import { useEffect, useState } from 'react';

// 全局下载队列：可一次排多个下载，右下角悬浮坞统一展示进度。模块级单例，跨页面共享。
export type DownloadTaskStatus = 'pending' | 'running' | 'done' | 'error';
export interface DownloadTask {
  id: string;
  name: string;
  percent: number;
  status: DownloadTaskStatus;
  error?: string;
  // 真正中止下载的回调（如通知主进程 abort）；不提供时 X 仅移除卡片。
  cancel?: () => void;
}

let tasks: DownloadTask[] = [];
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function mutate(fn: (t: DownloadTask[]) => DownloadTask[]) { tasks = fn(tasks); emit(); }

// ponytail: 固定 3 并发，足够“同时下很多个”又不会把磁盘/网络打爆；需要更高吞吐再调
const MAX_CONCURRENT = 3;
let activeCount = 0;
const waiters: Array<() => void> = [];
function acquire(): Promise<void> {
  return new Promise((resolve) => {
    if (activeCount < MAX_CONCURRENT) { activeCount++; resolve(); }
    else waiters.push(() => { activeCount++; resolve(); });
  });
}
function release() {
  activeCount--;
  const next = waiters.shift();
  if (next) next();
}

let progressBound = false;
function bindProgress() {
  if (progressBound) return;
  progressBound = true;
  const api = (window as unknown as { electronAPI?: { onDownloadProgress?: (cb: (p: { taskId?: string; percent: number }) => void) => void } }).electronAPI;
  api?.onDownloadProgress?.((p) => {
    if (!p?.taskId) return;
    const id = p.taskId;
    mutate((ts) => ts.map((t) => (t.id === id ? { ...t, percent: p.percent } : t)));
  });
}

// 入队一个下载；run 收到 taskId，内部用它调 downloadFile 以便进度对号入座
export function enqueueDownload(
  name: string,
  run: (taskId: string) => Promise<{ success: boolean; error?: string }>,
  onCancel?: () => void,
): string {
  bindProgress();
  const id = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const cancel = onCancel ? () => { try { onCancel(); } catch {} } : undefined;
  mutate((ts) => [...ts, { id, name, percent: 0, status: 'pending', cancel }]);
  void (async () => {
    await acquire();
    mutate((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'running' } : t)));
    try {
      const r = await run(id);
      mutate((ts) => ts.map((t) => (t.id === id ? { ...t, status: r.success ? 'done' : 'error', percent: r.success ? 100 : t.percent, error: r.error } : t)));
    } catch (e) {
      mutate((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'error', error: String((e as Error)?.message || e) } : t)));
    } finally {
      release();
    }
  })();
  return id;
}

export function clearFinishedDownloads() { mutate((ts) => ts.filter((t) => t.status !== 'done')); }
export function removeDownload(id: string) { mutate((ts) => ts.filter((t) => t.id !== id)); }
// 取消并移除：先调用任务的中止回调（真正停止下载），再从列表移除卡片。
export function cancelDownload(id: string) {
  mutate((ts) => {
    const t = ts.find((x) => x.id === id);
    if (t && t.cancel) { try { t.cancel(); } catch {} }
    return ts.filter((x) => x.id !== id);
  });
}
// 供多文件聚合安装（如版本安装）从外部刷新某个队列任务的进度
export function updateDownloadPercent(id: string, percent: number) {
  mutate((ts) => ts.map((t) => (t.id === id ? { ...t, percent } : t)));
}

export function useDownloadQueue() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((x) => x + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return { tasks, clearFinishedDownloads, removeDownload, cancelDownload };
}
