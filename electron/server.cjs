// 本地开服（赞助版）—— 一键下载并在本机运行 Minecraft 服务端，带控制台与进程管理。
// 支持 Vanilla / Fabric / Forge / NeoForge：
//   Vanilla：版本 JSON 的 server.jar；
//   Fabric：meta 的 server 引导 jar（首次运行自动补齐库）；
//   Forge / NeoForge：下载 installer 后用匹配的 Java 执行 --installServer，再运行生成的 run.bat。
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');
const cp = require('child_process');
const https = require('https');
const http = require('http');

const keepAgent = new https.Agent({ keepAlive: true, maxSockets: 48, maxFreeSockets: 16 });
function agentFor(u) { return u.startsWith('http:') ? undefined : keepAgent; }

function get(url, { timeoutMs = 20000, headers } = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('重定向过多'));
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(url, {
      agent: agentFor(url),
      headers: Object.assign({ 'User-Agent': 'GlowstoneLauncher/1.0', 'Accept-Encoding': 'identity' }, headers || {}),
      timeout: timeoutMs,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return get(new URL(res.headers.location, url).toString(), { timeoutMs, headers }, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error('连接超时')));
    req.on('error', reject);
  });
}
async function getJson(url, opts) { return JSON.parse((await get(url, opts)).toString('utf8')); }

// ---- 快速文件下载：支持 Range 时多连接分块并行，否则单连接流式；全程上报百分比 ----
function probeRange(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('重定向过多'));
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(url, {
      agent: agentFor(url),
      headers: { 'User-Agent': 'GlowstoneLauncher/1.0', Range: 'bytes=0-0', 'Accept-Encoding': 'identity' },
      timeout: 15000,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return probeRange(new URL(res.headers.location, url).toString(), redirects + 1).then(resolve, reject);
      }
      const cr = res.headers['content-range'] || '';
      const m = /\/(\d+)$/.exec(cr);
      const total = m ? parseInt(m[1], 10) : parseInt(res.headers['content-length'] || '0', 10);
      res.resume();
      resolve({ finalUrl: url, support: res.statusCode === 206 && !!m && total > 0, total });
    });
    req.on('timeout', () => req.destroy(new Error('连接超时')));
    req.on('error', reject);
  });
}
function oneRange(url, start, end, partPath, tries = 3) {
  return new Promise((resolve, reject) => {
    const run = (n) => {
      const out = fs.createWriteStream(partPath);
      const u = new URL(url);
      const lib = u.protocol === 'http:' ? http : https;
      const req = lib.get(url, {
        agent: agentFor(url),
        headers: { 'User-Agent': 'GlowstoneLauncher/1.0', Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' },
        timeout: 30000,
      }, (res) => {
        if (res.statusCode !== 206 && res.statusCode !== 200) { res.resume(); return fail(new Error('HTTP ' + res.statusCode)); }
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve()));
        out.on('error', fail); res.on('error', fail);
      });
      let settled = false;
      const fail = (e) => { if (settled) return; settled = true; try { req.destroy(); } catch {} fs.unlink(partPath, () => {}); if (n < tries) setTimeout(() => run(n + 1), 500 * n); else reject(e); };
      req.on('timeout', () => fail(new Error('连接超时')));
      req.on('error', fail);
    };
    run(1);
  });
}
async function chunkedDownload(url, savePath, total, onPct, connections = 8) {
  const dir = path.dirname(savePath);
  fs.mkdirSync(dir, { recursive: true });
  const parts = [];
  const seg = Math.ceil(total / connections);
  const done = new Array(connections).fill(0);
  const tasks = [];
  for (let i = 0; i < connections; i++) {
    const start = i * seg;
    const end = Math.min(total - 1, start + seg - 1);
    if (start > end) { done[i] = 0; continue; }
    const partPath = path.join(dir, `.part_${i}_${process.pid}`);
    parts.push(partPath);
    const size = end - start + 1;
    tasks.push(
      oneRange(url, start, end, partPath).then(() => {
        done[i] = size;
        const got = done.reduce((a, b) => a + b, 0);
        onPct(Math.min(99, (got / total) * 100));
      }),
    );
  }
  await Promise.all(tasks);
  // 顺序合并分块
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(savePath);
    let i = 0;
    const next = () => {
      if (i >= parts.length) return out.end(() => resolve());
      const rs = fs.createReadStream(parts[i++]);
      rs.on('error', reject); rs.on('end', next); rs.pipe(out, { end: false });
    };
    out.on('error', reject);
    next();
  });
  parts.forEach((p) => fs.unlink(p, () => {}));
  onPct(100);
}
function streamDownload(url, savePath, onPct) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(url, {
      agent: agentFor(url),
      headers: { 'User-Agent': 'GlowstoneLauncher/1.0', 'Accept-Encoding': 'identity' },
      timeout: 30000,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return streamDownload(new URL(res.headers.location, url).toString(), savePath, onPct).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let got = 0;
      const out = fs.createWriteStream(savePath);
      res.on('data', (d) => { got += d.length; if (total) onPct(Math.min(99, (got / total) * 100)); });
      res.pipe(out);
      out.on('finish', () => out.close(() => { onPct(100); resolve(got); }));
      out.on('error', reject); res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('连接超时')));
    req.on('error', reject);
  });
}
async function downloadFast(url, savePath, onPct) {
  fs.mkdirSync(path.dirname(savePath), { recursive: true });
  try {
    const info = await probeRange(url);
    if (info.support && info.total > 2 * 1024 * 1024) {
      const conns = info.total > 30 * 1024 * 1024 ? 8 : 6;
      await chunkedDownload(info.finalUrl, savePath, info.total, onPct || (() => {}), conns);
      return info.total;
    }
  } catch { /* 探测失败则回退流式 */ }
  return streamDownload(url, savePath, onPct || (() => {}));
}
// 兼容旧调用：downloadTo(url, savePath, { onProgress })
async function downloadTo(url, savePath, opts) {
  return downloadFast(url, savePath, (opts && opts.onProgress) || (() => {}));
}

