import { useState, useEffect, useCallback, useMemo } from 'react';
import { scopedStorage, logger } from '@lark-apaas/client-toolkit-lite';
import {
  IAccount,
  IInstalledVersion,
  IMod,
  ILauncherSettings,
  ILogEntry,
  ISavedSkin,
  DEFAULT_SETTINGS,
  MOCK_INITIAL_LOGS,
  STORAGE_KEYS,
  accountKey,
  defaultSkinForName,
} from '@/data/launcher';

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = scopedStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.warn(`Failed to read storage ${key}:`, String(err));
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T): void {
  try {
    scopedStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    logger.warn(`Failed to write storage ${key}:`, String(err));
  }
}

// ---- Multi-account bootstrap (migrate the legacy single account) ----
function bootstrapAccounts(): { accounts: IAccount[]; currentAccountId: string } {
  // 权威 id 永远由「登录类型 + 唯一身份」重新生成，而不是沿用记录里可能被污染的 id：
  // 旧版本曾让正版账号继承离线账号 id，导致离线记录被覆盖。按 accountKey 重建可幂等纠正，
  // 且不同登录类型前缀不同（offline:/external:/ms:），物理上不可能再互相覆盖。
  const normalize = (a: IAccount): IAccount => ({
    ...a,
    id: accountKey(a),
    // backfill an official skin for offline/external accounts created without one
    skinUrl: a.skinUrl || (a.type === 'microsoft' ? a.skinUrl : defaultSkinForName(a.username)),
  });
  const richness = (a: IAccount) => (a.accessToken ? 2 : 0) + (a.skinUrl ? 1 : 0) + (a.uuid ? 1 : 0);
  const dedupe = (list: IAccount[]): IAccount[] => {
    const byId = new Map<string, IAccount>();
    for (const a of list) {
      const ex = byId.get(a.id!);
      // 同身份重复记录：保留信息更全的一条，不丢字段
      byId.set(a.id!, ex && richness(ex) > richness(a) ? { ...a, ...ex, id: a.id } : a);
    }
    return [...byId.values()];
  };
  const stored = readStorage<IAccount[]>(STORAGE_KEYS.ACCOUNTS, []);
  let accounts: IAccount[] = dedupe(stored.map(normalize));
  if (accounts.length === 0) {
    const legacy = readStorage<IAccount | null>(STORAGE_KEYS.ACCOUNT, null);
    if (legacy) accounts = [normalize(legacy)];
  }
  let currentAccountId = readStorage<string>(STORAGE_KEYS.CURRENT_ACCOUNT, '');
  if (!accounts.some((a) => a.id === currentAccountId)) currentAccountId = accounts[0]?.id || '';
  return { accounts, currentAccountId };
}
// Correct legacy records that were imported as 'vanilla' even though their id names a loader.
function inferLoaderFromId(id: string, current?: IInstalledVersion['loader']): IInstalledVersion['loader'] {
  if (current && current !== 'vanilla') return current;
  const n = String(id || '').toLowerCase();
  if (n.includes('neoforge')) return 'neoforge';
  if (n.includes('fabric')) return 'fabric';
  if (n.includes('quilt')) return 'quilt';
  if (n.includes('forge')) return 'forge';
  return current || 'vanilla';
}

const boot = bootstrapAccounts();

