import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Download, AlertTriangle, Check, Search, X, FolderOpen, FolderInput, HardDrive, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { useLauncherStore } from '@/hooks/useLauncherStore';
import { enqueueDownload, updateDownloadPercent } from '@/hooks/useDownloadQueue';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit-lite';
import type { IVersionManifestItem, IInstalledVersion } from '@/data/launcher';
import VersionIcon, { defaultVersionIcon } from '@/components/VersionIcon';
import { isMobileHost } from '@/mobile/bridge';

const CATEGORIES = [
  { key: 'release', label: '正式版', icon: 'grass' as const, color: 'text-green-600' },
  { key: 'snapshot', label: '预览版', icon: 'command' as const, color: 'text-blue-600' },
  { key: 'old', label: '远古版', icon: 'cobble' as const, color: 'text-amber-700' },
  { key: 'april_fools', label: '愚人节版', icon: 'gold' as const, color: 'text-yellow-500' },
] as const;

const LOADERS = [
  { key: 'vanilla', label: 'Vanilla', desc: '纯净原版' },
  { key: 'fabric', label: 'Fabric', desc: '轻量高性能' },
  { key: 'forge', label: 'Forge', desc: 'Mod 资源最丰富' },
  { key: 'quilt', label: 'Quilt', desc: 'Fabric 分支' },
  { key: 'neoforge', label: 'NeoForge', desc: 'Forge 现代分支' },
] as const;

