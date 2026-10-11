const { app, BrowserWindow, shell, ipcMain, clipboard, dialog, session, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let splashWindow;
let tray = null;
let isQuitting = false;
// 部分安全软件 / 输入法 / 游戏覆盖层向渲染进程注入 DLL，与 Chromium 的渲染器代码完整性
// （RendererCodeIntegrity）冲突时，渲染进程会在启动瞬间直接崩溃（退出码 0x80000003 /
// 0xFFFF7003）。仅关闭该代码完整性检查，操作系统沙箱与站点隔离仍然保留，兼容更多用户机器。
app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity');
// 某些 Windows 环境（精简版系统、AppContainer 权限损坏、部分安全软件/EDR、Win7/8 等）下，
// Chromium 渲染器沙箱在初始化瞬间就崩溃——即使是只加载 data URL 的空白窗口也崩，
// 渲染进程退出码 0x80000003（STATUS_BREAKPOINT），表现为“打开后没有任何渲染/白屏”。
// 本启动器只加载本地打包页面、外部链接一律交给系统浏览器，并始终保留 contextIsolation、
// 关闭 nodeIntegration，禁用渲染沙箱不改变其“仅运行可信本地内容”的模型，却能保证这些机器正常显示。
app.commandLine.appendSwitch('no-sandbox');
// 关闭/最小化前先让渲染层播放淡出动画，动画结束回传 anim-finished 再真正隐藏/最小化
let pendingWinAction = null;

// Public OAuth client for the Microsoft Identity v2 device-code flow. Public-client id, no secret needed.
const MS_CLIENT_ID = 'c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb';
const MS_DEVICE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode';
const MS_TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const APP_ICON = path.join(__dirname, 'icon.ico');

// 全局连接池：开启 keepAlive 复用 TCP/TLS（默认 agent 每个请求都重新握手，几百个小文件时
// 握手开销巨大），并放大单主机并发上限。下载同一主机的多个文件/分块时直接复用连接，
// 这是 PCL2 下载快的关键之一。Node 会按 host:port 自动分池，跨主机/重定向也安全。
const httpsKeepAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 4000, maxSockets: 64, maxFreeSockets: 24, scheduling: 'fifo', timeout: 30000 });
const httpKeepAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 4000, maxSockets: 64, maxFreeSockets: 24, scheduling: 'fifo', timeout: 30000 });
function agentForUrl(u) {
  try { return new URL(u).protocol === 'http:' ? httpKeepAgent : httpsKeepAgent; }
  catch { return httpsKeepAgent; }
}

// 版本 -> 必需 Java 大版本 的权威映射（官方锁定；单一数据源 java-runtime-map.json，前端共享同一份）
const JAVA_RT_MAP = (() => {
  try { return require('./java-runtime-map.json'); }
  catch { return { legacy: [], calendar: {}, defaultLatest: 21, downloadFallbackMajor: {}, downloads: [] }; }
})();
function parseMcVersion(id) {
  // 从 "26.1.2-Fabric 0.19.3" / "1.21.11" / "26w14a" 开头提取版本号，忽略加载器后缀
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(id || '').trim());
  if (m) return { major: +m[1], minor: +m[2], patch: m[3] ? +m[3] : 0 };
  const w = /^(\d+)w/.exec(String(id || ''));
  if (w) return { major: +w[1], minor: -1, patch: 0 };
  return null;
}
// 该 MC 版本官方要求的最低 Java 大版本（传统 1.x 走区间，新年份版 26.x 走 calendar，替代旧的“猜 17”）
function requiredJavaForVersion(id) {
  const v = parseMcVersion(id);
  if (!v) return 21;
  if (v.major === 1) {
    for (const r of JAVA_RT_MAP.legacy) {
      if (r.minorMax != null && v.minor > r.minorMax) continue;
      if (r.minorMin != null && v.minor < r.minorMin) continue;
      if (r.minor != null && v.minor !== r.minor) continue;
      if (r.patchMax != null && v.patch > r.patchMax) continue;
      if (r.patchMin != null && v.patch < r.patchMin) continue;
      return r.java;
    }
    return 21;
  }
  return JAVA_RT_MAP.calendar[String(v.major)] ?? JAVA_RT_MAP.defaultLatest;
}

// 最早预热关键域名的 DNS（部分机器冷启动首次解析要十几秒，会拖慢版本清单/取肤/Java 下载）
try {
  const dns = require('dns');
  ['bmclapi2.bangbang93.com', 'launchermeta.mojang.com', 'api.mojang.com', 'api.adoptium.net', 'mirrors.tuna.tsinghua.edu.cn', 'mc-heads.net'].forEach((h) => dns.lookup(h, () => {}));
} catch {}

function httpRequest(url, options = {}, bodyData = null, _redirects = 0) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const lib = urlObj.protocol === 'http:' ? http : https;
    const method = options.method || 'GET';
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'http:' ? 80 : 443),
      path: urlObj.pathname + urlObj.search,
      method,
      headers: options.headers || {},
    };
    if (bodyData) reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyData);
    const req = lib.request(reqOptions, (res) => {
      // 跟随重定向：外置/微软登录可能先 301/302/307/308 跳转（http→https、非 www→www）。
      // 不跟随会让 POST 落到只收 GET 的最终 URL 而报 405。303 按规范改 GET，其余保持方法与 body。
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && _redirects < 6) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        const nextMethod = res.statusCode === 303 ? 'GET' : method;
        const nextBody = nextMethod === 'GET' ? null : bodyData;
        return resolve(httpRequest(next, { ...options, method: nextMethod }, nextBody, _redirects + 1));
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          // Try URL-encoded
          const params = new URLSearchParams(data);
          if (params.has('access_token') || params.has('error') || params.has('device_code')) {
            const obj = {};
            for (const [k, v] of params) obj[k] = v;
            resolve({ status: res.statusCode, data: obj });
          } else {
            resolve({ status: res.statusCode, data: data });
          }
        }
      });
    });
    req.setTimeout(options.timeoutMs || 15000, () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

// GET raw bytes with redirect-follow + hard timeout (renderer fetch to Mojang/BMCL can hang;
// routing through main also dodges CORS for skin/texture hosts).
function httpGetBuffer(url, { timeoutMs = 9000, redirects = 0, headers } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      method: 'GET',
      headers: Object.assign({ 'User-Agent': 'GlowstoneLauncher/1.0', 'Accept': '*/*' }, headers || {}),
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 6) {
        res.resume();
        return resolve(httpGetBuffer(new URL(res.headers.location, url).toString(), { timeoutMs, redirects: redirects + 1, headers }));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.end();
  });
}
async function httpGetJson(url, opts) {
  const buf = await httpGetBuffer(url, opts);
  return JSON.parse(buf.toString('utf8'));
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    transparent: false,
    resizable: false,
    alwaysOnTop: true,
    center: true,
    skipTaskbar: true,
    backgroundColor: '#020817',
    icon: APP_ICON,
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.webContents.on('did-finish-load', () => {
    try { splashWindow.show(); } catch {}
    applyWindowShape(splashWindow); // 启动画面同样圆角
  });
  splashWindow.on('closed', () => { splashWindow = null; });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    transparent: false,
    show: false,
    title: 'Glowstone Launcher',
    icon: APP_ICON,
    backgroundColor: '#020817',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    if (splashWindow) {
      setTimeout(() => {
        try { splashWindow.close(); } catch {}
        mainWindow.show();
        applyWindowShape(mainWindow);
      }, 600);
    } else {
      mainWindow.show();
      applyWindowShape(mainWindow);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('maximize-change', true);
    applyWindowShape(mainWindow); // 最大化铺满，去掉圆角
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('maximize-change', false);
    applyWindowShape(mainWindow); // 还原后恢复圆角
  });
  mainWindow.on('restore', () => {
    mainWindow.webContents.send('play-anim', 'in');
    applyWindowShape(mainWindow); // 最小化再恢复：重建形状，确保不透明可见
  });
  // 点 X / Alt+F4：播放淡出动画后收进系统托盘，而不是直接退出（托盘菜单可真正退出）
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      requestWinHide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// 让渲染层先播淡出动画，结束后再执行真正的窗口动作；500ms 兜底防止回调丢失卡死
function playOutThen(action) {
  pendingWinAction = action;
  const wc = mainWindow?.webContents;
  if (!wc || wc.isLoading()) { finishWinAction(); return; }
  wc.send('play-anim', 'out');
  setTimeout(() => { if (pendingWinAction === action) finishWinAction(); }, 500);
}
function finishWinAction() {
  const act = pendingWinAction;
  pendingWinAction = null;
  if (!mainWindow) return;
  if (act === 'min') mainWindow.minimize();
  else { mainWindow.hide(); trayHint(); }
}
function requestWinHide() { playOutThen('hide'); }

// 不透明窗口的圆角形状管理：调用 shape-window.ps1（Win10 SetWindowRgn / Win11 DWM）。
// 窗口已用不透明 backgroundColor 兜底，这里只负责圆角，彻底避免"透明看不见"。
// PowerShell 冷启动 + Add-Type 编译需要时间，且窗口 show/布局未稳定时 GetClientRect 可能
// 暂时拿不到正确尺寸，因此延迟执行、把脚本 stdout 结果写入 shape.log，失败自动重试最多 3 次。
const shapeSeq = new WeakMap();
function shapeLog(m) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'shape.log'), `${new Date().toISOString()} ${m}\n`); } catch {}
}
function applyWindowShape(win) {
  if (!win || win.isDestroyed()) return;
  shapeLog('applyWindowShape called');
  const mySeq = (shapeSeq.get(win) || 0) + 1;
  shapeSeq.set(win, mySeq);
  const attempt = (n, delay) => setTimeout(() => {
    try {
      if (!win || win.isDestroyed() || shapeSeq.get(win) !== mySeq) { shapeLog(`attempt#${n} skipped (destroyed/stale)`); return; }
      let hwndNum;
      try {
        // Electron 22 用同步的 getNativeWindowHandle()（返回 Buffer）；getNativeHandle() 是更高版本 API
        const handleBuf = win.getNativeWindowHandle();
        hwndNum = process.arch === 'x64' ? handleBuf.readBigUInt64LE(0) : handleBuf.readUInt32LE(0);
      } catch (e) { shapeLog(`attempt#${n} no handle: ${e.message}`); return; }
      const ps = app.isPackaged
        ? path.join(process.resourcesPath, 'shape-window.ps1')
        : path.join(__dirname, 'shape-window.ps1');
      // 注意：不传宽高。脚本内部用 GetClientRect 取物理像素客户区尺寸，避免高 DPI 下
      // 用逻辑像素(DIP)算错圆角区域把窗口裁掉（“打开不显示”）。半径传逻辑像素，脚本按 DPI 换算。
      const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps,
        '-Hwnd', String(hwndNum), '-RadiusDip', '10'];
      if (win.isMaximized()) args.push('-Maximized');
      shapeLog(`attempt#${n} spawning powershell hwnd=${hwndNum} ps=${ps} exists=${fs.existsSync(ps)}`);
      require('child_process').execFile('powershell.exe', args, { windowsHide: true, timeout: 20000 }, (err, stdout, stderr) => {
        const out = (stdout || '').trim().split(/\r?\n/)[0];
        shapeLog(`attempt#${n} cb max=${win.isDestroyed() ? 'destroyed' : win.isMaximized()} err=${err ? err.message : 'none'} out=[${out}] stderr=[${(stderr || '').trim().slice(0, 160)}]`);
        const good = out.startsWith('ROUND_') || out === 'RECT_MAX';
        if (!good && n < 3 && !win.isDestroyed() && shapeSeq.get(win) === mySeq) attempt(n + 1, 200 + 250 * n);
      });
    } catch (e) {
      shapeLog(`throw attempt#${n}: ${e.message}`);
      if (n < 3 && win && !win.isDestroyed() && shapeSeq.get(win) === mySeq) attempt(n + 1, 300 * n);
    }
  }, delay);
  attempt(1, 120);
}

// 强制透明窗口重新合成：先 invalidate 让 Chromium 重绘，再用 1px 的内容尺寸微调触发 DWM
// 重新合成（Windows 上透明无边框窗口 hide/show、minimize/restore 后偶发不重绘，表现为透明）。
function forceRepaint(win, delayMs) {
  setTimeout(() => {
    try {
      if (!win || win.isDestroyed() || !win.isVisible()) return;
      try { win.webContents.invalidate && win.webContents.invalidate(); } catch {}
      const [w, h] = win.getContentSize();
      win.setContentSize(w, h + 1);
      setImmediate(() => { try { win.setContentSize(w, h); } catch {} });
    } catch {}
  }, delayMs || 60);
}
function showMainWindow() {
  if (!mainWindow) { createWindow(); return; }
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  mainWindow.webContents.send('play-anim', 'in');
  // 后台关闭再打开：重建窗口形状，不透明背景兜底，确保不会停在透明状态
  applyWindowShape(mainWindow);
}
let lastTrayHint = 0;
function trayHint() {
  // 收进托盘时轻提示一次（节流，避免动画重复触发刷屏）
  const now = Date.now();
  if (tray && now - lastTrayHint > 3000) {
    lastTrayHint = now;
    try { tray.displayBalloon({ title: 'Glowstone Launcher', content: '启动器仍在后台运行，点击托盘图标可恢复' }); } catch {}
  }
}
function createTray() {
  if (tray) return;
  let img;
  try { img = nativeImage.createFromPath(APP_ICON); if (img.isEmpty()) img = nativeImage.createFromPath(path.join(__dirname, 'logo.png')); }
  catch { img = nativeImage.createFromPath(path.join(__dirname, 'logo.png')); }
  tray = new Tray(img);
  tray.setToolTip('Glowstone Launcher（后台运行中）');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主界面', click: showMainWindow },
    { type: 'separator' },
    { label: '退出启动器', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
}

ipcMain.on('window-minimize', () => playOutThen('min'));
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => requestWinHide());
ipcMain.on('anim-finished', () => finishWinAction());
ipcMain.on('app-quit', () => { isQuitting = true; app.quit(); });
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);

ipcMain.on('open-external', (_e, url) => {
  if (typeof url === 'string' && url.startsWith('http')) shell.openExternal(url);
});
ipcMain.on('copy-clipboard', (_e, text) => { if (typeof text === 'string') clipboard.writeText(text); });

// 版本清单走主进程：首选源 2.2s 没回来就并发拉起备用源竞速，谁先用谁；
// 成功后落盘缓存，两源都挂时直接用上次缓存，保证页面不会无限转圈。
const MANIFEST_URLS = {
  bmcl: 'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json',
  official: 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json',
};
function manifestCachePath() { return path.join(app.getPath('userData'), 'version_manifest_cache.json'); }
function readManifestCache() {
  try { const d = JSON.parse(fs.readFileSync(manifestCachePath(), 'utf8')); if (Array.isArray(d.versions)) return d; } catch {}
  return null;
}
function fetchFirstJson(urls, stallMs) {
  // urls[0] 立即发起，stallMs 后 urls[1] 并发补位；任一成功即 resolve，两个都失败才 reject
  return new Promise((resolve, reject) => {
    let settled = false; const errors = []; let pending = urls.length;
    const timers = [];
    urls.forEach((u, i) => {
      const start = () => httpGetJson(u, { timeoutMs: 8000 }).then((data) => {
        if (settled) return;
        if (!data || !Array.isArray(data.versions)) throw new Error('清单格式异常');
        settled = true; timers.forEach(clearTimeout);
        resolve({ data, usedSource: u.includes('bmcl') ? 'bmcl' : 'official' });
      }).catch((e) => {
        errors.push(e.message);
        if (--pending === 0 && !settled) { settled = true; reject(new Error(errors.join(' | '))); }
      });
      if (i === 0) start(); else timers.push(setTimeout(start, stallMs));
    });
  });
}
ipcMain.handle('fetch-version-manifest', async (_e, source) => {
  const preferred = source === 'official' ? MANIFEST_URLS.official : MANIFEST_URLS.bmcl;
  const fallback = source === 'official' ? MANIFEST_URLS.bmcl : MANIFEST_URLS.official;
  // 离线优先：24h 内的缓存立即返回（秒开，不受冷启动进程级网络阻塞影响），后台静默刷新
  const cached = readManifestCache();
  const fresh = cached && (Date.now() - (cached.savedAt || 0) < 24 * 3600 * 1000);
  const refresh = () => fetchFirstJson([preferred, fallback], 2200)
    .then(({ data }) => { try { fs.writeFileSync(manifestCachePath(), JSON.stringify({ savedAt: Date.now(), versions: data.versions })); } catch {} })
    .catch(() => {});
  if (fresh) { refresh(); return { success: true, versions: cached.versions, usedSource: 'cache' }; }
  try {
    const { data, usedSource } = await fetchFirstJson([preferred, fallback], 2200);
    try { fs.writeFileSync(manifestCachePath(), JSON.stringify({ savedAt: Date.now(), versions: data.versions })); } catch {}
    return { success: true, versions: data.versions, usedSource };
  } catch (e) {
    if (cached) return { success: true, versions: cached.versions, usedSource: 'cache' };
    return { success: false, error: String(e && e.message || e || '网络异常') };
  }
});

// 玩家名/链接取肤：主进程下载绕开 CORS。玩家名：Mojang 名称→UUID，再走 BMCL 会话镜像
// 同时拿皮肤(SKIN)与披风(CAPE)；直链回退 minotar / mc-heads（minotar 国内更稳，放前面）。
// 返回 { dataUrl: 皮肤, capeDataUrl: 披风|'' }。
// 依次尝试多个 JSON 源，返回第一个解析出 predicate 的结果（官方优先，BMCL 兜底）。
// 实测 BMCL 的 users/profiles、session 镜像现已大量 404，而官方接口可达，故官方必须排在前面。
async function firstJson(urls, predicate) {
  for (const u of urls) {
    try { const d = await httpGetJson(u, { timeoutMs: 7000 }); if (!predicate || predicate(d)) return d; } catch {}
  }
  return null;
}
async function firstBuffer(urls) {
  for (const u of (urls || []).filter(Boolean)) {
    try { const b = await httpGetBuffer(u, { timeoutMs: 9000 }); if (b && b.length > 32) return b; } catch {}
  }
  return null;
}
async function resolveSkinDataUrl(query) {
  // 直接给了图片 URL：官方地址与其 BMCL 镜像互为回退
  if (/^https?:\/\//i.test(String(query || ''))) {
    const q = String(query);
    const buf = await firstBuffer([
      q,
      q.includes('textures.minecraft.net') ? q.replace(/^https?:\/\/textures\.minecraft\.net/, 'https://bmclapi2.bangbang93.com') : '',
      q.includes('bmclapi2.bangbang93.com') ? q.replace(/^https?:\/\/bmclapi2\.bangbang93\.com/, 'https://textures.minecraft.net') : '',
    ]);
    if (!buf) throw new Error('皮肤下载失败');
    return { dataUrl: 'data:image/png;base64,' + buf.toString('base64'), capeDataUrl: '' };
  }
  const compact = String(query || '').replace(/-/g, '');
  let uuid = /^[0-9a-f]{32}$/i.test(compact) ? compact : '';
  const name = encodeURIComponent(query);
  // 1) 名称 -> UUID：官方优先，BMCL 镜像兜底
  if (!uuid) {
    const prof = await firstJson([
      `https://api.mojang.com/users/profiles/minecraft/${name}`,
      `https://bmclapi2.bangbang93.com/users/profiles/minecraft/${name}`,
    ], (d) => d && d.id);
    if (prof) uuid = prof.id;
  }
  // 2) UUID -> 材质属性（皮肤+披风）：官方 sessionserver 优先，BMCL 镜像兜底
  let skinUrl = '', capeUrl = '';
  if (uuid) {
    const sess = await firstJson([
      `https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`,
      `https://bmclapi2.bangbang93.com/session/minecraft/profile/${uuid}`,
    ], (d) => d && Array.isArray(d.properties) && d.properties.some((p) => p.name === 'textures'));
    try {
      const prop = sess && sess.properties.find((p) => p.name === 'textures');
      if (prop) {
        const T = (JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8')).textures) || {};
        if (T.SKIN && T.SKIN.url) skinUrl = T.SKIN.url;            // 保留官方 textures.minecraft.net 原始地址
        if (T.CAPE && T.CAPE.url) capeUrl = T.CAPE.url;
      }
    } catch {}
  }
  // 3) 皮肤图片：官方材质 -> BMCL 镜像 -> minotar -> mc-heads，多源回退
  const skinBuf = await firstBuffer([
    skinUrl,
    skinUrl && skinUrl.includes('textures.minecraft.net') ? skinUrl.replace(/^https?:\/\/textures\.minecraft\.net/, 'https://bmclapi2.bangbang93.com') : '',
    `https://minotar.net/skin/${uuid || query}`,
    `https://mc-heads.net/skin/${uuid || name}`,
  ]);
  if (!skinBuf) throw new Error('皮肤下载失败（已尝试官方材质库、BMCL、minotar、mc-heads）');
  // 4) 披风：官方材质 -> BMCL 镜像（拿不到不影响皮肤）
  let capeDataUrl = '';
  if (capeUrl) {
    const cb = await firstBuffer([
      capeUrl,
      capeUrl.includes('textures.minecraft.net') ? capeUrl.replace(/^https?:\/\/textures\.minecraft\.net/, 'https://bmclapi2.bangbang93.com') : '',
    ]);
    if (cb) capeDataUrl = 'data:image/png;base64,' + cb.toString('base64');
  }
  return { dataUrl: 'data:image/png;base64,' + skinBuf.toString('base64'), capeDataUrl };
}
ipcMain.handle('fetch-skin', async (_e, query) => {
  try { const r = await resolveSkinDataUrl(String(query || '')); return { success: true, dataUrl: r.dataUrl, capeDataUrl: r.capeDataUrl || '' }; }
  catch (e) { return { success: false, error: String(e.message || e) }; }
});

// 通用图片代理：渲染层图片 CDN 被墙/防盗链加载失败时，由主进程（Node）请求并返回
// dataURL 兜底。跟随重定向，按 Content-Type / 扩展名识别 mime，限制最大 25MB。
function fetchImageBuffer(rawUrl, redirectsLeft = 5, timeoutMs = 18000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(rawUrl); } catch { return reject(new Error('图片地址无效')); }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, {
      method: 'GET',
      agent: u.protocol === 'http:' ? httpKeepAgent : httpsKeepAgent,
      headers: { Accept: 'image/*,*/*;q=0.8', 'User-Agent': 'GlowstoneLauncher/1.0' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('重定向次数过多'));
        const next = new URL(res.headers.location, u).toString();
        return resolve(fetchImageBuffer(next, redirectsLeft - 1, timeoutMs));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > 25 * 1024 * 1024) { req.destroy(new Error('图片过大')); } else chunks.push(c); });
      res.on('end', () => resolve({ buf: Buffer.concat(chunks), mime: res.headers['content-type'] || '' }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('连接超时')));
    req.end();
  });
}

// 图片候选源：原始源优先；MCIM 镜像（项目 icon 有效）；images.weserv.nl 通用 CDN 兜底
function imageCandidateUrls(rawUrl) {
  const list = [rawUrl];
  const u = String(rawUrl || '');
  if (u.includes('cdn.modrinth.com')) list.push(u.replace('cdn.modrinth.com', 'mod.mcimirror.top'));
  if (u.includes('edge.forgecdn.net') || u.includes('media.forgecdn.net')) {
    list.push(u.replace(/(edge|media)\.forgecdn\.net/, 'mod.mcimirror.top'));
  }
  list.push('https://images.weserv.nl/?url=' + u.replace(/^https?:\/\//, ''));
  return Array.from(new Set(list));
}

// 图片下载并发队列（最多 4 个同时，避免画廊一次性大量并发被 CDN 重置）
let imgActive = 0;
const imgWaiters = [];
function imgSlotAcquire() {
  if (imgActive < 4) { imgActive++; return Promise.resolve(); }
  return new Promise((res) => imgWaiters.push(res));
}
function imgSlotRelease() {
  imgActive--;
  const next = imgWaiters.shift();
  if (next) { imgActive++; next(); }
}
function mimeFromUrl(rawUrl, mime) {
  let m = String(mime || '').split(';')[0].trim();
  if (!m || m === 'application/octet-stream' || !m.startsWith('image/')) {
    const ext = String(rawUrl).split('?')[0].split('.').pop().toLowerCase();
    m = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' })[ext] || 'image/png';
  }
  return m;
}

ipcMain.handle('proxy-image', async (_e, rawUrl) => {
  const candidates = imageCandidateUrls(String(rawUrl || ''));
  let lastErr = '未知错误';
  await imgSlotAcquire();
  try {
    for (let ci = 0; ci < candidates.length; ci++) {
      const cand = candidates[ci];
      const tries = ci === 0 ? 3 : 1;       // 原始源重试 3 次；镜像/兜底各 1 次
      const tmo = ci === 0 ? 18000 : 10000; // 备用源超时更短，快速切换
      for (let t = 1; t <= tries; t++) {
        try {
          const { buf, mime } = await fetchImageBuffer(cand, 5, tmo);
          const m = mimeFromUrl(rawUrl, mime);
          return { success: true, dataUrl: 'data:' + m + ';base64,' + buf.toString('base64') };
        } catch (e) {
          lastErr = String(e.message || e);
          if (/HTTP 404/.test(lastErr)) break; // 镜像 404 立即换下一个源
        }
      }
    }
  } finally { imgSlotRelease(); }
  return { success: false, error: lastErr };
});

// ============ 文本翻译（描述中文化） ============
// 主用国内可达的 MyMemory 免费接口（分段请求），失败再回退 Google；MC 资源正文绝大多数为英文，源语言按英文。
function httpGetText(url, opts) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, {
      method: 'GET',
      agent: u.protocol === 'http:' ? httpKeepAgent : httpsKeepAgent,
      headers: Object.assign({ 'User-Agent': 'GlowstoneLauncher/1.0', Accept: 'application/json,text/plain,*/*' }, (opts && opts.headers) || {}),
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(httpGetText(new URL(res.headers.location, u).toString(), opts));
      }
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        resolve(Buffer.concat(ch).toString('utf8'));
      });
    });
    req.on('error', reject);
    req.setTimeout((opts && opts.timeoutMs) || 12000, () => req.destroy(new Error('连接超时')));
    req.end();
  });
}