let storeState = {
  accounts: boot.accounts,
  currentAccountId: boot.currentAccountId,
  currentVersion: readStorage<string>(STORAGE_KEYS.CURRENT_VERSION, ''),
  installedVersions: readStorage<IInstalledVersion[]>(STORAGE_KEYS.INSTALLED_VERSIONS, []).map((v) => ({ ...v, loader: inferLoaderFromId(v.id, v.loader) })),
  installedMods: readStorage<IMod[]>(STORAGE_KEYS.INSTALLED_MODS, []),
  // Merge defaults over stored settings so newly added keys (versionIsolation/downloadSource) are backfilled.
  settings: { ...DEFAULT_SETTINGS, ...readStorage<Partial<ILauncherSettings>>(STORAGE_KEYS.SETTINGS, {}) },
  logs: readStorage<ILogEntry[]>(STORAGE_KEYS.LOGS, MOCK_INITIAL_LOGS),
  savedSkins: readStorage<ISavedSkin[]>(STORAGE_KEYS.SAVED_SKINS, []),
};
// Persist migrated multi-account state once.
writeStorage(STORAGE_KEYS.ACCOUNTS, storeState.accounts);
writeStorage(STORAGE_KEYS.CURRENT_ACCOUNT, storeState.currentAccountId);
// Persist loader-corrected installed versions once.
writeStorage(STORAGE_KEYS.INSTALLED_VERSIONS, storeState.installedVersions);

// Migration: clear old mock mods data from previous versions
const STORE_VERSION = 'v2';
const savedVersion = scopedStorage.getItem('__glowstone_storeVersion');
if (savedVersion !== STORE_VERSION) {
  storeState.installedMods = [];
  writeStorage(STORAGE_KEYS.INSTALLED_MODS, []);
  scopedStorage.setItem('__glowstone_storeVersion', STORE_VERSION);
}

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function persistAccounts() {
  writeStorage(STORAGE_KEYS.ACCOUNTS, storeState.accounts);
  writeStorage(STORAGE_KEYS.CURRENT_ACCOUNT, storeState.currentAccountId);
  // keep legacy key in sync with the current account
  const cur = storeState.accounts.find((a) => a.id === storeState.currentAccountId) || null;
  writeStorage(STORAGE_KEYS.ACCOUNT, cur);
}

function addLog(level: ILogEntry['level'], message: string, source: ILogEntry['source'] = 'launcher') {
  const now = new Date();
  const timestamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const entry: ILogEntry = { timestamp, level, message, source };
  storeState = { ...storeState, logs: [...storeState.logs.slice(-200), entry] };
  writeStorage(STORAGE_KEYS.LOGS, storeState.logs);
  notify();
}

