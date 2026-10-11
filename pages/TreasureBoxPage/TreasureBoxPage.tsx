import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Gauge, Trash2, ArchiveRestore, Loader2, Download, FolderOpen } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useLauncherStore } from '@/hooks/useLauncherStore';
import { isMobileHost } from '@/mobile/bridge';
import { toast } from 'sonner';

type Api = {
  electronAPI?: {
    memoryOptimize?: () => Promise<{ success: boolean; freeGB?: number; beforeMB?: number; afterMB?: number; freedMB?: number; touched?: number; error?: string }>;
    cleanupGarbage?: (gameDir?: string, allDirs?: string[]) => Promise<{ success: boolean; deletedFiles?: number; freedMB?: number; error?: string }>;
    backupSaves?: (gameDir: string) => Promise<{ success: boolean; backupPath?: string; worlds?: number; error?: string }>;
    restoreSaves?: (gameDir: string, backupPath: string) => Promise<{ success: boolean; worlds?: number; error?: string }>;
    listSaves?: (gameDir: string) => Promise<{ success: boolean; worlds?: string[]; backups?: Array<{ name: string; path: string }>; error?: string }>;
    selectFolder?: () => Promise<{ success: boolean; path?: string; canceled?: boolean }>;
    downloadFile?: (url: string, dir: string, name?: string, taskId?: string) => Promise<{ success: boolean; savePath?: string; error?: string }>;
    onDownloadProgress?: (cb: (p: { taskId?: string; percent: number }) => void) => () => void;
    openFolder?: (p: string) => void;
  }
};
const api = () => (window as unknown as Api).electronAPI ?? null;

