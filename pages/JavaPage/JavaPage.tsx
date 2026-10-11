import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Coffee, RefreshCw, Download, Loader2, FolderOpen, CheckCircle2, Cpu, FolderPlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { isMobileHost } from '@/mobile/bridge';
import { toast } from 'sonner';

interface JavaItem { path: string; major: number; custom?: boolean }
interface JreDef { major: number; title: string; fit: string }
const JRES: JreDef[] = [
  { major: 8, title: 'Java 8', fit: '适用于 1.16.5 及更早版本' },
  { major: 17, title: 'Java 17', fit: '适用于 1.17 – 1.20.4' },
  { major: 21, title: 'Java 21', fit: '适用于 1.20.5 / 1.21' },
  { major: 25, title: 'Java 25', fit: '最新 LTS，26.x 等最新版本强制需要' },
];

function getAPI() {
  return (window as unknown as {
    electronAPI?: {
      listJava?: (a?: { force?: boolean }) => Promise<{ javas: JavaItem[] }>;
      downloadJava?: (major: number) => Promise<{ success: boolean; path?: string; error?: string }>;
      importJava?: () => Promise<{ success: boolean; canceled?: boolean; path?: string; major?: number; error?: string; exists?: boolean }>;
      removeCustomJava?: (p: string) => Promise<{ success: boolean }>;
      openFolder?: (p: string) => Promise<{ success: boolean }>;
      onJavaDownloadProgress?: (cb: (p: { stage: string; percent: number; detail: string }) => void) => () => void;
    }
  }).electronAPI ?? null;
}

export default function JavaPage() {
  const isMobile = isMobileHost();
  const [javas, setJavas] = useState<JavaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const [progress, setProgress] = useState<Record<number, { stage: string; percent: number }>>({});
  const [importing, setImporting] = useState(false);

  const refresh = useCallback(async (force = false) => {
    const api = getAPI();
    if (!api?.listJava) { toast.error('需要在桌面端运行'); return; }
    setLoading(true);
    try {
      const r = await api.listJava(force ? { force: true } : undefined);
      // 去重 + 按大版本升序
      const seen = new Set<string>();
      const list = (r.javas || []).filter((j) => {
        const k = j.path.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }).sort((a, b) => (a.major || 999) - (b.major || 999));
      setJavas(list);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh(false);
    const api = getAPI();
    const off = api?.onJavaDownloadProgress?.((p) => {
      setProgress((prev) => ({ ...prev, [pickMajorFromStage(p.stage)]: { stage: p.stage, percent: p.percent || 0 } }));
    });
    return () => { off?.(); };
  }, [refresh]);

  // 下载进度事件不带 major（全局单任务），用当前 busy 的那个 major 归属
  const busyMajor = () => Number(Object.keys(busy).find((k) => busy[Number(k)]) || 0);
  const pickMajorFromStage = (_stage: string) => busyMajor();

  const download = async (major: number) => {
    const api = getAPI();
    if (!api?.downloadJava) { toast.error('需要在桌面端运行'); return; }
    setBusy((b) => ({ ...b, [major]: true }));
    setProgress((p) => ({ ...p, [major]: { stage: '开始下载…', percent: 2 } }));
    const r = await api.downloadJava(major);
    setBusy((b) => ({ ...b, [major]: false }));
    if (r.success) {
      setProgress((p) => ({ ...p, [major]: { stage: '完成', percent: 100 } }));
      toast.success(`Java ${major} 安装完成，已自动识别：${r.path}`);
      refresh(true);
    } else {
      toast.error(`Java ${major} 下载失败：${r.error}`);
      setProgress((p) => ({ ...p, [major]: { stage: '', percent: 0 } }));
    }
  };

  const majorOf = (j: JavaItem) => (!j.major ? '未知' : `Java ${j.major}`);

  const doImport = async () => {
    const api = getAPI();
    if (!api?.importJava) { toast.error('需要在桌面端运行'); return; }
    if (importing) return; // 防重入：原生对话框弹出前有延迟，避免连点开多个
    setImporting(true);
    try {
      const r = await api.importJava();
      if (r.canceled) return;
      if (r.success) { toast.success(`已导入并识别 Java ${r.major}：${r.path}`); refresh(true); }
      else if (!r.exists) toast.error(r.error || '导入失败');
    } finally { setImporting(false); }
  };

  const doRemove = async (p: string) => {
    const api = getAPI();
    await api?.removeCustomJava?.(p);
    setJavas((list) => list.filter((j) => j.path !== p));
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Coffee className="size-6 text-primary" />Java 管理</h1>
          <p className="text-muted-foreground text-sm mt-1">{isMobile ? 'Java 运行时已随启动器内置，无需下载；此处列出可用运行时' : '自动扫描全盘已安装的 Java；缺少时可一键下载，下载完成立即识别'}</p>
        </div>
        <div className="flex items-center gap-2">
          {!isMobile && (
          <Button variant="outline" className="gap-2" onClick={doImport} disabled={importing}>
            {importing ? <Loader2 className="size-4 animate-spin" /> : <FolderPlus className="size-4" />}手动导入
          </Button>
          )}
          <Button variant="outline" className="gap-2" onClick={() => refresh(true)} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}重新扫描
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Cpu className="size-4" />已识别的 Java（{javas.length}）</CardTitle>
          <CardDescription>启动游戏时会按版本所需自动选择最合适的一个</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {javas.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground py-4 text-center">{isMobile ? '内置运行时将在首次启动游戏时自动就位' : '暂未扫描到 Java，可在下方一键下载'}</p>
          )}
          {javas.map((j) => (
            <div key={j.path} className="flex items-center gap-3 rounded-xl border border-border/60 p-3">
              <Badge variant="secondary" className="shrink-0 font-mono">{majorOf(j)}</Badge>
              {j.custom && <Badge variant="outline" className="shrink-0 text-[10px]">手动导入</Badge>}
              <span className="flex-1 text-xs text-muted-foreground break-all font-mono">{j.path}</span>
              {!isMobile && (
              <Button size="sm" variant="ghost" className="shrink-0 gap-1" onClick={() => getAPI()?.openFolder?.(j.path)}>
                <FolderOpen className="size-3.5" />位置
              </Button>
              )}
              {j.custom && (
                <Button size="sm" variant="ghost" className="shrink-0 gap-1 text-muted-foreground hover:text-destructive" onClick={() => doRemove(j.path)}>
                  <Trash2 className="size-3.5" />移除
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {!isMobile && (
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        {JRES.map((jre) => {
          const installed = javas.some((j) => j.major === jre.major);
          const isBusy = !!busy[jre.major];
          const pg = progress[jre.major];
          return (
            <Card key={jre.major}>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2"><Coffee className="size-4 text-primary" />{jre.title}</span>
                  {installed && <CheckCircle2 className="size-4 text-green-500" />}
                </CardTitle>
                <CardDescription>{jre.fit}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {pg?.percent > 0 && pg.percent < 100 && (
                  <div className="space-y-1">
                    <Progress value={pg.percent} className="h-2" />
                    <p className="text-[11px] text-muted-foreground">{pg.stage} {pg.percent}%</p>
                  </div>
                )}
                <Button className="w-full gap-2" variant={installed ? 'outline' : 'default'} disabled={isBusy} onClick={() => download(jre.major)}>
                  {isBusy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                  {isBusy ? '下载中' : installed ? '重新下载' : '下载并安装'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      )}
    </motion.div>
  );
}
