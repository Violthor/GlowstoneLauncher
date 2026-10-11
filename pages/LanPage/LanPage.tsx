import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Network, Users, Copy, Loader2, Server, KeyRound, LogOut, XCircle, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useLauncherStore } from '@/hooks/useLauncherStore';
import { toast } from 'sonner';

interface LanApi {
  lanCoreInfo: () => Promise<{ ready: boolean; version?: string }>;
  lanStartHost: () => Promise<{ success: boolean; error?: string; lanIp?: string; virtIp?: string }>;
  lanStartJoin: (code: string) => Promise<{ success: boolean; error?: string; localPort?: number; target?: string }>;
  lanSetHostPort: (port: number) => Promise<{ success: boolean; error?: string; code?: string }>;
  lanWatchLog: (arg: { gameDir: string; versionId: string; versionIsolation: boolean }) => Promise<{ success: boolean }>;
  lanStop: () => Promise<{ success: boolean }>;
  onLanPort: (cb: (p: { port: number }) => void) => () => void;
  gameRunningList: () => Promise<Array<{ pid: number; versionId: string; title: string }>>;
  onGameRunningChanged: (cb: (list: Array<{ pid: number; versionId: string }>) => void) => () => void;
}

function getApi(): LanApi | null {
  return (window as unknown as { electronAPI?: LanApi }).electronAPI ?? null;
}

async function copyText(text: string, label = '已复制到剪贴板') {
  try { await navigator.clipboard.writeText(text); toast.success(label); } catch { toast.error('复制失败，请手动复制'); }
}

