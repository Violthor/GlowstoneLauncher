import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Search, Package, Trash2, FolderOpen, X, Loader2, RefreshCw, FileArchive, DownloadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLauncherStore } from '@/hooks/useLauncherStore';
import { toast } from 'sonner';
import type { IMod } from '@/data/launcher';
import { MODRINTH_ZH_MAP } from '@/data/launcher';
import { resolveModZh } from '@/data/modZh';

// Modrinth 请求：优先 MCIM 国内镜像，失败回退官方；两源都失败抛 netDown（区别于"无匹配"）
const MR_BASES = ['https://mod.mcimirror.top/modrinth/v2', 'https://api.modrinth.com/v2'];
function mrGet(path: string, timeoutMs = 9000): Promise<any> {
  let lastErr: unknown = null;
  return (async () => {
    for (const base of MR_BASES) {
      const ctrl = new AbortController();
      const tm = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch(base + path, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
        if (!r.ok) { lastErr = new Error('HTTP ' + r.status); continue; }
        return await r.json();
      } catch (e) { lastErr = e; }
      finally { clearTimeout(tm); }
    }
    throw Object.assign(new Error('Modrinth 网络不可达（镜像与官方均失败）'), { netDown: true, last: String((lastErr as Error)?.message || lastErr) });
  })();
}
function mrPost(path: string, body: unknown, timeoutMs = 12000): Promise<any> {
  let lastErr: unknown = null;
  return (async () => {
    for (const base of MR_BASES) {
      const ctrl = new AbortController();
      const tm = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch(base + path, {
          method: 'POST', signal: ctrl.signal,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) { lastErr = new Error('HTTP ' + r.status); continue; }
        return await r.json();
      } catch (e) { lastErr = e; }
      finally { clearTimeout(tm); }
    }
    throw Object.assign(new Error('Modrinth 网络不可达（镜像与官方均失败）'), { netDown: true, last: String((lastErr as Error)?.message || lastErr) });
  })();
}
interface LatestInfo { version: string; url: string; filename: string }

const categoryLabelMap: Record<string, string> = {
  optimization: '性能优化', utility: '实用工具', technology: '科技', magic: '魔法',
  adventure: '冒险', decoration: '装饰', library: '依赖库', worldgen: '世界生成',
  storage: '存储', food: '食物', equipment: '装备', 'game-mechanics': '游戏机制',
  transportation: '运输', mobs: '生物', social: '社交', economy: '经济',
  combat: '战斗', cursed: '搞怪魔性', miscellaneous: '杂项', cosmetic: '外观',
  fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt',
};

const getCategoryLabel = (cat: string) => categoryLabelMap[cat] ?? cat;

interface DiskMod {
  id: string;
  fileName: string;
  name: string;
  version: string;
  description: string;
  author: string;
  iconUrl: string;
  loaders: string[];
  enabled: boolean;
  sha1?: string;
  sha512?: string;
}

function getElectronAPI() {
  return (window as unknown as { electronAPI?: {
    openFolder: (p: string) => Promise<{ success: boolean; error?: string }>;
    openVersionFolder?: (a: { root: string; versionId: string; isolated: boolean; kind: string }) => Promise<{ success: boolean; error?: string; path?: string }>;
    scanMods?: (a: { root: string; versionId: string; isolated: boolean }) => Promise<{ success: boolean; error?: string; mods?: DiskMod[]; modDir?: string }>;
    toggleMod?: (a: { root: string; versionId: string; isolated: boolean; fileName: string; enabled: boolean }) => Promise<{ success: boolean; error?: string; fileName?: string }>;
    deleteMod?: (a: { root: string; versionId: string; isolated: boolean; fileName: string }) => Promise<{ success: boolean; error?: string }>;
    exportModpack?: (a: { root: string; versionId: string; isolated: boolean }) => Promise<{ success: boolean; canceled?: boolean; savePath?: string; error?: string }>;
    downloadFile?: (url: string, dir: string, name: string) => Promise<{ success: boolean; error?: string }>;
  } }).electronAPI ?? null;
}

