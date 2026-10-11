// 陶瓦联机 —— 基于 EasyTier 的免管理员异地组网（房主导出本机局域网服务，加入方本地端口转发）
// 架构：
//  房主(host)：--no-tun + 子网代理(-n 本机IP/32)，把 MC“对局域网开放”的服务导出到虚拟网；
//  加入(join)：--no-tun + --port-forward，把虚拟网里房主的服务映射到本机 127.0.0.1:<本地端口>，
//             游戏多人里直连 127.0.0.1:<本地端口> 即可，无需 JVM 全局代理，不影响正版登录与皮肤。
const path = require('path');
const os = require('os');
const net = require('net');
const fs = require('fs');
const cp = require('child_process');

const dns = require('dns');
// 已实测在线、可握手的公共节点（IP 直连，规避个别机器 DNS/内核解析器异常）；官方域名作为兜底
const PEER_URIS = [
  'tcp://140.150.236.98:11010',   // PublicServer_et-hk 香港（2026-09-29 实测可握手，首选）
  'tcp://39.108.52.138:11010',    // PublicServer_JoeAliShenzhen 阿里云深圳（备用，恢复时自动可用）
  'tcp://public.easytier.cn:11010', // 官方域名，兜底
];
function dnsResolve4(host) { return new Promise((res) => { try { dns.setServers(['223.5.5.5', '119.29.29.29', '8.8.8.8']); } catch {} dns.resolve4(host, (e, a) => res(e ? [] : (a || []))); }); }
function sysLookup(host) { return new Promise((res) => { dns.lookup(host, { all: true }, (e, a) => res(e ? [] : (a || []).map((x) => x.address))); }); }
async function peerArgs() {
  const out = []; const seen = new Set();
  const add = (u) => { if (!seen.has(u)) { seen.add(u); out.push(u); } };
  for (const uri of PEER_URIS) {
    add(uri);
    const m = uri.match(/^tcp:\/\/([^:]+):(\d+)$/);
    if (m && !/^\d+\.\d+\.\d+\.\d+$/.test(m[1])) {
      let ips = [];
      try { ips = await dnsResolve4(m[1]); } catch {}
      if (!ips.length) { try { ips = await sysLookup(m[1]); } catch {} }
      ips.slice(0, 2).forEach((ip) => add(`tcp://${ip}:${m[2]}`));
    }
  }
  return out.flatMap((u) => ['-p', u]);
}
const HOST_VIRT_IP = '10.0.100.1';
const JOIN_VIRT_IP = '10.0.100.2';

function randStr(len) {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

function b64urlEncode(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  let s = String(str).trim().replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
}

function getFreePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', () => resolve(0));
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

// 选择一块真实的物理局域网 IPv4（排除常见虚拟网卡与回环）
function pickLanIp() {
  const VIRT_HINT = /vmware|virtualbox|hyper-v|hyperv|vethernet|radmin|tailscale|zerotier|hamachi|wsl|docker|npcap|loopback|pseudo|bluetooth|teredo|isatap|6to4/i;
  const all = [];
  const ifaces = os.networkInterfaces();
  for (const [name, arr] of Object.entries(ifaces)) {
    for (const it of arr || []) {
      if (it.family !== 'IPv4' || it.internal) continue;
      const ip = it.address;
      if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) continue;
      all.push({ name, ip, virt: VIRT_HINT.test(name) });
    }
  }
  const phys = all.filter((x) => !x.virt);
  const pick = phys[0] || all[0];
  return pick ? pick.ip : '127.0.0.1';
}