// 版本 → 支持的加载器（跟 PCL2 一样：有的才显示）。规则按官方加载器支持线：
// Fabric/Quilt ≥1.14（快照看年份 ≥18w，pre/rc 看主版本）；Forge ≥1.1 仅正式版；NeoForge ≥1.20.1 仅正式版。
const mcNum = (v: string): number[] => String(v).replace(/[^0-9.]/g, '').split('.').map((x) => parseInt(x, 10) || 0);
const mcGe = (v: string, a: number[]): boolean => {
  const n = mcNum(v);
  if (!n.length) return false;
  for (let i = 0; i < Math.max(n.length, a.length); i++) {
    const x = n[i] || 0, y = a[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
};
const isSnapId = (v: string): boolean => !/^\d+(\.\d+)*$/.test(v);
function loadersForVersion(id: string) {
  const v = String(id || '');
  const loaders = [LOADERS[0]];
  if (isAprilFools(v) || /^(rd-|c0|a1|b1|inf|classic|indev|alpha|beta)/i.test(v)) return loaders; // 远古/愚人节只有原版
  let fabOk = false;
  if (!isSnapId(v)) fabOk = mcGe(v, [1, 14]);
  else if (/^\d{2}w/.test(v)) fabOk = parseInt(v.slice(0, 2), 10) >= 18;
  else fabOk = mcGe(v, [1, 14]); // pre / rc
  if (fabOk) loaders.push(LOADERS[1], LOADERS[3]); // fabric, quilt
  if (!isSnapId(v) && mcGe(v, [1, 1])) loaders.push(LOADERS[2]); // forge
  if (!isSnapId(v) && mcGe(v, [1, 20, 1])) loaders.push(LOADERS[4]); // neoforge
  return loaders;
}
// 手机原生桥已支持 vanilla/fabric/quilt/forge/neoforge 五种加载器
function supportedLoaders(id: string) {
  return loadersForVersion(id);
}

const APRIL_FOOLS_IDS = new Set([
  '24w14potato', '23w13a_or_b', '22w13oneblockatatime', '20w14infinite',
  '3D Shareware v1.34', '1.14.3 - Combat Test', '2.0', '1.15 April Fools',
  '25w14craftmine', '24w13a', '23w13a', '22w13a', '21w15a', '20w14a',
  '1.RV-Pre1', '15w14a', '2.0', '2.1',
]);

function isAprilFools(id: string): boolean {
  return APRIL_FOOLS_IDS.has(id) ||
    id.includes('potato') || id.includes('20w14inf') || id.includes('22w13one') ||
    id.includes('23w13a_or') || id.includes('3D Shareware') || id.includes('combat') ||
    id.includes('april') || id.includes('April') || /^25w14/i.test(id);
}

const INITIAL_SHOWN = 10;

export default function VersionDownloadPage() {
  const { installedVersions, addInstalledVersion, updateInstalledVersion, appendLog, settings, setSettings } = useLauncherStore();
  const downloadSource = settings.downloadSource || 'bmcl';
  const [diskFreeGB, setDiskFreeGB] = useState<number | null>(null);
  const [versions, setVersions] = useState<IVersionManifestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['release']));
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVersion, setSelectedVersion] = useState<IVersionManifestItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [selectedLoader, setSelectedLoader] = useState('vanilla');
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStage, setDownloadStage] = useState('');
  const [nameConflict, setNameConflict] = useState(false);
  const [downloadPath, setDownloadPath] = useState('');
  const [defaultMc, setDefaultMc] = useState('');
  const [drives, setDrives] = useState<Array<{ root: string; freeGB: number }>>([]);
  const [usedSource, setUsedSource] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [importing, setImporting] = useState(false);

  // 默认游戏目录（%APPDATA%\.minecraft，自动创建）与盘符列表，供安装弹窗快选
  useEffect(() => {
    const api = (window as unknown as { electronAPI?: {
      defaultMcDir?: () => Promise<{ success: boolean; path?: string }>;
      listDrives?: () => Promise<{ success: boolean; drives?: Array<{ root: string; freeGB: number }> }>;
    } }).electronAPI;
    api?.defaultMcDir?.().then((r) => { if (r.success && r.path) setDefaultMc(r.path); }).catch(() => {});
    api?.listDrives?.().then((r) => { if (r.success && r.drives) setDrives(r.drives); }).catch(() => {});
  }, []);

  const chooseFolder = async () => {
    const api = (window as unknown as { electronAPI?: { selectFolder: () => Promise<{ success: boolean; path?: string }> } }).electronAPI;
    if (!api) { toast.error('需要在桌面端中运行'); return; }
    const res = await api.selectFolder();
    if (res.success && res.path) setDownloadPath(res.path);
  };

  const sourceLabel = downloadSource === 'official' ? 'Mojang 官方源' : 'BMCLAPI 国内镜像';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true); setError(null);
        const api = (window as unknown as { electronAPI?: { fetchVersionManifest?: (s: string) => Promise<{ success: boolean; versions?: IVersionManifestItem[]; usedSource?: string; error?: string }> } }).electronAPI;
        let list: IVersionManifestItem[] = [];
        const mobile = isMobileHost();
        const ipcOnce = async (): Promise<{ list: IVersionManifestItem[]; src: string }> => {
          if (!api?.fetchVersionManifest) throw new Error('no ipc');
          const r = await api.fetchVersionManifest(downloadSource);
          if (!r.success) throw new Error(r.error || '获取失败');
          return { list: r.versions || [], src: r.usedSource === 'bmcl' ? 'BMCLAPI 镜像' : r.usedSource === 'cache' ? '本地清单（后台自动更新）' : r.usedSource === 'official' ? 'Mojang 官方源' : '' };
        };
        if (mobile) {
          // 手机：WebView 直连外部清单会被 CORS 拦截，只走原生 RPC（原生内部已 BMCL/官方故障转移），重试 2 次
          let lastErr: unknown = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const r = await ipcOnce();
              list = r.list;
              if (!cancelled) setUsedSource(r.src);
              break;
            } catch (e) {
              lastErr = e;
              if (attempt < 2) await new Promise((res) => setTimeout(res, 600));
            }
          }
          if (!list.length && lastErr) throw lastErr;
        } else {
          // 桌面：主进程 IPC 与渲染层直连 BMCL（Chromium 网络栈）竞速，根治冷启动 DNS/TLS/系统代理探测的长时间转圈
          const directFetch = async (): Promise<IVersionManifestItem[]> => {
            const ctrl = new AbortController();
            const tm = setTimeout(() => ctrl.abort(), 9000);
            try {
              const res = await fetch('https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json', { signal: ctrl.signal });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const data = await res.json();
              return data.versions || [];
            } finally { clearTimeout(tm); }
          };
          try {
            const result = await Promise.any([
              ipcOnce().then((r) => ({ list: r.list, src: r.src })),
              directFetch().then((l) => ({ list: l, src: 'BMCLAPI 直连' })),
            ]);
            list = result.list;
            if (!cancelled) setUsedSource(result.src);
          } catch {
            const r = await ipcOnce(); // 两条路都失败：再试一次 IPC（可能命中磁盘缓存）
            list = r.list;
          }
        }
        if (!cancelled) setVersions(list);
      } catch (err) {
        logger.warn('Failed to fetch version manifest:', String(err));
        if (!cancelled) setError(`获取版本列表失败：${err instanceof Error ? err.message : '网络连接超时'}。请检查网络后点“重新加载”`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [downloadSource, reloadTick]);

  // Free space on the chosen install drive.
  useEffect(() => {
    if (!downloadPath) { setDiskFreeGB(null); return; }
    let alive = true;
    const api = (window as unknown as { electronAPI?: { diskFree?: (p: string) => Promise<{ success: boolean; freeGB?: number }> } }).electronAPI;
    api?.diskFree?.(downloadPath).then((r) => { if (alive && r.success && r.freeGB != null) setDiskFreeGB(r.freeGB); }).catch(() => {});
    return () => { alive = false; };
  }, [downloadPath]);

  const groupedVersions = useMemo(() => {
    const groups: Record<string, IVersionManifestItem[]> = {
      release: [], snapshot: [], old: [], april_fools: [],
    };
    const seen = new Set<string>();
    versions.forEach((v) => {
      if (seen.has(v.id)) return;
      seen.add(v.id);
      if (isAprilFools(v.id)) groups.april_fools.push(v);
      else if (v.type === 'release') groups.release.push(v);
      else if (v.type === 'snapshot') groups.snapshot.push(v);
      else groups.old.push(v);
    });
    return groups;
  }, [versions]);

  const toggleCategory = (key: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const openInstallDialog = (version: IVersionManifestItem) => {
    setSelectedVersion(version);
    setCustomName(version.id);
    // 跟 PCL2 一样：该版本不支持的加载器就不显示；若上次选择不在支持列表则重置为原版
    const supported = supportedLoaders(version.id);
    setSelectedLoader(supported.some((l) => l.key === selectedLoader) ? selectedLoader : 'vanilla');
    setNameConflict(false);
    setDownloadProgress(0);
    setDownloading(false);
    setDownloadPath(defaultMc);
    setDialogOpen(true);
  };

  const handleCustomNameChange = (value: string) => {
    setCustomName(value);
    setNameConflict(installedVersions.some((v) => v.id === value));
  };

  const startDownload = async () => {
    if (!selectedVersion || !customName.trim()) return;
    if (nameConflict) { toast.error('版本名称已存在'); return; }
    if (!downloadPath) { toast.error('请先选择下载位置'); return; }
    appendLog('INFO', `开始下载版本 ${customName} (${selectedLoader})...`);

    const api = (window as unknown as {
      electronAPI?: {
        installMinecraftVersion: (o: Record<string, unknown>) => Promise<{ success: boolean; cancelled?: boolean; error?: string; versionId?: string }>;
        onInstallProgress: (cb: (p: { stage: string; percent: number; detail: string }) => void) => () => void;
        installCancel: () => Promise<{ success: boolean; error?: string }>;
      }
    }).electronAPI;

    if (api?.installMinecraftVersion) {
      // 固化选择（弹窗关闭后 state 会清空），版本安装也进入右下角下载队列
      const ver = selectedVersion;
      const loader = selectedLoader;
      const name = customName.trim();
      const dir = downloadPath;
      const src = downloadSource;
      enqueueDownload(`安装版本 ${name}`, async (taskId) => {
        const unsub = api.onInstallProgress((p) => updateDownloadPercent(taskId, p.percent));
        const result = await api.installMinecraftVersion({
          versionUrl: ver.url,
          versionId: name,
          gameDir: dir,
          loader,
          source: src,
        });
        unsub();
        if (!result.success) return { success: false, error: result.error || '安装失败' };
        const finalDir = result.gameDir || dir;
        const isAF = isAprilFools(ver.id);
        const type = isAF ? 'april_fools' : (ver.type === 'old_alpha' || ver.type === 'old_beta') ? 'old' : ver.type as IInstalledVersion['versionType'];
        const catLabel = type === 'release' ? '正式版' : type === 'snapshot' ? '预览版' : type === 'april_fools' ? '愚人节版' : '远古版';
        addInstalledVersion({
          id: name,
          versionId: ver.id,
          loader: loader as IInstalledVersion['loader'],
          icon: defaultVersionIcon(loader, type as string),
          category: catLabel,
          description: `${loader} 加载器`,
          isFavorite: false,
          installTime: Date.now(),
          gameDir: finalDir,
          minMemoryMB: 512,
          maxMemoryMB: 4096,
          versionType: type as IInstalledVersion['versionType'],
        });
        appendLog('INFO', `版本 ${name} 安装完成`);
        return { success: true };
      }, () => { api.installCancel?.(); });
      toast.success('已加入下载队列，可在右下角查看进度');
      setDialogOpen(false);
    } else {
      toast.error('需要在桌面端中运行');
    }
  };

  const handleImportMinecraft = async () => {
    const api = (window as unknown as { electronAPI?: { scanMinecraft: () => Promise<{ success: boolean; versions?: Array<{id: string; versionId: string; gameDir: string; versionType: string; hasJar: boolean; loader?: string; loaderVersion?: string}>; mcDir?: string; error?: string }> } }).electronAPI;
    if (!api?.scanMinecraft) { toast.error('仅桌面版支持此功能'); return; }
    setImporting(true);
    let result: { success: boolean; versions?: Array<{id: string; versionId: string; gameDir: string; versionType: string; hasJar: boolean; loader?: string; loaderVersion?: string}>; mcDir?: string; error?: string };
    try {
      result = await api.scanMinecraft();
      if (!result.success) { toast.error(result.error || '扫描版本失败，请检查存储权限后重试'); return; }
      if (!result.versions || result.versions.length === 0) {
        toast.error(result.mcDir ? `未在 ${result.mcDir}/versions 检测到版本，请先在版本下载中下载` : '未检测到版本，请先下载版本');
        return;
      }
    let added = 0;
    let refreshed = 0;
    for (const v of result.versions) {
      const loader = ((v.loader as 'vanilla' | 'forge' | 'fabric' | 'quilt' | 'neoforge') || 'vanilla');
      const iconType = defaultVersionIcon(loader, v.versionType);
      const category = v.versionType === 'release' ? '正式版' : v.versionType === 'snapshot' ? '预览版' : '远古版';
      const vType = v.versionType as 'release' | 'snapshot' | 'old_alpha' | 'old_beta';
      const existing = installedVersions.find((iv) => iv.id === v.id);
      if (existing) {
        // 刷新已导入记录以纠正加载器；但保留用户手动设置的自定义图片图标
        const isCustomIcon = typeof existing.icon === 'string' && (existing.icon.startsWith('data:') || existing.icon.startsWith('custom:'));
        updateInstalledVersion(v.id, { loader, loaderVersion: v.loaderVersion, icon: isCustomIcon ? existing.icon : iconType, category, versionType: vType, gameDir: v.gameDir });
        refreshed++;
        continue;
      }
      addInstalledVersion({
        id: v.id,
        versionId: v.versionId,
        loader,
        loaderVersion: v.loaderVersion,
        icon: iconType,
        category,
        description: `从 ${result.mcDir} 导入`,
        isFavorite: false,
        installTime: Date.now(),
        gameDir: v.gameDir,
        minMemoryMB: 512,
        maxMemoryMB: 4096,
        versionType: vType,
      });
      added++;
    }
      toast.success(`导入完成：新增 ${added} 个，更新 ${refreshed} 个（共找到 ${result.versions.length} 个）`);
      appendLog('INFO', `从 ${result.mcDir} 导入：新增 ${added}，更新 ${refreshed}`);
    } catch (e: unknown) {
      toast.error(`扫描版本失败：${e instanceof Error ? e.message : '请重试'}`);
    } finally {
      setImporting(false);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const filterVersions = (items: IVersionManifestItem[]) => {
    if (!searchQuery) return items;
    const q = searchQuery.toLowerCase();
    return items.filter((v) => v.id.toLowerCase().includes(q));
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">版本下载</h1>
          <p className="text-muted-foreground text-sm mt-1">
            从 {sourceLabel} 获取版本（{isMobileHost() ? 'BMCL/官方自动故障转移' : '两源竞速自动切换'}{usedSource ? ` · 当前：${usedSource}` : ''}）
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={handleImportMinecraft} disabled={importing}>
          {importing ? <Loader2 className="size-4 animate-spin" /> : <FolderInput className="size-4" />}导入已有版本
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索版本号..."
          className="pl-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {searchQuery && (
          <button type="button" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        )}
      </div>

      {error && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-3 text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <Button size="sm" variant="outline" className="gap-1 shrink-0" onClick={() => setReloadTick((n) => n + 1)}>
            <RefreshCw className="size-3.5" />重新加载
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {CATEGORIES.map((cat) => {
          const filtered = filterVersions(groupedVersions[cat.key] || []);
          const isExpanded = expandedCategories.has(cat.key);
          const showingAll = showAll.has(cat.key);
          const displayItems = showingAll ? filtered : filtered.slice(0, INITIAL_SHOWN);
          if (loading) return null;
          if (filtered.length === 0 && searchQuery) return null;
          return (
            <Card key={cat.key} className="overflow-hidden">
              <button type="button" onClick={() => toggleCategory(cat.key)} className="w-full flex items-center justify-between p-3.5 hover:bg-muted/30 transition-colors text-left">
                <div className="flex items-center gap-3">
                  <VersionIcon type={cat.key} size={28} />
                  <span className="font-semibold">{cat.label}</span>
                  <Badge variant="secondary" className="font-mono text-xs">{filtered.length}</Badge>
                </div>
                <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                  <ChevronDown className="size-5 text-muted-foreground" />
                </motion.div>
              </button>
              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div key="content" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: 'easeInOut' }} className="overflow-hidden">
                    <div className="border-t border-border/50 max-h-[420px] overflow-y-auto p-1.5 space-y-0.5">
                      {loading ? (
                        <div className="text-center py-6 text-muted-foreground text-sm">加载中...</div>
                      ) : displayItems.length === 0 ? (
                        <div className="text-center py-6 text-muted-foreground text-sm">未找到版本</div>
                      ) : (
                        displayItems.map((v) => {
                          const installed = installedVersions.some((iv) => iv.versionId === v.id || iv.id === v.id);
                          return (
                            <motion.div key={v.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/40 transition-colors group">
                              <div className="flex items-center gap-3 min-w-0">
                                <VersionIcon type={cat.key} size={22} />
                                <div className="min-w-0">
                                  <div className="font-medium text-sm truncate">{v.id}</div>
                                  <div className="text-xs text-muted-foreground">{formatDate(v.releaseTime)}</div>
                                </div>
                              </div>
                              <Button size="sm" variant={installed ? 'ghost' : 'secondary'} onClick={() => openInstallDialog(v)} className="shrink-0 gap-1 h-8">
                                {installed ? <Check className="size-3.5" /> : <Download className="size-3.5" />}
                                {installed ? '已装' : '安装'}
                              </Button>
                            </motion.div>
                          );
                        })
                      )}
                      {filtered.length > INITIAL_SHOWN && (
                        <button
                          onClick={() => setShowAll((prev) => { const n = new Set(prev); if (n.has(cat.key)) n.delete(cat.key); else n.add(cat.key); return n; })}
                          className="w-full text-center py-2 text-xs text-primary hover:underline"
                        >
                          {showingAll ? '收起' : `显示全部 ${filtered.length} 个版本`}
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          );
        })}
        {loading && (
          <Card className="p-8 text-center text-muted-foreground">
            <div className="size-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            正在获取版本列表…（首选源 2.2 秒无响应自动并发备用源，离线时用本地缓存）
          </Card>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" onInteractOutside={(e) => { if (downloading) e.preventDefault(); }} onPointerDownOutside={(e) => { if (downloading) e.preventDefault(); }} onEscapeKeyDown={(e) => { if (downloading) e.preventDefault(); }}>
          <DialogHeader><DialogTitle>安装版本</DialogTitle></DialogHeader>
          {selectedVersion && (
            <div className="space-y-4">
              <div className="bg-muted/40 rounded-xl p-3 flex items-center gap-3">
                <VersionIcon type={isAprilFools(selectedVersion.id) ? 'april_fools' : (selectedVersion.type === 'old_alpha' || selectedVersion.type === 'old_beta') ? 'old' : selectedVersion.type as 'release' | 'snapshot'} size={32} />
                <div>
                  <div className="font-semibold">{selectedVersion.id}</div>
                  <div className="text-sm text-muted-foreground">{formatDate(selectedVersion.releaseTime)}</div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>自定义版本名</Label>
                <Input value={customName} onChange={(e) => handleCustomNameChange(e.target.value)} className={nameConflict ? 'border-destructive' : ''} disabled={downloading} />
                {nameConflict && <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="size-3" />版本名称已存在</p>}
              </div>
              <div className="space-y-2">
                <Label>选择加载器</Label>
                {(() => {
                  const supported = supportedLoaders(selectedVersion.id);
                  return (
                    <Tabs value={supported.some((l) => l.key === selectedLoader) ? selectedLoader : 'vanilla'} onValueChange={setSelectedLoader}>
                      <TabsList className="w-full" style={{ gridTemplateColumns: `repeat(${supported.length}, minmax(0, 1fr))` }}>
                        {supported.map((l) => (<TabsTrigger key={l.key} value={l.key} className="text-xs px-1">{l.label}</TabsTrigger>))}
                      </TabsList>
                      <TabsContent value={selectedLoader}><p className="text-sm text-muted-foreground pt-1">{supported.find((l) => l.key === selectedLoader)?.desc || LOADERS.find((l) => l.key === 'vanilla')?.desc}</p></TabsContent>
                    </Tabs>
                  );
                })()}
              </div>
              <div className="space-y-2">
                <Label>下载源（API）</Label>
                <Select value={downloadSource} onValueChange={(v) => setSettings({ downloadSource: v as 'official' | 'bmcl' })} disabled={downloading}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bmcl">BMCLAPI 国内镜像（推荐，速度快）</SelectItem>
                    <SelectItem value="official">Mojang 官方源</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>下载位置（自动创建 .minecraft 结构） <span className="text-destructive">*</span></Label>
                <div className="flex gap-2">
                  <Input value={downloadPath} onChange={(e) => setDownloadPath(e.target.value)} placeholder="默认 %APPDATA%\\.minecraft" disabled={downloading} className="text-sm flex-1" />
                  <Button variant="outline" size="icon" onClick={chooseFolder} disabled={downloading} type="button" className="shrink-0" title="选择已有文件夹或新建文件夹"><FolderOpen className="size-4" /></Button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {defaultMc && (
                    <button type="button" disabled={downloading} onClick={() => setDownloadPath(defaultMc)}
                      className="text-[11px] px-2 py-1 rounded-md border border-border hover:border-primary/50 hover:text-primary disabled:opacity-50">
                      默认 .minecraft
                    </button>
                  )}
                  {drives.map((d) => (
                    <button key={d.root} type="button" disabled={downloading} onClick={() => setDownloadPath(`${d.root}.minecraft`)}
                      className="text-[11px] px-2 py-1 rounded-md border border-border hover:border-primary/50 hover:text-primary disabled:opacity-50 inline-flex items-center gap-1">
                      <HardDrive className="size-3" />{d.root}（剩 {d.freeGB}GB）
                    </button>
                  ))}
                </div>
                {diskFreeGB != null && (
                  <p className={`text-xs ${diskFreeGB < 2 ? 'text-destructive' : 'text-muted-foreground'}`}>
                    该盘剩余空间 {diskFreeGB} GB{diskFreeGB < 2 ? '，空间可能不足，建议更换位置' : ''}
                  </p>
                )}
              </div>
              {downloading && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">{downloadStage || '下载中...'}</span><span className="font-mono">{downloadProgress}%</span></div>
                  <Progress value={downloadProgress} className="h-2" />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={downloading}>取消</Button>
            <Button onClick={startDownload} disabled={downloading || !customName.trim() || nameConflict || !downloadPath}>
              <Download className="size-4 mr-1" />{downloading ? '下载中' : '开始安装'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
