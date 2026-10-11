// 异地联机（GlowRemote）—— 以子进程方式“外部调用”官方 EasyTier 程序 easytier-core.exe。
// 重要：本文件不包含、也不修改 EasyTier 源代码，只负责按用户在界面上的网络参数启动/停止其
// 官方可执行文件；退出联机或应用退出时自动结束该进程。EasyTier 依据 Apache-2.0 授权。
const path = require('path');
const cp = require('child_process');
const fs = require('fs');

// 公共引导节点（用于让分散在各地的节点能互相发现；与本机是否在同一局域网无关）
const PUBLIC_PEERS = [
  'tcp://140.150.236.98:11010',
  'tcp://39.108.52.138:11010',
  'tcp://public.easytier.cn:11010',
];

function initRemoteLan({ ipcMain, app, getMainWindow }) {
  const send = (channel, payload) => {
    const w = getMainWindow && getMainWindow();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };

  const coreDir = () => (app.isPackaged
    ? path.join(process.resourcesPath, 'easytier')
    : path.join(__dirname, '..', 'resources', 'easytier'));
  const coreExe = () => path.join(coreDir(), 'easytier-core.exe');

  const state = { proc: null, running: false, cfg: null, logs: [] };

  const emit = (line) => {
    const s = String(line).replace(/\r?\n$/, '');
    if (!s) return;
    state.logs.push(s);
    if (state.logs.length > 400) state.logs.shift();
    send('remote-log', s);
  };

  const kill = () => {
    if (!state.proc) return;
    const proc = state.proc;
    try { proc.kill(); } catch {}
    try { cp.spawnSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { windowsHide: true }); } catch {}
    if (state.proc === proc) state.proc = null;
  };

  ipcMain.handle('remote-core-info', async () => {
    const exists = fs.existsSync(coreExe());
    let version = '';
    if (exists) { try { version = (cp.execFileSync(coreExe(), ['--version'], { windowsHide: true, encoding: 'utf8' })).trim(); } catch {} }
    return { ready: exists, version, wintun: fs.existsSync(path.join(coreDir(), 'wintun.dll')) };
  });

  ipcMain.handle('remote-start', async (_e, arg) => {
    if (state.proc) kill();
    const networkName = String(arg.networkName || '').trim();
    const networkSecret = String(arg.networkSecret || '').trim();
    const virtIp = String(arg.virtIp || '').trim();
    if (!networkName || !networkSecret || !virtIp) return { success: false, error: '请填写网络名称、网络密钥和虚拟 IP' };
    if (!/^10\.\d+\.\d+\.\d+$/.test(virtIp)) return { success: false, error: '虚拟 IP 建议使用 10.x.x.x 形式，同一网络内各节点不得重复' };

    const args = [
      '--network-name', networkName,
      '--network-secret', networkSecret,
      '-i', virtIp,
      '--hostname', 'GlowRemote',
      '--console-log-level', 'info',
    ];
    // 免管理员模式：不创建虚拟网卡（--no-tun），改用 smoltcp，适合无法提权的环境
    if (arg.noTun === true) args.push('--no-tun', 'true', '--use-smoltcp', 'true', '--no-listener');

    // 引导节点：公共节点 + 用户自填节点
    const peers = [];
    if (arg.usePublicPeers !== false) peers.push(...PUBLIC_PEERS);
    for (const p of (Array.isArray(arg.customPeers) ? arg.customPeers : String(arg.customPeers || '').split(/[\s,;]+/))) {
      const u = String(p || '').trim();
      if (u) peers.push(u);
    }
    for (const u of peers) args.push('-p', u);

    state.logs = [];
    let proc;
    try { proc = cp.spawn(coreExe(), args, { cwd: coreDir(), windowsHide: false }); }
    catch (e) { return { success: false, error: '启动 easytier 失败：' + e.message }; }
    state.proc = proc;
    state.running = true;
    state.cfg = { networkName, virtIp, noTun: arg.noTun === true };
    proc.stdout.on('data', (b) => b.toString().split(/\r?\n/).forEach(emit));
    proc.stderr.on('data', (b) => b.toString().split(/\r?\n/).forEach(emit));
    proc.on('error', (e) => { emit('[启动失败] ' + e.message); send('remote-state', { running: false }); });
    proc.on('exit', (code) => {
      emit(`[EasyTier 已退出 code=${code}]`);
      if (state.proc === proc) { state.proc = null; state.running = false; }
      send('remote-state', { running: false, code });
    });

    send('remote-state', { running: true, ...state.cfg });
    return { success: true, ...state.cfg };
  });

  ipcMain.handle('remote-stop', async () => {
    kill(); state.running = false;
    send('remote-state', { running: false });
    return { success: true };
  });

  ipcMain.handle('remote-logs', async () => state.logs.slice(-200));

  // 应用退出时确保外部进程被回收
  app.on('before-quit', () => { try { kill(); } catch {} });

  return { stop: () => { kill(); state.running = false; } };
}

module.exports = { initRemoteLan };
