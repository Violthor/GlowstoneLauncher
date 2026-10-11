import { memo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, FolderOpen, Settings2, Sparkles, Plus, ShieldCheck, Link2Off, Globe, Loader2, Check, Terminal, ChevronDown, FileText, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useLauncherStore } from '@/hooks/useLauncherStore';
import PixelAvatar from '@/components/PixelAvatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import VersionIcon from '@/components/VersionIcon';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { accountTypeLabel, randomOfficialSkin, loaderLabel } from '@/data/launcher';

function HomePageInner() {
  const { account, accounts, setAccount, addAccount, switchAccount, currentVersionObj, installedVersions, setCurrentVersion, settings, appendLog, updateInstalledVersion } = useLauncherStore();
  const navigate = useNavigate();
  const [showJvm, setShowJvm] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchPct, setLaunchPct] = useState(0);
  const [launchStage, setLaunchStage] = useState('准备中...');
  const [launchError, setLaunchError] = useState('');
  const [versionPickerOpen, setVersionPickerOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logData, setLogData] = useState<{ latestlog: string; latestcrash: string }>({ latestlog: '', latestcrash: '' });
  const [logLoading, setLogLoading] = useState(false);

  // 游戏启动后进程消失/闪退：读取最近一次游戏日志与崩溃报告，定位真实原因
  const openGameLogs = async () => {
    const api = (window as unknown as { electronAPI?: { readGameLogs?: () => Promise<{ latestlog: string; latestcrash: string }> } }).electronAPI;
    if (!api?.readGameLogs) { toast.error('当前环境不支持读取日志'); return; }
    setLogLoading(true);
    setLogOpen(true);
    try {
      const r = await api.readGameLogs();
      setLogData({ latestlog: r.latestlog || '', latestcrash: r.latestcrash || '' });
    } finally {
      setLogLoading(false);
    }
  };

  const copyLog = (text: string) => {
    if (!text) { toast.message('暂无内容'); return; }
    navigator.clipboard.writeText(text).then(() => toast.success('已复制，可粘贴发送')).catch(() => toast.error('复制失败'));
  };

  const handleLaunch = async () => {
    if (isLaunching) return;
    if (!account) { toast.error('请先添加账号'); navigate('/account'); return; }
    if (!currentVersionObj) { toast.error('请先选择版本'); navigate('/version-download'); return; }

    setIsLaunching(true);
    setLaunchError('');
    setLaunchPct(0);
    setLaunchStage('准备中...');
    setLaunchOpen(true);
    const maxMem = currentVersionObj.maxMemoryMB || settings.maxMemoryMB || 4096;
    const minMem = currentVersionObj.minMemoryMB || settings.minMemoryMB || 512;
    appendLog('INFO', '开始启动游戏...');
    appendLog('INFO', `版本: ${currentVersionObj.id} | 加载器: ${currentVersionObj.loader}`);
    appendLog('INFO', `内存: ${minMem}-${maxMem}MB`);

    const api = (window as unknown as {
      electronAPI?: {
        launchGame: (o: Record<string, unknown>) => Promise<{ success: boolean; pid?: number; error?: string; windowTitle?: string }>;
        onLaunchProgress?: (cb: (p: { stage: string; percent: number }) => void) => () => void;
      };
    }).electronAPI;

    if (api) {
      const unsub = api.onLaunchProgress
        ? api.onLaunchProgress((p) => { setLaunchPct(p.percent); setLaunchStage(p.stage); })
        : undefined;
      // launchGame resolves ONLY after the real game window appears (or fails)
      const result = await api.launchGame({
        javaPath: currentVersionObj.javaPath || '',
        gameDir: currentVersionObj.gameDir || '.minecraft',
        versionId: currentVersionObj.id,
        username: account.username,
        uuid: account.uuid || '',
        accessToken: account.accessToken || '0',
        userType: account.type === 'microsoft' ? 'msa' : 'mojang',
        accountType: account.type,
        externalServer: account.externalServer || '',
        jvmArgs: currentVersionObj.jvmArgs || '',
        maxMemory: maxMem,
        minMemory: minMem,
        versionIsolation: settings.versionIsolation === true,
      });
      unsub && unsub();
      if (result.success) {
        setLaunchPct(100);
        setLaunchStage('游戏窗口已出现');
        appendLog('INFO', `游戏已启动 (PID: ${result.pid})，窗口：${result.windowTitle || 'Minecraft'}`);
        toast.success('游戏已启动！');
        setTimeout(() => setLaunchOpen(false), 800);
      } else if ((result as { cancelled?: boolean }).cancelled) {
        setLaunchOpen(false);
        appendLog('WARN', '已取消本次启动');
      } else {
        setLaunchError(result.error || '未知错误');
        appendLog('ERROR', `启动失败: ${result.error}`);
        toast.error('游戏启动失败');
      }
    } else {
      const steps = ['正在检查游戏文件...', '正在加载资源...', '正在初始化...', '正在启动 Minecraft...'];
      for (const step of steps) {
        await new Promise((r) => setTimeout(r, 400));
        setLaunchStage(step);
        appendLog('INFO', step);
      }
      appendLog('WARN', '网页模式无法直接启动游戏，请使用桌面版');
      setLaunchError('网页模式无法直接启动游戏，请使用桌面版');
    }
    setIsLaunching(false);
  };

  const handleAddAccount = () => navigate('/account');
  const openVersionPicker = () => {
    if (installedVersions.length === 0) { toast.info('还没有已安装版本，先去下载一个'); navigate('/version-download'); return; }
    setVersionPickerOpen(true);
  };
  const pickVersion = (id: string) => {
    setCurrentVersion(id);
    setVersionPickerOpen(false);
    toast.success('已切换版本');
  };

  const handleSwitchType = (type: 'microsoft' | 'offline' | 'external') => {
    if (!account) { navigate('/account'); return; }
    if (type === 'microsoft') {
      // Switch to an existing Microsoft account instead of overwriting the current one.
      const ms = accounts.find((a) => a.type === 'microsoft');
      if (ms && ms.id) { switchAccount(ms.id); toast.success(`已切换到正版账号 ${ms.username}`); }
      else navigate('/account');
    } else if (type === 'offline') {
      // Reuse an offline account (same name first), otherwise add one WITHOUT dropping the MS account.
      const off = accounts.find((a) => a.type === 'offline' && a.username === account.username)
        || accounts.find((a) => a.type === 'offline');
      if (off && off.id) { switchAccount(off.id); toast.success(`已切换到离线账号 ${off.username}`); }
      else {
        addAccount({ type: 'offline', username: account.username, avatar: 'steve', skinUrl: randomOfficialSkin() });
        toast.success('已新增离线账号并切换（正版账号已保留，可在账号管理切回）');
      }
    } else {
      // 外置登录（LittleSkin 等 Yggdrasil 皮肤站）
      const ext = accounts.find((a) => a.type === 'external');
      if (ext && ext.id) { switchAccount(ext.id); toast.success(`已切换到外置账号 ${ext.username}`); }
      else navigate('/account');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="min-h-full flex flex-col"
    >
      <div className="flex justify-center mb-4">
        <div className="inline-flex rounded-full bg-card/80 backdrop-blur-sm border border-border/40 p-1 shadow-sm">
          <button
            type="button"
            onClick={() => account ? handleSwitchType('microsoft') : navigate('/account')}
            className="relative inline-flex h-8 items-center gap-2 rounded-full px-4 text-sm font-medium"
          >
            {account?.type === 'microsoft' && (
              <motion.span
                layoutId="acct-type-pill"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                className="absolute inset-0 rounded-full bg-primary"
              />
            )}
            <ShieldCheck className={`relative z-10 size-4 ${account?.type === 'microsoft' ? 'text-primary-foreground' : 'text-muted-foreground'}`} />
            <span className={`relative z-10 ${account?.type === 'microsoft' ? 'text-primary-foreground' : 'text-muted-foreground'}`}>正版</span>
          </button>
          <button
            type="button"
            onClick={() => account ? handleSwitchType('offline') : navigate('/account')}
            className="relative inline-flex h-8 items-center gap-2 rounded-full px-4 text-sm font-medium"
          >
            {account?.type === 'offline' && (
              <motion.span
                layoutId="acct-type-pill"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                className="absolute inset-0 rounded-full bg-primary"
              />
            )}
            <Link2Off className={`relative z-10 size-4 ${account?.type === 'offline' ? 'text-primary-foreground' : ''}`} />
            <span className={`relative z-10 ${account?.type === 'offline' ? 'text-primary-foreground' : ''}`}>离线</span>
          </button>
          <button
            type="button"
            onClick={() => account ? handleSwitchType('external') : navigate('/account')}
            className="relative inline-flex h-8 items-center gap-2 rounded-full px-4 text-sm font-medium"
          >
            {account?.type === 'external' && (
              <motion.span
                layoutId="acct-type-pill"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                className="absolute inset-0 rounded-full bg-primary"
              />
            )}
            <Globe className={`relative z-10 size-4 ${account?.type === 'external' ? 'text-primary-foreground' : ''}`} />
            <span className={`relative z-10 ${account?.type === 'external' ? 'text-primary-foreground' : ''}`}>外置</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-6 py-8">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.5, type: 'spring', stiffness: 200, damping: 20 }}
          className="relative"
        >
          {account ? (
            <>
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-amber-400/30 via-yellow-300/20 to-transparent blur-2xl" />
              <div className="relative bg-card/60 backdrop-blur-sm border border-border/40 rounded-3xl p-8 shadow-lg">
                <PixelAvatar
                  username={account?.username}
                  uuid={account?.uuid}
                  skinUrl={account?.skinUrl}
                  size={140}
                  isLoggedIn={!!account}
                  onSwitchType={handleSwitchType}
                  onRefresh={() => { setAccount({ ...account! }); toast.success('头像已刷新'); }}
                  onImportSkin={(dataUrl) => { setAccount({ ...account!, skinUrl: dataUrl }); toast.success('皮肤已更换'); }}
                  {...(account.type !== 'microsoft' ? {
                    hasCape: !!account.capeUrl,
                    onImportCape: (dataUrl: string) => { setAccount({ ...account!, capeUrl: dataUrl }); toast.success('披风已导入'); },
                    onRemoveCape: () => { setAccount({ ...account!, capeUrl: undefined }); toast.success('披风已移除'); },
                  } : {})}
                />
              </div>
              <div className="absolute -top-2 -right-2">
                <Badge variant="outline" className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 flex items-center gap-1">
                  <Sparkles className="size-3" />
                  {account.type === 'microsoft' ? '正版' : account.type === 'external' ? '外置' : '离线'}
                </Badge>
              </div>
            </>
          ) : (
            <button
              onClick={handleAddAccount}
              className="relative w-[140px] h-[140px] rounded-3xl border-2 border-dashed border-muted-foreground/40 hover:border-primary hover:bg-primary/5 transition-colors flex flex-col items-center justify-center gap-3 text-muted-foreground hover:text-primary"
            >
              <Plus className="size-10" strokeWidth={1.5} />
              <span className="text-base font-medium">添加账号</span>
            </button>
          )}
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="text-3xl font-bold tracking-tight"
        >
          {account ? account.username : (
            <button onClick={handleAddAccount} className="flex items-center gap-2 text-primary hover:underline">
              <Plus className="size-7" /> 添加账号
            </button>
          )}
        </motion.h1>
        {accounts.length > 1 && account && (
          <div className="w-64 -mt-3">
            <Select value={account.id} onValueChange={(v) => switchAccount(v)}>
              <SelectTrigger className="h-9"><SelectValue placeholder="切换账号" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id as string}>
                    {accountTypeLabel(a.type)} · {a.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.4 }}
        className="space-y-3 max-w-md mx-auto w-full"
      >
        <Card className="overflow-hidden border-2 border-primary/60 shadow-lg shadow-primary/10">
          <Button
            size="lg"
            onClick={handleLaunch}
            disabled={isLaunching || !currentVersionObj}
            className="w-full h-16 text-xl font-bold rounded-xl gap-2"
          >
            <AnimatePresence mode="wait">
              {isLaunching ? (
                <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                  <div className="size-5 border-2 border-current border-t-transparent rounded-full animate-spin" />启动中...
                </motion.div>
              ) : (
                <motion.div key="launch" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                  <Play className="size-6 fill-current" />启动游戏
                </motion.div>
              )}
            </AnimatePresence>
          </Button>
        </Card>

        <div className="text-center text-sm text-muted-foreground">
          当前版本: <span className="font-medium text-foreground">{currentVersionObj?.id ?? '未选择版本'}</span>
          {installedVersions.length === 0 && <span className="ml-2 text-amber-500">（请先下载版本）</span>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" size="lg" onClick={openVersionPicker} className="h-12 rounded-xl gap-2">
            <FolderOpen className="size-4" />版本选择
          </Button>
          <Button variant="outline" size="lg" onClick={() => navigate('/version-settings', { state: { transDir: 'right' } })} className="h-12 rounded-xl gap-2">
            <Settings2 className="size-4" />版本设置
          </Button>
        </div>

        {/* 手机端：游戏启动后进程消失/闪退，点此查看真实日志 */}
        <button type="button" onClick={openGameLogs}
          className="mx-auto flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors">
          <FileText className="size-4" />游戏闪退 / 没反应？查看上次游戏日志
        </button>

        {currentVersionObj && (
          <div className="w-full">
            <button type="button" onClick={() => setShowJvm((v) => !v)}
              className={`mx-auto flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${showJvm ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border bg-card hover:border-primary/40 hover:text-primary'}`}>
              <Terminal className="size-4" />
              {showJvm ? '收起 Java 启动参数' : 'Java 参数调试（点击展开设置）'}
              <ChevronDown className={`size-4 transition-transform ${showJvm ? 'rotate-180' : ''}`} />
            </button>
            {showJvm && (
              <div className="mt-2 space-y-1.5">
                <Textarea
                  value={currentVersionObj.jvmArgs || ''}
                  onChange={(e) => updateInstalledVersion(currentVersionObj.id, { jvmArgs: e.target.value })}
                  rows={3}
                  placeholder="-XX:+UseG1GC -XX:+ParallelRefProcEnabled ...（留空则用默认）"
                  className="font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">此处的 JVM 参数会在启动时直接追加到 java 命令后，自动保存到当前版本。</p>
              </div>
            )}
          </div>
        )}
      </motion.div>
      {/* Installed / imported version picker */}
      <Dialog open={versionPickerOpen} onOpenChange={setVersionPickerOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>选择版本（已安装 / 已导入 {installedVersions.length} 个）</DialogTitle>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto grid grid-cols-1 gap-2 pr-1">
            {installedVersions.map((v) => {
              const active = v.id === (currentVersionObj?.id ?? '');
              return (
                <button
                  key={v.id}
                  onClick={() => pickVersion(v.id)}
                  className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition-colors ${active ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50 hover:bg-accent'}`}
                >
                  <VersionIcon type={v.icon || 'grass'} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{v.id}</div>
                    <div className="text-xs text-muted-foreground truncate">{v.category ?? ''} · {loaderLabel(v.loader)}</div>
                  </div>
                  {active && <Check className="size-5 text-primary shrink-0" />}
                </button>
              );
            })}
          </div>
          <div className="flex justify-between items-center pt-1">
            <span className="text-xs text-muted-foreground">没有想要的版本？去下载页获取</span>
            <Button variant="outline" size="sm" onClick={() => { setVersionPickerOpen(false); navigate('/version-download'); }}>
              <FolderOpen className="size-4 mr-1" />下载新版本
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Launch progress modal: only completes when the real game window appears */}
      <Dialog
        open={launchOpen}
        onOpenChange={(o) => { if (!isLaunching && launchError) setLaunchOpen(o); }}
      >
        <DialogContent
          className="sm:max-w-md"
          onInteractOutside={(e) => { if (isLaunching) e.preventDefault(); }}
          onPointerDownOutside={(e) => { if (isLaunching) e.preventDefault(); }}
          onEscapeKeyDown={(e) => { if (isLaunching) e.preventDefault(); }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isLaunching && !launchError && <Loader2 className="size-5 animate-spin text-primary" />}
              {launchError ? '游戏启动失败' : '正在启动游戏'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex justify-between text-sm gap-3">
              <span className="text-muted-foreground break-all">{launchError || launchStage}</span>
              {!launchError && <span className="font-mono shrink-0">{launchPct}%</span>}
            </div>
            {!launchError && <Progress value={launchPct} className="h-2.5" />}
            {launchError && (
              <div className="text-xs text-destructive bg-destructive/10 rounded-lg p-3 max-h-44 overflow-y-auto whitespace-pre-wrap font-mono">
                {launchError}
              </div>
            )}
            <p className="text-xs text-muted-foreground">游戏窗口真正弹出后进度才会到 100%，请耐心等待。</p>
          </div>
          {isLaunching && !launchError && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  const cancelApi = (window as unknown as { electronAPI?: { launchCancel?: () => Promise<{ success: boolean }> } }).electronAPI;
                  cancelApi?.launchCancel?.();
                  appendLog('WARN', '正在取消启动…');
                }}
              >
                取消启动
              </Button>
            </div>
          )}
          {launchError && (
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setLaunchOpen(false)}>关闭</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 上次游戏日志 / 崩溃报告 */}
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {logLoading ? <Loader2 className="size-5 animate-spin text-primary" /> : <FileText className="size-5" />}
              上次游戏日志（闪退原因在最下面）
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {logData.latestcrash && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-destructive">崩溃报告 (latestcrash)</span>
                  <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => copyLog(logData.latestcrash)}>
                    <Copy className="size-3.5" />复制
                  </Button>
                </div>
                <pre className="text-[11px] font-mono whitespace-pre-wrap bg-destructive/10 rounded-lg p-2 max-h-48 overflow-y-auto">{logData.latestcrash}</pre>
              </div>
            )}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">运行日志 (latestlog)</span>
                <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => copyLog(logData.latestlog)}>
                  <Copy className="size-3.5" />复制
                </Button>
              </div>
              <pre className="text-[11px] font-mono whitespace-pre-wrap bg-muted rounded-lg p-2 max-h-72 overflow-y-auto">{logData.latestlog || '暂无日志'}</pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

export default memo(HomePageInner);