function initServer({ ipcMain, app, getMainWindow }) {
  const send = (channel, payload) => {
    const w = getMainWindow && getMainWindow();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };
  const registryPath = () => path.join(app.getPath('userData'), 'server_registry.json');
  const readRegistry = () => { try { const a = JSON.parse(fs.readFileSync(registryPath(), 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; } };
  const writeRegistry = (a) => { try { fs.writeFileSync(registryPath(), JSON.stringify(a, null, 2)); } catch {} };

  const state = { proc: null, dir: null, logs: [], ready: false, lanIp: '', port: 25565 };
  // 安装进度（主进程权威状态）：切走页面再回来，可通过 server-install-state 取回，进度不丢
  const install = { running: false, percent: 0, phase: '', done: false, error: '', logs: [] };
  function installSnapshot() {
    return {
      running: install.running, percent: Math.round(install.percent), phase: install.phase,
      done: install.done, error: install.error, logs: install.logs.slice(-200),
    };
  }
  function setInstall(patch) {
    Object.assign(install, patch);
    send('server-install-progress', installSnapshot());
  }
  function installLine(s) {
    const line = String(s).replace(/\r?\n$/, '');
    if (!line) return;
    install.logs.push(line);
    if (install.logs.length > 200) install.logs = install.logs.slice(-200);
    try { send('server-install-log', line); } catch {}
    setInstall({});
  }
  function pushLog(line) {
    const s = String(line).replace(/\r?\n$/, '');
    if (!s) return;
    state.logs.push(s);
    if (state.logs.length > 800) state.logs = state.logs.slice(-800);
    send('server-log', s);
    // 服务端加载完成（出现 "Done (x.xxxs)! For help, type ..."）
    if (!state.ready && /Done \([\d.]+s\)!/.test(s)) {
      state.ready = true;
      emitState(true, { ready: true });
    }
  }
  function emitState(running, extra) {
    const address = state.lanIp ? `${state.lanIp}:${state.port}` : '';
    send('server-state', Object.assign({
      running, dir: state.dir, ready: state.ready,
      lanIp: state.lanIp, port: state.port, address,
    }, extra || {}));
  }

  // 本机局域网 IPv4（供同 WiFi/局域网的玩家连接）
  function lanIPv4() {
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
      for (const ni of ifs[name] || []) {
        if (ni.family === 'IPv4' && !ni.internal) return ni.address;
      }
    }
    return '127.0.0.1';
  }
  // 读取 server.properties 里的端口（首次运行前文件不存在则默认 25565）
  function readServerPort(dir) {
    try {
      const t = fs.readFileSync(path.join(dir, 'server.properties'), 'utf8');
      const m = /^\s*server-port\s*=\s*(\d+)/m.exec(t);
      if (m) return parseInt(m[1], 10);
    } catch {}
    return 25565;
  }

  // ---- 版本信息（BMCL 优先，官方回退）----
  const MANIFEST = [
    'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json',
    'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json',
  ];
  async function versionJsonOf(mc) {
    let man = null;
    for (const u of MANIFEST) { try { man = await getJson(u, { timeoutMs: 12000 }); break; } catch {} }
    if (!man) throw new Error('无法获取版本清单');
    const ent = man.versions.find((v) => v.id === mc);
    if (!ent) throw new Error('未找到版本 ' + mc);
    const vjUrls = [
      ent.url.includes('mojang') ? ent.url.replace(/^https?:\/\/[^/]+/, 'https://bmclapi2.bangbang93.com') : ent.url,
      ent.url,
    ];
    let vj = null;
    for (const u of vjUrls) { try { vj = await getJson(u, { timeoutMs: 12000 }); break; } catch {} }
    if (!vj) throw new Error('无法获取版本 ' + mc + ' 的信息');
    return vj;
  }
  function bmclMaven(officialUrl) {
    // 官方 maven → BMCL /maven 镜像
    try {
      const u = new URL(officialUrl);
      if (u.hostname === 'maven.minecraftforge.net') return 'https://bmclapi2.bangbang93.com/maven' + u.pathname;
      if (u.hostname === 'maven.neoforged.net') return 'https://bmclapi2.bangbang93.com/maven' + u.pathname.replace(/^\/releases/, '');
      return officialUrl;
    } catch { return officialUrl; }
  }
  async function xmlMeta(url) {
    let buf = null;
    for (const u of [bmclMaven(url), url]) { try { buf = await get(u, { timeoutMs: 15000 }); break; } catch {} }
    if (!buf) throw new Error('无法获取加载器版本元数据');
    return buf.toString('utf8');
  }
  function versionsFromXml(xml) {
    const out = [];
    const re = /<version>([^<]+)<\/version>/g;
    let m;
    while ((m = re.exec(xml))) out.push(m[1]);
    return out;
  }

  // ---- Fabric 国内镜像 ----
  // Fabric Meta（版本/loader/profile JSON）：BMCL 镜像优先，官方回退
  const FABRIC_META_BASES = [
    'https://bmclapi2.bangbang93.com/fabric-meta',
    'https://meta.fabricmc.net',
  ];
  async function fabricGetJson(suffix, opts) {
    let lastErr = null;
    for (const base of FABRIC_META_BASES) {
      try {
        const j = await getJson(base + suffix, Object.assign({ timeoutMs: 15000 }, opts || {}));
        if (j !== null && j !== undefined) return j;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('无法获取 Fabric 信息');
  }
  // Fabric / Mojang maven 库：BMCL 统一 maven 镜像优先，官方基址回退
  function fabricMavenBases(officialBase) {
    const out = ['https://bmclapi2.bangbang93.com/maven/'];
    if (officialBase) out.push(officialBase.endsWith('/') ? officialBase : officialBase + '/');
    out.push('https://maven.fabricmc.net/');
    return Array.from(new Set(out));
  }
  // Maven 坐标 group:artifact:version[:classifier] → 仓库相对路径
  function mavenCoordToPath(name) {
    const p = String(name).split(':');
    const group = (p[0] || '').replace(/\./g, '/');
    const art = p[1], ver = p[2], cls = p[3];
    const file = `${art}-${ver}${cls ? '-' + cls : ''}.jar`;
    return `${group}/${art}/${ver}/${file}`;
  }

  // ---- 安装 ----
  ipcMain.handle('server-install', async (event, arg) => {
    const { mcVersion, loader, dir, javaPath } = arg || {};
    if (!mcVersion || !dir) return { success: false, error: '缺少版本或安装目录' };
    const onLog = (s) => String(s).split(/\r?\n/).forEach(installLine);
    // 重置安装状态并开始
    install.logs = []; install.error = ''; install.done = false; install.percent = 0; install.phase = '准备中'; install.running = true;
    setInstall({});
    const onPct = (p) => setInstall({ percent: p });
    try {
      fs.mkdirSync(dir, { recursive: true });
      const reg = readRegistry();
      let rec = { dir, mc: mcVersion, loader: loader || 'vanilla', loaderVer: '', jar: '', installed: false };

      if (!loader || loader === 'vanilla') {
        onLog('正在获取版本信息…');
        const vj = await versionJsonOf(mcVersion);
        if (!vj.downloads || !vj.downloads.server) throw new Error('该版本没有服务端（可能是仅客户端版本）');
        let url = vj.downloads.server.url;
        const bmcl = url.replace(/^https?:\/\/[^/]+/, 'https://bmclapi2.bangbang93.com');
        rec.jar = 'server.jar';
        setInstall({ phase: '下载 server.jar', percent: 0 });
        onLog('正在下载 server.jar（多连接加速）…');
        try { await downloadTo(bmcl, path.join(dir, rec.jar), { onProgress: onPct }); }
        catch { await downloadTo(url, path.join(dir, rec.jar), { onProgress: onPct }); }
      } else if (loader === 'fabric') {
        onLog('正在获取 Fabric 信息（国内镜像）…');
        setInstall({ phase: '正在获取 Fabric 信息…', percent: 0 });
        // 1) loader 列表（BMCL fabric-meta 优先，官方回退）
        const list = await fabricGetJson(`/v2/versions/loader/${encodeURIComponent(mcVersion)}`);
        if (!Array.isArray(list) || !list.length) throw new Error('未找到适用于 ' + mcVersion + ' 的 Fabric');
        const pick = list.find((x) => x.loader && x.loader.stable !== false) || list[0];
        rec.loaderVer = pick.loader.version;
        // 2) 完整库清单：profile/json（含 fabric-loader + intermediary + 公共库）；失败则用 launcherMeta 拼
        let libs = null;
        try {
          const profile = await fabricGetJson(`/v2/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(rec.loaderVer)}/profile/json`);
          if (profile && Array.isArray(profile.libraries) && profile.libraries.length) libs = profile.libraries;
        } catch { /* 落到 launcherMeta */ }
        if (!libs) {
          const lm = (pick.launcherMeta && pick.launcherMeta.libraries) || {};
          libs = [].concat(lm.common || [], lm.server || []);
          libs.push({ name: pick.intermediary.maven, url: 'https://maven.fabricmc.net/' });
          libs.push({ name: pick.loader.maven, url: 'https://maven.fabricmc.net/' });
        }
        onLog(`Fabric loader ${rec.loaderVer}，共 ${libs.length} 个库，全部走国内镜像下载`);
        // 3) 原版 server.jar（BMCL 镜像，占进度 0~55%）
        onLog('正在下载原版 server.jar（镜像加速）…');
        const vj = await versionJsonOf(mcVersion);
        if (!vj.downloads || !vj.downloads.server) throw new Error('该版本没有服务端（可能是仅客户端版本）');
        const vanillaUrl = vj.downloads.server.url;
        const vanillaBmcl = vanillaUrl.replace(/^https?:\/\/[^/]+/, 'https://bmclapi2.bangbang93.com');
        setInstall({ phase: '下载原版 server.jar', percent: 0 });
        try {
          await downloadTo(vanillaBmcl, path.join(dir, 'server.jar'), { onProgress: (p) => onPct(Math.round(p * 0.55)) });
        } catch {
          await downloadTo(vanillaUrl, path.join(dir, 'server.jar'), { onProgress: (p) => onPct(Math.round(p * 0.55)) });
        }
        // 4) Fabric 库（BMCL maven 镜像，占进度 55~100%）
        const libRoot = path.join(dir, 'libraries');
        let done = 0;
        for (const lib of libs) {
          const rel = mavenCoordToPath(lib.name);
          const saveTo = path.join(libRoot, rel);
          fs.mkdirSync(path.dirname(saveTo), { recursive: true });
          if (fs.existsSync(saveTo) && fs.statSync(saveTo).size > 0) { done += 1; onPct(55 + Math.round((done / libs.length) * 45)); continue; }
          setInstall({ phase: `下载 Fabric 库 ${done + 1}/${libs.length}` });
          let lastErr = null, ok = false;
          for (const base of fabricMavenBases(lib.url)) {
            try { await downloadTo(base + rel, saveTo, { onProgress: () => {} }); ok = true; break; }
            catch (e) { lastErr = e; }
          }
          if (!ok) throw new Error('Fabric 库下载失败：' + lib.name + '（' + String(lastErr && lastErr.message || lastErr) + '）');
          done += 1;
          onPct(55 + Math.round((done / libs.length) * 45));
        }
        rec.jar = 'server.jar';
        rec.fabric = true;
        onLog('Fabric 服务端文件准备完成');
      } else if (loader === 'forge' || loader === 'neoforge') {
        if (!javaPath) return { success: false, error: '安装 Forge/NeoForge 需要选择 Java' };
        let ver = '';
        let installerRel = '';
        if (loader === 'forge') {
          const xml = await xmlMeta('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml');
          const all = versionsFromXml(xml).filter((v) => v.startsWith(mcVersion + '-'));
          // 优先无后缀（推荐版），否则取最新（含 beta）
          ver = [...all].reverse().find((v) => /^[\d.]+-[\d.]+$/.test(v)) || [...all].reverse()[0];
          if (!ver) throw new Error('未找到适用于 ' + mcVersion + ' 的 Forge');
          installerRel = `net/minecraftforge/forge/${ver}/forge-${ver}-installer.jar`;
        } else {
          const xml = await xmlMeta('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml');
          const mm = /^1\.(\d+)\.(\d+)/.exec(mcVersion);
          const prefix = mm ? `${mm[1]}.${mm[2]}` : '';
          const all = versionsFromXml(xml).filter((v) => !prefix || v.startsWith(prefix + '.'));
          ver = [...all].reverse()[0];
          if (!ver) throw new Error('未找到适用于 ' + mcVersion + ' 的 NeoForge');
          installerRel = `net/neoforged/neoforge/${ver}/neoforge-${ver}-installer.jar`;
        }
        rec.loaderVer = ver;
        const installerOfficial = loader === 'forge'
          ? `https://maven.minecraftforge.net/${installerRel}`
          : `https://maven.neoforged.net/releases/${installerRel}`;
        const installerPath = path.join(dir, path.basename(installerRel));
        setInstall({ phase: `下载 ${loader} 安装器 ${ver}`, percent: 0 });
        onLog(`正在下载 ${loader} 安装器 (${ver})…`);
        try { await downloadTo(bmclMaven(installerOfficial), installerPath, { onProgress: onPct }); }
        catch { await downloadTo(installerOfficial, installerPath, { onProgress: onPct }); }
        setInstall({ phase: '执行安装器（下载服务端与库，可能需几分钟）', percent: 100 });
        onLog('正在执行安装器 --installServer（会下载服务端与库，可能需几分钟）…');
        await new Promise((resolve, reject) => {
          const p = cp.spawn(javaPath, ['-jar', installerPath, '--installServer'], { cwd: dir, windowsHide: true });
          p.stdout.on('data', (d) => onLog(d.toString().trim()));
          p.stderr.on('data', (d) => onLog(d.toString().trim()));
          p.on('error', reject);
          p.on('exit', (c) => c === 0 ? resolve() : reject(new Error('安装器退出码 ' + c)));
        });
        try { fs.unlinkSync(installerPath); } catch {}
        rec.jar = fs.existsSync(path.join(dir, 'run.bat')) ? 'run.bat' : '';
      } else {
        return { success: false, error: '不支持的加载器：' + loader };
      }

      rec.installed = true;
      const others = reg.filter((r) => r.dir !== dir);
      writeRegistry([...others, rec]);
      emitState(false, { installed: true });
      setInstall({ running: false, done: true, percent: 100, phase: '安装完成' });
      return { success: true, record: rec };
    } catch (e) {
      const msg = String((e && e.message) || e);
      setInstall({ running: false, error: msg, phase: '安装失败' });
      return { success: false, error: msg };
    }
  });

  // 安装进度快照（页面挂载时调用，切走再回来进度不丢）
  ipcMain.handle('server-install-state', async () => installSnapshot());

  ipcMain.handle('server-list', async () => readRegistry());

  function killProc() {
    if (state.proc) {
      const pid = state.proc.pid;
      try { state.proc.kill(); } catch {}
      try { cp.spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true }); } catch {}
      state.proc = null;
    }
  }

  ipcMain.handle('server-start', async (event, arg) => {
    const { dir, javaPath, maxMem, minMem } = arg || {};
    const rec = readRegistry().find((r) => r.dir === dir);
    if (!rec) return { success: false, error: '未找到该服务器，请先安装' };
    if (state.proc) return { success: false, error: '已有服务器在运行，请先停止' };
    if (!javaPath && rec.loader !== 'forge' && rec.loader !== 'neoforge') return { success: false, error: '请选择 Java' };
    try {
      // 自动同意 EULA
      fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n');
      state.dir = dir;
      state.logs = [];
      state.ready = false;
      state.lanIp = lanIPv4();
      state.port = readServerPort(dir);
      let proc;
      const xms = Math.max(512, Number(minMem) || 1024);
      const xmx = Math.max(xms, Number(maxMem) || 2048);
      if (rec.loader === 'forge' || rec.loader === 'neoforge') {
        if (!fs.existsSync(path.join(dir, 'run.bat'))) return { success: false, error: '未找到 run.bat，安装可能不完整' };
        proc = cp.spawn('cmd.exe', ['/c', 'run.bat', 'nogui'], { cwd: dir, windowsHide: true });
      } else if (rec.loader === 'fabric' || rec.fabric === true) {
        // Fabric：classpath = libraries 下全部库 + 原版 server.jar，主类 KnotServer，gameJarPath 指向原版 jar
        const libRoot = path.join(dir, 'libraries');
        const cpJars = [];
        const walk = (d) => {
          if (!fs.existsSync(d)) return;
          for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
            const fp = path.join(d, ent.name);
            if (ent.isDirectory()) walk(fp);
            else if (ent.name.endsWith('.jar')) cpJars.push(fp);
          }
        };
        walk(libRoot);
        const vanillaJar = path.join(dir, 'server.jar');
        if (!fs.existsSync(vanillaJar)) return { success: false, error: '未找到 server.jar，安装可能不完整' };
        cpJars.push(vanillaJar);
        const classpath = cpJars.join(';');
        proc = cp.spawn(javaPath, [
          '-Xms' + xms + 'M', '-Xmx' + xmx + 'M',
          '-Dfabric.gameJarPath=' + vanillaJar,
          '-cp', classpath,
          'net.fabricmc.loader.impl.launch.knot.KnotServer', 'nogui',
        ], { cwd: dir, windowsHide: true });
      } else {
        proc = cp.spawn(javaPath, ['-Xms' + xms + 'M', '-Xmx' + xmx + 'M', '-jar', rec.jar, 'nogui'], { cwd: dir, windowsHide: true });
      }
      state.proc = proc;
      const onData = (d) => d.toString().split(/\r?\n/).forEach(pushLog);
      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);
      proc.on('error', (e) => { pushLog('[启动失败] ' + e.message); emitState(false); });
      proc.on('exit', (code) => {
        if (state.proc === proc) state.proc = null;
        pushLog('[服务器已停止 code=' + code + ']');
        emitState(false, { code });
      });
      emitState(true);
      return { success: true };
    } catch (e) {
      return { success: false, error: String((e && e.message) || e) };
    }
  });

  ipcMain.handle('server-stop', async () => { killProc(); state.ready = false; emitState(false); return { success: true }; });
  ipcMain.handle('server-state', async () => ({
    running: !!state.proc, dir: state.dir, ready: state.ready,
    lanIp: state.lanIp, port: state.port,
    address: state.lanIp ? `${state.lanIp}:${state.port}` : '',
  }));
  ipcMain.handle('server-logs', async () => state.logs.slice(-400));
  // 向服务端控制台发送命令（op / gamemode / say / stop …）
  ipcMain.handle('server-command', async (_e, arg) => {
    const cmd = String((arg && arg.command) || '').trim();
    if (!cmd) return { success: false, error: '命令为空' };
    if (!state.proc) return { success: false, error: '服务器未运行' };
    const stdin = state.proc.stdin;
    if (!stdin || stdin.destroyed) return { success: false, error: '控制台不可写（进程可能正在退出）' };
    try {
      stdin.write(cmd + '\n');
      pushLog('> ' + cmd);
      return { success: true };
    } catch (e) {
      return { success: false, error: String((e && e.message) || e) };
    }
  });
  // Windows 下递归删除目录：处理只读属性与短暂占用（jar/日志可能被锁），重试若干次
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  async function rimrafRetry(target, tries = 3) {
    let lastErr = null;
    for (let n = 1; n <= tries; n++) {
      try { fs.rmSync(target, { recursive: true, force: true }); lastErr = null; break; }
      catch (e) {
        lastErr = e;
        // 兜底：清掉只读位再删
        try {
          const chmod = (d) => {
            if (!fs.existsSync(d)) return;
            try { fs.chmodSync(d, 0o666); } catch {}
            for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
              const fp = path.join(d, ent.name);
              if (ent.isDirectory()) chmod(fp);
              else { try { fs.chmodSync(fp, 0o666); } catch {} }
            }
          };
          chmod(target);
          fs.rmSync(target, { recursive: true, force: true });
          lastErr = null; break;
        } catch (e2) { lastErr = e2; await delay(400 * n); }
      }
    }
    if (lastErr) throw lastErr;
  }

  ipcMain.handle('server-remove', async (_e, arg) => {
    const dir = (arg && arg.dir) || '';
    if (!dir) return { success: false, error: '缺少目录参数' };
    if (state.dir === dir) { killProc(); state.dir = null; state.ready = false; }
    // 1) 先从注册表移除（即使磁盘删除失败也不再出现在列表）
    writeRegistry(readRegistry().filter((r) => r.dir !== dir));
    // 2) 真正递归删除磁盘上的服务器文件
    try {
      if (fs.existsSync(dir)) await rimrafRetry(dir);
      return { success: true, removed: !fs.existsSync(dir) };
    } catch (e) {
      const msg = String((e && e.message) || e);
      return { success: false, error: '记录已删除，但文件删除失败（可能被占用，请关闭后手动删除）：' + msg };
    }
  });

  app.on('before-quit', () => { try { killProc(); } catch {} });
  return {};
}

module.exports = { initServer };