export default function ModManagePage() {
  const { installedMods, setModEnabled, removeInstalledMod, currentVersionObj, settings, installedVersions } = useLauncherStore();
  const [keyword, setKeyword] = useState('');
  const [filterEnabled, setFilterEnabled] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [diskMods, setDiskMods] = useState<DiskMod[]>([]);
  const [loading, setLoading] = useState(false);
  const [modDir, setModDir] = useState('');
  // Mods are per-version: let the user pick which installed version to manage (defaults to current).
  const [scopeVersionId, setScopeVersionId] = useState(currentVersionObj?.id ?? '');
  const [updates, setUpdates] = useState<Record<string, LatestInfo>>({});
  const [checking, setChecking] = useState(false);
  // PCL2 中文译名库（按需异步加载，单独分包），让本地扫描出的 Mod 也能直接显示中文名
  const [wikiZh, setWikiZh] = useState<Record<string, string>>({});
  useEffect(() => { let dead = false; import('@/data/wikiZh.json').then((m) => { if (!dead) setWikiZh((m as { default: Record<string, string> }).default || (m as unknown as Record<string, string>)); }).catch(() => {}); return () => { dead = true; }; }, []);

  const effectiveVid = scopeVersionId || currentVersionObj?.id || '';
  const scopeVersion = installedVersions.find((v) => v.id === effectiveVid) || currentVersionObj;
  const root = (scopeVersion && scopeVersion.gameDir) || settings.downloadDir || '.minecraft';
  const isolated = (settings as Record<string, unknown>).versionIsolation === true;
  const versionId = scopeVersion?.id ?? '';

  const refresh = useCallback(async () => {
    const api = getElectronAPI();
    if (!api || !api.scanMods || !versionId) { setDiskMods([]); return; }
    setLoading(true);
    try {
      const res = await api.scanMods({ root, versionId, isolated });
      if (res.success) {
        setDiskMods(res.mods || []);
        setModDir(res.modDir || '');
      } else {
        toast.error(`扫描 Mod 失败：${res.error}`);
      }
    } finally {
      setLoading(false);
    }
  }, [root, versionId, isolated]);

  useEffect(() => { refresh(); }, [refresh]);
  // 窗口重新聚焦（如下载完 Mod 切回、从游戏返回）时自动重扫，避免新装的 Mod 要手动点刷新才出现
  useEffect(() => {
    const onFocus = () => { refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  // Merge disk-scanned mods (authoritative) with any online-installed records that carry
  // extra metadata (Chinese name / categories). Disk files win on identity & enabled state.
  const mergedMods: IMod[] = useMemo(() => {
    const onlineById = new Map<string, IMod>();
    installedMods.forEach((m) => onlineById.set(m.id, m));
    const list: IMod[] = diskMods.map((d) => {
      const online = onlineById.get(d.id);
      // 离线中文译名：优先在线记录，其次用 Mod id 走 PCL2 中文库/内置字典，匹配不到则回退英文原名
      const offlineZh = resolveModZh(wikiZh, MODRINTH_ZH_MAP, String(d.id || '').toLowerCase()).name;
      return {
        id: d.id,
        slug: d.id,
        name: d.name,
        nameZh: online?.nameZh || offlineZh || undefined,
        description: d.description || online?.description || '',
        iconUrl: d.iconUrl || online?.iconUrl || '',
        version: d.version || online?.version || '',
        author: d.author || online?.author || '未知作者',
        categories: d.loaders?.length ? d.loaders : (online?.categories || []),
        gameVersions: online?.gameVersions || [],
        loaders: d.loaders?.length ? d.loaders : (online?.loaders || []),
        downloads: online?.downloads || 0,
        updatedAt: online?.updatedAt || '',
        source: 'local',
        enabled: d.enabled,
        installedVersionId: versionId,
        fileName: d.fileName,
        sha1: d.sha1 || online?.sha1,
        sha512: d.sha512 || online?.sha512,
        projectId: online?.projectId,
        installedMrVersionId: online?.installedMrVersionId,
      };
    });
    return list;
  }, [diskMods, installedMods, versionId, wikiZh]);

  const displayMods = useMemo(() => {
    return mergedMods.filter((m) => {
      if (keyword && !m.name.toLowerCase().includes(keyword.toLowerCase()) && !(m.nameZh ?? '').includes(keyword)) return false;
      if (filterEnabled === 'enabled' && !m.enabled) return false;
      if (filterEnabled === 'disabled' && m.enabled) return false;
      if (categoryFilter !== 'all' && !m.categories.includes(categoryFilter)) return false;
      return true;
    });
  }, [mergedMods, keyword, filterEnabled, categoryFilter]);

  const allCategories = useMemo(() => {
    const set = new Set<string>();
    mergedMods.forEach((m) => m.categories.forEach((c) => set.add(c)));
    return Array.from(set);
  }, [mergedMods]);

  const enabledCount = mergedMods.filter((m) => m.enabled).length;
  const totalCount = mergedMods.length;

  const handleToggle = async (mod: IMod) => {
    const api = getElectronAPI();
    const next = !mod.enabled;
    if (mod.source === 'local' && mod.fileName && api?.toggleMod) {
      const fn = mod.fileName as string;
      // optimistic (match by fileName because duplicate jars can share a mod id)
      setDiskMods((prev) => prev.map((d) => (d.fileName === fn ? { ...d, enabled: next } : d)));
      const res = await api.toggleMod({ root, versionId, isolated, fileName: fn, enabled: next });
      if (!res.success) {
        toast.error(`切换失败：${res.error}`);
        setDiskMods((prev) => prev.map((d) => (d.fileName === fn ? { ...d, enabled: !next } : d)));
      } else {
        toast.success(next ? `已启用 ${mod.nameZh ?? mod.name}` : `已禁用 ${mod.nameZh ?? mod.name}（重启游戏生效）`);
        refresh();
      }
    } else {
      setModEnabled(mod.id, next);
    }
  };

  const handleRemove = async (mod: IMod) => {
    const api = getElectronAPI();
    if (mod.source === 'local' && mod.fileName && api?.deleteMod) {
      const res = await api.deleteMod({ root, versionId, isolated, fileName: mod.fileName });
      if (!res.success) { toast.error(`删除失败：${res.error}`); return; }
      removeInstalledMod(mod.id);
      toast.info(`已删除 ${mod.nameZh ?? mod.name}`);
      refresh();
    } else {
      removeInstalledMod(mod.id);
      toast.info(`已移除 ${mod.nameZh ?? mod.name}`);
    }
  };

  // Keep the managed version following the home-selected version unless the user picked one.
  useEffect(() => { if (currentVersionObj?.id) setScopeVersionId((prev) => prev || currentVersionObj.id); }, [currentVersionObj?.id]);

  const handleExportModpack = async () => {
    if (!versionId) { toast.error('请先选择要导出的版本'); return; }
    const api = getElectronAPI();
    const res = await api?.exportModpack?.({ root, versionId, isolated });
    if (!res) return;
    if (res.canceled) return;
    if (res.success) { toast.success('整合包已导出：' + res.savePath); }
    else toast.error('导出失败：' + res.error);
  };

  // 检查全部 Mod（本地 Mod 按名称在 Modrinth 解析项目，在线下载的直接用项目 id）
  const resolveProjectId = async (mod: IMod): Promise<string> => {
    const rec = installedMods.find((x) => x.id === mod.id);
    if (rec?.source === 'modrinth' && rec.id) return rec.id;
    const d = await mrGet(`/search?query=${encodeURIComponent(mod.name)}&limit=1&facets=${encodeURIComponent('[["project_type:mod"]]')}`, 8000);
    const hit = d?.hits?.[0];
    // 名称需大致对得上，避免把同名不相干项目误判为更新
    if (hit && (hit.title?.toLowerCase().includes(mod.name.toLowerCase()) || mod.name.toLowerCase().includes(hit.title?.toLowerCase() || '§§'))) return hit.id;
    return '';
  };

  const checkUpdates = async () => {
    if (!mergedMods.length) { toast.message('当前版本还没有 Mod'); return; }
    setChecking(true);
    const next: Record<string, LatestInfo> = {};
    let netFailed = false;

    // 1) 文件哈希批量识别（等同 PCL2）：POST /version_files，返回 hash→已装版本（含 project_id）
    const byHash = new Map<string, IMod>();
    mergedMods.forEach((m) => { if (m.sha1) byHash.set(m.sha1, m); });
    let hashMap: Record<string, any> = {};
    if (byHash.size) {
      try { hashMap = await mrPost('/version_files', { hashes: [...byHash.keys()], algorithm: 'sha1' }); }
      catch (e) { if ((e as { netDown?: boolean }).netDown) netFailed = true; }
    }
    const identified = new Map<string, { m: IMod; ver: any }>();
    Object.entries(hashMap).forEach(([hash, ver]) => {
      const m = byHash.get(hash);
      if (m) identified.set(m.id, { m, ver });
    });

    // 2) 哈希没识别到的，回退按名字搜索项目（闭源/非 Modrinth 可能找不到）
    const nameFallback = mergedMods.filter((m) => !identified.has(m.id));
    const pidByName = new Map<string, string>();
    await Promise.all(nameFallback.map(async (m) => {
      try { const pid = await resolveProjectId(m); if (pid) pidByName.set(m.id, pid); }
      catch (e) { if ((e as { netDown?: boolean }).netDown) netFailed = true; }
    }));

    // 3) 按项目聚合，拉版本列表，按加载器/游戏版本过滤后取最新，与已装版本比对
    const projects = new Map<string, { mods: IMod[]; installed: Set<string>; loaders: Set<string>; gv: Set<string> }>();
    identified.forEach(({ m, ver }) => {
      const pid = ver.project_id;
      if (!projects.has(pid)) projects.set(pid, { mods: [], installed: new Set(), loaders: new Set(), gv: new Set() });
      const p = projects.get(pid)!;
      p.mods.push(m); p.installed.add(ver.id);
      (ver.loaders || []).forEach((l: string) => p.loaders.add(l));
      (ver.game_versions || []).forEach((g: string) => p.gv.add(g));
    });
    pidByName.forEach((pid, id) => {
      const m = mergedMods.find((x) => x.id === id);
      if (!projects.has(pid)) projects.set(pid, { mods: [], installed: new Set(), loaders: new Set(m?.loaders || []), gv: new Set() });
      if (m) projects.get(pid)!.mods.push(m);
    });

    let matched = 0;
    await Promise.all([...projects.entries()].map(async ([pid, p]) => {
      try {
        const list = await mrGet(`/project/${pid}/version`, 10000);
        let versions = Array.isArray(list) ? list : [];
        if (p.loaders.size) {
          const fit = versions.filter((v: { loaders?: string[] }) => (v.loaders || []).some((l) => p.loaders.has(l)));
          if (fit.length) versions = fit;
        }
        if (p.gv.size) {
          const fit = versions.filter((v: { game_versions?: string[] }) => (v.game_versions || []).some((g) => p.gv.has(g)));
          if (fit.length) versions = fit;
        }
        const latest = versions[0];
        p.mods.forEach((m) => {
          matched++;
          if (latest && !p.installed.has(latest.id) && Array.isArray(latest.files) && latest.files.length) {
            const f = latest.files.find((x: { primary: boolean }) => x.primary) || latest.files[0];
            next[m.id] = { version: latest.version_number, url: f.url, filename: f.filename };
          }
        });
      } catch (e) { if ((e as { netDown?: boolean }).netDown) netFailed = true; }
    }));

    setUpdates(next);
    setChecking(false);
    const n = Object.keys(next).length;
    // 网络完全不通时明确提示网络问题，而不是误报"闭源/非 Modrinth"
    if (netFailed && !matched) toast.error('无法连接 Modrinth（国内镜像与官方均不可达），请检查网络后重试');
    else if (!matched) toast.message('未能联网匹配到这些 Mod（可能是闭源/非 Modrinth Mod）');
    else toast[n ? 'message' : 'success'](n ? `已比对 ${matched} 个，发现 ${n} 个可更新，点行内"更新"` : `已比对 ${matched} 个 Mod，均为最新`);
  };

  const updateMod = async (mod: IMod) => {
    const info = updates[mod.id];
    const api = getElectronAPI();
    if (!info || !api?.downloadFile || !modDir) return;
    const res = await api.downloadFile(info.url, modDir, info.filename);
    if (res.success) { toast.success(`${mod.nameZh ?? mod.name} 已更新到 ${info.version}`); refresh(); }
    else toast.error('更新失败：' + res.error);
  };

  const openModFolder = async () => {
    const api = getElectronAPI();
    if (scopeVersion && api && api.openVersionFolder) {
      const result = await api.openVersionFolder({ root, versionId, isolated, kind: 'mods' });
      if (!result.success) toast.error(`打开文件夹失败: ${result.error}`);
      return;
    }
    const modDirFallback = `${root}/mods`;
    if (api) {
      const result = await api.openFolder(modDirFallback);
      if (!result.success) toast.error(`打开文件夹失败: ${result.error}`);
    } else {
      toast.info(`Mod 文件夹路径: ${modDirFallback}`);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mod 管理</h1>
          <p className="text-muted-foreground text-sm mt-1">
            管理已安装的 Mod，{enabledCount} / {totalCount} 个已启用
            {modDir && <span className="ml-2 text-xs opacity-70">目录：{modDir}</span>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Select value={effectiveVid} onValueChange={setScopeVersionId}>
            <SelectTrigger className="w-[200px] h-9"><SelectValue placeholder="选择版本" /></SelectTrigger>
            <SelectContent>
              {installedVersions.map((v) => (<SelectItem key={v.id} value={v.id}>{v.id}</SelectItem>))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={refresh} className="gap-2" disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}刷新
          </Button>
          <Button variant="outline" onClick={checkUpdates} className="gap-2" disabled={checking}>
            {checking ? <Loader2 className="size-4 animate-spin" /> : <DownloadCloud className="size-4" />}检查更新
          </Button>
          <Button variant="outline" onClick={handleExportModpack} className="gap-2">
            <FileArchive className="size-4" />导出整合包
          </Button>
          <Button variant="outline" onClick={openModFolder} className="gap-2">
            <FolderOpen className="size-4" />打开 Mod 文件夹
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索 Mod..." className="pl-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none" />
            {keyword && (
              <button type="button" onClick={() => setKeyword('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Select value={filterEnabled} onValueChange={setFilterEnabled}>
              <SelectTrigger className="w-[120px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="enabled">仅启用</SelectItem>
                <SelectItem value="disabled">仅禁用</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[130px] h-9"><SelectValue placeholder="分类" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部分类</SelectItem>
                {allCategories.map((c) => (<SelectItem key={c} value={c}>{getCategoryLabel(c)}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <div className="space-y-2">
        {loading && totalCount === 0 ? (
          <Card className="p-10 text-center">
            <Loader2 className="size-10 mx-auto animate-spin text-muted-foreground mb-3" />
            <p className="text-muted-foreground">正在扫描 Mod 文件夹...</p>
          </Card>
        ) : displayMods.length === 0 ? (
          <Card className="p-10 text-center">
            <Package className="size-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">{totalCount === 0 ? '暂无已安装的 Mod，去资源下载页获取吧' : '暂无匹配的 Mod'}</p>
          </Card>
        ) : (
          displayMods.map((mod, index) => (
            <motion.div key={`${mod.id}-${mod.fileName ?? ''}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03, duration: 0.25 }}>
              <Card className={`overflow-hidden transition-all ${mod.enabled ? '' : 'opacity-50'}`}>
                <div className="p-3.5 flex items-start gap-3">
                  <div className="shrink-0 w-12 h-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                    {mod.iconUrl ? (
                      <img src={mod.iconUrl} alt={mod.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
                    ) : (
                      <Package className="size-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-sm truncate">{mod.nameZh ?? mod.name}</h3>
                      {mod.nameZh && <span className="text-muted-foreground text-xs font-normal">| {mod.name}</span>}
                      {mod.version && <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">v{mod.version}</Badge>}
                      {!mod.enabled && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">已禁用</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{mod.description || '无描述'}</p>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {mod.categories.slice(0, 3).map((c) => (<Badge key={c} variant="secondary" className="text-[10px] px-1.5 py-0">{getCategoryLabel(c)}</Badge>))}
                      <span className="text-[11px] text-muted-foreground">作者：{mod.author}</span>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-3">
                    {updates[mod.id] && (
                      <Button size="sm" variant="outline" className="h-8 gap-1 text-amber-600 border-amber-400" onClick={() => updateMod(mod)}>
                        <DownloadCloud className="size-3.5" />更新到 {updates[mod.id].version}
                      </Button>
                    )}
                    <div className="flex items-center gap-2">
                      <Switch checked={mod.enabled} onCheckedChange={() => handleToggle(mod)} />
                      <span className="text-xs text-muted-foreground hidden sm:inline">{mod.enabled ? '启用' : '禁用'}</span>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => handleRemove(mod)} className="text-muted-foreground hover:text-destructive h-8 w-8">
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))
        )}
      </div>
    </motion.div>
  );
}
