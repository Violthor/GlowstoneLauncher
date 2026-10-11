// Mobile bridge: 在 Android WebView 中把电脑版的 window.electronAPI 契约映射到原生能力。
// 原生侧通过 @JavascriptInterface 的 GlowstoneNative.startRequest(id, method, args) 接单，
// 完成后回调 window._nativeResolve；原生主动推送的进度走 window._nativeEvent。

/* eslint-disable @typescript-eslint/no-explicit-any */
type NativeHost = { startRequest: (id: string, method: string, argsJson: string) => void };

function getNative(): NativeHost | null {
  return (window as any).GlowstoneNative ?? null;
}

let seq = 0;
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();
const eventListeners: Record<string, Set<(data: any) => void>> = {};

// 原生回传请求结果
(window as any)._nativeResolve = (id: string, ok: boolean, payload: any) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (ok) p.resolve(payload);
  else p.reject(payload instanceof Error ? payload : new Error(typeof payload === 'string' ? payload : JSON.stringify(payload)));
};

// 原生主动推送事件（进度、状态变化）
(window as any)._nativeEvent = (channel: string, data: any) => {
  eventListeners[channel]?.forEach((l) => {
    try { l(data); } catch { /* ignore listener errors */ }
  });
};

function call(method: string, arg?: any): Promise<any> {
  const native = getNative();
  if (!native) return Promise.reject(new Error('native bridge unavailable: ' + method));
  return new Promise((resolve, reject) => {
    const id = 'r' + Date.now().toString(36) + (seq++).toString(36);
    pending.set(id, { resolve, reject });
    let argsJson: string;
    try { argsJson = JSON.stringify(arg ?? null); } catch { argsJson = 'null'; }
    native.startRequest(id, method, argsJson);
  });
}

function onEvent(channel: string, cb: (data: any) => void): () => void {
  if (!eventListeners[channel]) eventListeners[channel] = new Set();
  eventListeners[channel].add(cb);
  return () => eventListeners[channel]?.delete(cb);
}

// 设备码登录在前端用 fetch 复刻（见 msLogin.ts），成功后由原生持久化账号
import { deviceCode, pollToken } from './msLogin';