export default function TreasureBoxPage() {
  const isMobile = isMobileHost();
  const { installedVersions, currentVersionObj } = useLauncherStore();
  const targetId = currentVersionObj?.id ?? installedVersions[0]?.id ?? '';
  const target = installedVersions.find((v) => v.id === targetId) || currentVersionObj;
  const gameDir = target?.gameDir || '';

  const [memBusy, setMemBusy] = useState(false);
  const [memInfo, setMemInfo] = useState<string | null>(null);
  const [cleanBusy, setCleanBusy] = useState(false);
  const [cleanResult, setCleanResult] = useState<string | null>(null);
  const [savesBusy, setSavesBusy] = useState(false);
  const [savesData, setSavesData] = useState<{ worlds: string[]; backups: Array<{ name: string; path: string }> }>({ worlds: [], backups: [] });
  const [restoreBusy, setRestoreBusy] = useState<string | null>(null);

  // 下载自定义文件
  const [customUrl, setCustomUrl] = useState('');
  const [customDir, setCustomDir] = useState('');
  const [customName, setCustomName] = useState('');
  const [customBusy, setCustomBusy] = useState(false);
  const [customPercent, setCustomPercent] = useState(0);
  const customTaskId = useRef(`custom-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

  const loadSaves = async () => {
    if (!gameDir) { setSavesData({ worlds: [], backups: [] }); return; }
    const r = await api()?.listSaves?.(gameDir).catch(() => null);
    if (r?.success) setSavesData({ worlds: r.worlds || [], backups: r.backups || [] });
  };
  useEffect(() => { loadSaves(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gameDir]);

  // 监听自定义文件下载进度（按 taskId 过滤，避免和其它下载串扰）
  useEffect(() => {
    const off = api()?.onDownloadProgress?.((p) => {
      if (p.taskId === customTaskId.current && typeof p.percent === 'number') setCustomPercent(p.percent);
    });
    return () => { off?.(); };
  }, []);

  const doMemory = async () => {
    setMemBusy(true); setMemInfo(null);
    try {
      const r = await api()?.memoryOptimize?.();
      if (r?.success) {
        const gb = (mb: number) => (mb / 1024).toFixed(1);
        setMemInfo(typeof r.beforeMB === 'number' && typeof r.afterMB === 'number'
          ? `可用内存 ${gb(r.beforeMB)} GB → ${gb(r.afterMB)} GB，释放约 ${r.freedMB ?? 0} MB（整理 ${r.touched || 0} 个进程）`
          : `已整理 ${r.touched || 0} 个进程，当前可用内存约 ${r.freeGB} GB`);
      }
      else toast.error(r?.error || '内存优化失败');
    } finally { setMemBusy(false); }
  };

  const doClean = async () => {
    setCleanBusy(true); setCleanResult(null);
    try {
      // 收集所有已安装版本的游戏目录（去重），实现“所有版本一键清理”，而非只清当前版本
      const allDirs = Array.from(new Set(installedVersions.map((v) => v.gameDir).filter(Boolean) as string[]));
      const r = await api()?.cleanupGarbage?.(gameDir || undefined, allDirs);
      if (r?.success) {
        setCleanResult((r.deletedFiles || 0) === 0 ? '没有发现需要清理的游戏垃圾' : `已清理全部版本共 ${r.deletedFiles} 个文件，释放约 ${r.freedMB} MB`);
      } else toast.error(r?.error || '清理失败');
    } finally { setCleanBusy(false); }
  };

  const doBackup = async () => {
    if (!gameDir) { toast.error('请先在版本设置中选择一个版本'); return; }
    setSavesBusy(true);
    try {
      const r = await api()?.backupSaves?.(gameDir);
      if (r?.success) { toast.success(`已备份 ${r.worlds} 个世界`); loadSaves(); }
      else toast.error(r?.error || '备份失败');
    } finally { setSavesBusy(false); }
  };

  const doRestore = async (backupPath: string) => {
    if (!gameDir) return;
    setRestoreBusy(backupPath);
    try {
      const r = await api()?.restoreSaves?.(gameDir, backupPath);
      if (r?.success) toast.success(`已恢复 ${r.worlds} 个世界（冲突世界已备份为 .bak）`);
      else toast.error(r?.error || '恢复失败');
    } finally { setRestoreBusy(null); }
  };

  const chooseCustomDir = async () => {
    const r = await api()?.selectFolder?.();
    if (r?.success && r.path) setCustomDir(r.path);
  };

  const startCustomFile = async () => {
    const url = customUrl.trim();
    if (!url) { toast.error('请输入下载地址'); return; }
    try { new URL(url); } catch { toast.error('请输入有效的下载地址'); return; }
    if (!customDir) { toast.error('请选择保存位置'); return; }
    setCustomBusy(true); setCustomPercent(0);
    try {
      const r = await api()?.downloadFile?.(url, customDir, customName.trim() || undefined, customTaskId.current);
      if (r?.success) { setCustomPercent(100); toast.success('下载完成'); }
      else toast.error(r?.error || '下载失败，该网站可能限制了直接下载（如网盘）');
    } finally { setCustomBusy(false); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">百宝箱</h1>
        <p className="text-muted-foreground text-sm mt-1">系统清理、存档工具与文件下载</p>
      </div>

      {!isMobile && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 内存优化 */}
        <Card className="p-5 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Gauge className="size-4" />内存优化</div>
          <p className="text-xs text-muted-foreground">整理各进程（含启动器与游戏）的内存工作集，把占用的物理内存换出，降低任务管理器中的内存占用</p>
          <Button size="sm" onClick={doMemory} disabled={memBusy} className="w-fit">{memBusy ? <Loader2 className="size-3 animate-spin" /> : null}立即优化</Button>
          {memInfo && <p className="text-xs text-green-600">{memInfo}</p>}
        </Card>

        {/* 清理游戏垃圾 */}
        <Card className="p-5 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Trash2 className="size-4" />清理游戏垃圾</div>
          <p className="text-xs text-muted-foreground">一键清理所有版本的 logs、crash-reports、debug、崩溃日志与临时文件（含各盘与版本隔离目录），不会动存档和 Mod</p>
          <Button size="sm" variant="secondary" onClick={doClean} disabled={cleanBusy} className="w-fit">{cleanBusy ? <Loader2 className="size-3 animate-spin" /> : null}一键清理</Button>
          {cleanResult && <p className="text-xs text-green-600">{cleanResult}</p>}
        </Card>
      </div>
      )}

      {/* 下载自定义文件（真实可用） */}
      <Card className="p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3"><Download className="size-4" />下载自定义文件</div>
        <p className="text-xs text-muted-foreground mb-4">使用启动器下载引擎下载任意直链文件。部分网站（如百度网盘等需登录/鉴权的链接）可能报错（403），属正常。</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2 md:col-span-2">
            <Label>下载地址</Label>
            <Input value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="https://example.com/file.zip" disabled={customBusy} />
          </div>
          <div className="space-y-2">
            <Label>保存到</Label>
            <div className="flex gap-2">
              <Input value={customDir} readOnly placeholder="点击右侧选择文件夹" className="flex-1" />
              <Button type="button" variant="secondary" size="sm" onClick={chooseCustomDir} disabled={customBusy} className="shrink-0 gap-1">
                <FolderOpen className="size-3.5" />选择
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>文件名（可留空自动获取）</Label>
            <Input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="留空则使用链接中的文件名" disabled={customBusy} />
          </div>
        </div>
        {customBusy && (
          <div className="mt-4 space-y-2">
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">下载中…</span><span className="font-mono">{customPercent}%</span></div>
            <Progress value={customPercent} className="h-2" />
          </div>
        )}
        <div className="flex flex-wrap gap-2 mt-4">
          <Button size="sm" onClick={startCustomFile} disabled={customBusy || !customUrl || !customDir} className="gap-1">
            {customBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}开始下载
          </Button>
          <Button size="sm" variant="secondary" onClick={() => customDir && api()?.openFolder?.(customDir)} disabled={!customDir} className="gap-1">
            <FolderOpen className="size-3.5" />打开文件夹
          </Button>
        </div>
      </Card>

      {/* 存档备份/恢复（手机端隐藏：原生未实现） */}
      {!isMobile && (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
          <ArchiveRestore className="size-4" />存档备份 / 恢复
          <span className="ml-auto text-xs font-normal text-muted-foreground/80">针对版本：{targetId || '未选择'}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={doBackup} disabled={savesBusy || !gameDir}>{savesBusy ? <Loader2 className="size-3 animate-spin" /> : null}备份当前存档</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <div>
            <div className="text-xs text-muted-foreground mb-1">现有世界（{savesData.worlds.length}）</div>
            <div className="text-xs space-y-0.5 max-h-28 overflow-y-auto bg-muted/30 rounded-lg p-2">
              {savesData.worlds.length === 0 ? <span className="text-muted-foreground/70">没有存档（可能还没进过游戏）</span> :
                savesData.worlds.map((w) => (<div key={w} className="truncate">{w}</div>))}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">可用备份（{savesData.backups.length}）</div>
            <div className="text-xs space-y-1 max-h-28 overflow-y-auto bg-muted/30 rounded-lg p-2">
              {savesData.backups.length === 0 ? <span className="text-muted-foreground/70">还没有备份</span> :
                savesData.backups.map((b) => (
                  <div key={b.name} className="flex items-center justify-between gap-2">
                    <span className="truncate">{b.name.replace('saves-', '')}</span>
                    <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" disabled={restoreBusy === b.path} onClick={() => doRestore(b.path)}>
                      {restoreBusy === b.path ? <Loader2 className="size-3 animate-spin" /> : null}恢复
                    </Button>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </Card>
      )}
    </motion.div>
  );
}
