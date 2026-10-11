import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User, Plus, LogOut, ShieldCheck, Link2Off, Globe, RefreshCw,
  Upload, Trash2, Copy, Check, ExternalLink, AlertCircle, Loader2, ArrowLeft, Link2,
  Shirt, Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useLauncherStore } from '@/hooks/useLauncherStore';
import { OFFICIAL_SKINS, randomOfficialSkin } from '@/data/launcher';
import type { IAccount, ISavedSkin } from '@/data/launcher';
import Skin3DPreview from '@/components/Skin3DPreview';
import SkinFace from '@/components/SkinFace';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit-lite';
import { isMobileHost } from '@/mobile/bridge';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,16}$/;

interface MsNativeResult { success: boolean; username: string; uuid: string; accessToken: string; refreshToken: string }
interface ElectronAPI {
  msDeviceCode: (arg?: { clientId?: string }) => Promise<{ success: boolean; data?: { device_code: string; user_code: string; verification_uri: string; interval: number; expires_in: number }; error?: string; description?: string }>;
  msPollToken: (dc: string | { deviceCode: string; clientId?: string }) => Promise<{ success: boolean; data?: { username: string; uuid: string; accessToken: string }; error?: string; description?: string }>;
  msNativeLogin?: () => Promise<MsNativeResult>;
  fetchSkin?: (q: string) => Promise<{ success: boolean; dataUrl?: string; capeDataUrl?: string; error?: string }>;
  externalAuth?: (a: { server: string; username: string; password: string }) => Promise<{ success: boolean; data?: { username: string; uuid: string; accessToken: string; apiRoot?: string; skinUrl?: string; capeUrl?: string; slim?: boolean }; error?: string }>;
  externalRefreshTextures?: (a: { apiRoot: string; uuid: string }) => Promise<{ success: boolean; skinUrl?: string; capeUrl?: string; slim?: boolean; error?: string }>;
  openExternal: (url: string) => void;
  copyToClipboard: (text: string) => void;
}

function getElectronAPI(): ElectronAPI | null {
  return (window as unknown as { electronAPI?: ElectronAPI }).electronAPI ?? null;
}

