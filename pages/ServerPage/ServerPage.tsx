import { useEffect, useRef, useState } from "react";
import {
  Server as ServerIcon, Play, Square, FolderOpen, Trash2, Loader2, Download,
  Terminal, ChevronDown, Copy, Send, Network, CheckCircle2, Loader2 as Spin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type Loader = "vanilla" | "fabric" | "forge" | "neoforge";
interface ServerRec {
  dir: string; mc: string; loader: Loader; loaderVer: string; jar: string; installed: boolean;
}
interface ServerState {
  running: boolean; dir: string | null; ready: boolean;
  lanIp: string; port: number; address: string;
}
interface JavaItem { path: string; major: number; }
interface Api {
  fetchVersionManifest: (s?: string) => Promise<{ versions?: { id: string; type: string }[] }>;
  serverJavaList: () => Promise<{ javas: JavaItem[] }>;
  selectFolder: () => Promise<{ success: boolean; path?: string; canceled?: boolean }>;
  serverInstall: (a: Record<string, unknown>) => Promise<{ success: boolean; record?: ServerRec; error?: string }>;
  serverList: () => Promise<ServerRec[]>;
  serverStart: (a: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  serverStop: () => Promise<{ success: boolean }>;
  serverState: () => Promise<ServerState>;
  serverCommand: (c: string) => Promise<{ success: boolean; error?: string }>;
  serverRemove: (d: string) => Promise<{ success: boolean; removed?: boolean; error?: string }>;
  openFolder: (p: string) => Promise<{ success: boolean }>;
  copyToClipboard: (t: string) => void;
  onServerLog: (cb: (l: string) => void) => () => void;
  onServerInstallLog: (cb: (l: string) => void) => () => void;
  onServerState: (cb: (s: ServerState) => void) => () => void;
  serverInstallState: () => Promise<InstallSnapshot>;
  onServerInstallProgress: (cb: (s: InstallSnapshot) => void) => () => void;
}
interface InstallSnapshot {
  running: boolean; percent: number; phase: string; done: boolean; error: string; logs: string[];
}
function api(): Api {
  return (window as unknown as { electronAPI: Api }).electronAPI;
}
const LOADER_LABEL: Record<Loader, string> = {
  vanilla: "Vanilla 原版", fabric: "Fabric", forge: "Forge", neoforge: "NeoForge",
};

// 该 MC 版本服务端所需的最低 Java 大版本
function requiredJavaFor(mc: string, loader: Loader): number {
  const m = /^1\.(\d+)(?:\.(\d+))?/.exec(mc || "");
  if (!m) return 8;
  const minor = parseInt(m[1], 10);
  const patch = parseInt(m[2] || "0", 10);
  let req = 8;
  if (minor <= 16) req = 8;
  else if (minor === 17) req = 16;
  else if (minor === 18 || minor === 19) req = 17;
  else if (minor === 20) req = patch >= 5 ? 21 : 17;
  else req = 21; // 1.21+
  if (loader === "neoforge") req = Math.max(req, minor >= 21 ? 21 : 17);
  return req;
}

export default function ServerPage() {
  const [versions, setVersions] = useState<string[]>([]);
  const [mc, setMc] = useState("");
  const [loader, setLoader] = useState<Loader>("vanilla");
  const [dir, setDir] = useState("");
  const [javas, setJavas] = useState<JavaItem[]>([]);
  const [javaPath, setJavaPath] = useState("");
  const [minMem, setMinMem] = useState(1024);
  const [maxMem, setMaxMem] = useState(2048);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [inst, setInst] = useState<InstallSnapshot | null>(null);
  const [records, setRecords] = useState<ServerRec[]>([]);
  const [srv, setSrv] = useState<ServerState>({ running: false, dir: null, ready: false, lanIp: "", port: 25565, address: "" });
  const [consoleLines, setConsoleLines] = useState<string[]>([]);
  const [cmd, setCmd] = useState("");
  const [showInstallLog, setShowInstallLog] = useState(false);
  const consoleRef = useRef<HTMLDivElement>(null);
  const cmdRef = useRef<HTMLInputElement>(null);
  const dirTouched = useRef(false);

  const requiredJava = requiredJavaFor(mc, loader);

  // 初始数据：版本清单、精简 Java、已装服务器
  useEffect(() => {
    const a = api();
    a.fetchVersionManifest("bmcl").then((m) => {
      const ids = (m.versions || []).filter((v) => v.type === "release").map((v) => v.id);
      setVersions(ids);
      if (ids.length) setMc(ids[0]);
    }).catch(() => {});
    a.serverJavaList().then(({ javas: js }) => setJavas(js)).catch(() => {});
    refreshList();
    a.serverState().then(setSrv);
    const offLog = a.onServerLog((l) => setConsoleLines((c) => [...c.slice(-400), l]));
    const offILog = a.onServerInstallLog((l) => setInstallLog((c) => [...c, l]));
    const offState = a.onServerState((st) => setSrv(st));
    // 安装进度：先取主进程快照（切走再回来进度不丢），再订阅实时进度
    a.serverInstallState().then((s) => {
      setInst(s);
      if (s.logs.length) setInstallLog(s.logs);
      setInstalling(s.running);
      if (s.running) setShowInstallLog(true);
    }).catch(() => {});
    const offProg = a.onServerInstallProgress((s) => {
      setInst(s);
      if (s.logs.length) setInstallLog(s.logs);
      setInstalling(s.running);
    });
    return () => { offLog(); offILog(); offState(); offProg(); };
  }, []);

  const refreshList = () => api().serverList().then(setRecords).catch(() => {});

  // 默认安装目录建议（默认下载目录下 Servers\版本-类型）
  useEffect(() => {
    if (dirTouched.current || !mc) return;
    (window as unknown as { electronAPI?: { defaultDownloadDir?: () => Promise<{ success: boolean; path?: string } | string> } })
      .electronAPI?.defaultDownloadDir?.()
      .then((res) => {
        // IPC 返回 { success, path }，旧实现可能直接返回字符串，两种都兼容
        const base = typeof res === 'string' ? res : (res?.path || '');
        if (base) setDir(`${base}\\Servers\\${mc}-${loader}`);
        else setDir(`Servers\\${mc}-${loader}`);
      })
      .catch(() => setDir(`Servers\\${mc}-${loader}`));
  }, [mc, loader]);

  // 版本/加载器/Java 列表变化时自动选择合适 Java（取满足要求的最低版本，避免用过新的）
  useEffect(() => {
    if (!javas.length || !mc) return;
    const ok = javas.filter((j) => j.major >= requiredJava);
    const pick = ok.sort((a, b) => a.major - b.major)[0]
      || [...javas].sort((a, b) => b.major - a.major)[0];
    if (pick) setJavaPath(pick.path);
  }, [mc, loader, javas, requiredJava]);

  // 控制台自动滚动到底
  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [consoleLines]);

  const pickDir = async () => {
    const r = await api().selectFolder();
    if (r.success && r.path) { dirTouched.current = true; setDir(r.path); }
  };

  const doInstall = async () => {
    if (!mc || !dir) { toast.error("请选择版本和安装目录"); return; }
    if (!javaPath && loader !== "forge" && loader !== "neoforge") {
      toast.error("未检测到可用 Java，可先到 Java 页面下载"); return;
    }
    setInstalling(true);
    setInstallLog([]);
    setShowInstallLog(true);
    const r = await api().serverInstall({ mcVersion: mc, loader, dir, javaPath });
    setInstalling(false);
    if (r.success) {
      toast.success("服务器安装完成");
      await refreshList();
    } else {
      toast.error("安装失败：" + r.error);
    }
  };

  const start = async (rec: ServerRec) => {
    if (!javaPath && rec.loader !== "forge" && rec.loader !== "neoforge") {
      toast.error("请先选择 Java"); return;
    }
    setConsoleLines([]);
    const r = await api().serverStart({ dir: rec.dir, javaPath, minMem, maxMem });
    if (r.success) toast.success("服务器启动中…");
    else toast.error(r.error);
  };
  const stop = async () => {
    await api().serverStop();
    toast.message("正在停止服务器");
  };

  const sendCommand = async (raw?: string) => {
    const text = (raw ?? cmd).trim();
    if (!text) return;
    const r = await api().serverCommand(text);
    if (r.success) { setCmd(""); cmdRef.current?.focus(); }
    else toast.error(r.error || "发送失败");
  };

  const copyAddr = (t: string) => { api().copyToClipboard(t); toast.success("已复制：" + t); };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ServerIcon className="size-6 text-primary" />本地开服
        </h1>
        <p className="text-muted-foreground text-sm mt-1">一键下载并在本机运行 Minecraft 服务端，自动同意 EULA，支持原版 / Fabric / Forge / NeoForge。</p>
      </div>

      {/* 服务器地址（运行时显示） */}
      {srv.running && (
        <Card className="p-4 border-primary/40 bg-primary/5">
          <div className="flex items-center gap-2 mb-3">
            <Network className="size-5 text-primary" />
            <span className="font-semibold text-sm">服务器连接地址</span>
            {srv.ready
              ? <Badge className="bg-green-500 text-white text-[10px] gap-1"><CheckCircle2 className="size-3" />已就绪，可加入</Badge>
              : <Badge variant="outline" className="text-[10px] gap-1"><Spin className="size-3 animate-spin" />正在启动…</Badge>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg bg-background/70 border border-border p-3">
              <div className="text-[11px] text-muted-foreground mb-1">局域网地址（发给同一 WiFi / 局域网的玩家）</div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-bold text-base text-primary">{srv.address || "读取中…"}</span>
                <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={() => copyAddr(srv.address)}><Copy className="size-4" /></Button>
              </div>
            </div>
            <div className="rounded-lg bg-background/70 border border-border p-3">
              <div className="text-[11px] text-muted-foreground mb-1">本机自测地址（你自己的 MC 用）</div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-bold text-base">localhost:{srv.port}</span>
                <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={() => copyAddr(`localhost:${srv.port}`)}><Copy className="size-4" /></Button>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            外网玩家无法直接连局域网地址：需在路由器做端口转发，或让对方使用「陶瓦联机」组网，也可直接购买织音云服务器（公网可达）。
          </p>
        </Card>
      )}

      {/* 安装配置 */}
      <Card className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Minecraft 版本</label>
            <Select value={mc} onValueChange={setMc}>
              <SelectTrigger><SelectValue placeholder="选择版本" /></SelectTrigger>
              <SelectContent>
                {versions.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">服务端类型</label>
            <Select value={loader} onValueChange={(v) => setLoader(v as Loader)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(LOADER_LABEL) as Loader[]).map((l) => (
                  <SelectItem key={l} value={l}>{LOADER_LABEL[l]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-sm font-medium">安装目录</label>
            <div className="flex gap-2">
              <Input value={dir} onChange={(e) => { dirTouched.current = true; setDir(e.target.value); }} placeholder="选择服务器安装目录" className="flex-1" />
              <Button variant="outline" onClick={pickDir} className="gap-1"><FolderOpen className="size-4" />选择</Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center justify-between">
              Java
              <span className="text-[11px] font-normal text-primary">本版本推荐 Java {requiredJava}</span>
            </label>
            <Select value={javaPath} onValueChange={setJavaPath}>
              <SelectTrigger><SelectValue placeholder="未检测到 Java" /></SelectTrigger>
              <SelectContent>
                {javas.map((j) => <SelectItem key={j.path} value={j.path}>Java {j.major} · {j.path}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">已按版本自动选择；列表每个 Java 版本只显示一个。1.8–1.16.5 用 Java8，1.18–1.20.4 用 Java17，1.20.5+ 用 Java21。</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">最小内存(MB)</label>
              <Input type="number" value={minMem} onChange={(e) => setMinMem(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">最大内存(MB)</label>
              <Input type="number" value={maxMem} onChange={(e) => setMaxMem(Number(e.target.value))} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={doInstall} disabled={installing} className="gap-2">
            {installing ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {installing ? "正在安装…" : "安装服务器"}
          </Button>
          {installLog.length > 0 && (
            <button type="button" onClick={() => setShowInstallLog((v) => !v)} className="text-sm text-muted-foreground flex items-center gap-1 hover:text-primary">
              <ChevronDown className={`size-4 transition-transform ${showInstallLog ? "rotate-180" : ""}`} />安装日志
            </button>
          )}
        </div>
        {/* 下载/安装进度（主进程权威，切走再回来不丢） */}
        {inst && (inst.running || inst.done || inst.error) && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className={inst.error ? "text-destructive" : "text-muted-foreground"}>
                {inst.error ? "安装失败：" + inst.error : inst.phase}
              </span>
              {inst.running && inst.percent > 0 && (
                <span className="font-mono text-primary">{inst.percent}%</span>
              )}
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-[width] duration-200 ${inst.error ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${inst.error ? 100 : Math.max(2, inst.percent)}%` }}
              />
            </div>
          </div>
        )}
        {showInstallLog && installLog.length > 0 && (
          <div className="rounded-lg bg-muted p-3 max-h-48 overflow-y-auto font-mono text-xs space-y-0.5">
            {installLog.map((l, i) => <div key={i} className="whitespace-pre-wrap">{l}</div>)}
          </div>
        )}
      </Card>

      {/* 已安装服务器 */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">已安装服务器（{records.length}）</h2>
        {records.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground text-sm">还没有安装服务器，先在上面选择版本并安装</Card>
        ) : records.map((rec) => {
          const running = srv.dir === rec.dir && srv.running;
          return (
            <Card key={rec.dir} className="p-3.5 flex items-center gap-3 flex-wrap">
              <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <ServerIcon className="size-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{rec.mc} · {LOADER_LABEL[rec.loader]}</span>
                  {rec.loaderVer && <Badge variant="outline" className="text-[10px] font-mono">{rec.loaderVer}</Badge>}
                  {running && <Badge className="bg-green-500 text-white text-[10px]">运行中</Badge>}
                </div>
                <div className="text-xs text-muted-foreground truncate">{rec.dir}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {running ? (
                  <Button size="sm" variant="outline" onClick={stop} className="gap-1"><Square className="size-3.5" />停止</Button>
                ) : (
                  <Button size="sm" onClick={() => start(rec)} className="gap-1"><Play className="size-3.5" />启动</Button>
                )}
                <Button size="icon" variant="ghost" onClick={() => api().openFolder(rec.dir)} className="size-8 text-muted-foreground"><FolderOpen className="size-4" /></Button>
                <Button size="icon" variant="ghost" onClick={async () => {
                  if (running) await stop();
                  const r = await api().serverRemove(rec.dir);
                  if (r && r.success === false) {
                    toast.error(r.error || "文件删除失败，可能被占用");
                  } else {
                    toast.success("已删除服务器文件");
                  }
                  await refreshList();
                }} className="size-8 text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></Button>
              </div>
            </Card>
          );
        })}
      </div>

      {/* 控制台（可输入命令） */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <span className="text-sm font-semibold flex items-center gap-2"><Terminal className="size-4" />服务器控制台</span>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setConsoleLines([])}>清屏</Button>
        </div>
        <div ref={consoleRef} className="h-72 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed bg-muted/40">
          {consoleLines.length === 0 ? <div className="text-muted-foreground">启动服务器后，控制台输出会显示在这里</div>
            : consoleLines.map((l, i) => {
              const isCmd = l.startsWith("> ");
              return <div key={i} className={`whitespace-pre-wrap ${isCmd ? "text-primary" : ""}`}>{l}</div>;
            })}
        </div>
        {/* 命令输入 */}
        <div className="border-t border-border p-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground shrink-0">/</span>
            <Input
              ref={cmdRef}
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendCommand(); }}
              placeholder='输入服务器命令后回车，如 op 玩家名、gamemode creative、time set day、stop'
              className="flex-1 h-9 font-mono text-xs"
            />
            <Button size="sm" onClick={() => sendCommand()} className="gap-1 shrink-0"><Send className="size-3.5" />发送</Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {["op ", "gamemode creative", "time set day", "list", "save-all", "stop"].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  if (c.endsWith(" ")) { setCmd(c); cmdRef.current?.focus(); }
                  else sendCommand(c);
                }}
                className="text-[11px] font-mono px-2 py-0.5 rounded border border-border bg-muted/50 hover:bg-accent text-muted-foreground"
              >
                {c.trim()}
              </button>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