async function translateSegment(seg) {
  // 1) MyMemory（国内可达）
  try {
    const mmUrl = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(seg) + '&langpair=en|zh-CN';
    const body = await httpGetText(mmUrl, { timeoutMs: 12000 });
    const j = JSON.parse(body);
    const t = j && j.responseData && j.responseData.translatedText;
    if (t && j.responseStatus === 200 && !/^MYMEMORY WARNING/.test(t)) return t;
  } catch (e) { /* 回退 */ }
  // 2) Google（国外备用）
  const gUrl = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=' + encodeURIComponent(seg);
  const body = await httpGetText(gUrl, { timeoutMs: 10000 });
  const arr = JSON.parse(body);
  return (arr[0] || []).map((x) => x[0] || '').join('');
}

// 长文本切成 MyMemory 可接受的小段（按行聚合，每段 ≤ 约 420 字符），尽量保留换行结构。
function chunkForTranslate(text) {
  const MAX = 420;
  const chunks = [];
  let buf = '';
  const flush = () => { if (buf.trim()) chunks.push(buf); buf = ''; };
  for (const line of String(text).split('\n')) {
    if (line.length > MAX) {
      flush();
      const parts = line.match(/[\s\S]{1,MAX}(?:[.!?。！？]|\s|$)/g) || [line];
      for (const p of parts) chunks.push(p);
      continue;
    }
    if ((buf + '\n' + line).length > MAX) flush();
    buf = buf ? buf + '\n' + line : line;
  }
  flush();
  return chunks;
}

ipcMain.handle('translate-text', async (_e, arg) => {
  const text = String((arg && arg.text) || '').trim();
  if (!text) return { success: false, error: '空文本' };
  try {
    const chunks = chunkForTranslate(text.length > 6000 ? text.substring(0, 6000) : text);
    const out = [];
    for (const c of chunks) {
      try { out.push(await translateSegment(c)); }
      catch (e) { out.push(c); } // 单段失败保留原文，不阻断整体
    }
    return { success: true, text: out.join('\n') };
  } catch (e) {
    return { success: false, error: String(e.message || e) };
  }
});

// ============ 正版（Minecraft Services）皮肤 / 披风：真正联网更换，全局生效 ============
function mcApiRequest({ token, refreshToken, clientId, method, urlPath, body, contentType }) {
  return new Promise((resolve) => {
    // currentToken 当前访问令牌；retried 为 null 表示尚未因 401 重试，否则携带刷新后的新令牌
    const attempt = (currentToken, retried) => {
      const fullUrl = 'https://api.minecraftservices.com' + urlPath;
      const headers = { Authorization: 'Bearer ' + currentToken, Accept: 'application/json' };
      if (contentType) headers['Content-Type'] = contentType;
      // multipart 上传必须显式带 Content-Length，否则 Node 可能改用 chunked，部分网关/Mojang 边缘会拒绝
      if (body && Buffer.isBuffer(body)) headers['Content-Length'] = body.length;
      let req;
      try {
        req = https.request(fullUrl, { method, agent: httpsKeepAgent, headers }, (res) => {
          const ch = [];
          res.on('data', (c) => ch.push(c));
          res.on('end', async () => {
            const t = Buffer.concat(ch).toString();
            let j = null; try { j = JSON.parse(t); } catch {}
            // 401（令牌过期）且有 refreshToken 且尚未重试过：自动刷新后用新令牌重试一次
            if (res.statusCode === 401 && !retried && refreshToken) {
              const rr = await refreshMinecraftToken(refreshToken, clientId);
              if (rr.success && rr.data && rr.data.accessToken) {
                const nt = { accessToken: rr.data.accessToken, refreshToken: rr.data.refreshToken || refreshToken };
                return attempt(nt.accessToken, nt);
              }
            }
            resolve({ status: res.statusCode, json: j, newTokens: retried || null });
          });
        });
      } catch (e) { return resolve({ netError: true, error: String(e.message || e) }); }
      req.on('error', (e) => resolve({ netError: true, error: String(e.message || e) }));
      req.setTimeout(25000, () => req.destroy(new Error('连接超时')));
      if (body) req.write(body);
      req.end();
    };
    attempt(token, null);
  });
}
// 手工构造 multipart/form-data（皮肤文件上传）
function buildMultipart(fields, file) {
  const boundary = '----Glowstone' + crypto.randomBytes(12).toString('hex');
  const chunks = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`));
  chunks.push(file.data);
  chunks.push(Buffer.from('\r\n'));
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

// 用 Microsoft refreshToken 走 MS→Xbox→XSTS→MC 全流程换新 Minecraft accessToken。
// 返回 { success:true, data:{username,uuid,accessToken,refreshToken} } 或 { success:false,error,description }。
async function refreshMinecraftToken(refreshToken, clientId) {
  const UA = 'GlowstoneLauncher/1.0';
  const postJson = async (url, payload) => httpRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
  }, JSON.stringify(payload));
  try {
    if (!refreshToken) return { success: false, error: 'missing_refresh', description: '缺少 refreshToken' };
    // 1) Microsoft refresh
    const tbody = new URLSearchParams({
      client_id: clientId || MS_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: 'XboxLive.signin offline_access',
    }).toString();
    let tres;
    try {
      tres = await httpRequest(MS_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA } }, tbody);
    } catch { return { success: false, error: 'network_error', description: '无法连接微软登录服务器' }; }
    const td = tres.data || {};
    if (tres.status !== 200 || !td.access_token) {
      return { success: false, error: td.error || 'refresh_failed', description: td.error_description || '刷新令牌已失效，请重新登录正版账号' };
    }
    const msAccessToken = td.access_token;
    const newRefreshToken = td.refresh_token || refreshToken;
    // 2) Xbox Live
    const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msAccessToken },
      RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
    });
    if (xbl.status !== 200) return { success: false, error: 'xbl_auth_failed', description: 'Xbox Live 认证失败' };
    const xblToken = xbl.data.Token;
    const uhs = xbl.data.DisplayClaims && xbl.data.DisplayClaims.xui && xbl.data.DisplayClaims.xui[0] && xbl.data.DisplayClaims.xui[0].uhs;
    if (!xblToken || !uhs) return { success: false, error: 'xbl_auth_failed', description: 'Xbox Live 返回数据缺失' };
    // 3) XSTS
    const xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
    });
    if (xsts.status !== 200) return { success: false, error: 'xsts_failed', description: 'XSTS 认证失败' };
    // 4) Minecraft login
    const mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
      identityToken: 'XBL3.0 x=' + uhs + ';' + xsts.data.Token,
    });
    if (mc.status !== 200 || !mc.data.access_token) return { success: false, error: 'mc_auth_failed', description: 'Minecraft 令牌换取失败' };
    const mcToken = mc.data.access_token;
    // 5) Profile（同时验证游戏所有权）
    const prof = await httpRequest('https://api.minecraftservices.com/minecraft/profile', {
      method: 'GET', headers: { Authorization: 'Bearer ' + mcToken, Accept: 'application/json', 'User-Agent': UA },
    });
    if (prof.status !== 200 || !prof.data.id) return { success: false, error: 'no_game_ownership', description: '该账号未拥有 Minecraft' };
    return { success: true, data: { username: prof.data.name, uuid: prof.data.id, accessToken: mcToken, refreshToken: newRefreshToken } };
  } catch (err) {
    return { success: false, error: 'exception', description: String((err && err.message) || err) };
  }
}

// 账号拥有的披风列表（含当前是否穿戴）
ipcMain.handle('ms-capes', async (_e, arg) => {
  const r = await mcApiRequest({ token: arg.accessToken, refreshToken: arg.refreshToken, clientId: arg.clientId, method: 'GET', urlPath: '/minecraft/profile/capes' });
  if (r.netError) return { success: false, error: '网络错误：' + r.error };
  if (r.status === 200) return { success: true, capes: Array.isArray(r.json) ? r.json : [], newTokens: r.newTokens };
  // Mojang 对“没有任何披风”的账号返回 404 NOT_FOUND（而非空数组），按空列表处理，避免误报错误
  if (r.status === 404) return { success: true, capes: [], newTokens: r.newTokens };
  return { success: false, error: 'HTTP ' + r.status + ' ' + ((r.json && (r.json.error || r.json.errorMessage)) || ''), newTokens: r.newTokens };
});

// 穿戴指定披风（capeId）；capeId 为空则取消披风
ipcMain.handle('ms-set-cape', async (_e, arg) => {
  let r;
  if (arg.capeId) {
    const b = Buffer.from(JSON.stringify({ capeId: arg.capeId }));
    r = await mcApiRequest({ token: arg.accessToken, refreshToken: arg.refreshToken, clientId: arg.clientId, method: 'PUT', urlPath: '/minecraft/profile/capes/active', body: b, contentType: 'application/json' });
  } else {
    r = await mcApiRequest({ token: arg.accessToken, refreshToken: arg.refreshToken, clientId: arg.clientId, method: 'DELETE', urlPath: '/minecraft/profile/capes/active' });
  }
  if (r.netError) return { success: false, error: '网络错误：' + r.error };
  if (r.status >= 200 && r.status < 300) return { success: true, newTokens: r.newTokens };
  return { success: false, error: 'HTTP ' + r.status + ' ' + ((r.json && (r.json.error || r.json.errorMessage)) || ''), newTokens: r.newTokens };
});

// 真正上传皮肤：fileB64 为本地皮肤（multipart），或 url 为网络皮肤（表单）
ipcMain.handle('ms-set-skin', async (_e, arg) => {
  let body; let contentType;
  if (arg.fileB64) {
    const mb = buildMultipart({ variant: arg.variant || 'classic' }, {
      name: 'file', filename: arg.filename || 'skin.png', contentType: 'image/png', data: Buffer.from(arg.fileB64, 'base64'),
    });
    body = mb.body; contentType = mb.contentType;
  } else if (arg.url) {
    body = Buffer.from('variant=' + (arg.variant || 'classic') + '&url=' + encodeURIComponent(arg.url));
    contentType = 'application/x-www-form-urlencoded';
  } else {
    return { success: false, error: '缺少皮肤文件或链接' };
  }
  const r = await mcApiRequest({ token: arg.accessToken, refreshToken: arg.refreshToken, clientId: arg.clientId, method: 'POST', urlPath: '/minecraft/profile/skins', body, contentType });
  if (r.netError) return { success: false, error: '网络错误：' + r.error };
  if (r.status >= 200 && r.status < 300) return { success: true, profile: r.json, newTokens: r.newTokens };
  return { success: false, error: 'HTTP ' + r.status + ' ' + ((r.json && (r.json.error || r.json.errorMessage)) || ''), newTokens: r.newTokens };
});

// 用 Microsoft refreshToken 刷新 Minecraft accessToken（正版 token 过期后调用）
ipcMain.handle('ms-refresh-token', async (_e, arg) => {
  try {
    const clientId = resolveClientId(arg);
    const refreshToken = arg && arg.refreshToken;
    if (!refreshToken) return { success: false, error: '缺少 refreshToken' };
    // 1) 刷新 Microsoft token
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: 'XboxLive.signin offline_access',
    }).toString();
    let res;
    try {
      res = await httpRequest(MS_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA } }, body);
    } catch (e) {
      return { success: false, error: 'network_error', description: '无法连接微软登录服务器' };
    }
    const td = res.data || {};
    if (res.status !== 200 || !td.access_token) {
      return { success: false, error: td.error || 'refresh_failed', description: td.error_description || '刷新令牌已失效，请重新登录' };
    }
    const msAccessToken = td.access_token;
    const newRefreshToken = td.refresh_token || refreshToken;
    // 2) Xbox Live
    const xblRes = await postJsonRetry('https://user.auth.xboxlive.com/user/authenticate', {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msAccessToken },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    }, 'Xbox Live');
    if (xblRes.status !== 200) return { success: false, error: 'xbl_auth_failed', description: 'Xbox Live 认证失败' };
    const xblToken = xblRes.data.Token;
    const userHash = xblRes.data.DisplayClaims && xblRes.data.DisplayClaims.xui && xblRes.data.DisplayClaims.xui[0] && xblRes.data.DisplayClaims.xui[0].uhs;
    if (!xblToken || !userHash) return { success: false, error: 'xbl_auth_failed', description: 'Xbox Live 返回数据缺失' };
    // 3) XSTS
    const xstsRes = await postJsonRetry('https://xsts.auth.xboxlive.com/xsts/authorize', {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    }, 'XSTS');
    if (xstsRes.status !== 200) return { success: false, error: 'xsts_failed', description: 'XSTS 认证失败' };
    // 4) Minecraft login
    const mcRes = await postJsonRetry('https://api.minecraftservices.com/authentication/login_with_xbox', {
      identityToken: 'XBL3.0 x=' + userHash + ';' + xstsRes.data.Token,
    }, 'Minecraft');
    if (mcRes.status !== 200 || !mcRes.data.access_token) return { success: false, error: 'mc_auth_failed', description: 'Minecraft 令牌换取失败' };
    const mcToken = mcRes.data.access_token;
    // 5) Profile
    const profileRes = await httpRequest('https://api.minecraftservices.com/minecraft/profile', {
      method: 'GET', headers: { Authorization: 'Bearer ' + mcToken, Accept: 'application/json', 'User-Agent': UA },
    });
    if (profileRes.status !== 200 || !profileRes.data.id) return { success: false, error: 'no_game_ownership', description: '该账号未拥有 Minecraft' };
    return {
      success: true,
      data: { username: profileRes.data.name, uuid: profileRes.data.id, accessToken: mcToken, refreshToken: newRefreshToken },
    };
  } catch (err) {
    return { success: false, error: 'exception', description: String((err && err.message) || err) };
  }
});

// 手动下载指定大版本的 JRE，下完清扫描缓存，使新 Java 立刻被识别
ipcMain.handle('download-java', async (event, major) => {
  try {
    const exe = await ensureJavaRuntime(Number(major), (stage, pct, detail) => {
      try { event.sender.send('java-download-progress', { stage, percent: pct || 0, detail: detail || '' }); } catch {}
    });
    _deepJavaCache = null; _deepJavaPromise = null;
    return { success: true, path: exe };
  } catch (e) { return { success: false, error: String(e.message || e) }; }
});

ipcMain.handle('pick-background-video', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择视频背景', properties: ['openFile'],
    filters: [{ name: '视频', extensions: ['mp4', 'webm', 'mov', 'mkv', 'avi'] }],
  });
  if (r.canceled || !r.filePaths[0]) return { success: false, canceled: true };
  return { success: true, path: r.filePaths[0] };
});

ipcMain.handle('open-folder', (_e, folderPath) => {
  try {
    if (!folderPath) return { success: false, error: '路径为空' };
    const resolved = path.resolve(folderPath);
    if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
    shell.openPath(resolved);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// Per-version (PCL-style version isolation) run directory. Used both for the game launch working
// directory and for opening mods/saves/screenshots. Auto-detects an already-isolated instance.
function resolveRunDir(root, versionId, isolated) {
  try {
    const per = path.join(root, 'versions', String(versionId || ''));
    const looksIsolated = fs.existsSync(path.join(per, 'mods')) || fs.existsSync(path.join(per, 'saves'))
      || fs.existsSync(path.join(per, 'options.txt')) || fs.existsSync(path.join(per, 'config'));
    if (isolated || looksIsolated) return per;
  } catch {}
  return root;
}

// First launch must be Chinese: merge `lang:zh_cn` into options.txt without dropping other keys.
function ensureChineseLang(runDir) {
  try {
    const f = path.join(runDir, 'options.txt');
    let lines = [];
    if (fs.existsSync(f)) lines = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.length);
    let found = false;
    lines = lines.map((l) => { if (/^lang\s*:/.test(l)) { found = true; return 'lang:zh_cn'; } return l; });
    if (!found) lines.push('lang:zh_cn');
    fs.writeFileSync(f, lines.join('\n') + '\n');
  } catch {}
}

ipcMain.handle('open-version-folder', (_e, arg) => {
  try {
    arg = arg || {};
    if (!arg.root) return { success: false, error: '路径为空' };
    let root = path.isAbsolute(arg.root) ? arg.root : path.join(app.getPath('appData'), arg.root);
    const segs = root.split(/[\\/]/);
    if (arg.versionId && segs.length >= 2 && segs[segs.length - 2] === 'versions' && segs[segs.length - 1] === arg.versionId) {
      root = path.dirname(path.dirname(root));
    }
    let target;
    if (arg.kind === 'version') {
      target = path.join(root, 'versions', String(arg.versionId || ''));
    } else {
      const run = resolveRunDir(root, arg.versionId, !!arg.isolated);
      target = path.join(run, arg.kind || 'mods');
    }
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
    shell.openPath(target);
    return { success: true, path: target };
  } catch (err) { return { success: false, error: String(err) }; }
});

// ---------- Local mod folder scanning (Fabric/Quilt/Forge/NeoForge) ----------
// Minimal ZIP central-directory reader built on the bundled zlib (no third-party deps,
// so it works inside the packaged asar with node_modules excluded).
function readZipEntries(buf, wanted) {
  const out = {};
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return out;
  const total = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16);
  const zlib = require('zlib');
  for (let n = 0; n < total; n++) {
    if (cd + 46 > buf.length || buf.readUInt32LE(cd) !== 0x02014b50) break;
    const method = buf.readUInt16LE(cd + 10);
    const compSize = buf.readUInt32LE(cd + 20);
    const nameLen = buf.readUInt16LE(cd + 28);
    const extraLen = buf.readUInt16LE(cd + 30);
    const commentLen = buf.readUInt16LE(cd + 32);
    const localOff = buf.readUInt32LE(cd + 42);
    const name = buf.toString('utf8', cd + 46, cd + 46 + nameLen);
    cd += 46 + nameLen + extraLen + commentLen;
    let hit = null;
    for (const w of wanted) {
      if (name === w || name.endsWith('/' + w)) { hit = w; break; }
    }
    if (!hit || out[hit]) continue;
    if (localOff + 30 > buf.length) continue;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    try { out[hit] = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw); } catch {}
  }
  return out;
}

function tomlField(block, key) {
  // handles key = "x" / key = 'x' / key = """...""" / bare values
  const re = new RegExp('(?:^|[\\r\\n])\\s*' + key + '\\s*=\\s*(?:"""([\\s\\S]*?)"""|\\\'\\\'\\\'([\\s\\S]*?)\\\'\\\'\\\'|"([^"]*)"|\'([^\']*)\'|([^\\r\\n]+))', 'i');
  const m = re.exec(block || '');
  if (!m) return '';
  return (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '').trim();
}

function parseModJar(full) {
  const result = { id: '', name: '', version: '', description: '', author: '', iconUrl: '', loaders: [] };
  let buf;
  try { buf = fs.readFileSync(full); } catch { return result; }
  let entries;
  try {
    entries = readZipEntries(buf, ['fabric.mod.json', 'quilt.mod.json', 'META-INF/neoforge.mods.toml', 'META-INF/mods.toml', 'mcmod.info', 'META-INF/MANIFEST.MF']);
  } catch { return result; }
  // 新版 Fabric/NeoForge 常把版本写成 ${file.jarVersion} 占位符，真实版本在 MANIFEST.MF 的 Implementation-Version
  const manifestVer = (() => {
    try {
      const mf = (entries['META-INF/MANIFEST.MF'] || Buffer.alloc(0)).toString('utf8').replace(/\r?\n[ \t]+/g, ' ');
      const m = /^Implementation-Version:\s*(.+)$/im.exec(mf);
      return m ? m[1].trim() : '';
    } catch { return ''; }
  })();
  const resolveVer = (v) => (v && !/^\$\{.*\}$/.test(v) ? v : (manifestVer || ''));

  // Fabric / Quilt
  const fabKey = entries['fabric.mod.json'] ? 'fabric.mod.json' : (entries['quilt.mod.json'] ? 'quilt.mod.json' : null);
  if (fabKey) {
    result.loaders.push(fabKey === 'quilt.mod.json' ? 'quilt' : 'fabric');
    try {
      const j = JSON.parse(entries[fabKey].toString('utf8'));
      const m = (j.id && j) || (Array.isArray(j.jars) && null) || j;
      result.id = j.id || '';
      result.name = j.name || j.id || '';
      result.version = resolveVer(j.version);
      result.description = j.description || '';
      const authors = j.authors;
      if (Array.isArray(authors)) result.author = authors.map((a) => (typeof a === 'string' ? a : a && a.name) || '').filter(Boolean).join(', ');
      else if (typeof authors === 'string') result.author = authors;
      let icon = j.icon;
      if (icon && typeof icon === 'object') icon = icon.large || icon.small || Object.values(icon)[0];
      if (icon) {
        try {
          const ic = readZipEntries(buf, [icon])[icon] || readZipEntries(buf, ['assets/' + icon])['assets/' + icon];
          if (ic) result.iconUrl = 'data:image/png;base64,' + ic.toString('base64');
        } catch {}
      }
    } catch {}
    return result;
  }

  // Forge / NeoForge
  const tomlBuf = entries['META-INF/neoforge.mods.toml'] || entries['META-INF/mods.toml'];
  if (tomlBuf) {
    result.loaders.push(entries['META-INF/neoforge.mods.toml'] ? 'neoforge' : 'forge');
    const text = tomlBuf.toString('utf8');
    const blockMatch = /\[\[mods\]\]([\s\S]*?)(?:\[\[mods\]\]|\n\[|$)/i.exec(text);
    const block = blockMatch ? blockMatch[1] : text;
    result.id = tomlField(block, 'modId');
    result.name = tomlField(block, 'displayName') || result.id;
    result.version = resolveVer(tomlField(block, 'version'));
    result.description = tomlField(block, 'description');
    result.author = tomlField(text, 'authors');
    const logo = tomlField(block, 'logoFile');
    if (logo) {
      try {
        const ic = readZipEntries(buf, [logo])[logo];
        if (ic) result.iconUrl = 'data:image/png;base64,' + ic.toString('base64');
      } catch {}
    }
    return result;
  }

  // Legacy mcmod.info
  if (entries['mcmod.info']) {
    result.loaders.push('forge');
    try {
      let j = JSON.parse(entries['mcmod.info'].toString('utf8'));
      if (Array.isArray(j)) j = j[0]; else if (j.modList) j = j.modList[0];
      if (j) {
        result.id = j.modid || '';
        result.name = j.name || result.id;
        result.version = j.version || '';
        result.description = j.description || '';
        result.author = j.authorList ? (Array.isArray(j.authorList) ? j.authorList.join(', ') : j.authorList) : (j.authors || '');
      }
    } catch {}
  }
  return result;
}

function normalizeModRoot(arg) {
  let root = arg.root || '.minecraft';
  if (!path.isAbsolute(root)) root = path.join(app.getPath('appData'), root);
  const segs = root.split(/[\\/]/);
  if (arg.versionId && segs.length >= 2 && segs[segs.length - 2] === 'versions' && segs[segs.length - 1] === arg.versionId) {
    root = path.dirname(path.dirname(root));
  }
  return root;
}

ipcMain.handle('scan-mods', async (_e, arg) => {
  try {
    arg = arg || {};
    const root = normalizeModRoot(arg);
    const run = resolveRunDir(root, arg.versionId, !!arg.isolated);
    const modDir = path.join(run, 'mods');
    if (!fs.existsSync(modDir)) return { success: true, mods: [], modDir };
    const files = fs.readdirSync(modDir);
    const mods = [];
    for (const f of files) {
      const full = path.join(modDir, f);
      let st; try { st = fs.statSync(full); } catch { continue; }
      if (!st.isFile()) continue;
      let enabled = true; let base = f;
      if (/\.disabled$/i.test(f)) { enabled = false; base = f.replace(/\.disabled$/i, ''); }
      if (!/\.jar$/i.test(base)) continue;
      const meta = parseModJar(full);
      const fallbackName = base.replace(/\.jar$/i, '');
      // 文件哈希（Modrinth 用 SHA1/SHA512 精确识别项目与版本，比按名字搜索可靠，等同 PCL2）
      let sha1 = ''; let sha512 = '';
      try {
        const buf = fs.readFileSync(full);
        sha1 = crypto.createHash('sha1').update(buf).digest('hex');
        sha512 = crypto.createHash('sha512').update(buf).digest('hex');
      } catch {}
      mods.push({
        id: (meta.id || fallbackName).replace(/[^a-zA-Z0-9_.-]/g, '_'),
        fileName: f,
        name: meta.name || fallbackName,
        version: meta.version || '',
        description: meta.description || '',
        author: meta.author || '未知作者',
        iconUrl: meta.iconUrl || '',
        loaders: meta.loaders,
        enabled,
        mtime: st.mtimeMs,
        sha1,
        sha512,
      });
    }
    mods.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return { success: true, mods, modDir };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('toggle-mod', async (_e, arg) => {
  try {
    arg = arg || {};
    const root = normalizeModRoot(arg);
    const run = resolveRunDir(root, arg.versionId, !!arg.isolated);
    const modDir = path.join(run, 'mods');
    const oldPath = path.join(modDir, arg.fileName);
    if (!fs.existsSync(oldPath)) return { success: false, error: '文件不存在：' + arg.fileName };
    let newName;
    if (arg.enabled) {
      // enable: strip trailing .disabled
      newName = arg.fileName.replace(/\.disabled$/i, '');
    } else {
      newName = /\.disabled$/i.test(arg.fileName) ? arg.fileName : arg.fileName + '.disabled';
    }
    const newPath = path.join(modDir, newName);
    if (oldPath !== newPath) fs.renameSync(oldPath, newPath);
    return { success: true, fileName: newName };
  } catch (err) { return { success: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('delete-mod', async (_e, arg) => {
  try {
    arg = arg || {};
    const root = normalizeModRoot(arg);
    const run = resolveRunDir(root, arg.versionId, !!arg.isolated);
    const modDir = path.join(run, 'mods');
    const target = path.join(modDir, arg.fileName);
    const real = path.resolve(target);
    if (!real.startsWith(path.resolve(modDir))) return { success: false, error: '非法路径' };
    if (fs.existsSync(real)) fs.unlinkSync(real);
    return { success: true };
  } catch (err) { return { success: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return { success: false };
  return { success: true, path: result.filePaths[0] };
});

// 系统“下载”目录，作为资源下载的默认保存位置
ipcMain.handle('default-download-dir', () => {
  try { return { success: true, path: app.getPath('downloads') }; }
  catch { return { success: false, path: '' }; }
});

// 默认 .minecraft 游戏目录（自动创建），版本下载默认装到这里
ipcMain.handle('default-mc-dir', () => {
  try {
    const dir = path.join(app.getPath('appData'), '.minecraft');
    fs.mkdirSync(dir, { recursive: true });
    return { success: true, path: dir };
  } catch (e) { return { success: false, error: String(e) }; }
});

// Windows 盘符列表（供“下载到哪个盘”快速选择）
ipcMain.handle('list-drives', () => {
  try {
    if (process.platform !== 'win32') return { success: true, drives: [] };
    const drives = [];
    for (let code = 65; code <= 90; code++) {
      const root = String.fromCharCode(code) + ':\\';
      try { fs.accessSync(root); const st = fs.statfsSync(root); drives.push({ root, freeGB: Math.round((st.bavail * st.bsize) / 1073741824 * 10) / 10 }); } catch {}
    }
    return { success: true, drives };
  } catch (e) { return { success: false, drives: [], error: String(e) }; }
});

// 资源下载按类型自动定位到版本运行目录下的对应文件夹（mods/resourcepacks/shaderpacks/datapacks）。
// 注意：整合包(modpack)不在此列——它是要解压安装的实例，由前端下载后走 import-modpack，绝不能丢进 mods。
const RES_SUBFOLDER = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', datapack: 'datapacks' };
ipcMain.handle('resolve-target-dir', (_e, arg) => {
  try {
    const { root, versionId, isolated, kind } = arg || {};
    let run;
    const isGlobal = !root;
    if (!root) {
      // 没有归属游戏版本时，落到启动器自管的全局资源目录（不静默丢进系统“下载”文件夹），保证“开始下载”可用。
      run = path.join(app.getPath('userData'), 'global-resources');
    } else {
      let base = path.isAbsolute(root) ? root : path.join(app.getPath('appData'), root);
      const segs = base.split(/[\\/]/);
      if (versionId && segs.length >= 2 && segs[segs.length - 2] === 'versions' && segs[segs.length - 1] === versionId) {
        base = path.dirname(path.dirname(base));
      }
      run = resolveRunDir(base, versionId, !!isolated);
    }
    const sub = RES_SUBFOLDER[kind] || 'downloads';
    const target = path.join(run, sub);
    fs.mkdirSync(target, { recursive: true });
    return { success: true, path: target, runDir: run, global: isGlobal };
  } catch (e) { return { success: false, error: String(e) }; }
});

// Free disk space (GB) for the drive that holds `p`; walks up to the first existing ancestor.
ipcMain.handle('disk-free', (_e, p) => {
  try {
    let dir = p || app.getPath('home');
    let guard = 0;
    while (dir && !fs.existsSync(dir) && guard++ < 8) dir = path.dirname(dir);
    const st = fs.statfsSync(dir);
    const free = st.bavail * st.bsize;
    return { success: true, freeBytes: free, freeGB: Math.round((free / 1073741824) * 10) / 10 };
  } catch (err) { return { success: false, error: String((err && err.message) || err) }; }
});

// Classify a dropped archive by extension + contents so a .jar mod is no longer treated as a modpack.
ipcMain.handle('classify-archive', (_e, arg) => {
  try {
    const srcPath = arg && arg.srcPath;
    if (!srcPath || !fs.existsSync(srcPath)) return { success: false, kind: 'unknown' };
    const ext = path.extname(srcPath).toLowerCase();
    if (ext === '.mrpack') return { success: true, kind: 'modpack' };
    if (ext === '.jar') {
      // A .jar is a mod unless it is itself a packaged modpack (rare CurseForge zip-in-jar).
      return { success: true, kind: 'mod' };
    }
    if (ext === '.zip') {
      const { spawnSync } = require('child_process');
      const r = spawnSync('tar.exe', ['-tf', srcPath], { windowsHide: true, encoding: 'utf8', timeout: 8000 });
      const list = ((r && r.stdout) || '').toLowerCase();
      if (/modrinth\.index\.json|(^|[\r\n])manifest\.json|(^|[\r\n])overrides\//m.test(list)) return { success: true, kind: 'modpack' };
      if (/pack\.mcmeta/.test(list)) return { success: true, kind: 'datapack' };
      return { success: true, kind: 'resourcepack' };
    }
    return { success: true, kind: 'unknown' };
  } catch (e) { return { success: false, kind: 'unknown', error: String((e && e.message) || e) }; }
});

// Copy a dropped mod (.jar) / resource pack (.zip) into the chosen version's run directory.
ipcMain.handle('install-drop', (_e, arg) => {
  try {
    const srcPath = arg && arg.srcPath, kind = arg && arg.kind;
    const root = normalizeModRoot(arg);
    const run = resolveRunDir(root, arg.versionId, !!arg.isolated);
    const sub = kind === 'mod' ? 'mods' : kind === 'datapack' ? path.join('saves', arg.worldName || '') : 'resourcepacks';
    const destDir = path.join(run, sub);
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, path.basename(srcPath));
    fs.copyFileSync(srcPath, dest);
    return { success: true, dest, destDir };
  } catch (e) { return { success: false, error: String((e && e.message) || e) }; }
});

// Export the current instance (mods + config + resourcepacks/shaderpacks + options) as a shareable .zip.
ipcMain.handle('export-modpack', async (_e, arg) => {
  try {
    arg = arg || {};
    const root = normalizeModRoot(arg);
    const run = resolveRunDir(root, arg.versionId, !!arg.isolated);
    const dlg = await dialog.showSaveDialog(mainWindow, {
      title: '导出整合包',
      defaultPath: `${arg.versionId || 'modpack'}-整合包.zip`,
      filters: [{ name: 'Zip 压缩包', extensions: ['zip'] }],
    });
    if (dlg.canceled || !dlg.filePath) return { success: false, canceled: true };
    const stage = path.join(require('os').tmpdir(), 'glow_export_' + Date.now());
    fs.mkdirSync(stage, { recursive: true });
    const parts = ['mods', 'config', 'resourcepacks', 'shaderpacks', 'options.txt'];
    let copied = 0;
    for (const rel of parts) {
      const s = path.join(run, rel);
      if (fs.existsSync(s)) { try { fs.cpSync(s, path.join(stage, rel), { recursive: true }); copied++; } catch {} }
    }
    if (!copied) { try { fs.rmSync(stage, { recursive: true, force: true }); } catch {}; return { success: false, error: '该版本目录下没有可导出的 Mod / 配置' }; }
    const out = dlg.filePath.endsWith('.zip') ? dlg.filePath : dlg.filePath + '.zip';
    const { spawnSync } = require('child_process');
    let r = spawnSync('tar.exe', ['-a', '-cf', out, '-C', stage, '.'], { windowsHide: true });
    if (r.status !== 0) {
      spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Compress-Archive -Force -Path "' + path.join(stage, '*') + '" -DestinationPath "' + out + '"'], { windowsHide: true });
    }
    try { fs.rmSync(stage, { recursive: true, force: true }); } catch {}
    if (!fs.existsSync(out)) return { success: false, error: '整合包打包失败' };
    return { success: true, savePath: out };
  } catch (e) { return { success: false, error: String((e && e.message) || e) }; }
});

ipcMain.handle('dialog:openFile', async (_e, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return { success: false };
  return { success: true, path: result.filePaths[0] };
});

// Import a modpack (.mrpack/.zip/.jar, all ZIP-family) into a location chosen by the user.
ipcMain.handle('import-modpack', async (_e, arg) => {
  const srcPath = arg && arg.srcPath;
  const parentDir = arg && arg.parentDir;
  const rawName = arg && arg.name;
  try {
    if (!srcPath || !fs.existsSync(srcPath)) return { success: false, error: '找不到整合包文件' };
    if (!parentDir) return { success: false, error: '未选择安装位置' };
    const safeName = String(rawName || 'modpack').replace(/[\\/:*?"<>|]/g, '_').trim() || 'modpack';
    const dest = path.join(parentDir, safeName);
    fs.mkdirSync(dest, { recursive: true });
    const { spawnSync } = require('child_process');
    let extracted = false;
    try {
      const r = spawnSync('tar.exe', ['-xf', srcPath, '-C', dest], { windowsHide: true, encoding: 'utf8' });
      extracted = r.status === 0;
      if (!extracted && r.error) extracted = false;
    } catch { extracted = false; }
    if (!extracted) {
      // Fallback: copy to a .zip temp name and let PowerShell expand it.
      const tmpZip = path.join(require('os').tmpdir(), 'glow_modpack_' + Date.now() + '.zip');
      fs.copyFileSync(srcPath, tmpZip);
      const pr = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Expand-Archive -Force -LiteralPath "' + tmpZip + '" -DestinationPath "' + dest + '"'], { windowsHide: true });
      try { fs.unlinkSync(tmpZip); } catch {}
      if (pr.status !== 0) return { success: false, error: '整合包解压失败，文件可能已损坏' };
    }
    // Loader from Modrinth metadata when available, otherwise infer from the pack name.
    let loader = 'fabric';
    const idx = path.join(dest, 'modrinth.index.json');
    if (fs.existsSync(idx)) {
      try {
        const m = JSON.parse(fs.readFileSync(idx, 'utf8'));
        const deps = (m.dependencies && Object.keys(m.dependencies)) || [];
        const hit = deps.find(function (k) { return ['fabric-loader', 'quilt-loader', 'neoforge', 'forge'].indexOf(k) >= 0; });
        if (hit) loader = hit.replace('-loader', '');
      } catch {}
    } else {
      const n = safeName.toLowerCase();
      loader = n.indexOf('neoforge') >= 0 ? 'neoforge' : n.indexOf('forge') >= 0 ? 'forge' : n.indexOf('quilt') >= 0 ? 'quilt' : 'fabric';
    }
    // Lift overrides / client_overrides (mods, config, ...) up to the instance root.
    ['overrides', 'client_overrides'].forEach(function (ov) {
      const ovDir = path.join(dest, ov);
      if (fs.existsSync(ovDir)) {
        try { fs.cpSync(ovDir, dest, { recursive: true, force: true }); } catch {}
        try { fs.rmSync(ovDir, { recursive: true, force: true }); } catch {}
      }
    });
    return { success: true, gameDir: dest, loader: loader, name: safeName };
  } catch (e) {
    return { success: false, error: (e && e.message) || String(e) };
  }
});

// Install a CurseForge modpack (manifest.json + overrides). Unlike Modrinth .mrpack, a CF pack only
// lists mods as {projectID,fileID} in manifest.json — each mod must be resolved to a CDN URL and
// downloaded. Uses the MCIM CurseForge mirror (keyless) for resolution and the CF CDN for files.
ipcMain.handle('install-cf-modpack', async (event, arg) => {
  const srcPath = arg && arg.srcPath;
  const parentDir = arg && arg.parentDir;
  const rawName = arg && arg.name;
  const taskId = arg && arg.taskId;
  const sendPct = (p) => { try { event.sender.send('download-progress', { taskId, percent: Math.max(0, Math.min(100, Math.round(p))) }); } catch {} };
  try {
    if (!srcPath || !fs.existsSync(srcPath)) return { success: false, error: '找不到整合包文件' };
    if (!parentDir) return { success: false, error: '未选择安装位置' };
    const safeName = String(rawName || 'modpack').replace(/[\\/:*?"<>|]/g, '_').trim() || 'modpack';
    const dest = path.join(parentDir, safeName);
    fs.mkdirSync(dest, { recursive: true });

    // Extract (tar first, PowerShell fallback)
    let extracted = false;
    try {
      const { spawnSync } = require('child_process');
      const r = spawnSync('tar.exe', ['-xf', srcPath, '-C', dest], { windowsHide: true });
      extracted = r.status === 0;
      if (!extracted) {
        const tmpZip = path.join(require('os').tmpdir(), 'gl_cfmp_' + Date.now() + '.zip');
        fs.copyFileSync(srcPath, tmpZip);
        const pr = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Expand-Archive -Force -LiteralPath "' + tmpZip + '" -DestinationPath "' + dest + '"'], { windowsHide: true });
        try { fs.unlinkSync(tmpZip); } catch {}
        extracted = pr.status === 0;
      }
    } catch { extracted = false; }
    if (!extracted) return { success: false, error: '整合包解压失败，文件可能已损坏' };

    const manifestPath = path.join(dest, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return { success: false, error: '不是有效的 CurseForge 整合包（缺 manifest.json）' };
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Lift overrides / client_overrides (config, resources, ...) to instance root
    ['overrides', 'client_overrides'].forEach(function (ov) {
      const ovDir = path.join(dest, ov);
      if (fs.existsSync(ovDir)) {
        try { fs.cpSync(ovDir, dest, { recursive: true, force: true }); } catch {}
        try { fs.rmSync(ovDir, { recursive: true, force: true }); } catch {}
      }
    });

    // Loader from modloaders[].id, e.g. "forge-47.1.0" / "fabric-0.15.11-1.20.1"
    let loader = 'forge';
    const mlId = (((manifest.minecraft && manifest.minecraft.modloaders) || [])[0] || {}).id || '';
    const dash = mlId.indexOf('-');
    const prefix = dash >= 0 ? mlId.slice(0, dash) : mlId;
    if (['forge', 'fabric', 'quilt', 'neoforge'].includes(prefix)) loader = prefix;

    // Download each required mod
    const modFiles = Array.isArray(manifest.files) ? manifest.files.filter((f) => f.required !== false) : [];
    const modsDir = path.join(dest, 'mods');
    fs.mkdirSync(modsDir, { recursive: true });
    const failed = [];
    for (let i = 0; i < modFiles.length; i++) {
      const f = modFiles[i];
      sendPct((i / modFiles.length) * 100);
      try {
        const meta = await getJson(`https://mod.mcimirror.top/curseforge/v1/mods/${f.projectID}/files/${f.fileID}`);
        const dlUrl = meta && meta.data && meta.data.downloadUrl;
        if (!dlUrl) { failed.push(`#${f.fileID}`); continue; }
        const fileName = meta.data.fileName || path.basename(new URL(dlUrl).pathname);
        await downloadFileTo(dlUrl, path.join(modsDir, fileName), 3, null);
      } catch { failed.push(`#${f.fileID}`); }
    }
    sendPct(100);
    if (failed.length) {
      try { event.sender.send('download-progress', { taskId, percent: 100 }); } catch {}
      return { success: true, gameDir: dest, loader, name: safeName, warning: `${failed.length} 个 Mod 解析失败，可在整合包页面手动补下` };
    }
    return { success: true, gameDir: dest, loader, name: safeName };
  } catch (e) {
    return { success: false, error: (e && e.message) || String(e) };
  }
});