function initLan({ ipcMain, app, getMainWindow }) {
  const send = (channel, payload) => {
    const w = getMainWindow && getMainWindow();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };

  function coreDir() {
    // 打包后在 resources/easytier；开发态在项目 resources/easytier
    if (app.isPackaged) return path.join(process.resourcesPath, 'easytier');
    return path.join(__dirname, '..', 'resources', 'easytier');
  }
  const coreExe = () => path.join(coreDir(), 'easytier-core.exe');
  const cliExe = () => path.join(coreDir(), 'easytier-cli.exe');

  const state = {
    proc: null,
    mode: null,           // 'host' | 'join'
    config: null,
    logs: [],
    logWatcher: null,
    watchedSize: 0,
    portFound: null,
  };

function emitLog(line) {
    state.logs.push(line);
    if (state.logs.length > 400) state.logs.shift();
    send('lan-log', line);
  }
  // 白名单日志：我方 [ ] 行、连上节点、真实错误；其余内核内部 INFO/WARN/DEBUG 不展示
  function pushLog(line) {
    const s = String(line).replace(/\r?\n$/, '');
    if (!s) return;
    if (s.startsWith('[')) return emitLog(s);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return;
    let m = s.match(/reconn result: Some\(Ok\(ReconnResult \{ dead_url: "([^"]+)"/);
    if (m) return emitLog('[已连接中继节点] ' + m[1]);
    if (/reconn result: Some\(Err/.test(s) && !/dns|hickory|timeout after 1\.99|connect timeout/i.test(s)) return emitLog('[节点连接失败] ' + s.slice(0, 160));
    if (/\bERROR\b/.test(s) && !/dns|stun|hickory|listener|hosts file/i.test(s)) return emitLog(s.slice(0, 200));
  }

  function stopWatcher() {
    if (state.logWatcher) { try { fs.unwatchFile(state.logWatcher); } catch {} state.logWatcher = null; }
    state.watchedSize = 0;
  }

  function killProc() {
    if (state.proc) {
      try { state.proc.kill(); } catch {}
      try { cp.spawnSync('taskkill', ['/F', '/T', '/PID', String(state.proc.pid)], { windowsHide: true }); } catch {}
      state.proc = null;
    }
  }

  function spawnCore(args, label) {
    return new Promise((resolve, reject) => {
      let proc;
      try {
        proc = cp.spawn(coreExe(), args, { cwd: coreDir(), windowsHide: true });
      } catch (e) { return reject(e); }
      state.proc = proc;
      let settled = false;
      const onLine = (buf) => buf.toString().split(/\r?\n/).forEach(pushLog);
      proc.stdout.on('data', onLine);
      proc.stderr.on('data', onLine);
      proc.on('error', (err) => {
        pushLog(`[启动失败] ${err.message}`);
        if (!settled) { settled = true; reject(err); }
        send('lan-state', { running: false, mode: state.mode, reason: 'error' });
      });
      proc.on('exit', (code) => {
        pushLog(`[内核已退出 code=${code}]`);
        if (state.proc === proc) state.proc = null;
        send('lan-state', { running: false, mode: state.mode, reason: 'exit', code });
      });
      // 给内核一点启动时间，确认进程没有立即崩溃
      setTimeout(() => { if (!settled) { settled = true; resolve(proc); } }, 1200);
    });
  }

  // 自动监听游戏 latest.log，捕获“对局域网开放”的端口
  function watchGameLog(logPath) {
    stopWatcher();
    if (!logPath || !fs.existsSync(logPath)) return false;
    try { state.watchedSize = fs.statSync(logPath).size; } catch { state.watchedSize = 0; }
    state.logWatcher = logPath;
    const PORT_RE = /(?:Local game hosted on port|本地游戏已在端口|局域网游戏已在端口|对局域网开放[^\d]{0,12})(\d{2,5})/;
    fs.watchFile(logPath, { interval: 800 }, (cur) => {
      try {
        const size = cur.size;
        if (size < state.watchedSize) state.watchedSize = 0; // 日志被重置
        if (size <= state.watchedSize) return;
        const fd = fs.openSync(logPath, 'r');
        const len = size - state.watchedSize;
        const buf = Buffer.alloc(Math.min(len, 65536));
        fs.readSync(fd, buf, 0, buf.length, Math.max(0, size - buf.length));
        fs.closeSync(fd);
        state.watchedSize = size;
        const text = buf.toString('utf8');
        const m = text.match(PORT_RE);
        if (m) {
          const port = Number(m[1]);
          if (port >= 1024 && port <= 65535 && port !== state.portFound) {
            state.portFound = port;
            if (state.config) state.config.mcPort = port;
            pushLog(`[检测到局域网端口] ${port}`);
            send('lan-port', { port });
          }
        }
      } catch {}
    });
    return true;
  }

  ipcMain.handle('lan-core-info', async () => {
    const exists = fs.existsSync(coreExe());
    let version = '';
    if (exists) {
      try { version = (cp.execFileSync(coreExe(), ['--version'], { windowsHide: true, encoding: 'utf8' })).trim(); } catch {}
    }
    return { ready: exists, corePath: coreExe(), version };
  });

  ipcMain.handle('lan-start-host', async () => {
    if (state.proc) await stopInternal();
    const lanIp = pickLanIp();
    const rpcPort = await getFreePort();
    const networkName = 'glow-' + randStr(6);
    const networkSecret = randStr(20);
    const args = [
      '--network-name', networkName,
      '--network-secret', networkSecret,
      '-i', HOST_VIRT_IP,
      '--no-tun', 'true',
      '--use-smoltcp', 'true',
      '--no-listener',
      ...(await peerArgs()),
      '-r', `127.0.0.1:${rpcPort}`,
      '-n', `${lanIp}/32`,
      '--hostname', 'GlowHost',
      '--console-log-level', 'warn',
    ];
    state.mode = 'host';
    state.config = { networkName, networkSecret, lanIp, virtIp: HOST_VIRT_IP, rpcPort, mcPort: null };
    state.logs = []; state.portFound = null;
    await spawnCore(args, 'host');
    send('lan-state', { running: true, mode: 'host' });
    return { success: true, mode: 'host', ...state.config };
  });

  ipcMain.handle('lan-start-join', async (_e, arg) => {
    if (state.proc) await stopInternal();
    let info;
    try { info = b64urlDecode(typeof arg === 'string' ? arg : arg.code); } catch { return { success: false, error: '邀请码无效，无法解析' }; }
    if (!info.n || !info.s || !info.ip || !info.port) return { success: false, error: '邀请码信息不完整（需要网络凭证与房主端口）' };
    const rpcPort = await getFreePort();
    // 本地转发口：优先 25565，占用则随机
    let localPort = 25565;
    const busy = await new Promise((r) => { const t = net.createServer(); t.once('error', () => r(true)); t.once('listening', () => t.close(() => r(false))); t.listen(localPort, '127.0.0.1'); });
    if (busy) localPort = await getFreePort();
    const target = `${info.ip}:${info.port}`;
    const args = [
      '--network-name', info.n,
      '--network-secret', info.s,
      '-i', JOIN_VIRT_IP,
      '--no-tun', 'true',
      '--use-smoltcp', 'true',
      '--no-listener',
      ...(await peerArgs()),
      '-r', `127.0.0.1:${rpcPort}`,
      '--port-forward', `tcp://127.0.0.1:${localPort}/${target}`,
      '--port-forward', `udp://127.0.0.1:${localPort}/${target}`,
      '--hostname', 'GlowPlayer',
      '--console-log-level', 'warn',
    ];
    state.mode = 'join';
    state.config = { networkName: info.n, target, localPort, rpcPort, hostIp: info.ip, mcPort: info.port };
    state.logs = [];
    await spawnCore(args, 'join');
    send('lan-state', { running: true, mode: 'join' });
    return { success: true, mode: 'join', ...state.config };
  });

  // 房主设置/更新 MC 局域网端口，生成最终邀请码
  ipcMain.handle('lan-set-host-port', async (_e, arg) => {
    if (state.mode !== 'host' || !state.config) return { success: false, error: '房间未创建' };
    const port = Number(typeof arg === 'object' ? arg.port : arg);
    if (!port || port < 1024 || port > 65535) return { success: false, error: '端口无效' };
    state.config.mcPort = port; state.portFound = port;
    const code = b64urlEncode({ n: state.config.networkName, s: state.config.networkSecret, ip: state.config.lanIp, port });
    return { success: true, port, code };
  });

  function resolveRunDir(root, versionId, isolated) {
    try {
      const per = path.join(root, 'versions', String(versionId || ''));
      const looksIsolated = fs.existsSync(path.join(per, 'mods')) || fs.existsSync(path.join(per, 'saves'))
        || fs.existsSync(path.join(per, 'options.txt')) || fs.existsSync(path.join(per, 'config'));
      if (isolated || looksIsolated) return per;
    } catch {}
    return root;
  }
  function resolveLatestLog(arg) {
    if (typeof arg === 'string') return arg;
    if (!arg) return '';
    if (arg.logPath) return arg.logPath;
    let root = arg.gameDir || '.minecraft';
    if (!path.isAbsolute(root)) root = path.join(app.getPath('appData'), root);
    const segs = root.split(/[\\/]/);
    if (arg.versionId && segs.length >= 2 && segs[segs.length - 2] === 'versions' && segs[segs.length - 1] === arg.versionId) {
      root = path.dirname(path.dirname(root));
    }
    const runDir = resolveRunDir(root, arg.versionId, arg.versionIsolation);
    return path.join(runDir, 'logs', 'latest.log');
  }
  ipcMain.handle('lan-watch-log', async (_e, arg) => {
    const logPath = resolveLatestLog(arg);
    return { success: watchGameLog(logPath), logPath };
  });

  async function stopInternal() {
    stopWatcher();
    killProc();
    state.mode = null; state.config = null; state.portFound = null;
    send('lan-state', { running: false, mode: null });
  }
  ipcMain.handle('lan-stop', async () => { await stopInternal(); return { success: true }; });

  ipcMain.handle('lan-get-state', async () => ({ mode: state.mode, running: !!state.proc, config: state.config, portFound: state.portFound }));

  ipcMain.handle('lan-logs', async () => state.logs.slice(-200));

  ipcMain.handle('lan-status', async () => {
    if (!state.proc || !state.config) return { running: false, peers: [] };
    const rpc = `127.0.0.1:${state.config.rpcPort}`;
    function run(args) {
      return new Promise((resolve) => {
        cp.execFile(cliExe(), ['-p', rpc, '-o', 'json', ...args], { windowsHide: true, encoding: 'utf8', timeout: 4000 }, (e, out) => e ? resolve(null) : resolve(out));
      });
    }
    const [peerOut, nodeOut] = await Promise.all([run(['peer']), run(['node'])]);
    let peers = [];
    try { const j = JSON.parse(peerOut); const arr = Array.isArray(j) ? j : (j.peers || []); peers = arr.map((p) => ({ hostname: p.hostname, ipv4: p.ipv4, cost: p.cost, conn: p.tunnel_proto, lat: p.lat_ms })); } catch {}
    let node = null;
    try { node = JSON.parse(nodeOut); } catch {}
    return { running: true, mode: state.mode, peers, node };
  });

  // 应用退出时确保内核被回收
  app.on('before-quit', () => { try { stopWatcher(); killProc(); } catch {} });

  return { stop: stopInternal };
}

module.exports = { initLan, b64urlEncode };
