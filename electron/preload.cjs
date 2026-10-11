const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onMaximizeChange: (cb) => {
    const h = (_e, m) => cb(m);
    ipcRenderer.on('maximize-change', h);
    return () => ipcRenderer.removeListener('maximize-change', h);
  },
  // 关闭/最小化淡出、还原淡入动画
  onPlayAnim: (cb) => { const h = (_e, dir) => cb(dir); ipcRenderer.on('play-anim', h); return () => ipcRenderer.removeListener('play-anim', h); },
  animFinished: () => ipcRenderer.send('anim-finished'),
  appQuit: () => ipcRenderer.send('app-quit'),

  fetchVersionManifest: (source) => ipcRenderer.invoke('fetch-version-manifest', source),
  fetchSkin: (q) => ipcRenderer.invoke('fetch-skin', q),
  proxyImage: (u) => ipcRenderer.invoke('proxy-image', u),
  translateText: (t) => ipcRenderer.invoke('translate-text', { text: t }),
  msCapes: (accessToken, refreshToken) => ipcRenderer.invoke('ms-capes', { accessToken, refreshToken }),
  msSetCape: (accessToken, capeId, refreshToken) => ipcRenderer.invoke('ms-set-cape', { accessToken, capeId, refreshToken }),
  msSetSkin: (arg) => ipcRenderer.invoke('ms-set-skin', arg),
  msRefreshToken: (refreshToken) => ipcRenderer.invoke('ms-refresh-token', { refreshToken }),
  downloadJava: (major) => ipcRenderer.invoke('download-java', major),
  onJavaDownloadProgress: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on('java-download-progress', h); return () => ipcRenderer.removeListener('java-download-progress', h); },
  pickBackgroundVideo: () => ipcRenderer.invoke('pick-background-video'),

  msDeviceCode: (arg) => ipcRenderer.invoke('ms-device-code', arg),
  msPollToken: (dc) => ipcRenderer.invoke('ms-poll-token', dc),

  openExternal: (url) => ipcRenderer.send('open-external', url),
  copyToClipboard: (text) => ipcRenderer.send('copy-clipboard', text),
  openFolder: (p) => ipcRenderer.invoke('open-folder', p),
  openVersionFolder: (arg) => ipcRenderer.invoke('open-version-folder', arg),
  scanMods: (arg) => ipcRenderer.invoke('scan-mods', arg),
  toggleMod: (arg) => ipcRenderer.invoke('toggle-mod', arg),
  deleteMod: (arg) => ipcRenderer.invoke('delete-mod', arg),

  selectFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  defaultDownloadDir: () => ipcRenderer.invoke('default-download-dir'),
  defaultMcDir: () => ipcRenderer.invoke('default-mc-dir'),
  listDrives: () => ipcRenderer.invoke('list-drives'),
  resolveTargetDir: (arg) => ipcRenderer.invoke('resolve-target-dir', arg),
  selectFile: (filters) => ipcRenderer.invoke('dialog:openFile', filters),

  downloadFile: (url, dir, name, taskId) => ipcRenderer.invoke('downloadFile', { url, saveDir: dir, filename: name, taskId }),
  onDownloadProgress: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('download-progress', h);
    return () => ipcRenderer.removeListener('download-progress', h);
  },

  launchGame: (opts) => ipcRenderer.invoke('launch-game', opts),
  launchCancel: () => ipcRenderer.invoke('launch-cancel'),
  externalAuth: (arg) => ipcRenderer.invoke('external-auth', arg),
  externalRefreshTextures: (arg) => ipcRenderer.invoke('external-refresh-textures', arg),
  yggdrasilResolveRoot: (server) => ipcRenderer.invoke('yggdrasil-resolve-root', server),
  gameRunningList: () => ipcRenderer.invoke('game-running-list'),
  gameKill: (pid) => ipcRenderer.invoke('game-kill', pid),
  onGameRunningChanged: (cb) => {
    const h = (_e, list) => cb(list);
    ipcRenderer.on('game-running-changed', h);
    return () => ipcRenderer.removeListener('game-running-changed', h);
  },
  onLaunchProgress: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('game-launch-progress', h);
    return () => ipcRenderer.removeListener('game-launch-progress', h);
  },
  deleteVersion: (gameDir, versionId) => ipcRenderer.invoke('delete-version', { gameDir, versionId }),
  getSystemMemory: () => ipcRenderer.invoke('get-system-memory'),
  memoryOptimize: () => ipcRenderer.invoke('memory-optimize'),
  cleanupGarbage: (gameDir, allDirs) => ipcRenderer.invoke('cleanup-garbage', (gameDir || (allDirs && allDirs.length)) ? { gameDir, allDirs } : undefined),
  backupSaves: (gameDir) => ipcRenderer.invoke('backup-saves', { gameDir }),
  restoreSaves: (gameDir, backupPath) => ipcRenderer.invoke('restore-saves', { gameDir, backupPath }),
  listSaves: (gameDir) => ipcRenderer.invoke('list-saves', { gameDir }),
  findJava: () => ipcRenderer.invoke('find-java'),
  getJavaMajor: (p) => ipcRenderer.invoke('get-java-major', p),
  serverJavaList: () => ipcRenderer.invoke('server-java-list'),
  listJava: (arg) => ipcRenderer.invoke('list-java', arg),
  importJava: () => ipcRenderer.invoke('import-java'),
  removeCustomJava: (p) => ipcRenderer.invoke('remove-custom-java', p),
  appVersion: () => ipcRenderer.invoke('app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadAndInstallUpdate: (info) => ipcRenderer.invoke('download-and-install-update', info),
  runUpdateInstaller: (p) => ipcRenderer.invoke('run-update-installer', p),
  showItemInFolder: (p) => ipcRenderer.invoke('show-item-in-folder', p),
  onUpdateProgress: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('update-progress', h);
    return () => ipcRenderer.removeListener('update-progress', h);
  },
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  importModpack: (arg) => ipcRenderer.invoke('import-modpack', arg),
  installCfModpack: (arg) => ipcRenderer.invoke('install-cf-modpack', arg),
  classifyArchive: (arg) => ipcRenderer.invoke('classify-archive', arg),
  installDrop: (arg) => ipcRenderer.invoke('install-drop', arg),
  exportModpack: (arg) => ipcRenderer.invoke('export-modpack', arg),
  diskFree: (p) => ipcRenderer.invoke('disk-free', p),
  scanMinecraft: () => ipcRenderer.invoke('scan-minecraft'),
  // 静默扫描默认 .minecraft 及调用方给定的游戏目录（不弹目录框），用于启动时自动识别已装版本/加载器
  autoScanVersions: (dirs) => ipcRenderer.invoke('auto-scan-versions', { dirs: Array.isArray(dirs) ? dirs : [] }),
  installMinecraftVersion: (opts) => ipcRenderer.invoke('install-minecraft-version', opts),
  onInstallProgress: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('mc-install-progress', h);
    return () => ipcRenderer.removeListener('mc-install-progress', h);
  },
  installCancel: () => ipcRenderer.invoke('install-cancel'),

  // 陶瓦联机（EasyTier）
  lanCoreInfo: () => ipcRenderer.invoke('lan-core-info'),
  lanStartHost: () => ipcRenderer.invoke('lan-start-host'),
  lanStartJoin: (code) => ipcRenderer.invoke('lan-start-join', code),
  lanSetHostPort: (port) => ipcRenderer.invoke('lan-set-host-port', port),
  lanWatchLog: (logPath) => ipcRenderer.invoke('lan-watch-log', logPath),
  lanStop: () => ipcRenderer.invoke('lan-stop'),
  lanGetState: () => ipcRenderer.invoke('lan-get-state'),
  lanLogs: () => ipcRenderer.invoke('lan-logs'),
  lanStatus: () => ipcRenderer.invoke('lan-status'),
  onLanLog: (cb) => { const h = (_e, l) => cb(l); ipcRenderer.on('lan-log', h); return () => ipcRenderer.removeListener('lan-log', h); },
  onLanPort: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on('lan-port', h); return () => ipcRenderer.removeListener('lan-port', h); },
  onLanState: (cb) => { const h = (_e, st) => cb(st); ipcRenderer.on('lan-state', h); return () => ipcRenderer.removeListener('lan-state', h); },

  // 异地联机（赞助版）：外部调用官方 EasyTier 程序，仅启动/停止其进程
  remoteCoreInfo: () => ipcRenderer.invoke('remote-core-info'),
  remoteStart: (cfg) => ipcRenderer.invoke('remote-start', cfg),
  remoteStop: () => ipcRenderer.invoke('remote-stop'),
  remoteLogs: () => ipcRenderer.invoke('remote-logs'),
  onRemoteLog: (cb) => { const h = (_e, l) => cb(l); ipcRenderer.on('remote-log', h); return () => ipcRenderer.removeListener('remote-log', h); },
  onRemoteState: (cb) => { const h = (_e, st) => cb(st); ipcRenderer.on('remote-state', h); return () => ipcRenderer.removeListener('remote-state', h); },

  // 本地开服（赞助版）
  serverInstall: (arg) => ipcRenderer.invoke('server-install', arg),
  serverList: () => ipcRenderer.invoke('server-list'),
  serverStart: (arg) => ipcRenderer.invoke('server-start', arg),
  serverStop: () => ipcRenderer.invoke('server-stop'),
  serverState: () => ipcRenderer.invoke('server-state'),
  serverLogs: () => ipcRenderer.invoke('server-logs'),
  serverCommand: (command) => ipcRenderer.invoke('server-command', { command }),
  serverRemove: (dir) => ipcRenderer.invoke('server-remove', { dir }),
  onServerLog: (cb) => { const h = (_e, l) => cb(l); ipcRenderer.on('server-log', h); return () => ipcRenderer.removeListener('server-log', h); },
  onServerInstallLog: (cb) => { const h = (_e, l) => cb(l); ipcRenderer.on('server-install-log', h); return () => ipcRenderer.removeListener('server-install-log', h); },
  serverInstallState: () => ipcRenderer.invoke('server-install-state'),
  onServerInstallProgress: (cb) => { const h = (_e, st) => cb(st); ipcRenderer.on('server-install-progress', h); return () => ipcRenderer.removeListener('server-install-progress', h); },
  onServerState: (cb) => { const h = (_e, st) => cb(st); ipcRenderer.on('server-state', h); return () => ipcRenderer.removeListener('server-state', h); },

  // 赞助版联网激活（密钥 · 硬件绑定）
  hardwareId: () => ipcRenderer.invoke('hardware-id'),
  licenseActivate: (key) => ipcRenderer.invoke('license-activate', { key }),
  licenseStatus: () => ipcRenderer.invoke('license-status'),
  licenseClear: () => ipcRenderer.invoke('license-clear'),
  licenseRelease: () => ipcRenderer.invoke('license-release'),

  // MC百科中文译名实时查询（mcmod.cn），失败时前端回退内置译名表
  mcmodLookup: (q) => ipcRenderer.invoke('mcmod-lookup', q),

  isElectron: true,
});