// Detect the mod loader of an installed version from its json (mainClass/libraries), folder name as fallback.
function detectVersionLoader(meta, dirName) {
  let loader = 'vanilla';
  let loaderVersion = '';
  const libs = Array.isArray(meta && meta.libraries)
    ? meta.libraries.map((l) => (typeof l === 'string' ? l : (l && l.name) || '')).join('\n').toLowerCase()
    : '';
  const mainClass = String((meta && meta.mainClass) || '').toLowerCase();
  const blob = libs + '\n' + mainClass;
  if (blob.includes('fabric-loader') || blob.includes('fabricmc.loader')) loader = 'fabric';
  else if (blob.includes('quilt-loader') || blob.includes('quiltmc.loader')) loader = 'quilt';
  else if (blob.includes('optifine') || blob.includes('optifineinstaller')) loader = 'optifine';
  // 注意：NeoForge 必须先于 Forge 判定（二者现代版本都用 cpw.mods.bootstraplauncher）。
  else if (blob.includes('neoforged:neoforge') || blob.includes('net.neoforged') || blob.includes('fancymodloader')) loader = 'neoforge';
  // 只用加载器强特征：裸 'launchwrapper' 不可靠（远古原版 1.6 及更早自带官方库 net.minecraft:launchwrapper），
  // 裸 'bootstraplauncher' 改为完整 group，避免把远古/原版误判成 Forge。
  else if (blob.includes('minecraftforge') || blob.includes('cpw.mods.modlauncher') || blob.includes('cpw.mods.bootstraplauncher') || blob.includes('fmlloader')) loader = 'forge';
  const vm = libs.match(/(?:fabric-loader|quilt-loader|neoforge|forge)[^\n]{0,40}?[:@]([0-9][\w.\-+]*)/);
  if (vm) loaderVersion = vm[1];
  if (loader === 'vanilla' && dirName) {
    const n = String(dirName).toLowerCase();
    if (n.includes('fabric')) loader = 'fabric';
    else if (n.includes('quilt')) loader = 'quilt';
    else if (n.includes('optifine')) loader = 'optifine';
    else if (n.includes('neoforge')) loader = 'neoforge';
    else if (n.includes('forge')) loader = 'forge';
  }
  const mcVersion = (meta && (meta.inheritsFrom || meta.id)) || '';
  return { loader, loaderVersion, mcVersion };
}

// 导入版本时需要跳过的重型/系统目录（避免在整个系统目录里无意义递归）
const SCAN_PRUNE_DIRS = new Set([
  'node_modules', '.git', '$recycle.bin', 'system volume information', 'windows',
  'program files', 'program files (x86)', 'programdata', '$winreagent', 'recovery', 'msocache',
]);
// 扫描一个 versions 目录下的全部版本（存在 <v>/<v>.json 即认定为版本）
function scanVersionsDir(versionsDir, gameDir, out, seen) {
  let entries;
  try { entries = fs.readdirSync(versionsDir, { withFileTypes: true }); } catch { return 0; }
  let n = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const vDir = path.join(versionsDir, id);
    const jsonFile = path.join(vDir, `${id}.json`);
    const jarFile = path.join(vDir, `${id}.jar`);
    if (!fs.existsSync(jsonFile)) continue;
    const key = gameDir.toLowerCase() + '||' + id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let versionType = 'release';
    let loaderInfo = { loader: 'vanilla', loaderVersion: '', mcVersion: '' };
    try {
      const meta = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      versionType = meta.type || 'release';
      loaderInfo = detectVersionLoader(meta, id);
    } catch {}
    out.push({
      id,
      versionId: id,
      gameDir,
      versionType,
      hasJar: fs.existsSync(jarFile),
      loader: loaderInfo.loader,
      loaderVersion: loaderInfo.loaderVersion,
      mcVersion: loaderInfo.mcVersion,
    });
    n++;
  }
  return n;
}
// 在用户选择的任意文件夹中寻找版本，支持四种布局：
// 1) <root>/versions/<v>/<v>.json  root 是游戏目录（如 .minecraft）
// 2) <root>/<v>/<v>.json           root 本身就是 versions 目录
// 3) <root>/<root名>.json          root 本身就是单个版本目录
// 4) 向下递归最多 3 层寻找 versions 目录（多实例启动器目录、游戏根的上级文件夹均可）
function findVersionsInFolder(root) {
  const out = [];
  const seen = new Set();
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  // 1) root 是游戏目录
  const vUnderRoot = path.join(root, 'versions');
  if (isDir(vUnderRoot)) scanVersionsDir(vUnderRoot, root, out, seen);
  // 2) root 本身就是 versions 目录
  scanVersionsDir(root, path.dirname(root), out, seen);
  // 3) root 本身就是单个版本目录
  const base = path.basename(root);
  if (fs.existsSync(path.join(root, `${base}.json`))) {
    scanVersionsDir(path.dirname(root), path.dirname(path.dirname(root)), out, seen);
  }
  // 4) 向下递归寻找 versions 目录
  const walk = (dir, depth) => {
    if (depth < 0) return;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const low = e.name.toLowerCase();
      if (SCAN_PRUNE_DIRS.has(low)) continue;
      const p = path.join(dir, e.name);
      if (low === 'versions') { scanVersionsDir(p, dir, out, seen); continue; }
      walk(p, depth - 1);
    }
  };
  walk(root, 3);
  return out;
}
ipcMain.handle('scan-minecraft', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择游戏目录（.minecraft、versions、单个版本目录或其上级文件夹都可以）',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return { success: false, versions: [] };
  const root = result.filePaths[0];
  try {
    const versions = findVersionsInFolder(root);
    if (!versions.length) return { success: true, versions: [], mcDir: root, scannedRoot: root };
    return { success: true, versions, mcDir: versions[0].gameDir, scannedRoot: root };
  } catch (e) {
    return { success: false, error: e.message, versions: [] };
  }
});