export function useLauncherStore() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    return subscribe(() => forceUpdate((n) => n + 1));
  }, []);

  // Add (or update, by identity) an account and make it current. Never overwrites others.
  const addAccount = useCallback((acc: IAccount) => {
    // id 永远按「类型+身份」现算，绝不采用外部传入的 id，从根上杜绝正版继承离线 id 后覆盖。
    let id = accountKey(acc);
    const normalized: IAccount = { ...acc, id, addedAt: acc.addedAt || Date.now() };
    let idx = storeState.accounts.findIndex((a) => a.id === id);
    // 兜底：理论上不同类型前缀不同不会撞；若同 id 记录类型不一致，仍单独建档而非覆盖。
    if (idx >= 0 && storeState.accounts[idx].type !== normalized.type) {
      let n = 2;
      while (storeState.accounts.some((a) => a.id === `${id}#${n}`)) n++;
      id = `${id}#${n}`;
      normalized.id = id;
      idx = -1;
    }
    if (idx >= 0) {
      // merge, preserving fields not supplied (e.g. skin)
      const merged = { ...storeState.accounts[idx], ...normalized, id };
      const accounts = storeState.accounts.slice();
      accounts[idx] = merged;
      storeState = { ...storeState, accounts, currentAccountId: id };
    } else {
      storeState = { ...storeState, accounts: [...storeState.accounts, normalized], currentAccountId: id };
      const label = normalized.type === 'microsoft' ? '正版' : normalized.type === 'external' ? '外置' : '离线';
      addLog('INFO', `已添加${label}账号: ${normalized.username}`);
    }
    persistAccounts();
    notify();
    return id;
  }, []);

  const switchAccount = useCallback((id: string) => {
    if (!storeState.accounts.some((a) => a.id === id)) return;
    if (storeState.currentAccountId === id) return;
    storeState = { ...storeState, currentAccountId: id };
    persistAccounts();
    const a = storeState.accounts.find((x) => x.id === id);
    if (a) addLog('INFO', `已切换账号: ${a.username}`);
    notify();
  }, []);

  const removeAccount = useCallback((id: string) => {
    const target = storeState.accounts.find((a) => a.id === id);
    let accounts = storeState.accounts.filter((a) => a.id !== id);
    let currentAccountId = storeState.currentAccountId;
    if (currentAccountId === id) currentAccountId = accounts[0]?.id || '';
    storeState = { ...storeState, accounts, currentAccountId };
    persistAccounts();
    if (target) addLog('INFO', `已删除账号: ${target.username}`);
    notify();
  }, []);

  // Merge a patch into a specific account (defaults to current).
  const updateAccount = useCallback((id: string | null, patch: Partial<IAccount>) => {
    const targetId = id || storeState.currentAccountId;
    const accounts = storeState.accounts.map((a) => (a.id === targetId ? { ...a, ...patch, id: a.id } : a));
    storeState = { ...storeState, accounts };
    persistAccounts();
    notify();
  }, []);

  // Backward-compatible facade used across existing pages.
  //  - null                 -> remove the current account
  //  - same identity/current-> merge into current (skin refresh, etc.)
  //  - different identity   -> add & switch (so adding an offline account no longer
  //                           overwrites a signed-in Microsoft account)
  const setAccount = useCallback((account: Partial<IAccount> | IAccount | null) => {
    if (account === null) { removeAccount(storeState.currentAccountId); return; }
    const curId = storeState.currentAccountId;
    const current = storeState.accounts.find((a) => a.id === curId);
    // When the incoming record is a different login TYPE, it must not inherit the current
    // account's id (otherwise signing in Microsoft would overwrite the offline account).
    const crossType = current && account.type && account.type !== current.type;
    const base = crossType ? {} : (current || {});
    const candidate = { ...base, ...account } as IAccount;
    if (crossType) delete candidate.id;
    if (!crossType && ((account.id && account.id === curId) || (!account.id && current && accountKey(candidate) === curId))) {
      updateAccount(curId, account);
    } else {
      addAccount(candidate);
    }
  }, [addAccount, removeAccount, updateAccount]);

  const setCurrentVersion = useCallback((versionId: string) => {
    storeState = { ...storeState, currentVersion: versionId };
    writeStorage(STORAGE_KEYS.CURRENT_VERSION, versionId);
    notify();
  }, []);

  const addInstalledVersion = useCallback((version: IInstalledVersion) => {
    const exists = storeState.installedVersions.some((v) => v.id === version.id);
    if (exists) { addLog('WARN', `版本 ${version.id} 已存在`); return false; }
    storeState = { ...storeState, installedVersions: [...storeState.installedVersions, version] };
    if (!storeState.currentVersion) storeState = { ...storeState, currentVersion: version.id };
    writeStorage(STORAGE_KEYS.INSTALLED_VERSIONS, storeState.installedVersions);
    writeStorage(STORAGE_KEYS.CURRENT_VERSION, storeState.currentVersion);
    addLog('INFO', `版本 ${version.id} 安装完成`);
    notify();
    return true;
  }, []);

  const updateInstalledVersion = useCallback((id: string, patch: Partial<IInstalledVersion>) => {
    storeState = { ...storeState, installedVersions: storeState.installedVersions.map((v) => v.id === id ? { ...v, ...patch } : v) };
    writeStorage(STORAGE_KEYS.INSTALLED_VERSIONS, storeState.installedVersions);
    notify();
  }, []);

  const removeInstalledVersion = useCallback((id: string) => {
    storeState = { ...storeState, installedVersions: storeState.installedVersions.filter((v) => v.id !== id) };
    if (storeState.currentVersion === id) {
      storeState = { ...storeState, currentVersion: storeState.installedVersions[0]?.id ?? '' };
      writeStorage(STORAGE_KEYS.CURRENT_VERSION, storeState.currentVersion);
    }
    writeStorage(STORAGE_KEYS.INSTALLED_VERSIONS, storeState.installedVersions);
    addLog('INFO', `版本 ${id} 已删除`);
    notify();
  }, []);

  // 合并启动时静默扫描到的本机版本（含其他启动器安装的版本）。
  // 幂等：新版本入库；已存在则仅在加载器/目录/类型变化时刷新，并保留用户自定义图标与收藏。
  const mergeScannedVersions = useCallback((scanned: Array<{
    id: string; versionId?: string; gameDir?: string; versionType?: string;
    loader?: IInstalledVersion['loader']; loaderVersion?: string;
  }>) => {
    const iconFor = (loader?: string, vt?: string): string => {
      if (loader && ['fabric', 'forge', 'neoforge', 'optifine', 'quilt'].includes(loader)) return loader;
      if (vt === 'snapshot') return 'command';
      if (vt === 'old_alpha' || vt === 'old_beta' || vt === 'old') return 'cobble';
      return 'grass';
    };
    let added = 0;
    let changed = false;
    const list = [...storeState.installedVersions];
    for (const s of scanned) {
      if (!s || !s.id) continue;
      const loader = ((s.loader && s.loader !== 'vanilla')
        ? s.loader
        : inferLoaderFromId(s.id, s.loader as IInstalledVersion['loader'])) as IInstalledVersion['loader'];
      const vtRaw = s.versionType;
      const versionType = (vtRaw === 'snapshot' || vtRaw === 'old_alpha' || vtRaw === 'old_beta' || vtRaw === 'april_fools')
        ? vtRaw as IInstalledVersion['versionType']
        : 'release' as IInstalledVersion['versionType'];
      const idx = list.findIndex((v) => v.id === s.id);
      if (idx >= 0) {
        const ex = list[idx];
        const isCustomIcon = typeof ex.icon === 'string' && (ex.icon.startsWith('data:') || ex.icon.startsWith('custom:'));
        const nextIcon = isCustomIcon ? ex.icon : iconFor(loader, versionType);
        const nextGameDir = s.gameDir ?? ex.gameDir;
        const nextLoaderVer = s.loaderVersion ?? ex.loaderVersion;
        if (ex.loader === loader && ex.loaderVersion === nextLoaderVer && ex.gameDir === nextGameDir
          && ex.versionType === versionType && ex.icon === nextIcon) continue;
        list[idx] = { ...ex, loader, loaderVersion: nextLoaderVer, gameDir: nextGameDir, versionType, icon: nextIcon };
        changed = true;
      } else {
        list.push({
          id: s.id,
          versionId: s.versionId || s.id,
          loader,
          loaderVersion: s.loaderVersion,
          icon: iconFor(loader, versionType),
          category: versionType === 'release' ? '正式版' : versionType === 'snapshot' ? '预览版' : '远古版',
          description: '自动识别本机版本',
          isFavorite: false,
          installTime: Date.now(),
          gameDir: s.gameDir || '',
          minMemoryMB: 512,
          maxMemoryMB: 4096,
          versionType,
        } as IInstalledVersion);
        added++;
        changed = true;
      }
    }
    if (!changed) return { added: 0, updated: 0 };
    let currentVersion = storeState.currentVersion;
    if (!currentVersion && list.length) currentVersion = list[0].id;
    storeState = { ...storeState, installedVersions: list, currentVersion };
    writeStorage(STORAGE_KEYS.INSTALLED_VERSIONS, list);
    writeStorage(STORAGE_KEYS.CURRENT_VERSION, currentVersion);
    if (added > 0) addLog('INFO', `自动识别到 ${added} 个本机版本`);
    notify();
    return { added, updated: 0 };
  }, []);

  const setModEnabled = useCallback((modId: string, enabled: boolean) => {
    storeState = { ...storeState, installedMods: storeState.installedMods.map((m) => m.id === modId ? { ...m, enabled } : m) };
    writeStorage(STORAGE_KEYS.INSTALLED_MODS, storeState.installedMods);
    addLog('INFO', `模组 ${modId} 已${enabled ? '启用' : '禁用'}`);
    notify();
  }, []);

  const addInstalledMod = useCallback((mod: IMod) => {
    const exists = storeState.installedMods.some((m) => m.id === mod.id);
    if (exists) { addLog('WARN', `模组 ${mod.name} 已存在`); return false; }
    storeState = { ...storeState, installedMods: [...storeState.installedMods, mod] };
    writeStorage(STORAGE_KEYS.INSTALLED_MODS, storeState.installedMods);
    addLog('INFO', `模组 ${mod.name} 安装完成`);
    notify();
    return true;
  }, []);

  const removeInstalledMod = useCallback((modId: string) => {
    storeState = { ...storeState, installedMods: storeState.installedMods.filter((m) => m.id !== modId) };
    writeStorage(STORAGE_KEYS.INSTALLED_MODS, storeState.installedMods);
    addLog('INFO', `模组 ${modId} 已移除`);
    notify();
  }, []);

  const addSavedSkin = useCallback((skin: ISavedSkin) => {
    storeState = { ...storeState, savedSkins: [...storeState.savedSkins, skin] };
    writeStorage(STORAGE_KEYS.SAVED_SKINS, storeState.savedSkins);
    notify();
  }, []);

  const removeSavedSkin = useCallback((skinId: string) => {
    storeState = { ...storeState, savedSkins: storeState.savedSkins.filter((s) => s.id !== skinId) };
    writeStorage(STORAGE_KEYS.SAVED_SKINS, storeState.savedSkins);
    notify();
  }, []);

  const setSettings = useCallback((settings: Partial<ILauncherSettings> | ((prev: ILauncherSettings) => ILauncherSettings)) => {
    storeState = { ...storeState, settings: typeof settings === 'function' ? settings(storeState.settings) : { ...storeState.settings, ...settings } };
    writeStorage(STORAGE_KEYS.SETTINGS, storeState.settings);
    if (settings && typeof settings !== 'function' && 'theme' in settings && settings.theme) {
      document.documentElement.classList.toggle('dark', settings.theme === 'dark');
    }
    notify();
  }, []);

  const clearLogs = useCallback(() => {
    storeState = { ...storeState, logs: [] };
    writeStorage(STORAGE_KEYS.LOGS, []);
    notify();
  }, []);

  const appendLog = useCallback((level: ILogEntry['level'], message: string, source: ILogEntry['source'] = 'launcher') => {
    addLog(level, message, source);
  }, []);

  const account = useMemo(() => {
    return storeState.accounts.find((a) => a.id === storeState.currentAccountId)
      || storeState.accounts[0]
      || null;
  }, [storeState.currentAccountId, storeState.accounts]);

  const currentVersionObj = useMemo(() => {
    return storeState.installedVersions.find((v) => v.id === storeState.currentVersion) ?? null;
  }, [storeState.currentVersion, storeState.installedVersions]);

  return {
    account,
    accounts: storeState.accounts,
    currentAccountId: account ? account.id : storeState.currentAccountId,
    currentVersion: storeState.currentVersion,
    currentVersionObj,
    installedVersions: storeState.installedVersions,
    installedMods: storeState.installedMods,
    settings: storeState.settings,
    logs: storeState.logs,
    savedSkins: storeState.savedSkins,
    setAccount,
    addAccount,
    switchAccount,
    removeAccount,
    updateAccount,
    setCurrentVersion,
    addInstalledVersion,
    updateInstalledVersion,
    removeInstalledVersion,
    mergeScannedVersions,
    setModEnabled,
    addInstalledMod,
    removeInstalledMod,
    addSavedSkin,
    removeSavedSkin,
    setSettings,
    clearLogs,
    appendLog,
  };
}
