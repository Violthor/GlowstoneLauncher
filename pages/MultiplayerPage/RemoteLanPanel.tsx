import { useEffect, useRef, useState } from 'react';
import {
  Globe, Play, Square, Loader2, Copy, ShieldAlert, Info, Network as NetIcon, Users, Plus, LogIn,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';

interface RemoteApi {
  remoteCoreInfo: () => Promise<{ ready: boolean; version?: string; wintun?: boolean }>;
  remoteStart: (c: Record<string, unknown>) => Promise<{ success: boolean; error?: string; virtIp?: string }>;
  remoteStop: () => Promise<{ success: boolean }>;
  onRemoteLog: (cb: (l: string) => void) => () => void;
  onRemoteState: (cb: (s: { running: boolean; virtIp?: string }) => void) => () => void;
}
function api(): RemoteApi {
  return (window as unknown as { electronAPI: RemoteApi }).electronAPI;
}

// 房间号 = 网络名；密钥从房间号派生（朋友间只需知道房间号即可加入）
const roomSecret = (room: string) => 'gl-' + room.toLowerCase() + '-secret';
const randRoom = () => {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
};

export default function RemoteLanPanel() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [virtIp, setVirtIp] = useState('');
  const [room, setRoom] = useState(randRoom());
  const [joinRoom, setJoinRoom] = useState('');
  const [activeRoom, setActiveRoom] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const a = api();
    a.remoteCoreInfo().then((i) => setReady(i.ready)).catch(() => setReady(false));
    const offLog = a.onRemoteLog((l) => setLogs((p) => [...p.slice(-300), l]));
    const offState = a.onRemoteState((s) => {
      setRunning(s.running === true);
      if (s.virtIp) setVirtIp(s.virtIp);
    });
    return () => { offLog(); offState(); };
  }, []);

  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [logs]);

  const startAsHost = async () => {
    setBusy(true);
    const r = await api().remoteStart({
      networkName: room,
      networkSecret: roomSecret(room),
      virtIp: '10.0.2.1',
      usePublicPeers: true,
      noTun: false,
      customPeers: '',
    });
    setBusy(false);
    if (r.success) {
      setActiveRoom(room);
      if (r.virtIp) setVirtIp(r.virtIp);
      toast.success('房间已创建，把房间号发给朋友即可加入');
    } else toast.error(r.error || '创建房间失败');
  };

  const startAsGuest = async () => {
    const r0 = joinRoom.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(r0)) { toast.error('请输入 6 位房间号'); return; }
    setBusy(true);
    // 加入者用 .2 起的虚拟 IP；简单取随机末位避免冲突
    const last = 2 + Math.floor(Math.random() * 200);
    const r = await api().remoteStart({
      networkName: r0,
      networkSecret: roomSecret(r0),
      virtIp: `10.0.2.${last}`,
      usePublicPeers: true,
      noTun: false,
      customPeers: '',
    });
    setBusy(false);
    if (r.success) {
      setActiveRoom(r0);
      if (r.virtIp) setVirtIp(r.virtIp);
      toast.success('已加入房间 ' + r0);
    } else toast.error(r.error || '加入房间失败');
  };

  const stop = async () => {
    setBusy(true);
    await api().remoteStop();
    setRunning(false); setBusy(false); setActiveRoom(''); setVirtIp('');
    toast.message('已退出房间，EasyTier 进程已关闭');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Globe className="size-5 text-primary" />
        <span className="text-sm font-semibold">异地联机 · EasyTier</span>
        {running
          ? <Badge className="bg-green-500 text-white text-[10px]">运行中 · 房间 {activeRoom} · {virtIp}</Badge>
          : <Badge variant="outline" className="text-[10px]">未连接</Badge>}
      </div>

      {ready === false && (
        <Card className="p-3.5 border-destructive/40 text-destructive text-sm flex items-center gap-2">
          <ShieldAlert className="size-4" /> 未找到 EasyTier 程序，请使用完整赞助版安装包重新安装。
        </Card>
      )}

      {!running ? (
        <Tabs defaultValue="host" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="host" className="gap-1.5"><Plus className="size-4" />创建房间</TabsTrigger>
            <TabsTrigger value="join" className="gap-1.5"><LogIn className="size-4" />加入房间</TabsTrigger>
          </TabsList>

          <TabsContent value="host" className="space-y-4 mt-4">
            <Card className="p-4 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">你的房间号（发给朋友）</Label>
                <div className="flex gap-2">
                  <Input value={room} onChange={(e) => setRoom(e.target.value.toUpperCase())}
                    className="font-mono text-lg tracking-[0.3em] text-center" maxLength={6} />
                  <Button variant="outline" onClick={() => setRoom(randRoom())} className="shrink-0">随机</Button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>· 创建后朋友在「加入房间」输入此 6 位房间号即可连入你的虚拟局域网。</p>
                <p>· 你的虚拟 IP 固定为 10.0.2.1，朋友加入后会获得 10.0.2.x 地址。</p>
              </div>
              <Button className="w-full gap-2" onClick={startAsHost} disabled={busy || ready === false || room.length !== 6}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}创建房间并启动
              </Button>
            </Card>
          </TabsContent>

          <TabsContent value="join" className="space-y-4 mt-4">
            <Card className="p-4 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">输入朋友的房间号</Label>
                <Input value={joinRoom} onChange={(e) => setJoinRoom(e.target.value.toUpperCase())}
                  placeholder="ABCDEF" className="font-mono text-lg tracking-[0.3em] text-center" maxLength={6} />
              </div>
              <div className="text-xs text-muted-foreground">
                加入后你将获得 10.0.2.x 虚拟 IP，与房主在同一虚拟局域网内。
              </div>
              <Button className="w-full gap-2" onClick={startAsGuest} disabled={busy || ready === false || joinRoom.length !== 6}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Users className="size-4" />}加入房间
              </Button>
            </Card>
          </TabsContent>
        </Tabs>
      ) : (
        <Card className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted/40 p-3">
              <div className="text-xs text-muted-foreground">当前房间</div>
              <div className="font-mono text-xl font-bold tracking-widest mt-1">{activeRoom}</div>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <div className="text-xs text-muted-foreground">你的虚拟 IP</div>
              <div className="font-mono text-xl font-bold mt-1 flex items-center gap-2">
                {virtIp || '10.0.2.1'}
                <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => { navigator.clipboard.writeText(virtIp || '10.0.2.1'); toast.success('IP 已复制'); }}>
                  <Copy className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            把房间号和你的虚拟 IP 告诉朋友，他们加入房间后即可在游戏内通过此 IP 连接你的服务器。
          </div>
          <Button variant="outline" className="w-full gap-2 text-destructive" onClick={stop} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" />}退出房间并关闭 EasyTier
          </Button>
        </Card>
      )}

      {/* 组网日志 */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
          <NetIcon className="size-4 text-primary" /><span className="text-xs font-semibold">组网日志</span>
        </div>
        <div ref={logRef} className="h-40 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed bg-muted/40">
          {logs.length === 0 ? <div className="text-muted-foreground">启动后组网与连接日志显示在这里</div>
            : logs.map((l, i) => <div key={i} className="whitespace-pre-wrap">{l}</div>)}
        </div>
      </Card>

      {/* 第三方声明与免责 */}
      <Card className="p-3.5 text-xs text-muted-foreground space-y-1.5 border-border">
        <div className="flex items-center gap-1.5 font-medium text-foreground"><Info className="size-3.5 text-primary" />第三方组件与免责说明</div>
        <p>异地组网能力由 <span className="font-medium">EasyTier</span> 项目提供（Apache License 2.0，作者 kkHA/283385，项目地址 https://github.com/EasyTier/EasyTier ）。本启动器仅以子进程方式外部调用其官方程序，不包含、也不修改 EasyTier 源代码。</p>
        <p>虚拟网卡驱动使用 Wintun（wintun.net）。因组网、网络穿透产生的任何问题由 EasyTier 及其服务承担，本启动器仅负责调用，不就组网的可用性、安全性作担保。</p>
      </Card>
    </div>
  );
}