// 静默自动扫描：默认 .minecraft + 调用方给定的游戏目录（已记录版本所在目录 / 自定义下载目录），
// 不弹目录选择框。供启动器启动时自动识别本机已安装版本及其加载器（Fabric/Forge/Quilt/NeoForge），
// 这样普通用户（含用其他启动器装过游戏的人）无需手动「导入版本」也能看到版本与加载器标签。
ipcMain.handle('auto-scan-versions', async (_e, arg) => {
  const roots = [];
  const addRoot = (d) => {
    if (!d || typeof d !== 'string') return;
    try { d = normalizeGameDir(d); } catch {}
    if (d && !roots.includes(d)) roots.push(d);
  };
  try { addRoot(path.join(app.getPath('appData'), '.minecraft')); } catch {}
  const extra = (arg && Array.isArray(arg.dirs)) ? arg.dirs : [];
  for (const d of extra) addRoot(d);
  const out = [];
  const seen = new Set();
  for (const root of roots) {
    let found = [];
    try { found = findVersionsInFolder(root); } catch { found = []; }
    for (const v of found) {
      const key = String(v.gameDir || '').toLowerCase() + '||' + String(v.id).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
  }
  return { success: true, versions: out };
});

// 探测最终地址 + 是否支持 Range：发一个 GET bytes=0-0（跟随重定向）。
// 返回 206 + Content-Range: bytes 0-0/TOTAL 即支持分块；200 则只能单流。
function probeRange(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('重定向过多'));
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(url, {
      agent: agentForUrl(url),
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
// 下载单个字节区间到 partPath，失败重试（复用连接池）
function downloadRange(url, start, end, partPath, tries = 3) {
  return new Promise((resolve, reject) => {
    const run = (n) => {
      const out = fs.createWriteStream(partPath);
      const lib = url.startsWith('http:') ? http : https;
      const req = lib.request(url, {
        agent: agentForUrl(url),
        method: 'GET',
        headers: { 'User-Agent': 'GlowstoneLauncher/1.0', Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' },
        timeout: 30000,
      });
      let settled = false;
      const fail = (e) => { if (settled) return; settled = true; try { req.destroy(); } catch {} fs.unlink(partPath, () => {}); if (n < tries) setTimeout(() => run(n + 1), 400 * n); else reject(e); };
      req.on('response', (res) => {
        if (res.statusCode !== 206 && res.statusCode !== 200) { res.resume(); return fail(new Error('HTTP ' + res.statusCode)); }
        res.pipe(out);
        out.on('finish', () => out.close(() => { if (!settled) { settled = true; resolve(); } }));
        out.on('error', fail);
        res.on('error', fail);
      });
      req.on('timeout', () => fail(new Error('连接超时')));
      req.on('error', fail);
      req.end();
    };
    run(1);
  });
}
// 单流下载（不支持分块或小文件），带进度
function singleStream(url, savePath, onTick, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('重定向过多'));
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(url, {
      agent: agentForUrl(url),
      headers: { 'User-Agent': 'GlowstoneLauncher/1.0', 'Accept-Encoding': 'identity' },
      timeout: 30000,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return singleStream(new URL(res.headers.location, url).toString(), savePath, onTick, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let got = 0, lastEmit = 0;
      const tmp = savePath + '.tmp';
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      res.on('data', (c) => { got += c.length; const now = Date.now(); if (onTick && now - lastEmit > 150) { lastEmit = now; onTick(got, total); } });
      out.on('finish', () => out.close(() => { try { fs.renameSync(tmp, savePath); resolve(); } catch (e) { reject(e); } }));
      out.on('error', (e) => { fs.unlink(tmp, () => {}); reject(e); });
    });
    req.on('timeout', () => req.destroy(new Error('连接超时')));
    req.on('error', reject);
  });
}

ipcMain.handle('downloadFile', async (event, { url, saveDir, filename, taskId }) => {
  try {
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
    const finalName = filename || path.basename(new URL(url).pathname) || 'download';
    const savePath = path.join(saveDir, finalName);
    const tick = (receivedBytes, totalBytes) => event.sender.send('download-progress', {
      taskId, receivedBytes, totalBytes,
      percent: totalBytes ? Math.round((receivedBytes / totalBytes) * 100) : 0,
    });
    // 探测：大文件且支持 Range → 8 连接并行分块（单连接限速时提速数倍）
    let probe = null;
    try { probe = await probeRange(url); } catch {}
    const CHUNK_THRESHOLD = 4 * 1024 * 1024;
    if (probe && probe.support && probe.total >= CHUNK_THRESHOLD) {
      const N = 8, total = probe.total;
      const seg = Math.ceil(total / N);
      const partPaths = [];
      const jobs = [];
      for (let i = 0; i < N; i++) {
        const start = i * seg;
        if (start >= total) break;
        const end = Math.min(total - 1, start + seg - 1);
        const pp = savePath + `.part${i}`;
        partPaths.push(pp);
        jobs.push(downloadRange(probe.finalUrl, start, end, pp).then(() => {
          const got = partPaths.reduce((s, p) => s + (fs.existsSync(p) ? fs.statSync(p).size : 0), 0);
          tick(got, total);
        }));
      }
      await Promise.all(jobs);
      // 合并分片
      await new Promise((res, rej) => {
        const out = fs.createWriteStream(savePath);
        out.on('close', res); out.on('error', rej);
        for (const p of partPaths) { try { out.write(fs.readFileSync(p)); } catch (e) { rej(e); } }
        out.end();
      });
      for (const p of partPaths) { try { fs.unlinkSync(p); } catch {} }
      event.sender.send('download-progress', { taskId, percent: 100 });
      return { success: true, savePath };
    }
    // 回退：单流
    await singleStream(url, savePath, tick);
    event.sender.send('download-progress', { taskId, percent: 100 });
    return { success: true, savePath };
  } catch (err) {
    return { success: false, error: String((err && err.message) || err) };
  }
});

// Minecraft version downloader
// Active version install controller, so 'install-cancel' can abort in-flight downloads.
let activeInstall = null;
function makeCancelled() { const e = new Error('download cancelled'); e.isCancelled = true; return e; }

function downloadFileToOnce(url, savePath, redirects = 0, ctl = null) {
  return new Promise((resolve, reject) => {
    if (ctl && ctl.cancelled) { reject(makeCancelled()); return; }
    if (redirects > 5) { reject(new Error('Too many redirects')); return; }
    if (fs.existsSync(savePath) && fs.statSync(savePath).size > 0) { resolve(); return; }
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    const urlObj = new URL(url);
    const lib = urlObj.protocol === 'http:' ? http : https;
    const req = lib.get(url, { agent: agentForUrl(url), headers: { 'User-Agent': 'GlowstoneLauncher/1.0', 'Accept-Encoding': 'identity' }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadFileToOnce(new URL(res.headers.location, url).toString(), savePath, redirects + 1, ctl).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return; }
      const tmpPath = savePath + '.tmp';
      const fileStream = fs.createWriteStream(tmpPath);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close(() => { try { fs.renameSync(tmpPath, savePath); resolve(); } catch (e) { reject(e); } });
      });
      fileStream.on('error', (err) => { fs.unlink(tmpPath, () => {}); reject(err); });
    });
    if (ctl) ctl.addReq(req);
    req.on('close', () => { if (ctl) ctl.removeReq(req); });
    req.on('timeout', () => { try { req.destroy(new Error('download timeout')); } catch {} });
    req.on('error', (e) => { if (ctl && ctl.cancelled) reject(makeCancelled()); else reject(e); });
  });
}
// Retry wrapper: a flaky network must never leave a half-installed "installed" version.
async function downloadFileTo(url, savePath, tries = 3, ctl = null) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    if (ctl && ctl.cancelled) throw makeCancelled();
    try { return await downloadFileToOnce(url, savePath, 0, ctl); }
    catch (e) {
      lastErr = e;
      try { fs.unlinkSync(savePath + '.tmp'); } catch {}
      if (ctl && ctl.cancelled) throw makeCancelled();
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

// Follow redirects (BMCLAPI 302-redirects every meta call to a CDN node; without this we
// parsed an empty 302 body and threw "Invalid JSON") and enforce a timeout, exactly like
// downloadFileToOnce does for binaries.
function getJson(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error('Too many redirects')); return; }
    let urlObj;
    try { urlObj = new URL(url); } catch { reject(new Error('Bad URL: ' + url)); return; }
    const lib = urlObj.protocol === 'http:' ? http : https;
    const req = lib.get(url, { headers: { 'User-Agent': 'GlowstoneLauncher/1.0', 'Accept': 'application/json' }, timeout: 20000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        getJson(new URL(res.headers.location, url).toString(), redirects + 1).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return; }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Invalid JSON from ${url} (${data.length} bytes)`)); }
      });
    });
    req.on('timeout', () => { try { req.destroy(new Error('json request timeout')); } catch {} });
    req.on('error', reject);
  });
}

// 同一 URL 先重试（冷网络/瞬时 reset），再在官方<->BMCL 两个源之间切换，根治版本信息“json request timeout”概率失败
async function getJsonRetry(url, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await getJson(url); }
    catch (e) { last = e; await new Promise((r) => setTimeout(r, 300 * (i + 1))); }
  }
  throw last;
}
async function getJsonMulti(rawUrl, source, tries = 2) {
  const other = source === 'official' ? 'bmcl' : 'official';
  const cands = [...new Set([rewriteDownloadUrl(rawUrl, source), rewriteDownloadUrl(rawUrl, other), rawUrl])];
  let last;
  for (const u of cands) { try { return await getJsonRetry(u, tries); } catch (e) { last = e; } }
  throw last;
}

// Mojang uses downloads.artifact; Fabric/Forge profiles instead give a Maven "name" (+ optional repo "url").
// Support both so modded versions (fabric-loader, sponge-mixin, intermediary, asm, forge...) are on the classpath.
function mavenNameToPath(name) {
  const pp = String(name || '').split(':');
  const g = pp[0], a = pp[1], v = pp[2], cls = pp[3];
  if (!g || !a || !v) return null;
  const base = g.replace(/\./g, '/') + '/' + a + '/' + v + '/' + a + '-' + v;
  return cls ? base + '-' + cls + '.jar' : base + '.jar';
}
function libArtifactRel(lib) {
  // downloads 存在时以它为准：纯原生库只有 classifiers、没有 artifact，
  // 此时绝不能用 name 反推出不存在的主 jar（否则 404 拖垮整版本安装）。
  if (lib && lib.downloads) {
    if (lib.downloads.artifact && lib.downloads.artifact.path) return lib.downloads.artifact.path;
    return null;
  }
  if (lib && lib.name) return mavenNameToPath(lib.name);
  return null;
}
function libArtifactUrl(lib) {
  if (lib && lib.downloads) {
    if (lib.downloads.artifact && lib.downloads.artifact.url) return lib.downloads.artifact.url;
    return null;
  }
  if (lib && lib.name) {
    const rel = mavenNameToPath(lib.name);
    if (!rel) return null;
    const repo = lib.url || 'https://libraries.minecraft.net/';
    return repo.replace(/\/?$/, '/') + rel;
  }
  return null;
}

// Download-source rewriter. 'bmcl' routes Mojang hosts through the BMCLAPI China mirror;
// 'official' (or anything else) leaves every URL untouched. Loader hosts (Fabric/Forge) are kept.
function rewriteDownloadUrl(rawUrl, source) {
  if (source !== 'bmcl' || !rawUrl) return rawUrl;
  try {
    const u = new URL(rawUrl);
    const h = u.hostname.toLowerCase();
    const BMCL = 'bmclapi2.bangbang93.com';
    if (h === 'launchermeta.mojang.com' || h === 'piston-meta.mojang.com' || h === 'piston-data.mojang.com' || h === 'launcher.mojang.com' || h === 'resources.download.minecraft.net') {
      u.protocol = 'https:';
      if (h === 'resources.download.minecraft.net') { u.hostname = BMCL; u.pathname = '/assets' + u.pathname; }
      else u.hostname = BMCL;
      return u.toString();
    }
    if (h === 'libraries.minecraft.net' || h === 'maven.minecraftforge.net' || h === 'maven.fabricmc.net' || h === 'maven.quiltmc.org') {
      // BMCLAPI mirrors Mojang/Forge/Fabric/Quilt maven artifacts under a single /maven root.
      // Quilt's repo carries a /repository/release prefix which must be dropped before mirroring.
      u.protocol = 'https:';
      u.hostname = BMCL;
      u.pathname = '/maven' + u.pathname.replace(/^\/repository\/(release|snapshot|public)/, '');
      return u.toString();
    }
    return rawUrl;
  } catch { return rawUrl; }
}

// 将用户选择的下载位置归一化为真正的 Minecraft 游戏目录（.minecraft）。
// 选中盘符根目录（如 E:\）或不含 .minecraft 的普通文件夹时，在其下自动创建 .minecraft；
// 若选中的本身就是 .minecraft，或已含 versions/ 的游戏目录，则原样使用，避免重复嵌套。
function normalizeGameDir(dir) {
  if (!dir) return dir;
  let p = path.resolve(dir);
  const base = path.basename(p);
  if (base.toLowerCase() === '.minecraft') return p;
  try {
    if (fs.existsSync(path.join(p, 'versions')) || fs.existsSync(path.join(p, 'assets'))) return p;
  } catch {}
  return path.join(p, '.minecraft');
}

ipcMain.handle('install-minecraft-version', async (event, { versionUrl, versionId, gameDir, loader, source }) => {
  gameDir = normalizeGameDir(gameDir);
  const ctl = { cancelled: false, reqs: new Set(), addReq(r) { this.reqs.add(r); }, removeReq(r) { this.reqs.delete(r); } };
  activeInstall = ctl;
  try {
    const mu = (u) => rewriteDownloadUrl(u, source);
    const sendProgress = (stage, percent, detail) => {
      event.sender.send('mc-install-progress', { stage, percent: Math.max(0, Math.min(100, Math.round(percent))), detail });
    };
    const throwIfCancelled = () => { if (ctl.cancelled) throw makeCancelled(); };
    const osNameNow = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
    const libAllowed = (lib) => {
      if (!lib.rules) return true;
      let allowed = true; // Minecraft 规则语义：默认允许，命中的规则依次覆盖
      for (const rule of lib.rules) {
        let matches = true;
        if (rule.os) matches = rule.os.name === osNameNow;
        if (matches) allowed = rule.action === 'allow';
      }
      return allowed;
    };
    // Concurrency pool — runs N downloads in parallel, reports monotonic progress
    const runPool = async (tasks, concurrency, onTick) => {
      let idx = 0, done = 0;
      const total = tasks.length;
      const worker = async () => {
        while (idx < total) {
          if (ctl.cancelled) return;
          const my = tasks[idx++];
          try { await my(); } catch (e) { /* keep going on individual failure */ }
          done++;
          onTick && onTick(done, total);
        }
      };
      const workers = [];
      for (let i = 0; i < Math.min(concurrency, Math.max(1, total)); i++) workers.push(worker());
      await Promise.all(workers);
      return done;
    };

    sendProgress('正在获取版本信息...', 2, versionId);
    let versionJson = await getJsonMulti(versionUrl, source);

    // ---- Mod loader (Fabric / Quilt) -----------------------------------------------------------------
    // The loader meta returns a profile that *inherits* the vanilla version. Fold it into one
    // self-contained version json here so the existing library pool downloads the loader jars too
    // and the launch path (which does not resolve inheritsFrom) works unchanged. This is the fix
    // for "picked a loader but only vanilla got installed".
    if (loader === 'fabric' || loader === 'quilt') {
      sendProgress(`正在获取 ${loader} 加载器信息...`, 3, '');
      const metaBase = loader === 'fabric' ? 'https://meta.fabricmc.net/v2' : 'https://meta.quiltmc.org/v3';
      const mcId = versionJson.id || versionId;
      const list = await getJsonRetry(`${metaBase}/versions/loader/${encodeURIComponent(mcId)}`, 3);
      const pick = Array.isArray(list) && (list.find((x) => x.loader && x.loader.stable !== false) || list[0]);
      if (!pick || !pick.loader || !pick.loader.version) throw new Error(`未找到适用于 ${mcId} 的 ${loader} 加载器版本`);
      const loaderVer = pick.loader.version;
      const profile = await getJsonRetry(`${metaBase}/versions/loader/${encodeURIComponent(mcId)}/${encodeURIComponent(loaderVer)}/profile/json`, 3);
      const libKey = (name) => { const p = String(name || '').split(':'); return p.length >= 3 ? `${p[0]}:${p[1]}:${p[3] || ''}` : String(name); };
      const merged = []; const seen = new Set();
      // loader entries first so they win on duplicate group:artifact
      for (const lib of [...(profile.libraries || []), ...(versionJson.libraries || [])]) {
        const k = libKey(lib.name);
        if (!seen.has(k)) { seen.add(k); merged.push(lib); }
      }
      versionJson.libraries = merged;
      if (profile.mainClass) versionJson.mainClass = profile.mainClass;
      const mergeArgs = (kind) => {
        const a = (versionJson.arguments && Array.isArray(versionJson.arguments[kind])) ? versionJson.arguments[kind].slice() : [];
        const b = (profile.arguments && Array.isArray(profile.arguments[kind])) ? profile.arguments[kind] : [];
        const have = new Set(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));
        for (const x of b) { const sig = typeof x === 'string' ? x : JSON.stringify(x); if (!have.has(sig)) { have.add(sig); a.push(x); } }
        versionJson.arguments = versionJson.arguments || {};
        versionJson.arguments[kind] = a;
      };
      mergeArgs('jvm'); mergeArgs('game');
      delete versionJson.inheritsFrom;
      versionJson.id = versionId;
      sendProgress(`${loader} ${loaderVer} 已合并，开始下载`, 4, loaderVer);
    } else if (loader === 'forge' || loader === 'neoforge') {
      // These require running the official installer's processors, which a static download can't do.
      // Fail loudly instead of silently installing vanilla under a loader name.
      return { success: false, error: `${loader} 需要运行官方安装器进程，暂不支持在线自动安装。请改用 Fabric/Quilt，或在本地装好后通过「导入版本」添加` };
    }

    const versionsDir = path.join(gameDir, 'versions', versionId);
    fs.mkdirSync(versionsDir, { recursive: true });
    fs.writeFileSync(path.join(versionsDir, `${versionId}.json`), JSON.stringify(versionJson, null, 2));

    // Current CPU arch, used to drop x86/arm64 natives on a x64 JVM.
    const curArchInst = process.arch === 'ia32' ? 'x86' : process.arch;
    const classifierArchOk = (libName) => {
      const m = /:natives-[a-z]+(?:-([a-z0-9]+))?$/.exec(libName || '');
      if (!m) return true;
      let a = m[1] || 'x64';
      if (a === 'amd64') a = 'x64';
      return a === curArchInst;
    };

    // 1) client.jar (0 -> 6%) — retry, and remember it for the final integrity check
    const clientUrl = versionJson.downloads?.client?.url ? mu(versionJson.downloads.client.url) : '';
    const clientJarPath = path.join(versionsDir, `${versionId}.jar`);
    const clientAlready = clientUrl && fs.existsSync(clientJarPath) && fs.statSync(clientJarPath).size > 0;
    if (clientUrl && !clientAlready) {
      throwIfCancelled();
      sendProgress('正在下载游戏主文件...', 5, 'client.jar');
      await downloadFileTo(clientUrl, clientJarPath, 3, ctl);
    }
    throwIfCancelled();
    sendProgress('正在下载游戏主文件...', 6, 'client.jar');

    // 2) libraries + natives, parallel (6% -> 60%)
    const libsDir = path.join(gameDir, 'libraries');
    const nativesDir = path.join(versionsDir, 'natives');
    const libTasks = [];
    const requiredFiles = [];
    const nativeJars = [];
    for (const lib of (versionJson.libraries || [])) {
      if (!libAllowed(lib)) continue;
      if (!classifierArchOk(lib.name)) continue;
      const rel = libArtifactRel(lib);
      const libUrl = libArtifactUrl(lib) ? mu(libArtifactUrl(lib)) : '';
      if (rel && libUrl) {
        const p = path.join(libsDir, rel);
        const have = fs.existsSync(p) && fs.statSync(p).size > 0;
        requiredFiles.push({ url: libUrl, rawUrl: libArtifactUrl(lib), path: p, name: lib.name });
        // Count ONLY files still missing, so the progress "(done/total)" matches reality (item: 文件数目).
        if (!have) libTasks.push(() => downloadFileTo(libUrl, p, 3, ctl));
      }
      if (lib.natives && lib.natives.windows && lib.downloads && lib.downloads.classifiers) {
        const key = lib.natives.windows.replace('${arch}', '64');
        const cl = lib.downloads.classifiers[key];
        if (cl) {
          const np = path.join(libsDir, cl.path);
          const nUrl = mu(cl.url);
          const have = fs.existsSync(np) && fs.statSync(np).size > 0;
          requiredFiles.push({ url: nUrl, rawUrl: cl.url, path: np, name: lib.name });
          if (!have) libTasks.push(() => downloadFileTo(nUrl, np, 3, ctl).then(() => { nativeJars.push(np); }));
          else nativeJars.push(np);
        }
      }
      // 旧版（1.8.9 及更早）库 JSON 没有 downloads 字段：原生库按 Maven 约定构造。
      // BMCLAPI 的 JSON 里 artifactId 已以 “-platform” 结尾（如 jinput-platform），
      // 不能再追加；只有官方源的旧 JSON（如 lwjgl）才补 “-platform”。
      // classifier 取 natives.windows（${arch} 替换为 64）
      else if (lib.natives && lib.natives.windows && lib.name) {
        const classifier = String(lib.natives.windows).replace('${arch}', '64');
        const pp = String(lib.name).split(':');
        if (pp.length >= 3) {
          const nativeArtifact = /-platform$/.test(pp[1]) ? pp[1] : pp[1] + '-platform';
          const platformName = [pp[0], nativeArtifact, pp[2], classifier].join(':');
          const nrel = mavenNameToPath(platformName);
          if (nrel) {
            const np = path.join(libsDir, nrel);
            const nUrl = mu('https://libraries.minecraft.net/' + nrel);
            const have = fs.existsSync(np) && fs.statSync(np).size > 0;
            requiredFiles.push({ url: nUrl, rawUrl: 'https://libraries.minecraft.net/' + nrel, path: np, name: platformName });
            if (!have) libTasks.push(() => downloadFileTo(nUrl, np, 3, ctl).then(() => { nativeJars.push(np); }));
            else nativeJars.push(np);
          }
        }
      }
    }
    let lastLibPct = 6;
    await runPool(libTasks, 32, (done, total) => {
      const pct = 6 + (done / Math.max(1, total)) * 54;
      if (Math.floor(pct) > lastLibPct || done === total) { lastLibPct = pct; sendProgress(`正在下载库文件 (${done}/${total})...`, pct, ''); }
    });
    throwIfCancelled();
    // Integrity pass: the parallel pool never lets one failed file abort the install.
    // Re-download anything still missing so we never report success for a broken version.
    const stillMissing = [];
    for (const rf of requiredFiles) {
      if (ctl.cancelled) break;
      if (fs.existsSync(rf.path) && fs.statSync(rf.path).size > 0) continue;
      // 多源补救：首选源失败后，在 BMCL <-> 官方源之间切换，避免单个镜像节点抖动导致整版本失败。
      const candUrls = [...new Set([
        rf.url,
        rewriteDownloadUrl(rf.rawUrl || rf.url, source === 'bmcl' ? 'official' : 'bmcl'),
        rewriteDownloadUrl(rf.rawUrl || rf.url, source),
        rf.rawUrl,
      ].filter(Boolean))];
      let ok = false;
      for (const cu of candUrls) {
        if (ctl.cancelled) break;
        try { await downloadFileTo(cu, rf.path, 2, ctl); ok = true; break; } catch {}
      }
      if (!ok && !ctl.cancelled) stillMissing.push(rf.name);
    }
    throwIfCancelled();
    if (clientUrl && !(fs.existsSync(clientJarPath) && fs.statSync(clientJarPath).size > 0)) {
      return { success: false, error: '游戏主文件 client.jar 下载失败，请检查网络后重新下载该版本' };
    }
    if (stillMissing.length) {
      return { success: false, error: `有 ${stillMissing.length} 个库文件下载失败（例如 ${stillMissing.slice(0,3).join('、')}），请检查网络后重新下载该版本`, missing: stillMissing.slice(0, 20) };
    }
    // extract natives after download：用系统 tar.exe 解压（不引入额外依赖、错误不吞）
    if (nativeJars.length) {
      sendProgress('正在解压本地库...', 60, 'natives');
      fs.mkdirSync(nativesDir, { recursive: true });
      for (const nj of nativeJars) {
        await extractNativeJar(nj, nativesDir, ['META-INF/']);
      }
    }

    // 3) assets, parallel (62% -> 97%)
    if (versionJson.assetIndex) {
      sendProgress('正在获取资源索引...', 62, versionJson.assetIndex.id);
      const assetIndex = await getJsonMulti(versionJson.assetIndex.url, source);
      const objectsDir = path.join(gameDir, 'assets', 'objects');
      const indexesDir = path.join(gameDir, 'assets', 'indexes');
      fs.mkdirSync(indexesDir, { recursive: true });
      fs.writeFileSync(path.join(indexesDir, `${versionJson.assetIndex.id}.json`), JSON.stringify(assetIndex));

      const assetTasks = [];
      for (const [, obj] of Object.entries(assetIndex.objects || {})) {
        const hash = obj.hash;
        const sub = hash.substring(0, 2);
        const ap = path.join(objectsDir, sub, hash);
        if (fs.existsSync(ap) && fs.statSync(ap).size > 0) continue; // skip already present
        assetTasks.push(() => downloadFileTo(mu(`https://resources.download.minecraft.net/${sub}/${hash}`), ap, 3, ctl));
      }
      let lastAPct = 62;
      await runPool(assetTasks, 48, (done, total) => {
        const pct = 62 + (done / Math.max(1, total)) * 35;
        if (Math.floor(pct) > lastAPct || done === total) { lastAPct = pct; sendProgress(`正在下载资源文件 (${done}/${total})...`, pct, ''); }
      });
      throwIfCancelled();
    }

    // 4) log config
    if (versionJson.logging && versionJson.logging.client && versionJson.logging.client.file) {
      const logFile = versionJson.logging.client.file;
      const logDir = path.join(gameDir, 'assets', 'log_configs');
      fs.mkdirSync(logDir, { recursive: true });
      try { await downloadFileTo(mu(logFile.url), path.join(logDir, logFile.id), 1, ctl); } catch (e) {}
    }

    sendProgress('完成！', 100, '版本安装成功');
    return { success: true, versionId, gameDir };
  } catch (err) {
    if (err && err.isCancelled) return { success: false, cancelled: true, error: '已取消下载' };
    return { success: false, error: err.message };
  } finally {
    if (activeInstall === ctl) activeInstall = null;
  }
});

// Cancel an in-progress version install: flip the flag and destroy every in-flight request.
ipcMain.handle('install-cancel', async () => {
  if (!activeInstall) return { success: false, error: '没有正在进行的安装' };
  activeInstall.cancelled = true;
  for (const r of activeInstall.reqs) { try { r.destroy(makeCancelled()); } catch {} }
  return { success: true };
});

// System info
ipcMain.handle('get-system-memory', () => {
  const os = require('os');
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  return {
    totalGB: Math.round(totalBytes / (1024 * 1024 * 1024)),
    freeGB: Math.round(freeBytes / (1024 * 1024 * 1024)),
    usedGB: Math.round((totalBytes - freeBytes) / (1024 * 1024 * 1024)),
  };
});

