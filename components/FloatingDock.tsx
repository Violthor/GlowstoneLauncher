import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X, Power, CheckCircle2, AlertCircle, Loader2, Trash2 } from 'lucide-react';
import { useDownloadQueue } from '@/hooks/useDownloadQueue';
import { toast } from 'sonner';
import { isMobileHost } from '@/mobile/bridge';

interface RunningGame { pid: number; versionId: string; title?: string }
interface DockApi {
  gameRunningList?: () => Promise<RunningGame[]>;
  onGameRunningChanged?: (cb: (list: RunningGame[]) => void) => () => void;
  gameKill?: (pid?: number) => Promise<{ success: boolean; error?: string }>;
}
function getApi(): DockApi | null {
  return (window as unknown as { electronAPI?: DockApi }).electronAPI ?? null;
}

// 右下角全局悬浮坞：下载队列入口 + 运行中游戏的一键关闭（关闭钮始终在下载钮上方）
export default function FloatingDock() {
  const { tasks, clearFinishedDownloads, removeDownload, cancelDownload } = useDownloadQueue();
  const [games, setGames] = useState<RunningGame[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    const api = getApi();
    if (!api?.onGameRunningChanged) return;
    api.gameRunningList?.().then(setGames).catch(() => {});
    return api.onGameRunningChanged((l) => setGames(l));
  }, []);

  const activeCount = tasks.filter((t) => t.status === 'running' || t.status === 'pending').length;
  const hasTasks = tasks.length > 0;

  const killAll = async () => {
    const api = getApi();
    const r = await api?.gameKill?.();
    if (r?.success) toast.success('已关闭正在运行的游戏');
    else toast.error(r?.error || '关闭失败');
  };

  if (!hasTasks && games.length === 0) return null;

  const mobileDock = isMobileHost();

  return (
    <div
      className={`fixed z-[120] flex flex-col-reverse items-end gap-3 right-[max(1rem,env(safe-area-inset-right))] ${
        mobileDock
          ? 'bottom-[max(4.75rem,calc(env(safe-area-inset-bottom)+4.75rem))]'
          : 'bottom-[max(1rem,env(safe-area-inset-bottom))]'
      }`}
    >
      {/* 下载队列入口 */}
      {hasTasks && (
        <div className="relative">
          <AnimatePresence>
            {panelOpen && (
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className="absolute bottom-14 right-0 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <span className="text-sm font-semibold">下载队列（{activeCount} 个进行中）</span>
                  <button className="text-muted-foreground hover:text-foreground text-xs flex items-center gap-1" onClick={clearFinishedDownloads}>
                    <Trash2 className="size-3.5" />清除已完成
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto p-2 space-y-1.5">
                  {tasks.map((t) => (
                    <div key={t.id} className="rounded-lg px-3 py-2 bg-muted/40">
                      <div className="flex items-center gap-2">
                        {t.status === 'running' ? <Loader2 className="size-3.5 animate-spin text-primary shrink-0" />
                          : t.status === 'done' ? <CheckCircle2 className="size-3.5 text-green-500 shrink-0" />
                          : t.status === 'error' ? <AlertCircle className="size-3.5 text-destructive shrink-0" />
                          : <Download className="size-3.5 text-muted-foreground shrink-0" />}
                        <span className="text-xs font-medium truncate flex-1" title={t.name}>{t.name}</span>
                        <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                          {t.status === 'done' ? '完成' : t.status === 'error' ? '失败' : t.status === 'pending' ? '排队' : `${t.percent}%`}
                        </span>
                        <button
                          className="text-muted-foreground hover:text-foreground shrink-0"
                          title={t.cancel ? '取消下载' : '移除'}
                          onClick={() => {
                            const active = t.status === 'running' || t.status === 'pending';
                            if (active && t.cancel) cancelDownload(t.id);
                            else removeDownload(t.id);
                          }}
                        ><X className="size-3.5" /></button>
                      </div>
                      {(t.status === 'running') && (
                        <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${t.percent}%` }} /></div>
                      )}
                      {t.status === 'error' && t.error && <div className="mt-1 text-[10px] text-destructive break-all whitespace-normal">{t.error}</div>}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <motion.button
            whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
            onClick={() => setPanelOpen((v) => !v)}
            className="relative size-12 rounded-full bg-primary text-primary-foreground shadow-xl flex items-center justify-center"
            title="下载队列"
          >
            <Download className="size-5" />
            {activeCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-destructive text-white text-[10px] font-bold flex items-center justify-center">{activeCount}</span>
            )}
          </motion.button>
        </div>
      )}

      {/* 运行中游戏：一键关闭（位于下载钮上方，flex-col-reverse 下写在后面即更靠上） */}
      {games.length > 0 && (
        <motion.button
          initial={{ opacity: 0, scale: 0.6, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
          whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
          onClick={killAll}
          className="size-12 rounded-full bg-destructive text-destructive-foreground shadow-xl flex flex-col items-center justify-center"
          title={`一键关闭正在运行的游戏（${games.length}）`}
        >
          <Power className="size-5" />
        </motion.button>
      )}
    </div>
  );
}
