import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  KeyRound, Coffee, Palette, FolderInput, User as UserIcon, ChevronRight, ChevronLeft,
  CheckCircle2, Download as DlIcon, Upload, Video, Sun, Moon, ShieldCheck, Link2Off, Globe,
  Loader2, Copy, ExternalLink, AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import Skin3DPreview from '@/components/Skin3DPreview';
import { useLauncherStore } from '@/hooks/useLauncherStore';
import { randomOfficialSkin } from '@/data/launcher';
import type { IAccount } from '@/data/launcher';
import { HAS_LAN } from '@/data/edition';

type StepId = 'license' | 'java' | 'theme' | 'import' | 'account';
const COMMUNITY_STEPS: StepId[] = ['java', 'theme', 'import', 'account'];
const SPONSOR_STEPS: StepId[] = ['license', 'java', 'theme', 'import', 'account'];

const STEP_META: Record<StepId, { label: string; Icon: typeof Coffee }> = {
  license: { label: '赞助密钥', Icon: KeyRound },
  java: { label: 'Java 环境', Icon: Coffee },
  theme: { label: '主题外观', Icon: Palette },
  import: { label: '导入版本', Icon: FolderInput },
  account: { label: '添加角色', Icon: UserIcon },
};

interface LicenseApi {
  licenseStatus: () => Promise<{ activated: boolean }>;
  licenseActivate: (k: string) => Promise<{ success: boolean; error?: string; offline?: boolean }>;
  licenseClear: () => Promise<{ success: boolean }>;
  licenseRelease: () => Promise<{ success: boolean; error?: string }>;
  listJava: () => Promise<{ javas: { path: string; major: number }[] }>;
  downloadJava: (m: number) => Promise<{ success: boolean; path?: string }>;
  onJavaDownloadProgress: (cb: (p: { percent: number; detail: string; stage: number }) => void) => () => void;
  pickBackgroundVideo: () => Promise<{ success?: boolean; path?: string; canceled?: boolean }>;
  scanMinecraft: () => Promise<{ success: boolean; versions: unknown[]; error?: string }>;
  autoScanVersions: (dirs: string[]) => Promise<{ success: boolean; versions: Array<{ id: string; versionId?: string; gameDir?: string; versionType?: string; loader?: string; loaderVersion?: string }> }>;
  msDeviceCode: (a?: unknown) => Promise<{ success: boolean; data?: { device_code: string; user_code: string; verification_uri: string; interval: number; expires_in: number }; error?: string; description?: string }>;
  msPollToken: (d: { deviceCode: string }) => Promise<{ success: boolean; data?: { username: string; uuid: string; accessToken: string; refreshToken?: string }; error?: string; description?: string }>;
  externalAuth: (a: { server: string; username: string; password: string }) => Promise<{ success: boolean; data?: { username: string; uuid: string; accessToken: string; apiRoot?: string; skinUrl?: string; capeUrl?: string; slim?: boolean }; error?: string }>;
  fetchSkin: (q: string) => Promise<{ success: boolean; dataUrl?: string; capeDataUrl?: string }>;
  openExternal: (u: string) => void;
  copyToClipboard: (t: string) => void;
}
function api(): LicenseApi {
  return (window as unknown as { electronAPI: LicenseApi }).electronAPI;
}