// ---------- 百宝箱 ----------
// 内存优化：EmptyWorkingSet 清空各进程（含启动器自身/Java 游戏）工作集，物理内存换出到页面文件。
// 前后可用内存都在同一个 PowerShell 会话内用 GlobalMemoryStatusEx 测量，避免进程启动波动污染数字。
ipcMain.handle('memory-optimize', async () => {
  const cs = 'using System;using System.Runtime.InteropServices;using System.Diagnostics;public class MemOpt{'
    + '[StructLayout(LayoutKind.Sequential)] private struct M { public uint a; public uint b; public ulong c; public ulong avail; public ulong e; public ulong f; public ulong g; public ulong h; public ulong i; }'
    + '[DllImport("kernel32.dll")] private static extern bool GlobalMemoryStatusEx(ref M m);'
    + '[DllImport("psapi.dll")] private static extern bool EmptyWorkingSet(IntPtr h);'
    + '[DllImport("kernel32.dll")] private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);'
    + '[DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr h);'
    + '[DllImport("kernel32.dll")] private static extern bool SetSystemFileCacheSize(IntPtr min, IntPtr max, int flags);'
    + '[DllImport("ntdll.dll")] private static extern int NtSetSystemInformation(int cls, ref int info, int len);'
    + 'private const uint QI=0x0400, QLI=0x1000, SQ=0x0100;'
    + 'public static ulong AvailMB(){ M m=new M(); m.a=(uint)Marshal.SizeOf(typeof(M)); GlobalMemoryStatusEx(ref m); return m.avail/1048576UL; }'
    // 显式以 QUERY_INFORMATION|SET_QUOTA 打开句柄（比 Process.Handle 的 ALL_ACCESS 对受保护进程成功率更高），失败再退 LIMITED
    + 'public static int Sweep(){ int ok=0; foreach(Process proc in Process.GetProcesses()){ IntPtr h=OpenProcess(QI|SQ,false,proc.Id); if(h==IntPtr.Zero){ h=OpenProcess(QLI|SQ,false,proc.Id); } if(h!=IntPtr.Zero){ try{ if(EmptyWorkingSet(h)){ ok++; } }catch{} CloseHandle(h); } } GC.Collect(); GC.WaitForPendingFinalizers(); return ok; }'
    // 清空系统文件缓存与待机内存（RAMMap 同款）；需要更高权限，非管理员调用静默失败，不影响 EmptyWorkingSet 主流程
    + 'public static void PurgeCache(){ try{ SetSystemFileCacheSize(new IntPtr(-1), new IntPtr(-1), 0); }catch{} try{ int c=3; NtSetSystemInformation(80, ref c, 4); }catch{} try{ int c=4; NtSetSystemInformation(80, ref c, 4); }catch{} } }';
  const ps = "Add-Type -TypeDefinition '" + cs + "'; "
    + "$before=[MemOpt]::AvailMB(); "
    + "$ok=[MemOpt]::Sweep(); "
    + "Start-Sleep -Milliseconds 250; "
    + "[MemOpt]::Sweep() | Out-Null; " // 第二遍：换出第一遍后新回填的工作集
    + "[MemOpt]::PurgeCache(); "
    + "[GC]::Collect(); [GC]::WaitForPendingFinalizers(); Start-Sleep -Milliseconds 600; "
    + "$after=[MemOpt]::AvailMB(); Write-Output ($ok.ToString()+'|'+$before.ToString()+'|'+$after.ToString())";
  // 异步执行（旧版 execFileSync 同步阻塞主进程，点击后整个启动器无响应数秒）
  const execFileAsync = require('util').promisify(require('child_process').execFile);
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, timeout: 30000, encoding: 'utf8' });
    const m = String(stdout).trim().match(/(\d+)\|(\d+)\|(\d+)/);
    if (!m) return { success: false, error: '内存优化返回异常：' + String(stdout).trim().slice(0, 120) };
    const touched = parseInt(m[1], 10);
    const beforeMB = parseInt(m[2], 10), afterMB = parseInt(m[3], 10);
    return { success: true, touched, beforeMB, afterMB, freedMB: Math.max(0, afterMB - beforeMB), freeGB: Math.round(afterMB / 1024 * 10) / 10 };
  } catch (err) { return { success: false, error: String((err && err.message) || err) }; }
});

// 游戏垃圾文件：logs / crash-reports / debug / hs_err_pid / *.tmp，返回释放大小
const GARBAGE_PATTERNS = [/^hs_err_pid.*\.log$/i, /^\.locks$/i, /\.tmp$/i, /\.bak$/i, /^output-client\.log$/i, /^output-server\.log$/i];
const GARBAGE_DIRS = ['logs', 'crash-reports', 'debug', 'crashes'];
ipcMain.handle('cleanup-garbage', async (_e, arg) => {
  try {
    const roots = [];
    const push = (r) => {
      if (!r) return;
      if (!path.isAbsolute(r)) r = path.join(app.getPath('appData'), r); // 兼容 '.minecraft' 这类相对游戏目录
      if (fs.existsSync(r) && !roots.includes(r)) roots.push(r);
    };
    if (arg && arg.gameDir) push(arg.gameDir);
    // 一键清理覆盖“所有已安装版本”的游戏目录（含自定义盘 / 版本隔离目录），不只当前版本
    if (arg && Array.isArray(arg.allDirs)) arg.allDirs.forEach(push);
    push(path.join(app.getPath('appData'), '.minecraft'));
    for (let code = 67; code <= 90; code++) { const d = String.fromCharCode(code) + ':\\.minecraft'; try { if (fs.existsSync(d)) push(d); } catch {} }
    let deletedFiles = 0, freed = 0;
    const tryRemove = (p) => { try { const st = fs.statSync(p); if (st.isFile()) { freed += st.size; fs.unlinkSync(p); deletedFiles++; } } catch {} };
    for (const root of roots) {
      for (const dir of GARBAGE_DIRS) {
        const d = path.join(root, dir);
        if (!fs.existsSync(d)) continue;
        try {
          const walk = (cur) => { let ent; try { ent = fs.readdirSync(cur, { withFileTypes: true }); } catch { return; } for (const e of ent) { const p = path.join(cur, e.name); if (e.isDirectory()) walk(p); else tryRemove(p); } };
          walk(d);
        } catch {}
      }
      try { const ents = fs.readdirSync(root); for (const n of ents) { if (GARBAGE_PATTERNS.some((re) => re.test(n))) tryRemove(path.join(root, n)); } } catch {}
    }
    return { success: true, deletedFiles, freedBytes: freed, freedMB: Math.round(freed / (1024 * 1024)) };
  } catch (err) { return { success: false, error: String((err && err.message) || err) }; }
});

// 存档备份：把 gameDir/saves 复制到 <parent>/backup/saves-<时间戳>
ipcMain.handle('backup-saves', async (_e, arg) => {
  try {
    const gameDir = arg && arg.gameDir;
    if (!gameDir) return { success: false, error: '缺少游戏目录' };
    const saves = path.join(gameDir, 'saves');
    if (!fs.existsSync(saves)) return { success: false, error: '未找到 saves 存档目录' };
    const parent = path.dirname(gameDir);
    const backupRoot = path.join(parent, 'backup');
    fs.mkdirSync(backupRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const dest = path.join(backupRoot, 'saves-' + stamp);
    fs.mkdirSync(dest, { recursive: true });
    let worlds = 0;
    const ents = fs.readdirSync(saves, { withFileTypes: true });
    for (const e of ents) { if (e.isDirectory() && !e.name.startsWith('.')) { try { fs.cpSync(path.join(saves, e.name), path.join(dest, e.name), { recursive: true, force: true }); worlds++; } catch {} } }
    if (worlds === 0) { try { fs.rmSync(dest, { recursive: true, force: true }); } catch {} return { success: false, error: 'saves 中没有世界文件夹可备份' }; }
    return { success: true, backupPath: dest, worlds };
  } catch (err) { return { success: false, error: String((err && err.message) || err) }; }
});

// 存档恢复：把备份目录内容合并复制回 gameDir/saves（不删除现有世界，冲突文件覆盖前先改名 .bak）
ipcMain.handle('restore-saves', async (_e, arg) => {
  try {
    const { gameDir, backupPath } = arg || {};
    if (!gameDir || !backupPath) return { success: false, error: '缺少游戏目录或备份路径' };
    if (!fs.existsSync(backupPath)) return { success: false, error: '备份目录不存在' };
    const saves = path.join(gameDir, 'saves');
    fs.mkdirSync(saves, { recursive: true });
    let worlds = 0;
    const ents = fs.readdirSync(backupPath, { withFileTypes: true });
    for (const e of ents) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const src = path.join(backupPath, e.name), dst = path.join(saves, e.name);
      try {
        if (fs.existsSync(dst) && fs.existsSync(path.join(dst, 'level.dat'))) {
          fs.renameSync(dst, dst + '.bak-' + Date.now());
        }
        fs.cpSync(src, dst, { recursive: true, force: true }); worlds++;
      } catch {}
    }
    return { success: true, worlds };
  } catch (err) { return { success: false, error: String((err && err.message) || err) }; }
});

// 列出 gameDir/saves 的世界与可用备份（供百宝箱展示）
ipcMain.handle('list-saves', async (_e, arg) => {
  try {
    const gameDir = arg && arg.gameDir;
    const out = { worlds: [], backups: [] };
    if (gameDir) {
      const saves = path.join(gameDir, 'saves');
      try { if (fs.existsSync(saves)) out.worlds = fs.readdirSync(saves, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name); } catch {}
      const backupRoot = path.join(path.dirname(gameDir), 'backup');
      try { if (fs.existsSync(backupRoot)) out.backups = fs.readdirSync(backupRoot, { withFileTypes: true }).filter((e) => e.isDirectory() && /^saves-\d{14}$/.test(e.name)).map((e) => ({ name: e.name, path: path.join(backupRoot, e.name) })).sort((a, b) => b.name.localeCompare(a.name)); } catch {}
    }
    return { success: true, ...out };
  } catch (err) { return { success: false, error: String((err && err.message) || err) }; }
});

// Find Java on the system — scans EVERY fixed drive, not only C:.
const JAVA_PARENT_REL = [
  'Program Files\\Java',
  'Program Files (x86)\\Java',
  'Program Files\\Eclipse Adoptium',
  'Program Files\\Temurin',
  'Program Files\\Microsoft',
  'Program Files\\Zulu',
  'Program Files\\Amazon Corretto',
  'Program Files\\BellSoft',
  'Program Files\\Semeru',
  'Program Files\\IBM',
  'Program Files\\Java',
  'Java', 'jdk', 'JDK', 'Dev', 'Tools',
];
const JAVA_PRUNE = new Set([
  'windows', '$recycle.bin', 'system volume information', '$winreagent', '$windows.~bt',
  '$windows.~ws', 'recovery', 'perflogs', 'programdata', 'msocache', 'intel', 'amd',
  'nvidia corporation', 'driverstore', 'temp', 'tmp', 'cache', 'caches', 'node_modules',
  '.git', '.svn', '.hg', 'appdata', 'windowsapps', 'wpsystem', 'system.sav', 'inetpub',
  'logs', 'log', '$sysreset', 'crashdumps',
]);
let _allDrives = null;
function listAllDrives() {
  if (_allDrives) return _allDrives;
  const drives = [];
  for (let code = 67; code <= 90; code++) { // C..Z
    const root = String.fromCharCode(code) + ':\\';
    try { fs.accessSync(root); drives.push(root); } catch {}
  }
  _allDrives = drives;
  return drives;
}
function addJava(out, seen, p) {
  try {
    const full = path.resolve(p);
    const key = full.toLowerCase();
    if (!seen.has(key) && fs.existsSync(full)) { seen.add(key); out.push(full); }
  } catch {}
}
// Fast, shallow scan of well-known JDK locations on every drive (no deep walk).
let _namedJavaCache = null;
let _namedJavaAt = 0;
function collectNamedJava() {
  // 120 秒内复用浅层扫描结果，避免每次启动游戏都重新扫盘
  if (_namedJavaCache && Date.now() - _namedJavaAt < 120000) return _namedJavaCache.slice();
  const { execSync } = require('child_process');
  const out = [], seen = new Set();
  if (process.env.JAVA_HOME) addJava(out, seen, path.join(process.env.JAVA_HOME, 'bin', 'java.exe'));
  for (const root of listAllDrives()) {
    for (const rel of JAVA_PARENT_REL) {
      const base = path.join(root, rel);
      let dirs;
      try { dirs = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        addJava(out, seen, path.join(base, d.name, 'bin', 'java.exe'));
        try {
          for (const d2 of fs.readdirSync(path.join(base, d.name), { withFileTypes: true })) {
            if (d2.isDirectory()) addJava(out, seen, path.join(base, d.name, d2.name, 'bin', 'java.exe'));
          }
        } catch {}
      }
    }
  }
  // Per-user JDK locations (IntelliJ .jdks, scoop, chocolatey, local programs)
  const home = app.getPath('home');
  const userBases = [
    path.join(home, '.jdks'),
    path.join(home, 'scoop', 'apps'),
    path.join(home, 'AppData', 'Local', 'Programs', 'Eclipse Adoptium'),
    path.join(home, 'AppData', 'Local', 'Programs', 'Microsoft'),
    'C:\\ProgramData\\chocolatey\\lib',
  ];
  const walk = (dir, depth) => {
    if (depth < 0) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    addJava(out, seen, path.join(dir, 'bin', 'java.exe'));
    for (const e of entries) if (e.isDirectory()) walk(path.join(dir, e.name), depth - 1);
  };
  for (const base of userBases) walk(base, 3);

  // JDK_HOME（少数环境只设置了它，没有 JAVA_HOME）
  if (process.env.JDK_HOME) addJava(out, seen, path.join(process.env.JDK_HOME, 'bin', 'java.exe'));

  // Windows 注册表：Oracle / JavaSoft 记录的 JavaHome（含 32 位 Wow6432Node），自定义安装目录也能找到
  if (process.platform === 'win32') {
    const regKeys = [
      'HKLM\\SOFTWARE\\JavaSoft\\Java Runtime Environment',
      'HKLM\\SOFTWARE\\JavaSoft\\JDK',
      'HKLM\\SOFTWARE\\JavaSoft\\Java Development Kit',
      'HKLM\\SOFTWARE\\Wow6432Node\\JavaSoft\\Java Runtime Environment',
      'HKLM\\SOFTWARE\\Wow6432Node\\JavaSoft\\JDK',
      'HKLM\\SOFTWARE\\Wow6432Node\\JavaSoft\\Java Development Kit',
    ];
    for (const rk of regKeys) {
      try {
        const ro = execSync(`reg query "${rk}" /s`, { encoding: 'utf8', timeout: 4000, windowsHide: true });
        for (const mm of ro.matchAll(/JavaHome\s+REG_SZ\s+(.+)/gi)) {
          addJava(out, seen, path.join(mm[1].trim(), 'bin', 'java.exe'));
        }
      } catch {}
    }
  }

  // Minecraft 官方运行时与第三方启动器下载的 Java：AppData 在深度 walk 中被 prune，需在此显式枚举
  const appData = process.env.APPDATA || '';
  const localAppData = process.env.LOCALAPPDATA || '';
  const runtimeBases = [
    path.join(appData, '.minecraft', 'runtime'),
    path.join(appData, '.hmcl', 'java'),
    path.join(appData, '.hmcl', 'runtime'),
    path.join(localAppData, 'BakaXL', 'JavaRuntime'),
    path.join(localAppData, 'BakaXL', 'runtime'),
    path.join(localAppData, 'PCL', 'runtime'),
    path.join(localAppData, 'Programs'),
    path.join(localAppData, 'JetBrains', 'Toolbox', 'apps', 'JBR'),
    path.join(home, '.sdkman', 'candidates', 'java'),
    path.join(home, 'Java'),
  ];
  for (const rb of runtimeBases) walk(rb, 4);

  // Microsoft Store 版 Minecraft 自带运行时
  if (localAppData) {
    const msRoot = path.join(localAppData, 'Packages');
    try {
      for (const pkg of fs.readdirSync(msRoot, { withFileTypes: true })) {
        if (pkg.isDirectory() && /^Microsoft\.4297127D64EC6/i.test(pkg.name)) {
          walk(path.join(msRoot, pkg.name, 'LocalCache', 'Local', 'runtime'), 6);
        }
      }
    } catch {}
  }
  // PATH
  try {
    const result = execSync('where java', { encoding: 'utf8', timeout: 3000 });
    for (const l of result.trim().split('\n').map((x) => x.trim()).filter(Boolean)) addJava(out, seen, l);
  } catch {}
  _namedJavaCache = out.slice();
  _namedJavaAt = Date.now();
  return out;
}
// Bounded recursive walk: finds */bin/java.exe anywhere, prunes noise, depth/time/visit capped.
// Cooperative: yield to the event loop every batch so a full-drive scan never freezes the window.
const javaYield = () => new Promise((r) => setImmediate(r));
async function walkForJava(root, maxDepth, deadline, budget, out, seen) {
  const stack = [[root, maxDepth]];
  let sinceYield = 0;
  while (stack.length) {
    if (Date.now() > deadline || budget.n <= 0) return;
    if (++sinceYield >= 200) { sinceYield = 0; await javaYield(); }
    const [dir, depth] = stack.pop();
    budget.n--;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    let isJdk = false;
    for (const e of entries) {
      if (e.isDirectory() && e.name.toLowerCase() === 'bin') {
        const cand = path.join(dir, 'bin', 'java.exe');
        if (fs.existsSync(cand)) { addJava(out, seen, cand); isJdk = true; }
        break;
      }
    }
    if (isJdk || depth <= 0) continue;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const nm = e.name.toLowerCase();
      if (JAVA_PRUNE.has(nm)) continue;
      if (e.name.startsWith('$') || e.name.startsWith('.')) continue;
      stack.push([path.join(dir, e.name), depth - 1]);
    }
  }
}
let _deepJavaCache = null;
let _deepJavaPromise = null;
// Full-drive scan as a shared, cached, cooperative promise (never blocks the main process).
function deepScanJava() {
  if (_deepJavaCache) return Promise.resolve(_deepJavaCache);
  if (_deepJavaPromise) return _deepJavaPromise;
  _deepJavaPromise = (async () => {
    const out = collectNamedJava();
    const seen = new Set(out.map((p) => p.toLowerCase()));
    const deadline = Date.now() + 25000;
    const budget = { n: 250000 };
    for (const root of listAllDrives()) await walkForJava(root, 4, deadline, budget, out, seen);
    _deepJavaCache = out;
    _deepJavaPromise = null;
    return out;
  })().catch((e) => { _deepJavaPromise = null; throw e; });
  return _deepJavaPromise;
}
function startBackgroundJavaScan() { try { deepScanJava(); } catch {} }
// 用户手动导入的 Java（userData/custom-java.json，[{path,major}]），启动游戏与设置页都会合并识别
function customJavaFile() { return path.join(app.getPath('userData'), 'custom-java.json'); }
function readCustomJava() {
  try { const a = JSON.parse(fs.readFileSync(customJavaFile(), 'utf8')); return Array.isArray(a) ? a.filter((x) => x && x.path) : []; } catch { return []; }
}
function writeCustomJava(list) { fs.writeFileSync(customJavaFile(), JSON.stringify(list, null, 2), 'utf8'); }

// Synchronous entry used at launch: instant named scan + deep cache if ready.
function findJava() {
  const out = collectNamedJava();
  const seen = new Set(out.map((p) => p.toLowerCase()));
  if (_deepJavaCache) {
    for (const p of _deepJavaCache) addJava(out, seen, p);
  }
  for (const c of readCustomJava()) addJava(out, seen, c.path);
  startBackgroundJavaScan();
  return out;
}