function buildApi() {
  return {
    // ---- window controls: no-op on Android ----
    minimizeWindow: () => {},
    maximizeWindow: () => {},
    closeWindow: () => {},
    isMaximized: () => Promise.resolve(false),
    onMaximizeChange: () => () => {},
    onPlayAnim: () => () => {},
    animFinished: () => {},
    appQuit: () => {},

    fetchVersionManifest: (source: string) => call('fetch-version-manifest', source),
    fetchSkin: (q: string) => call('fetch-skin', q),
    downloadJava: (major: number) => call('download-java', major),
    onJavaDownloadProgress: (cb: any) => onEvent('java-download-progress', cb),
    pickBackgroundVideo: () => call('pick-background-video'),

    msDeviceCode: (arg?: any) => deviceCode(arg),
    msPollToken: (arg: any) => pollToken(arg, call),

    // 手机端正版登录：App 内 WebView 完成，不跳系统浏览器
    msNativeLogin: () => call('ms-login'),

    // 读取最近一次游戏日志/崩溃报告，定位启动后进程消失这类无弹窗故障
    readGameLogs: () => call('read-game-logs'),

    // 把当前账号（任意类型）同步到原生侧：写账号文件 + 设为当前 profile。
    // 登录 / 切换账号 / 冷启动恢复时调用，保证 MainActivity 能读到账号（否则启动报 null）。
    saveAccount: (a: any) => call('save-account', a),

    // 下载源（自动测速 / BMCL / 官方）
    getDownloadSource: () => call('get-download-source'),
    setDownloadSource: (src: string) => call('set-download-source', src),

    openExternal: (url: string) => { call('open-external', url).catch(() => {}); },
    copyToClipboard: (text: string) => { call('copy-clipboard', text).catch(() => {}); },
    openFolder: (p: string) => call('open-folder', p),
    openVersionFolder: (arg: any) => call('open-version-folder', arg),
    scanMods: (arg: any) => call('scan-mods', arg),
    toggleMod: (arg: any) => call('toggle-mod', arg),
    deleteMod: (arg: any) => call('delete-mod', arg),

    selectFolder: () => call('dialog:openFolder'),
    defaultDownloadDir: () => call('default-download-dir'),
    defaultMcDir: () => call('default-mc-dir'),
    listDrives: () => call('list-drives'),
    resolveTargetDir: (arg: any) => call('resolve-target-dir', arg),
    selectFile: (filters: any) => call('dialog:openFile', filters),

    downloadFile: (url: string, dir: string, name: string, taskId?: string) =>
      call('downloadFile', { url, saveDir: dir, filename: name, taskId }),
    onDownloadProgress: (cb: any) => onEvent('download-progress', cb),

    launchGame: (opts: any) => call('launch-game', opts),
    launchCancel: () => call('launch-cancel'),
    externalAuth: (arg: any) => call('external-auth', arg),
    externalRefreshTextures: (arg: any) => call('external-refresh-textures', arg),
    yggdrasilResolveRoot: (server: string) => call('yggdrasil-resolve-root', server),
    gameRunningList: () => call('game-running-list'),
    gameKill: (pid: number) => call('game-kill', pid),
    onGameRunningChanged: (cb: any) => onEvent('game-running-changed', cb),
    onLaunchProgress: (cb: any) => onEvent('game-launch-progress', cb),

    deleteVersion: (gameDir: string, versionId: string) =>
      call('delete-version', { gameDir, versionId }),
    getSystemMemory: () => call('get-system-memory'),
    memoryOptimize: () => call('memory-optimize'),
    cleanupGarbage: (gameDir: string, allDirs: any) =>
      call('cleanup-garbage', gameDir || (allDirs && allDirs.length) ? { gameDir, allDirs } : undefined),
    backupSaves: (gameDir: string) => call('backup-saves', { gameDir }),
    restoreSaves: (gameDir: string, backupPath: string) =>
      call('restore-saves', { gameDir, backupPath }),
    listSaves: (gameDir: string) => call('list-saves', { gameDir }),

    findJava: () => call('find-java'),
    listJava: (arg?: any) => call('list-java', arg),
    importJava: () => call('import-java'),
    removeCustomJava: (p: string) => call('remove-custom-java', p),

    appVersion: () => call('app-version'),
    checkForUpdates: () => call('check-for-updates'),
    downloadAndInstallUpdate: (info: any) => call('download-and-install-update', info),
    onUpdateProgress: (cb: any) => onEvent('update-progress', cb),

    pathForFile: () => '',
    importModpack: (arg: any) => call('import-modpack', arg),
    installCfModpack: (arg: any) => call('install-cf-modpack', arg),
    classifyArchive: (arg: any) => call('classify-archive', arg),
    installDrop: (arg: any) => call('install-drop', arg),
    exportModpack: (arg: any) => call('export-modpack', arg),
    diskFree: (p: string) => call('disk-free', p),
    scanMinecraft: () => call('scan-minecraft'),
    installMinecraftVersion: (opts: any) => call('install-minecraft-version', opts),
    onInstallProgress: (cb: any) => onEvent('mc-install-progress', cb),
    installCancel: () => call('install-cancel'),

    // LAN（community 构建已摇除，不会调用；给安全空实现）
    lanCoreInfo: () => Promise.resolve({ ready: false }),
    lanStartHost: () => Promise.resolve({ success: false, error: 'unsupported' }),
    lanStartJoin: () => Promise.resolve({ success: false, error: 'unsupported' }),
    lanSetHostPort: () => Promise.resolve({ success: false }),
    lanWatchLog: () => Promise.resolve({ success: false }),
    lanStop: () => Promise.resolve({ success: false }),
    lanGetState: () => Promise.resolve({}),
    lanLogs: () => Promise.resolve({ logs: '' }),
    lanStatus: () => Promise.resolve({}),
    onLanLog: () => () => {},
    onLanPort: () => () => {},
    onLanState: () => () => {},

    isElectron: false,
  };
}

export function isMobileHost(): boolean {
  return !!getNative();
}

export function initMobileBridge(): boolean {
  if (!getNative()) return false;
  (globalThis as any).__glowCall = call;
  (window as any).electronAPI = buildApi();
  return true;
}