export default function AccountPage() {
  const isMobile = isMobileHost();
  const { account, accounts, setAccount, addAccount, updateAccount, switchAccount, removeAccount, savedSkins, addSavedSkin, removeSavedSkin, appendLog, settings } = useLauncherStore();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  // true = showing the three login-type cards; false = inside one type's form (needs a Back button).
  const [picking, setPicking] = useState(true);
  const [loginType, setLoginType] = useState<'microsoft' | 'offline' | 'external'>('offline');
  const [offlineUsername, setOfflineUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [externalServer, setExternalServer] = useState('');
  const [externalUsername, setExternalUsername] = useState('');
  const [externalPassword, setExternalPassword] = useState('');
  const [externalLoading, setExternalLoading] = useState(false);
  const [extSyncing, setExtSyncing] = useState(false);
  const lastExtSyncRef = useRef<{ key: string; t: number }>({ key: '', t: 0 });

  // Microsoft login state
  const [msCode, setMsCode] = useState('');
  const [msCodeCopied, setMsCodeCopied] = useState(false);
  const [msPolling, setMsPolling] = useState(false);
  const [msStatus, setMsStatus] = useState('');
  const [msError, setMsError] = useState('');
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Skin state
  const [skinTab, setSkinTab] = useState<'saved' | 'official'>('saved');
  const [selectedSkinUrl, setSelectedSkinUrl] = useState(account?.skinUrl || '');
  const [skinName, setSkinName] = useState('');
  const [skinQuery, setSkinQuery] = useState('');
  const [skinLoading, setSkinLoading] = useState(false);
  // 正版披风：右键菜单 + 披风选择弹窗
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; accId: string } | null>(null);
  const [capeDlgOpen, setCapeDlgOpen] = useState(false);
  const [capeAccId, setCapeAccId] = useState('');
  const [capes, setCapes] = useState<{ id: string; state: string; alias: string; url: string; img: string }[]>([]);
  const [capeLoading, setCapeLoading] = useState(false);
  const [uploadingSkin, setUploadingSkin] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (account?.skinUrl) setSelectedSkinUrl(account.skinUrl);
  }, [account?.skinUrl]);

  // 选中外置账号时自动从皮肤站同步一次（20s 节流），实现皮肤/披风实时跟随 LittleSkin
  useEffect(() => {
    if (!account || account.type !== 'external' || !account.externalServer || !account.uuid || !account.id) return;
    const key = account.id;
    const now = Date.now();
    if (lastExtSyncRef.current.key === key && now - lastExtSyncRef.current.t < 20000) return;
    lastExtSyncRef.current = { key, t: now };
    void downloadExternalTextures(account.id, account.externalServer, account.uuid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id, account?.type]);

  // 窗口重新获得焦点时自动刷新当前账号材质：在 LittleSkin 网页 / 微软官网换肤后回到启动器
  // 即自动更新 3D 与头像，无需手动刷新或重启页面（15s 节流，避免频繁请求）
  const lastFocusSyncRef = useRef(0);
  useEffect(() => {
    const a = account;
    if (!a) return;
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusSyncRef.current < 15000) return;
      lastFocusSyncRef.current = now;
      const api = getElectronAPI();
      if (a.type === 'external' && a.id && a.externalServer && a.uuid) {
        void downloadExternalTextures(a.id, a.externalServer, a.uuid);
      } else if (a.type === 'microsoft' && a.id && a.uuid && api?.fetchSkin) {
        api.fetchSkin(a.uuid).then((r) => {
          if (r?.success && r.dataUrl) updateAccount(a.id!, { skinUrl: r.dataUrl, ...(r.capeDataUrl ? { capeUrl: r.capeDataUrl } : {}) });
        }).catch(() => {});
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id, account?.type, account?.uuid, account?.externalServer]);

  useEffect(() => {
    return () => { if (pollTimerRef.current) clearTimeout(pollTimerRef.current); };
  }, []);

  useEffect(() => {
    if (!offlineUsername) { setUsernameError('请输入用户名'); return; }
    if (offlineUsername.length < 3) { setUsernameError('用户名至少 3 个字符'); return; }
    if (offlineUsername.length > 16) { setUsernameError('用户名最多 16 个字符'); return; }
    if (/[\u4e00-\u9fa5]/.test(offlineUsername)) { setUsernameError('用户名不能包含中文'); return; }
    if (!USERNAME_REGEX.test(offlineUsername)) { setUsernameError('只能包含字母、数字和下划线'); return; }
    setUsernameError('');
  }, [offlineUsername]);

  const copyCode = (code: string) => {
    if (!code) return;
    const api = getElectronAPI();
    if (api) api.copyToClipboard(code);
    else { try { navigator.clipboard.writeText(code); } catch (err) { logger.warn('Clipboard failed:', String(err)); } }
    setMsCodeCopied(true);
    setTimeout(() => setMsCodeCopied(false), 2000);
  };

  const startMicrosoftLogin = async () => {
    setMsError('');
    setMsCode('');

    const api = getElectronAPI();

    // 手机端：App 内 WebView 原生登录，不走设备码、不跳系统浏览器
    if (isMobile) {
      if (!api?.msNativeLogin) { setMsError('当前环境不支持正版登录'); return; }
      setMsPolling(true);
      setMsStatus('正在打开微软登录页面…');
      try {
        const r = await api.msNativeLogin();
        cancelMsLogin();
        setAddDialogOpen(false);
        const newId = addAccount({
          type: 'microsoft',
          username: r.username,
          uuid: r.uuid,
          accessToken: r.accessToken,
          avatar: 'steve',
        });
        api.fetchSkin?.(r.uuid).then((s) => {
          if (s?.success && s.dataUrl && newId) {
            updateAccount(newId, { skinUrl: s.dataUrl, ...(s.capeDataUrl ? { capeUrl: s.capeDataUrl } : {}) });
          }
        }).catch(() => {});
        toast.success(`欢迎回来，${r.username}！`);
        appendLog('INFO', `微软账号登录成功: ${r.username}`);
      } catch {
        // 用户在原生登录页取消：静默返回，不弹错误
        cancelMsLogin();
      }
      return;
    }

    setMsStatus('正在请求设备代码...');
    setMsPolling(true);
    if (!api) {
      setMsError('需要在桌面端中运行才能使用正版登录');
      setMsPolling(false);
      return;
    }

    const azureClientId = (settings as Record<string, unknown>).azureClientId as string | undefined;
    const clientId = azureClientId && azureClientId.trim() ? azureClientId.trim() : undefined;
    const res = await api.msDeviceCode(clientId ? { clientId } : undefined);
    if (!res.success || !res.data) {
      setMsError(res.description || res.error || '获取设备代码失败，请检查网络');
      setMsPolling(false);
      return;
    }

    const { device_code, user_code, verification_uri, interval } = res.data;
    setMsCode(user_code);
    setMsStatus('请在浏览器中输入代码，等待登录确认...');
    appendLog('INFO', `微软登录设备码: ${user_code}`);

    copyCode(user_code);
    api.openExternal(verification_uri);

    let pollInterval = Math.max(interval || 5, 2) * 1000;
    const startTime = Date.now();
    const timeout = (res.data.expires_in || 900) * 1000;

    let transientFails = 0;
    const poll = async () => {
      if (Date.now() - startTime > timeout) {
        setMsError('登录超时，请重试');
        setMsPolling(false);
        return;
      }
      let tokenRes;
      try {
        tokenRes = await api.msPollToken({ deviceCode: device_code, clientId });
      } catch {
        // IPC/network hiccup must NOT kill the polling loop
        transientFails++;
        if (transientFails <= 12) { pollTimerRef.current = setTimeout(poll, Math.max(pollInterval, 4000)); return; }
        setMsError('网络连接不稳定，登录已中断，请重试');
        setMsPolling(false);
        return;
      }
      if (tokenRes.success && tokenRes.data) {
        setMsStatus('正在获取游戏资料...');
        cancelMsLogin();
        setAddDialogOpen(false);
        const msData = tokenRes.data;
        const newId = addAccount({
          type: 'microsoft',
          username: msData.username,
          uuid: msData.uuid,
          accessToken: msData.accessToken,
          refreshToken: (msData as { refreshToken?: string }).refreshToken || '',
          avatar: 'steve',
        });
        // 正版账号：用 UUID 直接拉取其正版皮肤与披风并写回账号（失败不影响登录）
        api.fetchSkin?.(msData.uuid).then((r) => {
          if (r?.success && r.dataUrl && newId) {
            updateAccount(newId, { skinUrl: r.dataUrl, ...(r.capeDataUrl ? { capeUrl: r.capeDataUrl } : {}) });
          }
        }).catch(() => {});
        toast.success(`欢迎回来，${msData.username}！`);
        appendLog('INFO', `微软账号登录成功: ${msData.username}`);
        return;
      }
      if (tokenRes.error === 'authorization_pending') {
        setMsStatus('请在打开的网页中登录微软账号并输入代码，完成后这里会自动继续...');
        pollTimerRef.current = setTimeout(poll, pollInterval);
        return;
      }
      if (tokenRes.error === 'slow_down') {
        pollInterval += 5000;
        pollTimerRef.current = setTimeout(poll, pollInterval);
        return;
      }
      // transient network-level errors: keep polling a few times instead of giving up
      if (tokenRes.error === 'network_error') {
        transientFails++;
        if (transientFails <= 12) { setMsStatus('网络波动，正在重试连接登录服务器...'); pollTimerRef.current = setTimeout(poll, 5000); return; }
      }
      if (tokenRes.error === 'authorization_declined') setMsError('你拒绝了登录授权');
      else if (tokenRes.error === 'expired_token') setMsError('设备代码已过期，请重试');
      else setMsError(tokenRes.description || tokenRes.error || '登录失败');
      setMsPolling(false);
      appendLog('ERROR', `微软登录失败: ${tokenRes.description || tokenRes.error}`);
    };

    pollTimerRef.current = setTimeout(poll, pollInterval);
  };

  const cancelMsLogin = () => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    setMsPolling(false);
    setMsCode('');
    setMsError('');
    setMsStatus('');
  };

  // Always reopen on the clean login-type picker, never on a leftover device code.
  const openAddDialog = () => {
    cancelMsLogin();
    setLoginType('offline');
    setPicking(true);
    setAddDialogOpen(true);
  };

  // Load a skin straight from an image URL, or pull a premium player's skin by their username.
  // 走主进程：玩家名经 BMCL 名称→UUID→材质链解析，链接直接下载；统一返回 dataURL，绕开 CORS。
  const fetchNetworkSkin = async () => {
    const q = skinQuery.trim();
    if (!q) { toast.error('请输入皮肤图片链接或正版玩家名'); return; }
    setSkinLoading(true);
    const api = (window as unknown as { electronAPI?: { fetchSkin?: (q: string) => Promise<{ success: boolean; dataUrl?: string; capeDataUrl?: string; error?: string }> } }).electronAPI;
    try {
      if (!api?.fetchSkin) throw new Error('仅桌面端支持');
      const r = await api.fetchSkin(q);
      if (!r.success || !r.dataUrl) throw new Error(r.error || '获取失败');
      setSelectedSkinUrl(r.dataUrl);
      // 立即写回当前账号（皮肤+披风），无需刷新页面
      if (account) updateAccount(account.id, { skinUrl: r.dataUrl, ...(r.capeDataUrl ? { capeUrl: r.capeDataUrl } : {}) });
      if (!/^https?:\/\//i.test(q)) setSkinName(q);
      toast.success('皮肤已获取并应用，点击"保存皮肤"可加入已保存列表');
    } catch (e) {
      toast.error(`未能获取皮肤：${(e as Error).message || '玩家名不存在或网络不通'}`);
    } finally {
      setSkinLoading(false);
    }
  };

  const handleOfflineLogin = () => {
    if (usernameError) return;
    addAccount({ type: 'offline', username: offlineUsername.trim(), avatar: 'steve', skinUrl: randomOfficialSkin() });
    toast.success('离线账号已添加');
    appendLog('INFO', `离线账号: ${offlineUsername.trim()}`);
    setAddDialogOpen(false);
    setOfflineUsername('');
  };

  // 下载外置皮肤站（如 LittleSkin）的皮肤+披风并写回账号；initial 为认证响应已带的 URL，缺省时实时拉取
  const downloadExternalTextures = async (
    accountId: string, apiRoot: string, uuid: string,
    initial?: { skinUrl?: string; capeUrl?: string; slim?: boolean },
  ) => {
    const api = getElectronAPI();
    if (!api?.fetchSkin) return;
    let urls: { skinUrl?: string; capeUrl?: string; slim?: boolean } = initial || {};
    if (!urls.skinUrl && !urls.capeUrl && api.externalRefreshTextures) {
      const rr = await api.externalRefreshTextures({ apiRoot, uuid }).catch(() => null);
      if (rr?.success) urls = { skinUrl: rr.skinUrl, capeUrl: rr.capeUrl, slim: rr.slim };
    }
    const patch: Partial<IAccount> = {};
    if (urls.skinUrl) {
      const s = await api.fetchSkin(urls.skinUrl).catch(() => null);
      if (s?.success && s.dataUrl) patch.skinUrl = s.dataUrl;
    }
    if (urls.capeUrl) {
      const c = await api.fetchSkin(urls.capeUrl).catch(() => null);
      if (c?.success && c.dataUrl) patch.capeUrl = c.dataUrl;
    }
    if (typeof urls.slim === 'boolean') patch.slim = urls.slim;
    if (Object.keys(patch).length) updateAccount(accountId, patch);
  };

  // 手动从外置皮肤站重新拉取皮肤/披风（LittleSkin 等，改了皮肤即时生效）
  const syncExternalNow = async (manual = false) => {
    const a = account;
    if (!a || a.type !== 'external' || !a.id || !a.externalServer || !a.uuid) return;
    if (manual) setExtSyncing(true);
    try {
      await downloadExternalTextures(a.id, a.externalServer, a.uuid);
      if (manual) toast.success('已从皮肤站同步最新皮肤与披风');
    } catch {
      if (manual) toast.error('同步失败，请检查网络或认证服务器地址');
    } finally {
      if (manual) setExtSyncing(false);
    }
  };

  const handleExternalLogin = async () => {
    if (externalLoading) return;
    if (!externalUsername.trim()) { toast.error('请输入用户名/邮箱'); return; }
    if (!externalServer.trim()) { toast.error('请输入认证服务器地址'); return; }
    if (!externalPassword) { toast.error('请输入密码'); return; }
    const api = getElectronAPI();
    if (!api?.externalAuth) { toast.error('仅桌面端支持外置账号密码登录'); return; }
    setExternalLoading(true);
    try {
      const r = await api.externalAuth({ server: externalServer.trim(), username: externalUsername.trim(), password: externalPassword });
      if (!r.success || !r.data) { toast.error(r.error || '外置登录失败'); return; }
      // 存解析后的真实 API 根（站点根会被自动补成 /api/yggdrasil），启动游戏时 authlib-injector 用它
      const apiRoot = r.data.apiRoot || externalServer.trim().replace(/\/+$/, '');
      const newId = addAccount({
        type: 'external',
        username: r.data.username,
        uuid: r.data.uuid,
        accessToken: r.data.accessToken,
        avatar: 'steve',
        externalServer: apiRoot,
        skinUrl: randomOfficialSkin(),
      });
      // 从 LittleSkin 等外置站实时拉取该账号的皮肤与披风并写回（失败保留默认皮，不影响登录）
      if (newId) downloadExternalTextures(newId, apiRoot, r.data.uuid, { skinUrl: r.data.skinUrl, capeUrl: r.data.capeUrl, slim: r.data.slim });
      toast.success(`外置账号 ${r.data.username} 登录成功，正在同步皮肤站皮肤与披风…`);
      appendLog('INFO', `外置账号登录成功: ${r.data.username} @ ${apiRoot}`);
      setAddDialogOpen(false);
      setExternalUsername(''); setExternalPassword(''); setExternalServer('');
    } finally {
      setExternalLoading(false);
    }
  };

  const logout = () => {
    if (account?.id) removeAccount(account.id);
    setSelectedSkinUrl('');
    toast.info('已删除该账号');
  };

  const handleImportSkin = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('请选择图片文件'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setSelectedSkinUrl(dataUrl);
      setSkinName(file.name.replace(/\.(png|jpg|jpeg)$/i, ''));
      // 立即写回当前账号：3D 预览/首页头像/启动游戏同步更换，无需刷新或重启页面
      if (account) updateAccount(account.id, { skinUrl: dataUrl });
      toast.success('皮肤已导入并应用，点击"保存皮肤"可加入已保存列表');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const saveCurrentSkin = () => {
    if (!selectedSkinUrl) { toast.error('请先选择或导入皮肤'); return; }
    const name = skinName.trim() || `皮肤 ${savedSkins.length + 1}`;
    const skin: ISavedSkin = {
      id: `skin_${Date.now()}`,
      name,
      skinUrl: selectedSkinUrl,
      createdAt: Date.now(),
    };
    addSavedSkin(skin);
    toast.success(`皮肤"${name}"已保存`);
    setSkinName('');
  };

  const applySkin = (skinUrl: string) => {
    setSelectedSkinUrl(skinUrl);
    if (account) {
      setAccount({ ...account, skinUrl });
      toast.success('皮肤已应用');
    }
  };

  const deleteSavedSkin = (id: string) => {
    removeSavedSkin(id);
    toast.success('皮肤已删除');
  };

  // 更换皮肤/披风后，按 UUID 从 Mojang 重新拉取皮肤+披风并写回当前账号与预览
  const syncAccountSkin = async (a: IAccount) => {
    const api = getElectronAPI();
    if (!api?.fetchSkin || !a.uuid) return;
    const r = await api.fetchSkin(a.uuid).catch(() => null);
    if (r?.success && r.dataUrl && a.id) {
      updateAccount(a.id, { skinUrl: r.dataUrl, ...(r.capeDataUrl ? { capeUrl: r.capeDataUrl } : {}) });
      if (account && account.id === a.id) setSelectedSkinUrl(r.dataUrl);
    }
  };

  // 正版 token 过期前自动刷新：用 refreshToken 换新 accessToken，避免 HTTP 401
  const ensureFreshMsToken = async (a: IAccount): Promise<string | null> => {
    if (a.type !== 'microsoft') return a.accessToken || null;
    if (!a.refreshToken) return a.accessToken || null;
    try {
      const r = await getElectronAPI()?.msRefreshToken(a.refreshToken);
      if (r?.success && r.data?.accessToken) {
        if (a.id) updateAccount(a.id, { accessToken: r.data.accessToken, refreshToken: r.data.refreshToken || a.refreshToken });
        return r.data.accessToken;
      }
      // 刷新失败（如 refreshToken 也过期），回退用原 token 试一次
      return a.accessToken || null;
    } catch {
      return a.accessToken || null;
    }
  };

  // 主进程在请求中遇到 401 会自动刷新令牌并通过 newTokens 返回；把新令牌持久化到账号
  const applyNewTokens = (a: IAccount, nt: { accessToken?: string; refreshToken?: string } | null | undefined) => {
    if (!nt || !nt.accessToken || !a.id) return;
    updateAccount(a.id, { accessToken: nt.accessToken, refreshToken: nt.refreshToken || a.refreshToken });
  };

  // 打开披风选择弹窗：拉取该正版账号拥有的全部披风
  const openCapeDialog = async (accId: string) => {
    setCtxMenu(null);
    const a = accounts.find((x) => x.id === accId);
    if (!a || a.type !== 'microsoft' || !a.accessToken) { toast.error('仅正版账号可切换披风'); return; }
    setCapeAccId(accId); setCapeDlgOpen(true); setCapeLoading(true); setCapes([]);
    const token = await ensureFreshMsToken(a);
    if (!token) { toast.error('账号令牌已失效，请重新登录正版账号'); setCapeLoading(false); return; }
    const r = await getElectronAPI()?.msCapes(token, a.refreshToken);
    applyNewTokens(a, r?.newTokens);
    if (r?.success) {
      const list = await Promise.all((r.capes || []).map(async (c: { id: string; state: string; alias?: string; name?: string; url?: string; imageUrl?: string }) => {
        const url = c.url || c.imageUrl || '';
        let img = '';
        if (url) { const s = await getElectronAPI()?.fetchSkin(url).catch(() => null); img = s?.success ? s.dataUrl : ''; }
        return { id: c.id, state: c.state || '', alias: c.alias || c.name || '披风', url, img };
      }));
      setCapes(list);
    } else {
      toast.error('获取披风失败：' + (r?.error || ''));
    }
    setCapeLoading(false);
  };

  const chooseCape = async (capeId: string) => {
    const a = accounts.find((x) => x.id === capeAccId);
    if (!a?.accessToken) return;
    const token = await ensureFreshMsToken(a);
    if (!token) { toast.error('账号令牌已失效，请重新登录正版账号'); return; }
    const r = await getElectronAPI()?.msSetCape(token, capeId || '', a.refreshToken);
    applyNewTokens(a, r?.newTokens);
    if (r?.success) {
      toast.success(capeId ? '披风已穿戴并同步' : '已取消披风');
      setCapeDlgOpen(false);
      if (a.id) await syncAccountSkin(a);
    } else {
      toast.error('切换披风失败：' + (r?.error || ''));
    }
  };

  // 真正上传当前皮肤到正版账号（Mojang 全局生效，其他启动器刷新后一致）
  const uploadSkinToMojang = async () => {
    if (!account || account.type !== 'microsoft' || !account.accessToken) { toast.error('仅正版账号可上传皮肤'); return; }
    if (!selectedSkinUrl) { toast.error('请先选择或导入皮肤'); return; }
    setUploadingSkin(true);
    try {
      const token = await ensureFreshMsToken(account);
      if (!token) { toast.error('账号令牌已失效，请重新登录正版账号'); return; }
      const arg: Record<string, string> = { variant: account.slim ? 'slim' : 'classic', accessToken: token, refreshToken: account.refreshToken || '' };
      if (selectedSkinUrl.startsWith('data:')) {
        arg.fileB64 = selectedSkinUrl.split(',')[1] || '';
        arg.filename = 'skin.png';
      } else {
        arg.url = selectedSkinUrl;
      }
      const r = await getElectronAPI()?.msSetSkin(arg);
      applyNewTokens(account, r?.newTokens);
      if (r?.success) {
        toast.success('已上传到正版账号，全局生效；其他启动器刷新后也会一致');
        await syncAccountSkin(account);
      } else {
        toast.error('上传皮肤失败：' + (r?.error || ''));
      }
    } finally { setUploadingSkin(false); }
  };

  const typeLabel = account?.type === 'microsoft' ? '正版（微软账号）' : account?.type === 'external' ? '外置登录' : '离线账号';
  const STEVE_LOCAL = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 8 8" shape-rendering="crispEdges"><rect width="8" height="8" fill="#b07c54"/><rect y="0" width="8" height="2" fill="#5a3820"/><rect x="1" y="3" width="2" height="1" fill="#fff"/><rect x="5" y="3" width="2" height="1" fill="#fff"/><rect x="1" y="3" width="1" fill="#4a6a9a"/><rect x="6" y="3" width="1" fill="#4a6a9a"/><rect x="3" y="5" width="2" height="1" fill="#9a6840"/></svg>');
  const avatarUrl = account?.uuid && account.uuid.length >= 32
    ? `https://mc-heads.net/avatar/${account.uuid}/128`
    : STEVE_LOCAL;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-5 max-w-5xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">账号管理</h1>
          <p className="text-muted-foreground text-sm mt-1">管理你的游戏账号和皮肤</p>
        </div>
        <div className="flex gap-2">
          {account && <Button variant="outline" onClick={logout} className="gap-2"><LogOut className="size-4" />删除当前账号</Button>}
          <Button onClick={openAddDialog} className="gap-2"><Plus className="size-4" />添加账号</Button>
        </div>
      </div>

      {/* Account list */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><User className="size-5" />我的账号（{accounts.length}）</CardTitle>
          <CardDescription>点击任意账号即可切换为当前账号，互不覆盖</CardDescription>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                <User className="size-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground mb-3">尚未添加账号，可以同时添加正版、离线、外置多个账号</p>
              <Button onClick={openAddDialog} className="gap-2"><Plus className="size-4" />添加账号</Button>
            </div>
          ) : (
            <div className="space-y-2">
              {accounts.map((a) => {
                const isCur = !!account && a.id === account.id;
                const dot = a.type === 'microsoft' ? 'bg-green-500' : a.type === 'external' ? 'bg-purple-500' : 'bg-amber-500';
                const label = a.type === 'microsoft' ? '正版（微软）' : a.type === 'external' ? '外置登录' : '离线账号';
                const face = a.skinUrl ? (
                  <SkinFace skinUrl={a.skinUrl} size={40} className="rounded-lg" />
                ) : a.uuid && a.uuid.length >= 32 ? (
                  <img src={`https://mc-heads.net/avatar/${a.uuid}/64`} alt="" width={40} height={40}
                    className="rounded-lg" style={{ imageRendering: 'pixelated', width: 40, height: 40 }}
                    referrerPolicy="no-referrer"
                    onError={(e) => { (e.target as HTMLImageElement).src = STEVE_LOCAL; }} />
                ) : (
                  <img src={STEVE_LOCAL} alt="" width={40} height={40} className="rounded-lg" style={{ width: 40, height: 40 }} />
                );
                return (
                  <div key={a.id}
                    onClick={() => !isCur && a.id && switchAccount(a.id)}
                    className={`flex items-center gap-3 p-2.5 rounded-xl border-2 transition-all ${isCur ? 'border-primary bg-primary/5 cursor-default' : 'border-border hover:border-primary/40 cursor-pointer'}`}>
                    <div className="shrink-0"
                      onContextMenu={a.type === 'microsoft' ? (e) => {
                        e.preventDefault(); e.stopPropagation();
                        setCtxMenu({ x: e.clientX, y: e.clientY, accId: a.id || '' });
                      } : undefined}
                      title={a.type === 'microsoft' ? '右键可切换披风' : undefined}
                    >{face}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{a.username}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                        <span className={`inline-block size-2 rounded-full ${dot}`} />{label}
                        {a.externalServer && <span className="truncate">· {a.externalServer}</span>}
                      </div>
                    </div>
                    {isCur ? (
                      <Badge variant="outline" className="shrink-0">当前</Badge>
                    ) : (
                      <Button size="sm" variant="outline" className="shrink-0" onClick={(e) => { e.stopPropagation(); a.id && switchAccount(a.id); }}>切换</Button>
                    )}
                    <Button size="icon" variant="ghost" className="shrink-0 text-muted-foreground hover:text-destructive h-8 w-8"
                      onClick={(e) => { e.stopPropagation(); if (a.id) removeAccount(a.id); toast.info(`已删除账号 ${a.username}`); }}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Skin Selector */}
      {account && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><RefreshCw className="size-5" />皮肤选择器</CardTitle>
            <CardDescription>选择和管理你的游戏皮肤</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* 3D Preview */}
              <div className="lg:col-span-1">
                <div className="bg-muted/30 rounded-xl p-4 flex flex-col items-center">
                  {selectedSkinUrl ? (
                    <Skin3DPreview skinUrl={selectedSkinUrl} capeUrl={account?.capeUrl} slim={!!account?.slim} size={220} />
                  ) : (
                    <div className="w-[220px] h-[220px] flex items-center justify-center text-muted-foreground text-sm">
                      请选择皮肤
                    </div>
                  )}
                  <div className="flex gap-2 mt-4 w-full">
                    <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => fileRef.current?.click()}>
                      <Upload className="size-3.5" />导入皮肤
                    </Button>
                    <Button size="sm" className="flex-1 gap-1.5" onClick={saveCurrentSkin} disabled={!selectedSkinUrl}>
                      <Plus className="size-3.5" />保存皮肤
                    </Button>
                  </div>
                  {account.type === 'microsoft' && (
                    <div className="flex gap-2 mt-2 w-full">
                      <Button variant="secondary" size="sm" className="flex-1 gap-1.5" onClick={() => openCapeDialog(account.id || '')}>
                        <Layers className="size-3.5" />切换披风
                      </Button>
                      <Button variant="default" size="sm" className="flex-1 gap-1.5" onClick={uploadSkinToMojang} disabled={uploadingSkin}>
                        {uploadingSkin ? <Loader2 className="size-3.5 animate-spin" /> : <Shirt className="size-3.5" />}上传皮肤到正版
                      </Button>
                    </div>
                  )}
                  {account.type === 'external' && (
                    <Button variant="secondary" size="sm" className="mt-2 w-full gap-1.5" onClick={() => syncExternalNow(true)} disabled={extSyncing}>
                      {extSyncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                      从皮肤站同步皮肤/披风
                    </Button>
                  )}
                  <input ref={fileRef} type="file" accept="image/png" className="hidden" onChange={handleImportSkin} />
                  {selectedSkinUrl && (
                    <Input value={skinName} onChange={(e) => setSkinName(e.target.value)} placeholder="皮肤名称" className="mt-2 h-8 text-sm" />
                  )}
                  {!isMobile && (
                  <>
                  <div className="flex gap-1.5 mt-2 w-full">
                    <Input
                      value={skinQuery}
                      onChange={(e) => setSkinQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') fetchNetworkSkin(); }}
                      placeholder="皮肤链接 / 正版玩家名"
                      className="h-8 text-sm"
                    />
                    <Button variant="outline" size="sm" className="shrink-0 gap-1" onClick={fetchNetworkSkin} disabled={skinLoading}>
                      {skinLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}获取
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-snug">可粘贴皮肤图片直链，或输入正版玩家名自动拉取其皮肤</p>
                  </>
                  )}
                </div>
              </div>

              {/* Skin List */}
              <div className="lg:col-span-2">
                <Tabs value={skinTab} onValueChange={(v) => setSkinTab(v as 'saved' | 'official')}>
                  <TabsList className="grid grid-cols-2 w-full max-w-xs">
                    <TabsTrigger value="saved">已保存皮肤</TabsTrigger>
                    <TabsTrigger value="official">官方皮肤</TabsTrigger>
                  </TabsList>

                  <TabsContent value="saved" className="mt-4">
                    {savedSkins.length === 0 ? (
                      <div className="text-center py-10 text-muted-foreground text-sm">
                        暂无已保存皮肤，导入皮肤后点击"保存皮肤"添加
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {savedSkins.map((skin) => (
                          <div key={skin.id} className={`group relative rounded-xl border-2 p-2 cursor-pointer transition-all ${selectedSkinUrl === skin.skinUrl ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
                            onClick={() => applySkin(skin.skinUrl)}>
                            <div className="aspect-square rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                              <SkinFace skinUrl={skin.skinUrl} size={64} />
                            </div>
                            <div className="text-xs font-medium mt-1.5 truncate text-center">{skin.name}</div>
                            <button type="button" onClick={(e) => { e.stopPropagation(); deleteSavedSkin(skin.id); }}
                              className="absolute top-1 right-1 bg-destructive/90 text-white rounded-full p-1 hover:bg-destructive opacity-60 group-hover:opacity-100 transition-opacity">
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="official" className="mt-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {OFFICIAL_SKINS.map((skin) => (
                        <div key={skin.id} className={`relative rounded-xl border-2 p-2 cursor-pointer transition-all ${selectedSkinUrl === skin.url ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
                          onClick={() => applySkin(skin.url)}>
                          <div className="aspect-square rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                            <SkinFace skinUrl={skin.url} size={64} />
                          </div>
                          <div className="text-xs font-medium mt-1.5 truncate text-center">{skin.name}</div>
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add Account Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={(open) => { cancelMsLogin(); if (open) setLoginType('offline'); setAddDialogOpen(open); }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>添加账号</DialogTitle></DialogHeader>

          {!msPolling && !msCode ? (
            <div className="space-y-4">
              <div className={`grid gap-3 ${isMobile ? 'grid-cols-2' : 'grid-cols-3'}`}>
                <button type="button" onClick={() => { setLoginType('microsoft'); setPicking(false); }}
                  className={`p-4 rounded-xl border-2 transition-all text-center ${!picking && loginType === 'microsoft' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}>
                  <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-blue-500 flex items-center justify-center">
                    <ShieldCheck className="size-5 text-white" />
                  </div>
                  <div className="text-sm font-medium">微软账户</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Minecraft 正版登录</div>
                </button>
                <button type="button" onClick={() => { setLoginType('offline'); setPicking(false); }}
                  className={`p-4 rounded-xl border-2 transition-all text-center ${!picking && loginType === 'offline' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}>
                  <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-gray-500 flex items-center justify-center">
                    <Link2Off className="size-5 text-white" />
                  </div>
                  <div className="text-sm font-medium">离线账户</div>
                  <div className="text-xs text-muted-foreground mt-0.5">本地玩家 ID 登录</div>
                </button>
                <button type="button" onClick={() => { setLoginType('external'); setPicking(false); }}
                  className={`p-4 rounded-xl border-2 transition-all text-center ${!picking && loginType === 'external' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'} ${isMobile ? 'col-span-2' : ''}`}>
                  <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-purple-500 flex items-center justify-center">
                    <Globe className="size-5 text-white" />
                  </div>
                  <div className="text-sm font-medium">外置登录</div>
                  <div className="text-xs text-muted-foreground mt-0.5">第三方 / authlib-injector</div>
                </button>
              </div>

              {!picking && (<>
              {loginType === 'offline' && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>玩家名称</Label>
                    <Input value={offlineUsername} onChange={(e) => setOfflineUsername(e.target.value)}
                      placeholder="输入玩家名（3-16字符，不含中文）"
                      className={usernameError ? 'border-destructive focus-visible:ring-destructive' : ''} />
                    {usernameError && (
                      <p className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" />{usernameError}</p>
                    )}
                    <p className="text-xs text-muted-foreground">仅支持字母、数字和下划线，3-16 个字符，不能包含中文</p>
                  </div>
                </div>
              )}

              {loginType === 'external' && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>认证服务器地址（可把皮肤站的“外置登录/快速配置”卡片或链接直接拖到这里）</Label>
                    <Input
                      value={externalServer}
                      onChange={(e) => setExternalServer(e.target.value)}
                      placeholder="https://littleskin.cn/"
                      onDragOver={(e) => { e.preventDefault(); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const raw = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').trim();
                        const m = /https?:\/\/[^\s]+/i.exec(raw);
                        if (m) { setExternalServer(m[0]); toast.success('已识别外置登录服务器地址'); }
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>用户名 / 邮箱</Label>
                    <Input value={externalUsername} onChange={(e) => setExternalUsername(e.target.value)} placeholder="输入用户名或邮箱" autoComplete="username" />
                  </div>
                  <div className="space-y-2">
                    <Label>密码</Label>
                    <Input type="password" value={externalPassword} onChange={(e) => setExternalPassword(e.target.value)} placeholder="输入密码" autoComplete="current-password" />
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">通过认证服务器校验账号密码并自动获取登录令牌，令牌仅保存在本机。</p>
                </div>
              )}

              {loginType === 'microsoft' && (
                <div className="bg-muted/40 rounded-xl p-4 text-sm text-muted-foreground">
                  {isMobile
                    ? '点击下方按钮后，启动器会在应用内打开微软登录页面，输入微软账号密码即可完成登录，无需跳转浏览器或输入设备码。'
                    : '点击下方按钮后，启动器会自动打开浏览器并复制设备码，在网页中粘贴代码即可完成微软账号登录。'}
                </div>
              )}
              </>)}
            </div>
          ) : (
            <div className="space-y-4">
              {msCode && (
                <div className="bg-muted/40 rounded-xl p-5 text-center space-y-3">
                  <div className="text-sm text-muted-foreground">设备代码（已自动复制）</div>
                  <div className="font-mono text-2xl font-bold tracking-[0.3em] select-all text-primary">{msCode}</div>
                  <Button variant="outline" size="sm" onClick={() => copyCode(msCode)} className="gap-2 mx-auto">
                    {msCodeCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {msCodeCopied ? '已复制' : '复制代码'}
                  </Button>
                </div>
              )}
              {msPolling && (
                <div className="text-center text-sm space-y-2">
                  <div className="inline-flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />{msStatus}
                  </div>
                </div>
              )}
              {msError && (
                <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                  <AlertCircle className="size-4 shrink-0 mt-0.5" /><span>{msError}</span>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {!msPolling && !msCode && !picking && (
              <Button variant="ghost" onClick={() => setPicking(true)} className="mr-auto gap-1">
                <ArrowLeft className="size-4" />返回
              </Button>
            )}
            {msCode && !msPolling && (
              <Button variant="ghost" onClick={() => { cancelMsLogin(); setPicking(true); }} className="mr-auto gap-1">
                <ArrowLeft className="size-4" />返回
              </Button>
            )}
            <Button variant="outline" onClick={() => { if (msPolling) cancelMsLogin(); else setAddDialogOpen(false); }}>
              {msPolling ? '取消登录' : '取消'}
            </Button>
            {!msPolling && !msCode && (
              loginType === 'microsoft' ? (
                <Button onClick={startMicrosoftLogin}><ExternalLink className="size-4 mr-1" />开始微软登录</Button>
              ) : loginType === 'offline' ? (
                <Button onClick={handleOfflineLogin} disabled={!!usernameError}>添加离线账号</Button>
              ) : (
                <Button onClick={handleExternalLogin} disabled={externalLoading}>{externalLoading ? '正在登录…' : '账号密码登录'}</Button>
              )
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 头像右键菜单 */}
      <AnimatePresence>
        {ctxMenu && (
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }} />
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.12 }}
              className="fixed z-[95] min-w-[150px] rounded-lg border bg-popover p-1 shadow-lg text-sm"
              style={{ left: Math.min(ctxMenu.x, window.innerWidth - 170), top: Math.min(ctxMenu.y, window.innerHeight - 120) }}
            >
              <button className="w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 hover:bg-accent text-left"
                onClick={() => openCapeDialog(ctxMenu.accId)}>
                <Layers className="size-4" />切换披风…
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* 披风选择弹窗 */}
      <Dialog open={capeDlgOpen} onOpenChange={(o) => setCapeDlgOpen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Layers className="size-5" />选择披风</DialogTitle>
          </DialogHeader>
          {capeLoading ? (
            <div className="py-10 flex flex-col items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="size-6 animate-spin" />正在获取你拥有的披风…
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[50vh] overflow-y-auto pr-1">
              <button onClick={() => chooseCape('')}
                className="rounded-xl border-2 border-border hover:border-primary p-3 flex flex-col items-center gap-2 text-sm">
                <div className="h-12 flex items-center text-muted-foreground"><ShieldCheck className="size-7" /></div>
                不穿披风
              </button>
              {capes.map((c) => {
                const active = c.state === 'ACTIVE';
                return (
                  <button key={c.id} onClick={() => chooseCape(c.id)}
                    className={`rounded-xl border-2 p-2 flex flex-col items-center gap-1.5 text-xs ${active ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60'}`}>
                    {c.img ? (
                      <img src={c.img} alt={c.alias} className="h-12 object-contain" style={{ imageRendering: 'pixelated' }} />
                    ) : (
                      <div className="h-12 w-full bg-muted rounded" />
                    )}
                    <span className="truncate w-full text-center">{c.alias}</span>
                    {active && <Badge variant="secondary" className="text-[10px] h-4 px-1">穿戴中</Badge>}
                  </button>
                );
              })}
              {!capes.length && (
                <div className="col-span-full text-center text-muted-foreground text-sm py-6">该账号暂未拥有任何披风</div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