// Detect a java executable's major version (8, 17, 25 ...), cached.
const _javaMajorCache = new Map();
// Infer JDK major from the install path (jre1.8.0_xxx / jdk-21.0.2 / temurin-17 / Java/17) so a
// launch never has to cold-start every discovered JVM just to read "-version". Falls back to spawn.
// Mojang 官方运行时组件目录名 -> Java 大版本（PCL/官方启动器装的 runtime 路径不含数字版本号，靠它直接判定，免去冷启动 spawn）
const MOJANG_RT_MAJOR = {
  'jre-legacy': 8, 'java-runtime-alpha': 16, 'java-runtime-beta': 17,
  'java-runtime-gamma': 17, 'java-runtime-delta': 21,
};
function inferMajorFromPath(javaExe) {
  const q = String(javaExe || '').replace(/\\/g, '/').toLowerCase();
  let m;
  for (const [comp, maj] of Object.entries(MOJANG_RT_MAJOR)) if (q.includes(comp)) return maj;
  if (/1[._]8[._]/.test(q) || /(?:jdk|jre)[-_]?8(?:[._]|$)/.test(q)) return 8;
  if ((m = /(?:jdk|jre|temurin|zulu|corretto|msopenjdk|openjdk)[-_]?(\d{1,2})(?=[._u/\\-]|$)/.exec(q))) return parseInt(m[1], 10);
  if ((m = /\/(\d{1,2})\.0\.\d+/.exec(q))) return parseInt(m[1], 10);
  if ((m = /\/java\/(\d{1,2})(?:\/|$)/.exec(q))) return parseInt(m[1], 10);
  // 任意形如 jre25 / jdk25 / jre-v64-xxxx 里紧贴的两位主版本号兜底
  if ((m = /(?:jdk|jre)[^0-9]{0,3}(\d{2})(?=[._/\\-]|$)/.exec(q))) return parseInt(m[1], 10);
  return 0;
}
function getJavaMajor(javaExe) {
  if (_javaMajorCache.has(javaExe)) return _javaMajorCache.get(javaExe);
  let major = inferMajorFromPath(javaExe);
  if (!major) {
    try {
      const r = require('child_process').spawnSync(javaExe, ['-version'], { encoding: 'utf8', timeout: 6000, windowsHide: true });
      const txt = ((r && (r.stderr || r.stdout)) || '');
      const m = txt.match(/version "(\d+)(?:\.(\d+))?/);
      if (m) {
        const first = parseInt(m[1], 10);
        major = first === 1 ? parseInt(m[2] || '0', 10) : first; // 1.8.0 -> 8
      }
    } catch {}
  }
  _javaMajorCache.set(javaExe, major);
  return major;
}
ipcMain.handle('get-java-major', async (_e, p) => ({ major: getJavaMajor(p) }));

// Scan every installed JDK and return [{path,major}], best candidate first for `required`.
function listJavaWithVersion() {
  const all = [];
  for (const p of findJava()) {
    if (!fs.existsSync(p)) continue;
    const major = getJavaMajor(p);
    if (!all.some((x) => x.path.toLowerCase() === p.toLowerCase())) all.push({ path: p, major });
  }
  return all;
}
function pickJavaFor(preferred, required) {
  const cands = [];
  if (preferred && fs.existsSync(preferred)) cands.push({ path: preferred, major: getJavaMajor(preferred) });
  for (const x of listJavaWithVersion()) {
    if (!cands.some((c) => c.path.toLowerCase() === x.path.toLowerCase())) cands.push(x);
  }
  const usable = cands.filter((x) => !x.major || x.major >= required);
  usable.sort((a, b) => {
    // prefer the lowest major that still satisfies (avoid over-new), prefer configured
    const av = a.major || 999, bv = b.major || 999;
    if (av !== bv) return av - bv;
    if (a.path === preferred) return -1;
    if (b.path === preferred) return 1;
    return 0;
  });
  return usable[0] || null;
}
// Find bin/java.exe inside a folder (shallow), used after extracting a downloaded JRE.
function findJavaExeUnder(dir, depth) {
  if (!fs.existsSync(dir)) return '';
  const direct = path.join(dir, 'bin', 'java.exe');
  if (fs.existsSync(direct)) return direct;
  if (depth <= 0) return '';
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return ''; }
  for (const e of entries) {
    if (e.isDirectory()) { const hit = findJavaExeUnder(path.join(dir, e.name), depth - 1); if (hit) return hit; }
  }
  return '';
}
const _jrePromises = new Map();
// Download + extract a matching Temurin (Adoptium) JRE into userData/jres/jre<major> once, cached thereafter.
// 清华 Adoptium 镜像目录里挑版本号最大的 windows-x64 JRE zip。
// 直连国内镜像，避开 api.adoptium.net 307 跳 GitHub releases（国内常 ETIMEDOUT 20.205.x.x）。
async function pickTunaJreUrl(major) {
  try {
    const dir = `https://mirrors.tuna.tsinghua.edu.cn/Adoptium/${major}/jre/x64/windows/`;
    const html = (await httpGetBuffer(dir, { timeoutMs: 8000 })).toString('utf8');
    const names = [...html.matchAll(/OpenJDK\d+U-jre_x64_windows_hotspot_[^"'<>\s]+\.zip/g)].map((m) => m[0]);
    if (!names.length) return '';
    const key = (s) => s.replace(/\D+/g, ' ').trim().split(/\s+/).map((x) => x.padStart(4, '0')).join('.');
    names.sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
    return dir + names[0];
  } catch { return ''; }
}
// Temurin 未发布某大版本（如 Java16）时改用可兼容的下一大版本（映射表里 16->17，高版本能运行低字节码）
async function ensureJavaRuntime(major, sendLP) {
  const fallbacks = JAVA_RT_MAP.downloadFallbackMajor || {};
  const tryMajors = [...new Set([Number(major), Number(fallbacks[String(major)])].filter((x) => x && !Number.isNaN(x)))];
  let lastErr;
  for (const mj of tryMajors) { try { return await ensureJavaRuntimeOnce(mj, sendLP, Number(major)); } catch (e) { lastErr = e; } }
  throw lastErr || new Error('Java 运行环境下载失败');
}
async function ensureJavaRuntimeOnce(major, sendLP, wantMajor) {
  const label = wantMajor && wantMajor !== major ? `${wantMajor}（兼容 JRE ${major}）` : `${major}`;
  const base = path.join(app.getPath('userData'), 'jres', 'jre' + major);
  const cached = findJavaExeUnder(base, 2);
  if (cached) return cached;
  if (_jrePromises.has(major)) return _jrePromises.get(major);
  const p = (async () => {
    try {
      fs.mkdirSync(base, { recursive: true });
      // 国内清华镜像优先，Adoptium 官方（会跳 GitHub）兜底
      const candidates = [];
      const tuna = await pickTunaJreUrl(major);
      if (tuna) candidates.push(tuna);
      candidates.push(`https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/x64/jre/hotspot/normal/eclipse`);
      const zip = path.join(require('os').tmpdir(), `glow_jre${major}_${Date.now()}.zip`);
      sendLP && sendLP(`本机缺少 Java ${label}，正在自动下载兼容运行环境…`, 6, `JRE ${major}`);
      let okDl = false, dlErr;
      for (const u of candidates) {
        try { await downloadFileTo(u, zip, 2); okDl = true; break; }
        catch (e) { dlErr = e; try { fs.unlinkSync(zip); } catch {} }
      }
      if (!okDl) throw dlErr || new Error('所有 Java 下载源均不可用，请检查网络或手动安装对应 JDK');
      sendLP && sendLP('正在解压 Java 运行环境…', 12, '');
      const { spawnSync } = require('child_process');
      let ok = false;
      try { const r = spawnSync('tar.exe', ['-xf', zip, '-C', base], { windowsHide: true }); ok = r.status === 0; } catch { ok = false; }
      if (!ok) {
        const pr = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Expand-Archive -Force -LiteralPath "' + zip + '" -DestinationPath "' + base + '"'], { windowsHide: true });
        ok = pr.status === 0;
      }
      try { fs.unlinkSync(zip); } catch {}
      const exe = findJavaExeUnder(base, 3);
      if (!exe) throw new Error('JRE 解压后未找到 java.exe');
      return exe;
    } finally { _jrePromises.delete(major); }
  })();
  _jrePromises.set(major, p);
  return p;
}

ipcMain.handle('list-java', async (_e, arg) => {
  // Full-drive deep scan for the settings UI (cached; pass {force:true} to rescan).
  if (arg && arg.force) { _deepJavaCache = null; _deepJavaPromise = null; }
  const all = [];
  const push = (p, major, custom) => {
    if (!fs.existsSync(p)) return;
    const mj = major || getJavaMajor(p);
    if (!all.some((x) => x.path.toLowerCase() === p.toLowerCase())) all.push({ path: p, major: mj, custom: !!custom });
  };
  for (const p of await deepScanJava()) push(p, getJavaMajor(p), false);
  for (const c of readCustomJava()) push(c.path, c.major, true);
  return { javas: all };
});

// 手动导入：弹文件选择器选 java.exe，校验大版本后持久化
let importJavaBusy = false;
ipcMain.handle('import-java', async () => {
  if (importJavaBusy) return { success: false, canceled: true }; // 防重入：不重复弹原生对话框
  importJavaBusy = true;
  try {
  const r = await dialog.showOpenDialog({
    title: '选择要导入的 java.exe',
    properties: ['openFile'],
    filters: [{ name: 'Java 可执行文件', extensions: ['exe'] }],
  });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { success: false, canceled: true };
  const p = path.resolve(r.filePaths[0]);
  if (!/^java(w)?\.exe$/i.test(path.basename(p))) return { success: false, error: '请选择 JDK/JRE 的 bin 目录下的 java.exe' };
  if (!fs.existsSync(p)) return { success: false, error: '文件不存在' };
  const major = getJavaMajor(p);
  if (!major) return { success: false, error: '无法识别该 Java 的版本，请确认选择的是有效的 java.exe' };
  const list = readCustomJava();
  if (list.some((x) => x.path.toLowerCase() === p.toLowerCase())) return { success: false, error: '该 Java 已在列表中', exists: true, major };
  list.push({ path: p, major });
  writeCustomJava(list);
  _javaMajorCache.set(p, major);
  return { success: true, path: p, major };
  } finally { importJavaBusy = false; }
});

ipcMain.handle('remove-custom-java', async (_e, p) => {
  if (!p || typeof p !== 'string') return { success: false };
  const list = readCustomJava().filter((x) => x.path.toLowerCase() !== String(p).toLowerCase());
  writeCustomJava(list);
  return { success: true };
});


ipcMain.handle('find-java', () => {
  return { paths: findJava() };
});

// 枚举所有可能的 Minecraft 根目录（游戏常被放到自定义盘，如 D:\.minecraft）
function enumerateMcRoots(gameDirIn, versionId) {
  const roots = [];
  const pushRoot = (r) => { if (r && !roots.includes(r)) roots.push(r); };
  if (gameDirIn) {
    let r = gameDirIn;
    if (!path.isAbsolute(r)) r = path.join(app.getPath('appData'), r);
    pushRoot(r);
    if (path.basename(r) === versionId && path.basename(path.dirname(r)) === 'versions') pushRoot(path.dirname(path.dirname(r)));
    if (path.basename(r).toLowerCase() === 'versions') pushRoot(path.dirname(r));
  }
  pushRoot(path.join(app.getPath('appData'), '.minecraft'));
  // 所有固定盘根下的 .minecraft（C..Z），覆盖自定义下载盘
  for (let code = 67; code <= 90; code++) {
    const drv = String.fromCharCode(code) + ':\\.minecraft';
    try { if (fs.existsSync(drv)) pushRoot(drv); } catch {}
  }
  return roots;
}
// 递归清只读/隐藏属性
function clearReadOnly(dir) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of ents) {
    const p = path.join(dir, ent.name);
    try { fs.chmodSync(p, 0o666); } catch {}
    if (ent.isDirectory()) clearReadOnly(p);
  }
  try { fs.chmodSync(dir, 0o666); } catch {}
}
// 探测是否有文件被进程独占锁定：用 'r'（只读）而非 'r+'（读写）。
// 'r+' 会因只读属性/杀软短暂打开的句柄就误报；'r' 只在文件被真正独占（拒绝共享读，如运行中游戏锁定的 dll）时失败。
function findLockedFile(dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const ent of ents) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { const hit = findLockedFile(p); if (hit) return hit; }
    else { try { const fd = fs.openSync(p, 'r'); fs.closeSync(fd); } catch { return p; } }
  }
  return null;
}
// 检测 java/javaw 进程是否仍在运行（决定“文件占用”提示给谁看）
function javaProcesses() {
  try {
    const out = require('child_process').execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process javaw,java -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName -Unique'],
      { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    return String(out || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((n) => n.toLowerCase().replace(/\.exe$/i, ''));
  } catch { return []; }
}
// 鲁棒强制删除：清属性 -> Node rm -> PowerShell(\\?\ 长路径) -> cmd rd(\\?\)。返回 '' 表示成功，否则错误原因。
function rmrfRobust(target) {
  clearReadOnly(target);
  try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 }); } catch (e1) {
    try {
      // \\?\ 前缀绕过 260 字符 MAX_PATH 限制
      const longPath = '\\\\?\\' + path.resolve(target);
      const lit = longPath.replace(/'/g, "''");
      require('child_process').execFileSync('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `Remove-Item -LiteralPath '${lit}' -Recurse -Force -ErrorAction Stop`],
        { windowsHide: true, stdio: 'ignore', timeout: 30000 });
    } catch (e2) {
      try {
        const longPath = ('\\\\?\\' + path.resolve(target)).replace(/\//g, '\\');
        require('child_process').execFileSync('cmd.exe', ['/c', 'rd', '/s', '/q', longPath], { windowsHide: true, stdio: 'ignore', timeout: 30000 });
      } catch (e3) {
        return String((e1 && e1.message) || e1);
      }
    }
  }
  return fs.existsSync(target) ? '目录仍存在，可能有文件被占用或权限不足' : '';
}
ipcMain.handle('delete-version', async (_e, opts) => {
  try {
    const gameDirIn = opts && opts.gameDir;
    const versionId = opts && opts.versionId;
    if (!versionId || typeof versionId !== 'string' || /[\\/]|\.\./.test(versionId)) {
      return { success: false, error: '非法版本名' };
    }
    const roots = enumerateMcRoots(gameDirIn, versionId);
    let target = '';
    for (const r of roots) {
      const cand = path.join(r, 'versions', versionId);
      if (fs.existsSync(cand)) { target = cand; break; }
      if (path.basename(r) === versionId && path.basename(path.dirname(r)) === 'versions' && fs.existsSync(r)) { target = r; break; }
    }
    if (!target) return { success: true, removed: false, notFound: true };
    // Safety: target must be inside a 'versions' directory.
    if (path.basename(path.dirname(target)) !== 'versions') {
      return { success: false, error: '拒绝删除非版本目录' };
    }
    // 直接强删（rmrfRobust 内部已清只读并重试 3 次）；残留多为瞬时占用（杀软扫描/索引），
    // 间隔重试 2 次再下结论，避免“没启动游戏却报被占用”。
    let err = rmrfRobust(target);
    let gone = !fs.existsSync(target);
    for (let i = 0; !gone && i < 2; i++) {
      await new Promise((r) => setTimeout(r, 800));
      err = rmrfRobust(target);
      gone = !fs.existsSync(target);
    }
    if (gone) return { success: true, removed: true, path: target };
    const locked = findLockedFile(target);
    const procs = javaProcesses();
    if (locked && procs.length) {
      return { success: false, error: `文件被占用（${path.basename(locked)}），检测到游戏进程仍在运行（${procs.join('、')}），请先完全退出游戏后再删除` };
    }
    if (locked) {
      return { success: false, error: `文件被占用（${path.basename(locked)}）。当前未检测到游戏进程，可能是杀毒软件/系统索引正在扫描，请稍候重试或重启启动器后再删除` };
    }
    return { success: false, error: err || '删除失败，可能是权限不足' };
  } catch (err) {
    return { success: false, error: String((err && err.message) || err) };
  }
});

// The currently running launch, so 'launch-cancel' can reach its JVM child + window watcher.
let activeLaunch = null;
// Games whose window is up (survives activeLaunch being cleared), keyed by JVM pid for the
// in-launcher floating "stop game" button.
const runningGames = new Map();
function broadcastRunning() {
  try { mainWindow && mainWindow.webContents.send('game-running-changed', Array.from(runningGames.values())); } catch {}
}
ipcMain.handle('game-running-list', () => Array.from(runningGames.values()));
ipcMain.handle('game-kill', async (_e, pid) => {
  const targets = pid ? [Number(pid)] : Array.from(runningGames.keys());
  if (!targets.length) return { success: false, error: '当前没有运行中的游戏' };
  const { execFileSync } = require('child_process');
  for (const p of targets) {
    try { execFileSync('taskkill', ['/PID', String(p), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
    runningGames.delete(p);
  }
  broadcastRunning();
  return { success: true };
});
// authlib-injector 按需下载到 userData（约 340KB，不打进安装包），供外置账号启动时 -javaagent 注入。
let _authlibJarPromise = null;
function ensureAuthlibInjector() {
  if (_authlibJarPromise) return _authlibJarPromise;
  _authlibJarPromise = (async () => {
    const jar = path.join(app.getPath('userData'), 'authlib-injector.jar');
    if (fs.existsSync(jar) && fs.statSync(jar).size > 1000) return jar;
    const meta = await httpGetJson('https://authlib-injector.yushi.moe/artifact/latest.json', { timeoutMs: 8000 });
    const buf = await httpGetBuffer(meta.download_url, { timeoutMs: 25000 });
    fs.writeFileSync(jar, buf);
    return jar;
  })().catch((e) => { _authlibJarPromise = null; throw e; });
  return _authlibJarPromise;
}

// ============ 启动期确保本地库（natives）就位 ============
// 安装期解压可能失败（旧版 bug / 被杀软拦截 / Expand-Archive 静默失败），导致 LWJGL
// UnsatisfiedLinkError、游戏秒退(exit:0)。启动时按当前系统/架构收集原生 jar，缺失即下载，
// 再用系统自带 tar.exe 解压（Win10 1803+ 自带，基于 libarchive 支持 zip/jar），错误正常抛出。
// 不引入额外 npm 依赖，避免 asar 打包遗漏导致主进程启动即崩。
function extractNativeJar(jarPath, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(dest, { recursive: true });
    const tarBin = process.platform === 'win32' ? 'tar.exe' : 'tar';
    const child = spawn(tarBin, ['-xf', jarPath, '-C', dest], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`tar 解压失败 (exit ${code}): ${stderr.trim()}`));
      resolve();
    });
  });
}

async function ensureLaunchNatives({ versionJson, libsDir, nativesDir, source, sendLP, tick }) {
  const osKey = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'x86' : 'x64';
  const jobs = [];
  for (const lib of (versionJson.libraries || [])) {
    if (!lib.natives || !lib.natives[osKey]) continue;
    const classifier = String(lib.natives[osKey]).replace('${arch}', arch);
    let rel = null; let rawUrl = null;
    if (lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[classifier]) {
      const cl = lib.downloads.classifiers[classifier];
      rel = cl.path; rawUrl = cl.url;
    } else {
      // 旧版 Maven 约定：org.lwjgl.lwjgl:lwjgl-platform / net.java.jinput:jinput-platform
      const pp = String(lib.name || '').split(':');
      if (pp.length < 3) continue;
      const art = /-platform$/.test(pp[1]) ? pp[1] : pp[1] + '-platform';
      const platformName = [pp[0], art, pp[2], classifier].join(':');
      rel = mavenNameToPath(platformName);
      const repo = (lib.url || 'https://libraries.minecraft.net/').replace(/\/?$/, '/');
      rawUrl = rel ? repo + rel : null;
    }
    if (rel && rawUrl) jobs.push({ rel, rawUrl, excludes: (lib.extract && lib.extract.exclude) || [] });
  }
  if (!jobs.length) return 0;
  fs.mkdirSync(nativesDir, { recursive: true });
  let extracted = 0;
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
    const jarPath = path.join(libsDir, j.rel);
    const needDownload = !(fs.existsSync(jarPath) && fs.statSync(jarPath).size > 0);
    if (needDownload) {
      sendLP && sendLP('正在补全本地库文件…', 7, path.basename(j.rel));
      await tick();
      const cands = [...new Set([
        rewriteDownloadUrl(j.rawUrl, source === 'official' ? 'bmcl' : 'bmcl'),
        j.rawUrl,
      ])];
      let ok = false; let lastErr = null;
      for (const u of cands) {
        try { await downloadFileTo(u, jarPath, 2); ok = true; break; }
        catch (e) { lastErr = e; }
      }
      if (!ok) throw new Error('本地库下载失败：' + j.rel + '（' + ((lastErr && lastErr.message) || lastErr) + '）');
    }
    try {
      extracted += await extractNativeJar(jarPath, nativesDir, j.excludes);
    } catch (e) {
      throw new Error('本地库解压失败：' + j.rel + '（' + ((e && e.message) || e) + '）');
    }
  }
  return extracted;
}