export default function LanPage() {
  const { currentVersion, installedVersions, settings } = useLauncherStore();
  const versionObj = installedVersions.find((v) => v.id === currentVersion);

  const [phase, setPhase] = useState<'idle' | 'host' | 'join'>('idle');
  const [busy, setBusy] = useState(false);
  const [coreReady, setCoreReady] = useState<boolean | null>(null);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [portInput, setPortInput] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [hostIp, setHostIp] = useState('');
  const [joinLocalPort, setJoinLocalPort] = useState<number | null>(null);
  const [joinTarget, setJoinTarget] = useState('');
  const [gamePort, setGamePort] = useState<number | null>(null);
  const [runningList, setRunningList] = useState<Array<{ pid: number; versionId: string }>>([]);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const api = getApi();
    if (!api) return;
    api.lanCoreInfo().then((i) => setCoreReady(i.ready)).catch(() => setCoreReady(false));
    // 只有游戏真正在运行才允许开房
    api.gameRunningList?.().then(setRunningList).catch(() => {});
    const offRun = api.onGameRunningChanged?.((l) => setRunningList(l));
    // 端口只来自游戏日志（游戏内『对局域网开放』后自动捕获），不允许手填
    const off = api.onLanPort((p) => {
      setGamePort(p.port);
      setPortInput(String(p.port));
      if (phaseRef.current === 'host') {
        api.lanSetHostPort(p.port).then((r) => { if (r.success && r.code) setInviteCode(r.code); }).catch(() => {});
      }
    });
    return () => { off && off(); offRun && offRun(); };
  }, []);
  const gameRunning = runningList.length > 0;

  // 房主：必须先启动游戏；端口由游戏内『对局域网开放』经日志自动捕获，不接受手填
  const createHost = async () => {
    const api = getApi(); if (!api) return;
    if (!gameRunning) { toast.error('请先启动游戏，进入存档后在游戏内『对局域网开放』，再创建房间'); return; }
    if (!versionObj) { toast.error('未找到当前版本，请先在首页选择要联机的版本'); return; }
    setBusy(true);
    try {
      const r = await api.lanStartHost();
      if (!r.success) { toast.error(r.error || '创建房间失败'); return; }
      setHostIp(r.lanIp || '');
      api.lanWatchLog({ gameDir: versionObj.gameDir || '.minecraft', versionId: versionObj.id, versionIsolation: settings.versionIsolation === true }).catch(() => {});
      setInviteCode('');
      setGamePort(null);
      setPhase('host');
      toast.success('联机房间已创建，请在游戏内『对局域网开放』以获取端口');
    } finally { setBusy(false); }
  };

  // 端口来自游戏日志，若尚未捕获到真实端口则显示“无端口”
  const regenCode = async () => {
    const api = getApi(); if (!api) return;
    if (!gamePort) { setInviteCode('无端口'); toast.error('无端口：请先在游戏内『对局域网开放』，端口会自动识别'); return; }
    const r = await api.lanSetHostPort(gamePort);
    if (r.success && r.code) { setInviteCode(r.code); toast.success('联机地址已生成'); }
    else { setInviteCode('无端口'); toast.error(r.error || '无端口'); }
  };

  const startJoin = async () => {
    const api = getApi(); if (!api) return;
    const code = joinCodeInput.trim();
    if (!code) { toast.error('请输入房主给你的联机地址（邀请码）'); return; }
    setBusy(true);
    try {
      const r = await api.lanStartJoin(code);
      if (!r.success) { toast.error(r.error || '加入房间失败'); return; }
      setJoinLocalPort(r.localPort || null);
      setJoinTarget(r.target || '');
      setPhase('join');
      toast.success('已加入联机网络');
    } finally { setBusy(false); }
  };

  const leave = async () => {
    await getApi()?.lanStop();
    setPhase('idle'); setInviteCode(''); setJoinLocalPort(null); setJoinTarget(''); setPortInput(''); setJoinCodeInput(''); setGamePort(null);
    toast.message('已断开联机');
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-5 max-w-3xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Network className="size-6 text-primary" /> 陶瓦联机
          </h1>
          <p className="text-sm text-muted-foreground mt-1">免公网 IP、免管理员的异地联机：房主开放局域网，把联机地址发给好友即可一起玩</p>
        </div>
        {phase !== 'idle' && (
          <Button variant="outline" className="gap-2" onClick={leave}><LogOut className="size-4" />{phase === 'host' ? '关闭房间' : '断开连接'}</Button>
        )}
      </div>

      {coreReady === false && (
        <Card className="p-4 border-destructive/40 text-sm text-destructive flex items-center gap-2">
          <XCircle className="size-4" /> 未找到内置联机内核，联机功能不可用，请使用完整安装包重新安装。
        </Card>
      )}

      {phase === 'idle' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="size-11 rounded-xl bg-primary/10 flex items-center justify-center"><Server className="size-6 text-primary" /></div>
              <div>
                <div className="text-lg font-semibold">我是房主</div>
                <div className="text-xs text-muted-foreground">先启动游戏并对局域网开放，端口会自动识别</div>
              </div>
            </div>
            {!gameRunning && (
              <div className="text-xs text-amber-500 bg-amber-500/10 rounded-lg px-3 py-2">请先启动游戏，进入存档后再创建联机房间</div>
            )}
            <Button className="w-full gap-2" onClick={createHost} disabled={busy || coreReady === false || !gameRunning}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Network className="size-4" />} 创建联机房间
            </Button>
          </Card>

          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="size-11 rounded-xl bg-primary/10 flex items-center justify-center"><Users className="size-6 text-primary" /></div>
              <div>
                <div className="text-lg font-semibold">我要加入</div>
                <div className="text-xs text-muted-foreground">粘贴房主给的联机地址，获得本地直连地址</div>
              </div>
            </div>
            <Input value={joinCodeInput} onChange={(e) => setJoinCodeInput(e.target.value)} placeholder="粘贴房主发来的联机地址（邀请码）" onKeyDown={(e) => { if (e.key === 'Enter') startJoin(); }} />
            <Button className="w-full gap-2" onClick={startJoin} disabled={busy || coreReady === false}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />} 加入房间
            </Button>
          </Card>
        </div>
      )}

      {phase === 'host' && (
        <Card className="p-6 space-y-4">
          <div className="text-lg font-semibold flex items-center gap-2"><Server className="size-5 text-primary" /> 房主房间已创建</div>
          <div className="space-y-2">
            <div className="text-sm font-medium">局域网端口（游戏内自动识别，不可手填）</div>
            <div className="flex gap-2">
              <Input readOnly value={gamePort ?? ''} placeholder="无端口" className="font-mono" />
              <Button variant="outline" className="shrink-0" onClick={regenCode}>刷新端口/地址</Button>
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">联机地址（发给好友）</div>
            <div className="flex gap-2">
              <Input readOnly value={inviteCode || '无端口'} className="font-mono text-xs" />
              <Button className="shrink-0 gap-2" disabled={!inviteCode || inviteCode === '无端口'} onClick={() => copyText(inviteCode, '联机地址已复制')}><Copy className="size-4" />复制</Button>
            </div>
            {hostIp && <div className="text-xs text-muted-foreground">本机局域网 IP：{hostIp}</div>}
          </div>
        </Card>
      )}

      {phase === 'join' && (
        <Card className="p-6 space-y-4">
          <div className="text-lg font-semibold flex items-center gap-2"><Link2 className="size-5 text-primary" /> 已加入房间</div>
          <div className="space-y-2">
            <div className="text-sm font-medium">在游戏「多人游戏 → 直接连接（或添加服务器）」填入：</div>
            <div className="flex gap-2">
              <Input readOnly value={joinLocalPort ? `127.0.0.1:${joinLocalPort}` : '-'} className="font-mono text-base font-semibold" />
              <Button className="shrink-0 gap-2" disabled={!joinLocalPort} onClick={() => joinLocalPort && copyText(`127.0.0.1:${joinLocalPort}`, '直连地址已复制')}><Copy className="size-4" />复制地址</Button>
            </div>
            {joinTarget && <div className="text-xs text-muted-foreground">已连接到房主：{joinTarget}</div>}
          </div>
        </Card>
      )}
    </motion.div>
  );
}