// 压缩大图到 maxEdge，返回 JPEG/PNG dataURL（避免背景图撑爆本地存储）
function fileToCompressedDataUrl(file: File, maxEdge = 1920): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxEdge || height > maxEdge) {
          const k = Math.min(maxEdge / width, maxEdge / height);
          width = Math.round(width * k); height = Math.round(height * k);
        }
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        c.getContext('2d')!.drawImage(img, 0, 0, width, height);
        resolve(c.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface OnboardingWizardProps {
  /** 向导完成（含激活后直接进入）时通知外层，赞助版用于刷新授权状态 */
  onFinish?: () => void;
}
export default function OnboardingWizard({ onFinish }: OnboardingWizardProps) {
  const { settings, setSettings, accounts, account, addAccount, updateAccount, appendLog, installedVersions, mergeScannedVersions } = useLauncherStore();
  const steps = HAS_LAN ? SPONSOR_STEPS : COMMUNITY_STEPS;
  const [idx, setIdx] = useState(0);
  const step = steps[idx];

  // license step state
  const [licenseOk, setLicenseOk] = useState(!HAS_LAN);
  const [keyInput, setKeyInput] = useState('');
  const [activating, setActivating] = useState(false);

  // java step state
  const [presentMajors, setPresentMajors] = useState<number[]>([]);
  const [javaScanned, setJavaScanned] = useState(false);
  const [downloadingJava, setDownloadingJava] = useState<number | null>(null);
  const [javaPct, setJavaPct] = useState(0);

  // theme step state
  const bgFileRef = useRef<HTMLInputElement>(null);

  // import step state
  const [importResult, setImportResult] = useState<number | null>(null);
  const [autoImportCount, setAutoImportCount] = useState<number | null>(null);

  // account step state
  const [offlineName, setOfflineName] = useState('');
  const [extServer, setExtServer] = useState('https://littleskin.cn');
  const [extUser, setExtUser] = useState('');
  const [extPass, setExtPass] = useState('');
  const [extBusy, setExtBusy] = useState(false);
  const [msBusy, setMsBusy] = useState(false);
  const [msCode, setMsCode] = useState('');
  const [msHint, setMsHint] = useState('');
  const [msErr, setMsErr] = useState('');
  const msTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 向导只在需要时由 App 挂载；每次挂载都从首步开始，并检查赞助版是否已激活
  // （已激活则跳过密钥步，直接进入 Java 步）。
  useEffect(() => {
    setIdx(0);
    if (!HAS_LAN) { setLicenseOk(true); return; }
    let alive = true;
    api().licenseStatus().then((s) => {
      if (alive && s.activated) { setLicenseOk(true); setIdx(SPONSOR_STEPS.indexOf('java')); }
    }).catch(() => {});
    return () => { alive = false; if (msTimer.current) clearTimeout(msTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 进入 java 步时扫描
  useEffect(() => {
    if (step !== 'java' || javaScanned) return;
    api().listJava().then(({ javas }) => {
      setPresentMajors([...new Set(javas.map((j) => j.major).filter((m) => m > 0))]);
      setJavaScanned(true);
    }).catch(() => setJavaScanned(true));
  }, [step, javaScanned]);

  // 进入「导入版本」步时，先静默自动识别默认 .minecraft 与已记录游戏目录里的版本/加载器（无需手动选目录）
  useEffect(() => {
    if (step !== 'import' || autoImportCount !== null) return;
    const fn = api().autoScanVersions;
    if (!fn) { setAutoImportCount(0); return; }
    const dirs = Array.from(new Set(installedVersions.map((v) => v.gameDir).filter(Boolean) as string[]));
    let cancelled = false;
    fn(dirs).then((r) => {
      if (cancelled) return;
      if (r.success && Array.isArray(r.versions)) {
        const res = mergeScannedVersions(r.versions);
        setAutoImportCount(res.added);
      } else setAutoImportCount(0);
    }).catch(() => { if (!cancelled) setAutoImportCount(0); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, autoImportCount]);

  const JAVA_TARGETS = [8, 17, 21, 25];
  const JAVA_USE: Record<number, string> = {
    8: '1.8–1.16.5',
    17: '1.17–1.20.4',
    21: '1.20.5–1.21.x',
    25: '最新版本 / 新快照',
  };
  const missingJava = JAVA_TARGETS.filter((m) => !presentMajors.includes(m));

  const downloadAllJava = async () => {
    const off = api().onJavaDownloadProgress((p) => setJavaPct(Math.round(p.percent || 0)));
    for (const m of missingJava) {
      setDownloadingJava(m); setJavaPct(0);
      const r = await api().downloadJava(m);
      if (r.success) setPresentMajors((p) => [...new Set([...p, m])]);
      else { toast.error('Java ' + m + ' 下载失败，可稍后在 Java 页面重试'); }
    }
    setDownloadingJava(null); off();
  };

  const pickBgImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToCompressedDataUrl(file);
      setSettings({ backgroundImage: dataUrl });
      toast.success('背景图已设置');
    } catch { toast.error('图片读取失败'); }
    e.target.value = '';
  };
  const pickBgVideo = async () => {
    const r = await api().pickBackgroundVideo();
    if (r?.path) { setSettings({ backgroundVideo: r.path }); toast.success('视频背景已设置'); }
  };

  const doScanImport = async () => {
    const r = await api().scanMinecraft();
    if (r.success) { setImportResult(r.versions.length); if (r.versions.length) toast.success(`已导入 ${r.versions.length} 个版本`); else toast.message('该目录没找到版本'); }
    else toast.error(r.error || '导入失败');
  };

  const addOffline = () => {
    const name = offlineName.trim();
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(name)) { toast.error('玩家名 3-16 位，仅字母数字下划线'); return; }
    addAccount({ type: 'offline', username: name, avatar: 'steve', skinUrl: randomOfficialSkin() });
    setOfflineName(''); toast.success('离线角色已添加');
  };
  const addExternal = async () => {
    if (!extServer.trim() || !extUser.trim() || !extPass) { toast.error('请填写服务器、账号、密码'); return; }
    setExtBusy(true);
    try {
      const r = await api().externalAuth({ server: extServer.trim(), username: extUser.trim(), password: extPass });
      if (!r.success || !r.data) { toast.error(r.error || '外置登录失败'); return; }
      const apiRoot = r.data.apiRoot || extServer.trim().replace(/\/+$/, '');
      const id = addAccount({
        type: 'external', username: r.data.username, uuid: r.data.uuid, accessToken: r.data.accessToken,
        avatar: 'steve', externalServer: apiRoot, skinUrl: randomOfficialSkin(),
        ...(typeof r.data.slim === 'boolean' ? { slim: r.data.slim } : {}),
      } as IAccount);
      const skinPatch: Partial<IAccount> = {};
      if (r.data.skinUrl) { const s = await api().fetchSkin(r.data.skinUrl).catch(() => null); if (s?.dataUrl) skinPatch.skinUrl = s.dataUrl; }
      if (r.data.capeUrl) { const c = await api().fetchSkin(r.data.capeUrl).catch(() => null); if (c?.dataUrl) skinPatch.capeUrl = c.dataUrl; }
      if (id && Object.keys(skinPatch).length) updateAccount(id, skinPatch);
      toast.success(`外置角色 ${r.data.username} 已添加`);
      appendLog('INFO', `向导：外置账号 ${r.data.username} @ ${apiRoot}`);
      setExtUser(''); setExtPass('');
    } finally { setExtBusy(false); }
  };
  const addMicrosoft = async () => {
    setMsBusy(true); setMsErr(''); setMsCode(''); setMsHint('正在请求设备代码…');
    const a = api();
    const res = await a.msDeviceCode();
    if (!res.success || !res.data) { setMsErr(res.description || res.error || '获取设备代码失败'); setMsBusy(false); return; }
    const { device_code, user_code, verification_uri, interval, expires_in } = res.data;
    setMsCode(user_code); setMsHint('请在打开的网页中输入代码并登录…');
    a.copyToClipboard(user_code); a.openExternal(verification_uri);
    const start = Date.now(); const timeout = (expires_in || 900) * 1000;
    const poll = async () => {
      if (Date.now() - start > timeout) { setMsErr('登录超时，请重试'); setMsBusy(false); return; }
      let tr;
      try { tr = await a.msPollToken({ deviceCode: device_code }); }
      catch { msTimer.current = setTimeout(poll, 4000); return; }
      if (tr.success && tr.data) {
        const id = addAccount({ type: 'microsoft', username: tr.data.username, uuid: tr.data.uuid, accessToken: tr.data.accessToken, refreshToken: tr.data.refreshToken || '', avatar: 'steve' });
        a.fetchSkin(tr.data.uuid).then((s) => {
          if (s?.dataUrl && id) updateAccount(id, { skinUrl: s.dataUrl, ...(s.capeDataUrl ? { capeUrl: s.capeDataUrl } : {}) });
        }).catch(() => {});
        toast.success(`欢迎回来，${tr.data.username}`);
        setMsBusy(false); setMsCode(''); setMsHint('');
        return;
      }
      if (tr.error === 'authorization_pending' || tr.error === 'slow_down' || tr.error === 'network_error') {
        msTimer.current = setTimeout(poll, Math.max((interval || 5) * 1000, 4000));
        return;
      }
      setMsErr(tr.description || tr.error || '登录失败'); setMsBusy(false);
    };
    msTimer.current = setTimeout(poll, Math.max((interval || 5) * 1000, 3000));
  };

  const activateLicense = async () => {
    const k = keyInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(k)) { toast.error('密钥格式应为 XXXX-XXXX-XXXX-XXXX'); return; }
    setActivating(true);
    const r = await api().licenseActivate(k);
    setActivating(false);
    if (!r.success) { toast.error(r.error || '激活失败'); return; }
    setLicenseOk(true);
    toast.success(r.offline ? '离线授权成功' : '密钥激活成功');
    // 激活成功后始终进入下一步（Java/主题/导入/角色），避免跳过后续向导步骤。
    goNext();
  };

  const finishWizard = useCallback(() => {
    setSettings({ onboarded: true });
    onFinish?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSettings, onFinish]);

  const goNext = useCallback(() => {
    if (idx < steps.length - 1) setIdx(idx + 1);
    else finishWizard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, steps, finishWizard]);

  const canNext = step === 'license' ? licenseOk : true;

  return (
    <div className="dark">
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8"
      style={{ background: 'radial-gradient(1200px 640px at 50% -10%, #151b28 0%, #0c1018 55%, #070a10 100%)' }}
    >
      <Card className="w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl bg-[#12161f]/95 border-white/10 text-white">
        {/* 头部：步骤指示 */}
        <div className="px-5 sm:px-7 pt-5 pb-4 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 font-bold text-lg">
              <span className="text-primary">Glowstone</span> 初始设置
            </div>
            <span className="text-xs text-muted-foreground font-mono">{idx + 1} / {steps.length}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {steps.map((s, i) => {
              const M = STEP_META[s].Icon;
              const done = i < idx || (s === 'license' && licenseOk);
              const active = i === idx;
              return (
                <div key={s} className="flex items-center gap-1.5 flex-1">
                  <div className={`flex items-center gap-1.5 rounded-full px-2 h-7 text-[11px] font-medium border transition-all ${
                    done ? 'border-primary text-primary bg-primary/10' : active ? 'border-primary text-foreground' : 'border-border text-muted-foreground'}`}>
                    {done ? <CheckCircle2 className="size-3.5" /> : <M className="size-3.5" />}
                    <span className="hidden sm:inline">{STEP_META[s].label}</span>
                  </div>
                  {i < steps.length - 1 && <div className={`h-px flex-1 ${i < idx ? 'bg-primary' : 'bg-border'}`} />}
                </div>
              );
            })}
          </div>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-7 py-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.28, ease: [0.34, 1.4, 0.64, 1] }}
            >
              {step === 'license' && (
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold flex items-center gap-2"><KeyRound className="size-5 text-primary" />输入赞助版密钥</h2>
                  <p className="text-sm text-muted-foreground">密钥为 <span className="font-mono">XXXX-XXXX-XXXX-XXXX</span>，由数字与英文大小写组成，每个密钥只能在一台电脑激活一次，用于防止白嫖。</p>

                  {licenseOk ? (
                    <Card className="p-4 border-green-500/40 bg-green-500/5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-green-500">
                          <CheckCircle2 className="size-5" />
                          <span className="font-medium">本机已授权（硬件绑定）</span>
                        </div>
                        <Button
                          variant="outline" size="sm" className="gap-1 text-xs"
                          onClick={async () => {
                            const ok = window.confirm(
                              '确定要清除授权吗？\n\n' +
                              '· 当前密钥将被【永久作废】，此后在任何电脑都无法再次使用；\n' +
                              '· 作废后需要输入一个新密钥才能继续；\n' +
                              '· 若只是重装/更新启动器，无需点此按钮，授权会自动识别。\n\n' +
                              '点击「确定」作废当前密钥，点击「取消」返回。'
                            );
                            if (!ok) return;
                            const r = await api().licenseRelease();
                            if (!r.success) { toast.error(r.error || '密钥作废失败，授权未变更'); return; }
                            setLicenseOk(false);
                            setKeyInput('');
                            toast.message('当前密钥已永久作废，请输入新密钥');
                          }}
                        >
                          清除授权换密钥
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">该密钥已绑定本机硬件，重装/更新启动器会自动识别、无需重输。「清除授权换密钥」会将当前密钥永久作废，请谨慎操作。</p>
                    </Card>
                  ) : (
                    <div className="flex gap-2">
                      <Input value={keyInput} onChange={(e) => setKeyInput(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === 'Enter' && activateLicense()}
                        placeholder="XXXX-XXXX-XXXX-XXXX" className="font-mono uppercase tracking-wider" />
                      <Button onClick={activateLicense} disabled={activating} className="shrink-0 gap-1">
                        {activating ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}激活
                      </Button>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">激活需联网并读取本机硬件标识；断网时本机已激活过的密钥仍可离线使用。更新重装赞助版会自动识别、无需再次输入。</p>
                </div>
              )}

              {step === 'java' && (
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold flex items-center gap-2"><Coffee className="size-5 text-primary" />检查 Java 环境</h2>
                  <p className="text-sm text-muted-foreground">不同游戏版本需要不同 Java，建议把 Java 8 / 17 / 21 / 25 一次备齐。</p>
                  <div className="space-y-2">
                    {JAVA_TARGETS.map((m) => {
                      const has = presentMajors.includes(m);
                      const use = JAVA_USE[m] || '通用';
                      return (
                        <div key={m} className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                          <div className="flex items-center gap-2 text-sm">
                            {has ? <CheckCircle2 className="size-4 text-green-500" /> : <AlertCircle className="size-4 text-amber-500" />}
                            <span className="font-medium">Java {m}</span>
                            <span className="text-xs text-muted-foreground">适用 {use}</span>
                          </div>
                          <span className={`text-xs ${has ? 'text-green-500' : 'text-amber-500'}`}>{has ? '已安装' : '缺失'}</span>
                        </div>
                      );
                    })}
                  </div>
                  {!javaScanned ? <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="size-4 animate-spin" />正在扫描本机 Java…</div>
                    : missingJava.length > 0 ? (
                      <div className="space-y-2">
                        <Button onClick={downloadAllJava} disabled={downloadingJava !== null} className="w-full gap-2">
                          {downloadingJava !== null ? <Loader2 className="size-4 animate-spin" /> : <DlIcon className="size-4" />}
                          {downloadingJava !== null ? `正在下载 Java ${downloadingJava}（${javaPct}%）` : `一键下载缺失的 Java（${missingJava.join('、')}）`}
                        </Button>
                      </div>
                    ) : <div className="text-sm text-green-600 flex items-center gap-2"><CheckCircle2 className="size-4" />Java 已备齐</div>}
                </div>
              )}

              {step === 'theme' && (
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold flex items-center gap-2"><Palette className="size-5 text-primary" />设置主题外观</h2>
                  <div className="flex gap-3">
                    <Button variant={settings.theme === 'light' ? 'default' : 'outline'} onClick={() => setSettings({ theme: 'light' })} className="flex-1 gap-2"><Sun className="size-4" />浅色</Button>
                    <Button variant={settings.theme === 'dark' ? 'default' : 'outline'} onClick={() => setSettings({ theme: 'dark' })} className="flex-1 gap-2"><Moon className="size-4" />深色</Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Button variant="outline" onClick={() => bgFileRef.current?.click()} className="gap-2"><Upload className="size-4" />导入背景图</Button>
                    <Button variant="outline" onClick={pickBgVideo} className="gap-2"><Video className="size-4" />导入视频背景</Button>
                    <input ref={bgFileRef} type="file" accept="image/*" className="hidden" onChange={pickBgImage} />
                  </div>
                  {(settings.backgroundImage || settings.backgroundVideo) && (
                    <Button variant="ghost" size="sm" onClick={() => setSettings({ backgroundImage: undefined, backgroundVideo: undefined })}>清除自定义背景</Button>
                  )}
                  <p className="text-xs text-muted-foreground">这一步可以直接跳过；以后在「设置 → 外观」里随时可以更换主题、背景图和视频。</p>
                </div>
              )}

              {step === 'import' && (
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold flex items-center gap-2"><FolderInput className="size-5 text-primary" />导入已有版本</h2>
                  <p className="text-sm text-muted-foreground">启动器会自动识别默认目录里已安装的 Minecraft 版本（含 Fabric / Forge 等加载器）；如果版本装在其他位置，可手动选择目录扫描。</p>
                  {autoImportCount === null ? (
                    <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="size-4 animate-spin" />正在自动识别本机版本…</div>
                  ) : autoImportCount > 0 ? (
                    <p className="text-sm text-green-600">已自动识别到 {autoImportCount} 个本机版本（含加载器类型），无需手动导入。</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">默认目录未自动发现版本；如游戏装在其他盘或其他启动器目录，可点下方按钮手动选择。</p>
                  )}
                  <Button variant="outline" onClick={doScanImport} className="w-full gap-2"><FolderInput className="size-4" />选择其他游戏目录并扫描导入</Button>
                  {importResult !== null && (
                    <p className="text-sm">{importResult > 0 ? <span className="text-green-600">成功导入 {importResult} 个版本</span> : <span className="text-muted-foreground">没有发现可导入的版本</span>}</p>
                  )}
                  <p className="text-xs text-muted-foreground">这一步可以跳过；以后在「版本下载 → 导入已有版本」里随时可以导入，也可以直接下载新版本。</p>
                </div>
              )}

              {step === 'account' && (
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold flex items-center gap-2"><UserIcon className="size-5 text-primary" />添加角色</h2>
                  <div className="grid md:grid-cols-2 gap-4">
                    <Tabs defaultValue="offly" className="w-full">
                      <TabsList className="grid grid-cols-3 w-full">
                        <TabsTrigger value="ms" className="gap-1"><ShieldCheck className="size-3.5" />正版</TabsTrigger>
                        <TabsTrigger value="offly" className="gap-1"><Link2Off className="size-3.5" />离线</TabsTrigger>
                        <TabsTrigger value="ext" className="gap-1"><Globe className="size-3.5" />外置</TabsTrigger>
                      </TabsList>
                      <TabsContent value="ms" className="space-y-3 mt-3">
                        <Button onClick={addMicrosoft} disabled={msBusy} className="w-full gap-2">
                          {msBusy ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}{msBusy ? '登录中…' : '微软正版登录'}
                        </Button>
                        {msCode && (
                          <div className="rounded-lg border border-border bg-muted/40 p-3 text-center space-y-2">
                            <div className="text-xs text-muted-foreground">网页中输入此代码（已复制）</div>
                            <div className="font-mono text-xl font-bold tracking-widest text-primary flex items-center justify-center gap-2">
                              {msCode}
                              <button className="text-muted-foreground" onClick={() => api().copyToClipboard(msCode)}><Copy className="size-4" /></button>
                            </div>
                          </div>
                        )}
                        {msHint && !msErr && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" />{msHint}</p>}
                        {msErr && <p className="text-xs text-destructive flex items-center gap-1.5"><AlertCircle className="size-3.5" />{msErr}</p>}
                      </TabsContent>
                      <TabsContent value="offly" className="space-y-2 mt-3">
                        <Input value={offlineName} onChange={(e) => setOfflineName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && addOffline()}
                          placeholder="玩家名（3-16 位字母数字下划线）" />
                        <Button onClick={addOffline} className="w-full gap-2"><UserIcon className="size-4" />添加离线角色</Button>
                      </TabsContent>
                      <TabsContent value="ext" className="space-y-2 mt-3">
                        <Input value={extServer} onChange={(e) => setExtServer(e.target.value)} placeholder="认证服务器，如 https://littleskin.cn" />
                        <Input value={extUser} onChange={(e) => setExtUser(e.target.value)} placeholder="用户名 / 邮箱" autoComplete="username" />
                        <Input type="password" value={extPass} onChange={(e) => setExtPass(e.target.value)} placeholder="密码" autoComplete="current-password" />
                        <Button onClick={addExternal} disabled={extBusy} className="w-full gap-2">{extBusy ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}{extBusy ? '登录中…' : '外置账号登录'}</Button>
                      </TabsContent>
                    </Tabs>

                    {/* 3D 人物展示 */}
                    <div className="rounded-xl bg-muted/30 border border-border p-3 flex flex-col items-center justify-center min-h-[260px]">
                      {account ? (
                        <Skin3DPreview skinUrl={account.skinUrl || ''} capeUrl={account.capeUrl} slim={!!account.slim} size={180} />
                      ) : (
                        <div className="text-center text-muted-foreground text-sm space-y-2">
                          <UserIcon className="size-10 mx-auto opacity-40" />
                          添加角色后这里显示 3D 人物
                        </div>
                      )}
                    </div>
                  </div>
                  {accounts.length > 0 && <p className="text-xs text-green-600">已添加 {accounts.length} 个角色，当前：{account?.username}</p>}
                  <p className="text-xs text-muted-foreground">这一步可以跳过；以后在「账号管理」里随时可以添加正版、离线、外置账号。</p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* 底部导航 */}
        <div className="px-5 sm:px-7 py-4 border-t border-border flex items-center justify-between">
          <Button variant="ghost" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} className="gap-1">
            <ChevronLeft className="size-4" />上一步
          </Button>
          <div className="flex items-center gap-2">
            {step !== 'license' && (
              <Button variant="ghost" onClick={goNext} className="text-muted-foreground">跳过</Button>
            )}
            <Button onClick={goNext} disabled={!canNext} className="gap-1">
              {idx === steps.length - 1 ? '完成' : '下一步'}<ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </Card>
    </motion.div>
    </div>
  );
}