ipcMain.handle('launch-game', async (_event, opts) => {
  const { javaPath, gameDir: gameDirRaw, versionId, username, uuid, accessToken, userType, jvmArgs, maxMemory, minMemory } = opts;
  // 外置(Yggdrasil)账号：启动时用 authlib-injector 把认证/皮肤指向其皮肤站，游戏内才显示其皮肤披风
  const externalApiRoot = (opts.accountType === 'external' && typeof opts.externalServer === 'string') ? opts.externalServer.replace(/\/+$/, '') : '';
  const versionIsolation = !!opts.versionIsolation;
  // Cancellation handle: launch-cancel flips this and tears down the spawned JVM + window watcher.
  const abort = { cancelled: false, child: null, watcher: null, finishWait: null };
  activeLaunch = abort;
  try {
    const { spawn } = require('child_process');
    // Yield to the event loop between blocking steps so the window never freezes ("not responding")
    // and progress events reach the renderer before heavy synchronous work runs.
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    const sendLP = (stage, percent, detail) => {
      try { _event.sender.send('game-launch-progress', { stage, percent: Math.max(0, Math.min(100, Math.round(percent))), detail: detail || '' }); } catch {}
    };
    sendLP('正在准备游戏环境…', 2, '');
    await tick();
    // Resolve the game root: accept relative ".minecraft", absolute roots, and stored paths
    // that already point at ".../versions/<id>" (drag-drop imports).
    let gameDir = gameDirRaw;
    if (!gameDir) return { success: false, error: '未设置游戏目录，请先下载或导入版本' };
    if (!path.isAbsolute(gameDir)) gameDir = path.join(app.getPath('appData'), gameDir);
    {
      const segs = gameDir.split(/[\\/]/);
      if (segs.length >= 2 && segs[segs.length - 2] === 'versions' && segs[segs.length - 1] === versionId) {
        gameDir = path.dirname(path.dirname(gameDir));
      }
    }
    // Effective run dir: the per-version folder when isolation is enabled or the imported
    // instance already looks isolated (has its own mods/saves/config/options.txt).
    const runDir = resolveRunDir(gameDir, versionId, versionIsolation);
    try { fs.mkdirSync(runDir, { recursive: true }); } catch {}
    // Auto-switch the game to Simplified Chinese on first launch (merge, never clobber options.txt).
    ensureChineseLang(runDir);
    // Java is finalized by auto-detection below once the required version is known.
    let java = (javaPath && fs.existsSync(javaPath)) ? javaPath : "";
    if (!fs.existsSync(gameDir)) {
      return { success: false, error: '游戏目录不存在：' + gameDir + '，请先下载版本，或在设置中指定正确的 .minecraft 目录' };
    }

    const versionJsonPath = path.join(gameDir, 'versions', versionId, `${versionId}.json`);
    const versionJarPath = path.join(gameDir, 'versions', versionId, `${versionId}.jar`);
    if (!fs.existsSync(versionJsonPath)) return { success: false, error: `版本配置文件不存在: ${versionJsonPath}` };
    if (!fs.existsSync(versionJarPath)) return { success: false, error: '游戏核心文件不存在，请重新下载版本' };

    const versionJson = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
    // 官方 JSON 的 javaVersion 优先；导入版本常缺该字段，用权威映射按版本号兜底，取两者较大值避免低估
    const javaFromJson = parseInt(versionJson.javaVersion && versionJson.javaVersion.majorVersion, 10) || 0;
    const requiredJava = Math.max(javaFromJson, requiredJavaForVersion(versionId));
    sendLP('正在检测合适的 Java 运行环境…', 5, `需要 Java ${requiredJava}+`);
    await tick();
    // Single scan: pick the lowest installed JDK that still satisfies. Build the full diagnostic
    // list only when nothing qualifies (so a normal launch avoids a second full scan).
    let picked = pickJavaFor(java, requiredJava);
    const detected = picked ? [] : listJavaWithVersion();
    await tick();
    let javaMajorNow = picked ? picked.major : 0;
    if (!picked) {
      // No qualifying JVM installed: auto-provision a matching JRE instead of failing the launch.
      try {
        sendLP(`未检测到合适的 Java，正在自动安装 Java ${requiredJava} 运行环境…`, 6, '');
        const autoJava = await ensureJavaRuntime(requiredJava, sendLP);
        _javaMajorCache.set(autoJava, requiredJava);
        picked = { path: autoJava, major: requiredJava };
      } catch (je) {
        const have = detected.length ? detected.map((d) => `Java ${d.major || '?'}（${d.path}）`).join('；') : '未检测到任何 Java';
        return { success: false, error: `该版本需要 Java ${requiredJava} 或更高，自动下载 Java 失败（${(je && je.message) || je}）。已检测到：${have}。可检查网络后重试，或手动安装对应 JDK。` };
      }
    }
    java = picked.path;
    javaMajorNow = picked.major;
    const libsDir = path.join(gameDir, 'libraries');
    const nativesDir = path.join(gameDir, 'versions', versionId, 'natives');
    fs.mkdirSync(nativesDir, { recursive: true });
    // 启动前确保本地库就位：缺失即下载并解压，根治远古版/LWJGL UnsatisfiedLinkError 秒退。
    sendLP('正在检查本地库（natives）…', 7, '');
    await tick();
    try {
      await ensureLaunchNatives({ versionJson, libsDir, nativesDir, source: 'bmcl', sendLP, tick });
    } catch (ne) {
      return { success: false, error: String((ne && ne.message) || ne) };
    }
    const assetsDir = path.join(gameDir, 'assets');
    const sep = process.platform === 'win32' ? ';' : ':';
    const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
    const curArch = process.arch === 'ia32' ? 'x86' : process.arch; // x64 | arm64 | x86
    // Modern MC ships per-arch natives as separate Maven classifiers; keep current arch only.
    const nativesArchOk = (libName) => {
      const m = /:natives-[a-z]+(?:-([a-z0-9]+))?$/.exec(libName || '');
      if (!m) return true;
      let a = m[1] || 'x64'; // bare ":natives-windows" is the x64 build
      if (a === 'amd64') a = 'x64';
      return a === curArch;
    };

    const rulesAllow = (rules) => {
      if (!rules) return true;
      let allowed = false;
      for (const rule of rules) {
        let applies = true;
        if (rule.os) {
          applies = rule.os.name === osName;
          if (applies && rule.os.arch && rule.os.arch !== curArch) applies = false;
        }
        if (rule.features) applies = false; // demo / custom resolution features not enabled
        if (applies) allowed = rule.action === 'allow';
      }
      return allowed;
    };

    sendLP('正在校验游戏库文件…', 7, '');
    await tick();
    // Build classpath from libraries that pass OS/arch rules; fail fast on missing files
    const classpath = [versionJarPath];
    const missingLibs = [];
    const cpMap = new Map();
    for (const lib of (versionJson.libraries || [])) {
      if (!rulesAllow(lib.rules)) continue;
      if (!nativesArchOk(lib.name)) continue;
      const rel = libArtifactRel(lib);
      if (!rel) continue;
      const libPath = path.join(libsDir, rel);
      if (fs.existsSync(libPath) && fs.statSync(libPath).size > 0) {
        // Dedupe per group:artifact:classifier; later entries win so Forge pins override vanilla.
        const pp = String(lib.name || '').split(':');
        const key = pp.length >= 3 ? (pp[0] + ':' + pp[1] + ':' + (pp[3] || '')) : rel;
        cpMap.set(key, libPath);
      } else missingLibs.push(lib.name);
    }
    for (const cpVal of cpMap.values()) if (!classpath.includes(cpVal)) classpath.push(cpVal);
    await tick();
    if (missingLibs.length) {
      return { success: false, error: '游戏文件不完整，缺少 ' + missingLibs.length + ' 个库文件（例如 ' + missingLibs.slice(0, 3).join('、') + '）。请删除该版本后重新下载，下载过程中不要关闭启动器。', missing: missingLibs.slice(0, 20) };
    }
    const cpArg = classpath.join(sep);

    // Placeholder substitution
    const substMap = {
      natives_directory: nativesDir,
      launcher_name: 'GlowstoneLauncher',
      launcher_version: app.getVersion(),
      classpath: cpArg,
      classpath_separator: sep,
      library_directory: libsDir,
      auth_player_name: username || 'Player',
      version_name: versionId,
      game_directory: runDir,
      assets_root: assetsDir,
      game_assets: assetsDir,
      assets_index_name: versionJson.assetIndex ? versionJson.assetIndex.id : 'legacy',
      auth_uuid: uuid || '00000000-0000-0000-0000-000000000000',
      auth_access_token: accessToken || '0',
      auth_session: `token:${accessToken || '0'}:${uuid || '00000000-0000-0000-0000-000000000000'}`,
      user_type: userType || 'msa',
      version_type: versionJson.type || 'release',
      clientid: '',
      auth_xuid: '',
      user_properties: '{}',
      resolution_width: '854',
      resolution_height: '480',
    };
    const subst = (s) => typeof s === 'string' ? s.replace(/\$\{([^}]+)\}/g, (_, k) => (k in substMap ? substMap[k] : '')) : s;

    // ---- JVM args ----
    // Sanitize memory so a bad value can never break JVM creation.
    const totalRamMB = Math.floor(require('os').totalmem() / 1024 / 1024);
    let xmx = parseInt(maxMemory, 10) || 2048;
    let xms = parseInt(minMemory, 10) || 512;
    if (!Number.isFinite(xmx) || xmx < 512) xmx = 2048;
    if (!Number.isFinite(xms) || xms < 128) xms = 512;
    // never ask for more than ~90% of physical RAM, and keep min <= max
    const cap = Math.max(1024, Math.floor(totalRamMB * 0.9));
    if (xmx > cap) xmx = cap;
    if (xms > xmx) xms = Math.min(512, xmx);
    const jvmOut = [`-Xmx${xmx}M`, `-Xms${xms}M`];
    let usedModernJvm = false;
    if (Array.isArray(versionJson.arguments && versionJson.arguments.jvm)) {
      for (const entry of versionJson.arguments.jvm) {
        if (typeof entry === 'string') jvmOut.push(subst(entry));
        else if (entry && rulesAllow(entry.rules)) jvmOut.push(subst(entry.value));
      }
      usedModernJvm = true;
    }
    if (!usedModernJvm) {
      jvmOut.push(`-Djava.library.path=${nativesDir}`, '-cp', cpArg);
    }
    // --add-opens is only valid on Java 9+; on Java 8 it FATALLY prevents JVM creation.
    if (!javaMajorNow || javaMajorNow >= 9) {
      const addOpens = [
        '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
        '--add-opens', 'java.base/java.io=ALL-UNNAMED',
        '--add-opens', 'java.base/java.util=ALL-UNNAMED',
        '--add-opens', 'java.base/java.util.concurrent=ALL-UNNAMED',
        '--add-opens', 'java.base/java.net=ALL-UNNAMED',
        '--add-opens', 'java.base/jdk.internal.misc=ALL-UNNAMED',
        '--add-opens', 'java.base/sun.nio.ch=ALL-UNNAMED',
        '--add-opens', 'java.base/jdk.internal.loader=ALL-UNNAMED',
        '--add-opens', 'java.base/java.lang.reflect=ALL-UNNAMED',
        '--add-opens', 'java.naming/javax.naming=ALL-UNNAMED',
      ];
      jvmOut.splice(2, 0, ...addOpens);
    }
    if (jvmArgs) jvmOut.push(...jvmArgs.split(/\s+/).map(s => s.trim()).filter(Boolean));
    // 启动速度/运行流畅度优化：仅在用户与版本 JSON 未显式指定同名参数时追加，不覆盖既有配置
    const perfFlags = ['-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:+DisableExplicitGC', '-Dfile.encoding=UTF-8'];
    const jvmFlagKey = (f) => { const i = f.indexOf('='); return (i >= 0 ? f.slice(0, i) : f).toLowerCase(); };
    const haveJvmFlags = new Set(jvmOut.map(jvmFlagKey));
    for (const pf of perfFlags) if (!haveJvmFlags.has(jvmFlagKey(pf))) jvmOut.push(pf);

    // ---- Main class ----
    // 外置账号：在主类之前挂 authlib-injector（JVM 参数必须位于 main class 之前），
    // 让游戏向其皮肤站认证并加载该账号的皮肤/披风。下载失败不阻断启动。
    if (externalApiRoot) {
      try {
        sendLP('正在准备外置登录组件…', 12, 'authlib-injector');
        await tick();
        const agentJar = await ensureAuthlibInjector();
        jvmOut.push(`-javaagent:${agentJar}=${externalApiRoot}`, '-Dauthlibinjector.side=client');
      } catch (ae) {
        try { const lp = path.join(runDir, `glowstone-launch-${versionId}.log`); fs.appendFileSync(lp, `[Glowstone] authlib-injector 准备失败，游戏内将使用默认皮肤: ${(ae && ae.message) || ae}\n`); } catch {}
      }
    }
    const mainClass = versionJson.mainClass || 'net.minecraft.client.main.Main';
    jvmOut.push(mainClass);

    // ---- Game args ----
    const gameOut = [];
    if (Array.isArray(versionJson.arguments && versionJson.arguments.game)) {
      for (const entry of versionJson.arguments.game) {
        if (typeof entry === 'string') gameOut.push(subst(entry));
        else if (entry && rulesAllow(entry.rules)) {
          const v = entry.value;
          if (Array.isArray(v)) v.forEach(x => gameOut.push(subst(x))); else gameOut.push(subst(v));
        }
      }
    } else if (typeof versionJson.minecraftArguments === 'string') {
      for (const tok of versionJson.minecraftArguments.split(/\s+/)) gameOut.push(subst(tok));
    } else {
      gameOut.push('--username', substMap.auth_player_name, '--version', versionId, '--gameDir', runDir,
        '--assetsDir', assetsDir, '--assetIndex', substMap.assets_index_name, '--uuid', substMap.auth_uuid,
        '--accessToken', substMap.auth_access_token, '--userType', substMap.user_type, '--versionType', substMap.version_type);
    }

    const allArgs = [...jvmOut, ...gameOut];

    // Launch progress + log
    sendLP('正在准备启动参数…', 8, versionId);
    let logStream = null;
    try { logStream = fs.createWriteStream(path.join(runDir, `glowstone-launch-${versionId}.log`), { flags: 'w' }); } catch {}
    if (logStream) { logStream.write(`[Glowstone] java: ${java}\n[Glowstone] args:\n${allArgs.join('\n')}\n\n`); }

    // Prefer javaw (windowless) so no console box appears and the only window is the game.
    let javaExe = java;
    try {
      const javaw = java.replace(/[\\/]java\.exe$/i, m => m.replace(/java\.exe$/i, 'javaw.exe'));
      if (javaw !== java && fs.existsSync(javaw)) javaExe = javaw;
    } catch {}

    sendLP('正在启动 Java 虚拟机...', 22, '');
    const child = spawn(javaExe, allArgs, { cwd: runDir, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    abort.child = child;
    const pid = child.pid;
    let exited = null;
    let lastPct = 22;
    const bump = (pct, stage) => { if (pct > lastPct) { lastPct = pct; sendLP(stage, pct, ''); } };
    const onLine = (buf) => {
      const text = buf.toString();
      if (logStream) logStream.write(text);
      const t = text.toLowerCase();
      if (t.includes('lwjgl version') || t.includes('backend library') || t.includes('using lwjgl')) bump(42, '正在加载游戏引擎 LWJGL...');
      else if (t.includes('openal') || t.includes('sound engine started')) bump(58, '正在初始化音频...');
      else if (t.includes('reloading resource') || t.includes('created:') || t.includes('atlas') || t.includes('texture')) bump(70, '正在加载资源与纹理...');
      else if (t.includes('setting user') || t.includes('narrator') || t.includes('realms')) bump(82, '即将进入游戏主界面...');
    };
    child.stdout && child.stdout.on('data', onLine);
    child.stderr && child.stderr.on('data', onLine);
    child.on('error', (e) => { exited = 'spawn_error:' + ((e && e.message) || e); });
    child.on('exit', (code) => {
      exited = (code === 0 || code === null) ? ('exit:' + code) : ('crash:' + code);
      if (runningGames.delete(pid)) broadcastRunning();
      if (logStream) { logStream.write(`\n[Glowstone] game exited code=${code}\n`); logStream.end(); }
    });
    child.unref(); // game survives launcher closing

    // Wait until the REAL game window appears (or the JVM dies).
    // Locale-independent: watch MainWindowHandle (0 == no top-level window) through ONE
    // persistent hidden PowerShell, instead of parsing localized `tasklist` text.
    const windowAppeared = () => new Promise((resolve) => {
      let settled = false;
      let watcher = null;
      const done = (r) => { if (!settled) { settled = true; finish(); resolve(r); } };
      function finish() { clearInterval(exitCheck); clearInterval(nudge); clearTimeout(timer); try { watcher && watcher.kill(); } catch {} }
      const psScript =
        `$t=${pid}; while($true){ ` +
        `$p=Get-Process -Id $t -ErrorAction SilentlyContinue; ` +
        `if(-not $p){ [Console]::Out.WriteLine('EXITED'); break }; ` +
        `$h=$p.MainWindowHandle; if($h -ne 0){ [Console]::Out.WriteLine('WINDOW'); [Console]::Out.WriteLine('TITLE:'+$p.MainWindowTitle); break }; ` +
        `Start-Sleep -Milliseconds 200 }`;
      try { watcher = require('child_process').spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], { windowsHide: true }); } catch {}
      abort.watcher = watcher;
      abort.finishWait = () => done({ ok: false, reason: 'cancelled' });
      if (watcher) {
        let buf = '';
        watcher.stdout && watcher.stdout.on('data', (d) => {
          buf += d.toString();
          if (buf.includes('WINDOW')) { const mt = /TITLE:(.*)/.exec(buf); done({ ok: true, title: mt ? mt[1].trim() : '' }); }
          else if (buf.includes('EXITED')) done({ ok: false, reason: exited || 'process-exited' });
        });
        watcher.on('error', () => {});
        watcher.unref();
      }
      // Belt & suspenders: catch direct child exit.
      const exitCheck = setInterval(() => { if (exited) done({ ok: false, reason: exited }); }, 200);
      // Progress nudge while waiting for the window.
      const nudge = setInterval(() => { if (lastPct < 88) { lastPct = Math.min(88, lastPct + 0.4); sendLP('正在等待游戏窗口出现...', lastPct, ''); } }, 600);
      const timer = setTimeout(() => done({ ok: false, reason: 'timeout（游戏窗口 150 秒内未出现）' }), 150000);
    });

    const result = await windowAppeared();
    if (abort.cancelled) {
      try { abort.child && process.platform === 'win32' && require('child_process').execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); } catch {}
      try { abort.child && abort.child.kill(); } catch {}
      sendLP('已取消启动', 100, '');
      return { success: false, cancelled: true, error: '已取消启动' };
    }
    if (!result.ok) {
      let tail = '';
      try {
        const lp = path.join(gameDir, `glowstone-launch-${versionId}.log`);
        if (fs.existsSync(lp)) tail = fs.readFileSync(lp, 'utf8').split(/\r?\n/).slice(-35).join('\n');
      } catch {}
      sendLP('游戏启动失败', 100, result.reason);
      return { success: false, error: `游戏窗口未出现（${result.reason}），请查看启动日志`, pid, logTail: tail };
    }
    sendLP('游戏窗口已出现，启动完成', 100, result.title);
    runningGames.set(pid, { pid, versionId, title: result.title || versionId, startedAt: Date.now() });
    broadcastRunning();
    return { success: true, pid, javaPath: javaExe, windowTitle: result.title, argCount: allArgs.length };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  } finally {
    if (activeLaunch === abort) activeLaunch = null;
  }
});

// Cancel an in-flight game launch: kill the spawned JVM tree and release the window watcher.
ipcMain.handle('launch-cancel', async () => {
  const a = activeLaunch;
  if (!a) return { success: false, error: '当前没有正在进行的启动' };
  a.cancelled = true;
  try { a.child && a.child.pid && process.platform === 'win32' && require('child_process').execSync(`taskkill /PID ${a.child.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  try { a.child && a.child.kill(); } catch {}
  try { a.watcher && a.watcher.kill(); } catch {}
  try { a.finishWait && a.finishWait(); } catch {}
  return { success: true };
});

// External (Yggdrasil / authlib-injector style) account login with username + password.
// Users usually paste the SITE root (https://littleskin.cn/) instead of the API root
// (https://littleskin.cn/api/yggdrasil); POSTing {root}/authserver/authenticate then 404s.
// Probe the root, and the conventional "/api/yggdrasil" suffix, for a valid metadata document.
const _yggRootCache = new Map();
async function resolveYggdrasilRoot(input) {
  let base = String(input || '').trim().replace(/\/+$/, '');
  // 用户可能粘贴完整端点（…/authserver/authenticate）或已带 /api/yggdrasil，统一裁到 API 根
  const already = base.match(/^(.*?\/api\/yggdrasil)(\/.*)?$/i);
  if (already) base = already[1];
  else base = base.replace(/\/(authserver|sessionserver)(\/.*)?$/i, '').replace(/\/+$/, '');
  if (_yggRootCache.has(base)) return _yggRootCache.get(base);
  const isMeta = (d) => d && typeof d === 'object' && !Array.isArray(d) && (d.meta || 'signaturePublickey' in d || 'skinDomains' in d);
  let root = '';
  // 已是 /api/yggdrasil 先试；再试站点根与常见后缀
  const cands = [];
  for (const c of [base, base + '/api/yggdrasil', base + '/yggdrasil']) if (!cands.includes(c)) cands.push(c);
  for (const cand of cands) {
    try { const d = await httpGetJson(cand, { timeoutMs: 6000 }); if (isMeta(d)) { root = cand; break; } } catch {}
  }
  if (!root) root = base; // fall back to literal input
  _yggRootCache.set(base, root);
  return root;
}
ipcMain.handle('yggdrasil-resolve-root', async (_e, input) => {
  try { return { success: true, root: await resolveYggdrasilRoot(input) }; }
  catch (e) { return { success: false, error: String(e.message || e) }; }
});

// 解析 Yggdrasil profile.properties 里的 base64 textures，得到皮肤/披风 URL 与模型（LittleSkin 等外置站）
function parseYggdrasilTextures(profile) {
  const out = { skinUrl: '', capeUrl: '', slim: false };
  try {
    const props = profile && Array.isArray(profile.properties) ? profile.properties : [];
    const tp = props.find((p) => p && p.name === 'textures');
    if (!tp || !tp.value) return out;
    const T = (JSON.parse(Buffer.from(tp.value, 'base64').toString('utf8')).textures) || {};
    if (T.SKIN && T.SKIN.url) {
      out.skinUrl = T.SKIN.url;
      out.slim = !!(T.SKIN.metadata && /slim/i.test(T.SKIN.metadata.model || ''));
    }
    if (T.CAPE && T.CAPE.url) out.capeUrl = T.CAPE.url;
  } catch {}
  return out;
}
// 拉取外置站某玩家最新纹理（公开 profile 端点，无需密码）——用于皮肤/披风“实时同步”
ipcMain.handle('external-refresh-textures', async (_e, arg) => {
  try {
    const apiRoot = String((arg && arg.apiRoot) || '').replace(/\/+$/, '');
    const uuid = String((arg && arg.uuid) || '').replace(/-/g, '');
    if (!apiRoot || !/^https?:\/\//i.test(apiRoot)) return { success: false, error: '缺少认证服务器地址' };
    if (!/^[0-9a-f]{32}$/i.test(uuid)) return { success: false, error: '缺少有效的 UUID' };
    const d = await httpGetJson(`${apiRoot}/sessionserver/session/minecraft/profile/${uuid}`, { timeoutMs: 8000 });
    const t = parseYggdrasilTextures(d);
    if (!t.skinUrl && !t.capeUrl) return { success: false, error: '该账号在皮肤站未设置皮肤或披风' };
    return { success: true, ...t };
  } catch (e) { return { success: false, error: String((e && e.message) || e) }; }
});
ipcMain.handle('external-auth', async (_e, arg) => {
  try {
    const serverInput = String((arg && arg.server) || '').trim().replace(/\/+$/, '');
    const username = String((arg && arg.username) || '').trim();
    const password = String((arg && arg.password) || '');
    if (!/^https?:\/\/.+/i.test(serverInput)) return { success: false, error: '请输入正确的认证服务器地址（以 http(s):// 开头）' };
    if (!username) return { success: false, error: '请输入用户名/邮箱' };
    if (!password) return { success: false, error: '请输入密码' };
    const payload = JSON.stringify({
      agent: { name: 'Minecraft', version: 1 },
      username, password, requestUser: true,
    });
    // 候选 API 根：解析结果优先，再补常见变体。逐个尝试 authenticate：
    // 200 即成功；401/403 是账密错误（直接报）；404/405/网络错误说明根不对，换下一个候选自愈。
    const resolved = await resolveYggdrasilRoot(serverInput);
    let b = serverInput.trim().replace(/\/+$/, '');
    const am = b.match(/^(.*?\/api\/yggdrasil)(\/.*)?$/i);
    if (am) b = am[1].replace(/\/api\/yggdrasil$/i, '');
    b = b.replace(/\/(authserver|sessionserver)(\/.*)?$/i, '').replace(/\/+$/, '');
    const rootCands = [...new Set([resolved, b, b + '/api/yggdrasil', b + '/yggdrasil'])];
    let d = {}, lastStatus = 0, server = resolved, authErr = '';
    for (const root of rootCands) {
      let res;
      try { res = await httpRequest(root + '/authserver/authenticate', {
        method: 'POST', timeoutMs: 9000,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'GlowstoneLauncher/1.0' },
      }, payload); } catch (e) { authErr = String(e.message || e); continue; }
      d = res.data || {}; lastStatus = res.status; server = root;
      if (res.status === 200 && d.accessToken) break;
      // 凭据类错误：服务器是对的，只是账密错，不必再换根
      if (res.status === 401 || res.status === 403) {
        return { success: false, error: d.errorMessage || d.error || '用户名或密码错误' };
      }
      authErr = `HTTP ${res.status}`; // 404/405/... 换候选根重试
    }
    if (!d.accessToken) {
      return { success: false, error: `认证失败（${authErr || ('HTTP ' + lastStatus)}）。请确认认证服务器地址填到站点根（如 https://littleskin.cn ），而非完整登录链接` };
    }
    const profile = d.selectedProfile || (d.availableProfiles && d.availableProfiles[0]) || {};
    const rawUuid = String(profile.id || '').replace(/[^\da-fA-F]/g, '');
    // Yggdrasil returns a 32-char hex uuid without dashes; format it for the launch args.
    const uuid = rawUuid.length === 32
      ? `${rawUuid.slice(0, 8)}-${rawUuid.slice(8, 12)}-${rawUuid.slice(12, 16)}-${rawUuid.slice(16, 20)}-${rawUuid.slice(20)}`
      : (profile.id || '');
    const tex = parseYggdrasilTextures(profile);
    return { success: true, data: { username: profile.name || username, uuid, accessToken: d.accessToken, apiRoot: server, skinUrl: tex.skinUrl, capeUrl: tex.capeUrl, slim: tex.slim } };
  } catch (err) {
    return { success: false, error: '无法连接认证服务器：' + String((err && err.message) || err) };
  }
});

// Microsoft OAuth — Microsoft Identity v2 device-code flow (consumers) -> XBL -> XSTS -> MC
function resolveClientId(arg) {
  const c = arg && typeof arg === 'object' ? arg.clientId : '';
  return (typeof c === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(c.trim())) ? c.trim() : MS_CLIENT_ID;
}
ipcMain.handle('ms-device-code', async (_e, arg) => {
  try {
    const clientId = resolveClientId(arg);
    const body = new URLSearchParams({
      client_id: clientId,
      scope: 'XboxLive.signin offline_access',
    }).toString();
    const res = await httpRequest(
      MS_DEVICE_URL,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      body,
    );
    const d = res.data || {};
    if (res.status !== 200 || !d.device_code) {
      return { success: false, error: d.error || 'device_code_failed', description: typeof d === 'string' ? d : JSON.stringify(d) };
    }
    return {
      success: true,
      data: {
        device_code: d.device_code,
        user_code: d.user_code,
        verification_uri: d.verification_uri || 'https://www.microsoft.com/link',
        interval: d.interval || 5,
        expires_in: d.expires_in || 900,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('ms-poll-token', async (_event, arg) => {
  // Accept either a bare device-code string (legacy) or { deviceCode, clientId }.
  const deviceCode = typeof arg === 'string' ? arg : (arg && arg.deviceCode);
  const clientId = resolveClientId(typeof arg === 'object' ? arg : null);
  const UA = 'GlowstoneLauncher/1.0';
  const postJsonRetry = async (url, payload, stage) => {
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await httpRequest(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
        }, JSON.stringify(payload));
      } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 700)); }
    }
    throw new Error(stage + '网络请求失败：' + String((lastErr && lastErr.message) || lastErr));
  };
  try {
    // 1) Exchange v2 device code for a Microsoft (MSAL) access token
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
    }).toString();
    let res;
    try {
      res = await httpRequest(
        MS_TOKEN_URL,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA } },
        body,
      );
    } catch (e) {
      return { success: false, error: 'network_error', description: '无法连接微软登录服务器，请检查网络后等待自动重试' };
    }
    const td = res.data || {};
    if (res.status !== 200 || !td.access_token) {
      // authorization_pending is expected while the user has not finished signing in.
      const errCode = td.error || 'poll_failed';
      return { success: false, error: errCode, description: td.error_description || '' };
    }
    const msAccessToken = td.access_token;
    const refreshToken = td.refresh_token || '';

    // 2) Xbox Live (RPS ticket; v2 MSAL JWT still uses the d= prefix)
    const xblRes = await postJsonRetry('https://user.auth.xboxlive.com/user/authenticate', {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msAccessToken },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    }, 'Xbox Live');
    if (xblRes.status !== 200) {
      return { success: false, error: 'xbl_auth_failed', description: 'Xbox Live 认证失败 (' + xblRes.status + ')：' + JSON.stringify(xblRes.data).slice(0, 200) };
    }
    const xblToken = xblRes.data.Token;
    const userHash = xblRes.data.DisplayClaims && xblRes.data.DisplayClaims.xui && xblRes.data.DisplayClaims.xui[0] && xblRes.data.DisplayClaims.xui[0].uhs;
    if (!xblToken || !userHash) return { success: false, error: 'xbl_auth_failed', description: 'Xbox Live 返回数据缺失，请重试' };

    // 3) XSTS
    const xstsRes = await postJsonRetry('https://xsts.auth.xboxlive.com/xsts/authorize', {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    }, 'XSTS');
    if (xstsRes.status !== 200) {
      const xerr = xstsRes.data && xstsRes.data.XErr;
      let msg = 'XSTS 认证失败，请检查网络后重试';
      if (xerr === 2148916233) msg = '该微软账号没有 Xbox 档案，请先在 Xbox 官网免费注册一个玩家标签';
      else if (xerr === 2148916235) msg = '当前地区 Xbox Live 不可用，需要切换网络环境';
      else if (xerr === 2148916238) msg = '该账号是未成年人账号，需要加入家庭组才能登录';
      else if (xerr === 2148916236 || xerr === 2148916237) msg = '需要成人验证，请在微软账号完成年龄验证';
      return { success: false, error: 'xsts_failed', description: msg };
    }

    // 4) Minecraft services login
    const mcRes = await postJsonRetry('https://api.minecraftservices.com/authentication/login_with_xbox', {
      identityToken: 'XBL3.0 x=' + userHash + ';' + xstsRes.data.Token,
    }, 'Minecraft');
    if (mcRes.status !== 200 || !mcRes.data.access_token) {
      return { success: false, error: 'mc_auth_failed', description: 'Minecraft 令牌换取失败 (' + mcRes.status + ')' };
    }
    const mcToken = mcRes.data.access_token;

    // 5) Profile (also proves game ownership)
    const profileRes = await httpRequest(
      'https://api.minecraftservices.com/minecraft/profile',
      { method: 'GET', headers: { Authorization: 'Bearer ' + mcToken, Accept: 'application/json', 'User-Agent': UA } },
    );
    if (profileRes.status !== 200 || !profileRes.data.id) {
      return { success: false, error: 'no_game_ownership', description: '该微软账号未拥有 Minecraft Java 版，请先在官方购买' };
    }
    return {
      success: true,
      data: { username: profileRes.data.name, uuid: profileRes.data.id, accessToken: mcToken, refreshToken },
    };
  } catch (err) {
    return { success: false, error: 'exception', description: String((err && err.message) || err) };
  }
});

ipcMain.handle('app-version', () => app.getVersion());

// ==================== 启动器在线更新 ====================
// 更新清单托管在官网静态空间；普通版与赞助版使用各自渠道，互不串包。
// 发布新版时只需更新对应 JSON 与安装包。
// 结构：{ version:"1.0.7", url:"https://.../GlowstoneLauncher.exe", sha256:"...", size:..., releaseDate, notes }
let glowEdition = 'sponsor';
try { glowEdition = require('./edition.generated.cjs').edition || 'sponsor'; } catch {}
// 更新清单多线路：自有国内服务器（域名+IP）优先，阿里 CDN / jsDelivr 多主机兜底。
// infy.click（InfinityFree）已解析到停放 IP 且国内不可达，不再使用。
const PKG_NAME = glowEdition === 'community' ? 'glowstone-launcher-stable' : 'glowstone-launcher-pro-stable';
const MANIFEST_BASENAME = glowEdition === 'community' ? 'latest.json' : 'latest-sponsor.json';
// 自托管更新源（可选）：若你自建了更新站，把你的清单地址加到本数组最前面，例如
// 'https://your-domain.example/update/' + MANIFEST_BASENAME,
// 留空则仅使用下面的公共 CDN 镜像。请勿把私有服务器 IP / 内网地址提交到公开仓库。
const UPDATE_MANIFEST_URLS = [
  'https://cdn.npmmirror.com/packages/' + PKG_NAME + '/latest/manifest/' + MANIFEST_BASENAME,
  'https://fastly.jsdelivr.net/npm/' + PKG_NAME + '/manifest/' + MANIFEST_BASENAME,
  'https://gcore.jsdelivr.net/npm/' + PKG_NAME + '/manifest/' + MANIFEST_BASENAME,
  'https://cdn.jsdelivr.net/npm/' + PKG_NAME + '/manifest/' + MANIFEST_BASENAME,
];
// 私有下载站防盗链（可选）：若你自建了带密钥头校验的下载站，在此填写主机名与密钥头值；
// 两者留空（默认）时不会附加任何私有请求头，直接使用公共下载地址。
// 真实密钥属于敏感信息，请勿提交到公开仓库（建议改为从环境变量或未纳入版本管理的私有配置读取）。
const PRIVATE_DOWNLOAD_HOST = '';
const PRIVATE_DOWNLOAD_KEY = '';
// 数值化比较 x.y.z（忽略后缀），a>b 返回 1
function cmpAppVersion(a, b) {
  const pa = String(a || '').match(/\d+(?:\.\d+)*/);
  const pb = String(b || '').match(/\d+(?:\.\d+)*/);
  const na = pa ? pa[0].split('.').map((x) => parseInt(x, 10) || 0) : [0];
  const nb = pb ? pb[0].split('.').map((x) => parseInt(x, 10) || 0) : [0];
  const len = Math.max(na.length, nb.length);
  for (let i = 0; i < len; i++) {
    const x = na[i] || 0, y = nb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
// 多线路并行竞速：所有地址同时发起，谁先完整返回用谁（旧逻辑串行 await，前两条慢源
// 各要等满超时才轮到 CDN，所以检测更新要十几秒）。全部失败才 reject。
function raceJson(urls, perTimeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const errs = [];
    let pending = urls.length;
    urls.forEach((u) => {
      httpGetJson(u, { timeoutMs: perTimeoutMs })
        .then((d) => { if (!settled) { settled = true; resolve(d); } })
        .catch((e) => {
          errs.push(e.message);
          if (--pending === 0 && !settled) { settled = true; reject(new Error(errs.join(' | '))); }
        });
    });
  });
}
function updateManifestCachePath() { return path.join(app.getPath('userData'), 'update_manifest_cache.json'); }
function readUpdateCache() {
  try { const j = JSON.parse(fs.readFileSync(updateManifestCachePath(), 'utf8')); if (j && j.data) return j; } catch {}
  return null;
}
function buildUpdateResult(m, current, fromCache, stale) {
  const latest = String(m.version || '').replace(/^v/i, '').trim();
  if (!/^\d+\.\d+\.\d+/.test(latest)) return { success: false, current, error: '更新清单中的版本号无效' };
  return {
    success: true, current, latest,
    updateAvailable: cmpAppVersion(latest, current) > 0,
    notes: String(m.notes || ''),
    url: String(m.url || ''),
    sha256: String(m.sha256 || ''),
    size: Number(m.size) || 0,
    releaseDate: String(m.releaseDate || ''),
    sources: m.sources || null,
    fromCache: !!fromCache,
    stale: !!stale,
  };
}
let bgUpdateTimer = null;
function scheduleBackgroundUpdate() {
  if (bgUpdateTimer) return;
  bgUpdateTimer = setTimeout(() => {
    bgUpdateTimer = null;
    raceJson(UPDATE_MANIFEST_URLS, 5000).then((m) => {
      try { fs.writeFileSync(updateManifestCachePath(), JSON.stringify({ at: Date.now(), data: m })); } catch {}
      if (mainWindow && cmpAppVersion(String(m.version || ''), app.getVersion()) > 0) {
        mainWindow.webContents.send('update-available-bg', buildUpdateResult(m, app.getVersion(), false));
      }
    }).catch(() => {});
  }, 1500);
}
ipcMain.handle('check-for-updates', async (_e, force) => {
  const current = app.getVersion();
  if (!Array.isArray(UPDATE_MANIFEST_URLS) || UPDATE_MANIFEST_URLS.length === 0) {
    return { success: false, current, error: '更新地址尚未配置' };
  }
  const cached = readUpdateCache();
  // 30 分钟内的缓存立即返回（秒检查），后台静默刷新；手动强制刷新则跳过缓存。
  if (!force && cached && Date.now() - cached.at < 30 * 60 * 1000) {
    scheduleBackgroundUpdate();
    return buildUpdateResult(cached.data, current, true);
  }
  try {
    const m = await raceJson(UPDATE_MANIFEST_URLS, 5000);
    try { fs.writeFileSync(updateManifestCachePath(), JSON.stringify({ at: Date.now(), data: m })); } catch {}
    return buildUpdateResult(m, current, false);
  } catch (e) {
    if (cached && cached.data) return buildUpdateResult(cached.data, current, true, true); // 网络全挂：用缓存
    return { success: false, current, error: '无法连接更新服务器：' + ((e && e.message) || e) };
  }
});

// 通用：下载 URL 到 Buffer（跟随重定向、带进度、超时）
function fetchUrlBuffer(urlStr, onProgress, opts) {
  opts = opts || {};
  const timeoutMs = opts.timeoutMs || 30000;
  const redirects = opts.redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('重定向次数过多'));
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(e); }
    const lib = u.protocol === 'http:' ? http : https;
    const t0 = Date.now();
    let settled = false, lastData = t0, received = 0;
    const done = (fn, v) => { if (!settled) { settled = true; clearInterval(watchdog); fn(v); } };
    // 速度看门狗：8s 宽限后均速低于 50KB/s、或 8s 无数据、或 60s 硬上限 → 放弃该线路
    const watchdog = setInterval(() => {
      const now = Date.now(), el = now - t0;
      if (el > 60000 || now - lastData > 8000 || (el > 8000 && received > 0 && received / el < 51200)) {
        req.destroy(new Error(now - lastData > 8000 ? '连接超时' : 'SLOW'));
      }
    }, 1500);
    const reqHeaders = Object.assign(
      { 'User-Agent': 'GlowstoneLauncher/' + app.getVersion(), 'Accept-Encoding': 'identity' },
      opts.headers || {},
    );
    // 私有下载站：自动附加约定的密钥头（浏览器直接访问没有此头 → 403）。
    // PRIVATE_DOWNLOAD_HOST / PRIVATE_DOWNLOAD_KEY 均为空时本行不会生效。
    if (PRIVATE_DOWNLOAD_HOST && PRIVATE_DOWNLOAD_KEY &&
        (u.hostname === PRIVATE_DOWNLOAD_HOST || u.hostname.endsWith('.' + PRIVATE_DOWNLOAD_HOST))) {
      reqHeaders['X-Download-Key'] = PRIVATE_DOWNLOAD_KEY;
    }
    const req = lib.get(u, {
      agent: agentForUrl(u),
      headers: reqHeaders,
      timeout: timeoutMs,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        clearInterval(watchdog); settled = true;
        return resolve(fetchUrlBuffer(new URL(res.headers.location, u).toString(), onProgress, { timeoutMs, redirects: redirects + 1, headers: reqHeaders }));
      }
      if (res.statusCode !== 200) { res.resume(); return done(reject, new Error('HTTP ' + res.statusCode)); }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      const chunks = [];
      let lastEmit = 0;
      res.on('data', (c) => {
        chunks.push(c);
        received += c.length;
        lastData = Date.now();
        const now = Date.now();
        if (onProgress && now - lastEmit > 150) { lastEmit = now; onProgress({ received, total }); }
      });
      res.on('end', () => done(resolve, Buffer.concat(chunks)));
      res.on('error', (e) => done(reject, e));
    });
    req.on('timeout', () => req.destroy(new Error('连接超时')));
    req.on('error', (e) => done(reject, e));
  });
}

// 解析 tgz（gzip + ustar/pax tar），返回 { 路径: Buffer }
function parseTgz(buf) {
  const zlib = require('zlib');
  const data = zlib.gunzipSync(buf);
  const files = {};
  let off = 0;
  while (off + 512 <= data.length) {
    const header = data.slice(off, off + 512);
    if (header[0] === 0) break;
    let name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
    const size = parseInt(header.toString('utf8', 124, 136).replace(/[^0-7]/g, '') || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '');
    if (prefix && name[0] !== '/') name = prefix + '/' + name;
    const blocks = Math.ceil(size / 512);
    const body = data.slice(off + 512, off + 512 + size);
    if (type === '0' || type === '\u0000') files[name] = body;
    off += 512 + blocks * 512;
  }
  return files;
}

// 多线路下载安装包，返回完整 Buffer；自动按 jsDelivr 分块 → npmmirror tarball → 直链 顺序尝试
async function downloadUpdateBuffer(info, send) {
  const totalSize = Number(info.size) || 0;
  const sources = info.sources || {};
  let lastErr;

  // 线路 0：自有国内服务器完整安装包直链（域名 + IP 轮换），国内最快
  const ownFirst = sources.own ? (Array.isArray(sources.own) ? sources.own : [sources.own]) : [];
  for (const own of ownFirst) {
    try {
      return await fetchUrlBuffer(own, (p) => send({
        phase: 'download',
        received: p.received,
        total: totalSize || p.total,
        percent: (totalSize && p.total) ? Math.floor(p.received / p.total * 100) : 0,
      }), { timeoutMs: 30000 });
    } catch (e) { lastErr = e; }
  }

  // 线路 1：jsDelivr CDN 分块，主机逐个轮换
  const jd = sources.jsdelivr;
  if (jd && Array.isArray(jd.paths) && jd.paths.length) {
    try {
      const hosts = (jd.hosts && jd.hosts.length) ? jd.hosts : ['https://cdn.jsdelivr.net'];
      const parts = [];
      let got = 0;
      for (let i = 0; i < jd.paths.length; i++) {
        let part, err;
        for (const host of hosts) {
          try {
            const base = got;
            part = await fetchUrlBuffer(host + jd.paths[i], (p) => send({
              phase: 'download',
              received: base + p.received,
              total: totalSize,
              percent: totalSize ? Math.floor((base + p.received) / totalSize * 100) : 0,
            }), { timeoutMs: 20000 });
            err = null;
            break;
          } catch (e) { err = e; }
        }
        if (err) throw err;
        parts.push(part);
        got += part.length;
      }
      return Buffer.concat(parts);
    } catch (e) { lastErr = e; }
  }

  // 线路 2：npmmirror（阿里 CDN）tarball，解压取分块
  if (sources.npmmirror) {
    try {
      const tgz = await fetchUrlBuffer(sources.npmmirror, (p) => send({
        phase: 'download',
        received: p.received,
        total: p.total || totalSize,
        percent: (p.total && totalSize) ? Math.floor((p.received / p.total) * 95) : 0,
      }), { timeoutMs: 30000 });
      const files = parseTgz(tgz);
      const names = Object.keys(files)
        .filter((n) => /chunks\/part\d+\.bin$/.test(n))
        .sort((a, b) => parseInt(a.match(/part(\d+)/)[1], 10) - parseInt(b.match(/part(\d+)/)[1], 10));
      if (!names.length) throw new Error('压缩包中未找到分块文件');
      send({ phase: 'merge', percent: 97 });
      return Buffer.concat(names.map((n) => files[n]));
    } catch (e) { lastErr = e; }
  }

  // 线路 3（兜底）：清单直链
  const direct = info.url;
  if (direct) {
    try {
      return await fetchUrlBuffer(direct, (p) => send({
        phase: 'download',
        received: p.received,
        total: totalSize,
        percent: totalSize ? Math.floor(p.received / totalSize * 100) : 0,
      }), { timeoutMs: 30000 });
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('当前没有可用的下载线路，请稍后重试');
}

let updateInstalling = false;
ipcMain.handle('download-and-install-update', async (event, info) => {
  if (updateInstalling) return { success: false, error: '更新已经在进行中' };
  const version = String((info && (info.version || info.latest)) || 'latest').replace(/[^\w.\-]/g, '_');
  const savePath = path.join(app.getPath('downloads'), `GlowstoneLauncher-${version}.exe`);
  updateInstalling = true;
  const send = (p) => { try { event.sender.send('update-progress', p); } catch {} };
  try {
    send({ phase: 'download', percent: 0, received: 0, total: Number(info.size) || 0 });
    const buf = await downloadUpdateBuffer(info, send);
    // SHA256 校验，防止下载不完整 / 被篡改
    if (info.sha256) {
      send({ phase: 'verify', percent: 99 });
      const crypto = require('crypto');
      const gotSha = crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
      const want = String(info.sha256).toLowerCase().replace(/\s+/g, '');
      if (gotSha !== want) throw new Error('安装包校验失败（SHA256 不一致），文件可能下载不完整，请重试');
    }
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.writeFileSync(savePath, buf);
    send({ phase: 'done', percent: 100, path: savePath });
    // 自动打开安装向导；NSIS 脚本 customInit 会 taskkill 旧版再覆盖安装，因此这里不主动退出——
    // 若用户取消 UAC 或安装器没起来，启动器仍在，界面会显示安装包路径与“立即安装/打开文件夹”按钮。
    const openErr = await shell.openPath(savePath);
    if (openErr) { send({ phase: 'ready', percent: 100, path: savePath, openErr }); }
    return { success: true, path: savePath, openErr: openErr || '' };
  } catch (e) {
    return { success: false, error: ((e && e.message) || String(e)) };
  } finally {
    updateInstalling = false;
  }
});

// 手动重新运行已下载的安装包（用户在界面点“立即安装”）
ipcMain.handle('run-update-installer', async (_e, p) => {
  if (!p || typeof p !== 'string' || !fs.existsSync(p)) return { success: false, error: '安装包不存在，可能已被移动或删除' };
  const err = await shell.openPath(p);
  return err ? { success: false, error: err } : { success: true };
});
// 在文件管理器中定位并选中安装包
ipcMain.handle('show-item-in-folder', (_e, p) => { try { shell.showItemInFolder(p); return { success: true }; } catch (e) { return { success: false, error: String((e && e.message) || e) }; } });

// 本地开服：精简 Java 列表（每个大版本只保留一个代表），供开服页自动选择
ipcMain.handle('server-java-list', async () => {
  const all = listJavaWithVersion();
  const byMajor = new Map();
  for (const x of all) {
    if (!x.major) continue; // 丢弃无法识别版本的，避免出现“Java 0”
    if (!byMajor.has(x.major)) byMajor.set(x.major, x);
  }
  const javas = [...byMajor.values()].sort((a, b) => a.major - b.major);
  return { javas };
});

// ================= 赞助版联网激活（硬件绑定 · Supabase · 离线缓存）=================
let licenseCfg;
try { licenseCfg = require('./license.config.cjs'); } catch { licenseCfg = {}; }
const licenseCachePath = () => path.join(app.getPath('userData'), 'license.cache.json');
const crypto = require('crypto');

// 本机硬件标识：主板/BIOS/CPU/首块硬盘序列号组合后 SHA256（best-effort，缓存）。
let _hwidCache = null;
function readHardwareId() {
  if (_hwidCache) return Promise.resolve(_hwidCache);
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    "'BB=' + (Get-CimInstance Win32_BaseBoard).SerialNumber",
    "'BIOS=' + (Get-CimInstance Win32_BIOS).SerialNumber",
    "'CPU=' + ((Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId)",
    "'DISK=' + ((Get-CimInstance Win32_DiskDrive | Where-Object { $_.Index -eq 0 } | Select-Object -First 1).SerialNumber)",
  ].join('; ');
  return new Promise((resolve) => {
    let child;
    try { child = require('child_process').spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }); }
    catch { return resolve(''); }
    let out = '';
    const timer = setTimeout(() => { try { child.kill(); } catch {} resolve(finish(out)); }, 9000);
    function finish(txt) {
      clearTimeout(timer);
      const junk = /default string|to be filled|system serial|system product name|^none$|^unknown$|^n\/a$|^0+$|^null$/i;
      const parts = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        .map((l) => { const i = l.indexOf('='); return i < 0 ? '' : l.slice(i + 1).trim(); })
        .filter((v) => v && !junk.test(v));
      const basis = parts.sort().join('|');
      const id = basis ? crypto.createHash('sha256').update(basis).digest('hex') : '';
      _hwidCache = id;
      return id;
    }
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', () => resolve(finish(out)));
    child.on('exit', () => resolve(finish(out)));
  });
}

function readLicenseCache() {
  try { return JSON.parse(fs.readFileSync(licenseCachePath(), 'utf8')); } catch { return null; }
}
function writeLicenseCache(c) {
  try { fs.writeFileSync(licenseCachePath(), JSON.stringify(c)); } catch {}
}

// 调用自建授权服务器（POST JSON）。通用请求，payload 决定具体动作。
function licenseServerCall(payload) {
  return new Promise((resolve) => {
    const base = licenseCfg.apiBase;
    if (!base || /YOUR-/.test(base)) {
      return resolve({ netError: true, error: '尚未配置授权服务器地址（license.config.cjs）' });
    }
    const url = base;
    const body = Buffer.from(JSON.stringify(payload));
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(url, {
      method: 'POST',
      agent: agentForUrl(url),
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        Accept: 'application/json',
      },
    }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => {
        let j = {};
        try { j = JSON.parse(Buffer.concat(ch).toString('utf8')); } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve({ status: res.statusCode, json: j });
        if (res.statusCode === 404) {
          return resolve({ httpError: true, status: 404,
            error: '授权接口不存在（HTTP 404）：请确认授权服务已部署，且 license.config.cjs 的 apiBase 正确' });
        }
        resolve({ httpError: true, status: res.statusCode,
          error: `授权服务器返回 HTTP ${res.statusCode}：${j.message || ''}` });
      });
    });
    req.on('error', (e) => resolve({ netError: true, error: '无法连接授权服务器：' + String((e && e.message) || e) }));
    req.setTimeout(15000, () => req.destroy(new Error('连接超时')));
    req.write(body);
    req.end();
  });
}

// 激活：首次绑定硬件 / 同机放行 / 异机拒绝
function licenseServerActivate(key, hwid) {
  return licenseServerCall({ action: 'activate', key, hwid });
}

// 作废：清除授权换密钥时永久吊销当前密钥（需硬件匹配）
function licenseServerRelease(key, hwid) {
  return licenseServerCall({ action: 'release', key, hwid });
}

const REASON_CN = {
  invalid_key: '密钥无效，请检查后重试',
  hardware_mismatch: '该密钥已在其他电脑激活，无法在本机使用',
  revoked: '该密钥已被吊销',
  bad_hwid: '无法读取本机硬件信息',
};

ipcMain.handle('hardware-id', async () => ({ hwid: await readHardwareId() }));

ipcMain.handle('license-activate', async (_e, arg) => {
  const key = String((arg && arg.key) || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) {
    return { success: false, error: '密钥格式应为 XXXX-XXXX-XXXX-XXXX' };
  }
  const hwid = await readHardwareId();
  if (!hwid) return { success: false, error: '无法读取本机硬件标识，请重试' };
  const r = await licenseServerActivate(key, hwid);
  if (r.httpError) return { success: false, error: r.error };
  if (r.netError) {
    // 断网：仅当本机已有同一密钥、同一硬件且在宽限期内，才放行
    const c = readLicenseCache();
    const ageDays = c ? (Date.now() - (c.savedAt || 0)) / 86400000 : 9999;
    if (c && c.key === key && c.hwid === hwid && ageDays <= (licenseCfg.offlineGraceDays || 30)) {
      return { success: true, offline: true };
    }
    return { success: false, offline: true, error: '无法连接激活服务器，且本机没有该密钥的有效离线授权（首次激活必须联网，请检查网络后重试）' };
  }
  const j = r.json || {};
  if (j.ok) {
    writeLicenseCache({ key, hwid, sig: j.sig || '', savedAt: Date.now() });
    return { success: true };
  }
  return { success: false, error: REASON_CN[j.reason] || ('激活被拒绝（' + j.reason + '）') };
});

ipcMain.handle('license-status', async () => {
  const hwid = await readHardwareId();
  const c = readLicenseCache();
  if (!c) return { activated: false };
  if (!hwid || c.hwid !== hwid) return { activated: false, tampered: true };
  const ageDays = (Date.now() - (c.savedAt || 0)) / 86400000;
  // 尝试联网重新校验（best-effort，失败不阻塞）
  const r = await licenseServerActivate(c.key, hwid);
  if (r.httpError) {
    // 激活服务器临时异常（如函数未部署）：不立即吊销，按本机离线缓存宽限处理
    if (ageDays <= (licenseCfg.offlineGraceDays || 30)) return { activated: true, offline: true };
    return { activated: false, error: r.error };
  }
  if (!r.netError) {
    const j = r.json || {};
    if (j.ok) { writeLicenseCache({ key: c.key, hwid, sig: j.sig || '', savedAt: Date.now() }); return { activated: true }; }
    return { activated: false, error: REASON_CN[j.reason] || j.reason };
  }
  if (ageDays <= (licenseCfg.offlineGraceDays || 30)) return { activated: true, offline: true };
  return { activated: false, expired: true, error: '离线授权已过期，请联网后重新校验' };
});

// 清除本机授权缓存（换密钥 / 转移电脑前使用）
ipcMain.handle('license-clear', async () => {
  try { fs.unlinkSync(licenseCachePath()); } catch {}
  return { success: true };
});

// 作废当前密钥并清除本机授权（“清除授权换密钥”）：
// 通知服务器把当前密钥永久吊销(st=2)，成功后删除本地缓存。旧密钥此后无法再次使用。
ipcMain.handle('license-release', async () => {
  const c = readLicenseCache();
  const hwid = await readHardwareId();
  if (!c || !c.key) {
    // 本地没有缓存，直接清掉即可
    try { fs.unlinkSync(licenseCachePath()); } catch {}
    return { success: true };
  }
  const key = c.key;
  const r = await licenseServerRelease(key, hwid || c.hwid);
  if (r.netError) return { success: false, error: '无法连接授权服务器，密钥未作废：' + r.error };
  if (r.httpError) return { success: false, error: r.error };
  const j = r.json || {};
  // 无论服务器返回 ok 还是 revoked，都清除本地缓存（revoked 也已达到目的）
  try { fs.unlinkSync(licenseCachePath()); } catch {}
  if (j.ok) return { success: true };
  return { success: false, error: REASON_CN[j.reason] || ('作废被拒绝（' + j.reason + '）') };
});

// 陶瓦联机（EasyTier P2P 组网）+ 本地开服，仅赞助版打包
if (glowEdition !== 'community') {
  try { require('./lan.cjs').initLan({ ipcMain, app, getMainWindow: () => mainWindow }); } catch (e) { console.error('lan init failed', e); }
  try { require('./server.cjs').initServer({ ipcMain, app, getMainWindow: () => mainWindow }); } catch (e) { console.error('server init failed', e); }
  try { require('./remotelan.cjs').initRemoteLan({ ipcMain, app, getMainWindow: () => mainWindow }); } catch (e) { console.error('remotelan init failed', e); }
}

// MC百科中文译名实时查询（只读，两版都可用；失败由前端回退内置译名表）
try { require('./mcmod.cjs').initMcmod({ ipcMain }); } catch (e) { console.error('mcmod init failed', e); }


// On upgrade, drop Chromium caches so a freshly installed build can never render
// stale compiled/HTTP-cached frontend code.
app.whenReady().then(async () => {
  try {
    const tagFile = path.join(app.getPath('userData'), 'build-tag.txt');
    const ver = app.getVersion();
    let prev = '';
    try { prev = fs.readFileSync(tagFile, 'utf8'); } catch {}
    if (prev !== ver) {
      await session.defaultSession.clearCache();
      try { await session.defaultSession.clearStorageData({ storages: ['shadercache', 'serviceworkers'] }); } catch {}
      fs.writeFileSync(tagFile, ver);
    }
  } catch {}
});

// 单实例：再次启动时不新开进程，聚焦已有窗口并提示
const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
    try { tray && tray.displayBalloon({ title: 'Glowstone Launcher', content: '启动器已经在运行中' }); } catch {}
  });

  app.whenReady().then(() => {
    const diagLog = path.join(app.getPath('userData'), 'startup-diag.log');
    const dlog = (m) => { try { fs.appendFileSync(diagLog, `${new Date().toISOString()} ${m}\n`); } catch {} };
    dlog('app ready');
    try { createTray(); dlog('tray created'); } catch (e) { dlog('TRAY ERROR: ' + (e && e.stack)); }
    try { createSplashWindow(); dlog('splash created'); } catch (e) { dlog('SPLASH ERROR: ' + (e && e.stack)); }
    try { createWindow(); dlog('main window created'); } catch (e) { dlog('MAIN ERROR: ' + (e && e.stack)); }
    // 后台预热 Java 扫描缓存（仅读盘，不阻塞窗口），首次点“启动游戏”时免再扫盘
    setTimeout(() => { try { collectNamedJava(); startBackgroundJavaScan(); } catch {} }, 1500);
    // 预热到 BMCL 的连接（DNS/TLS/系统代理探测），并顺手刷新清单磁盘缓存，
    // 避免进版本下载页时第一次网络请求被代理自动探测卡住十几秒
    httpGetJson(MANIFEST_URLS.bmcl, { timeoutMs: 6000 })
      .then((d) => { if (d && Array.isArray(d.versions)) { try { fs.writeFileSync(manifestCachePath(), JSON.stringify({ savedAt: Date.now(), versions: d.versions })); } catch {} } })
      .catch(() => {});
  });

  // 关闭按钮只是收进托盘，因此不能在 window-all-closed 时退出；仅 macOS 保留默认行为
  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (mainWindow === null) createWindow(); else showMainWindow();
  });
}
