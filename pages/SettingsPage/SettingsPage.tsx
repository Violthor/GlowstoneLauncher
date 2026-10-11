import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Download, Shield, Palette, Image as ImageIcon, Upload, X, Cpu, Film,
  RefreshCw, DownloadCloud, Loader2, Sparkles, RotateCcw, FileText, ScrollText,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { useLauncherStore } from '@/hooks/useLauncherStore';
import { isMobileHost } from '@/mobile/bridge';
import { toast } from 'sonner';
import type { ILauncherSettings } from '@/data/launcher';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LICENSE_TITLE, LICENSE_VERSION, LICENSE_HOLDER, LICENSE_SECTIONS } from '@/data/licenseText';

interface SystemMemory {
  totalGB: number;
  freeGB: number;
  usedGB: number;
}

interface UpdateCheckResult {
  success: boolean;
  current?: string;
  latest?: string;
  updateAvailable?: boolean;
  notes?: string;
  url?: string;
  sha256?: string;
  size?: number;
  releaseDate?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sources?: any;
  error?: string;
}

function getElectronAPI() {
  return (window as unknown as {
    electronAPI?: {
      getSystemMemory: () => Promise<SystemMemory>;
      findJava: () => Promise<{ paths: string[] }>;
      pickBackgroundVideo?: () => Promise<{ success: boolean; canceled?: boolean; path?: string }>;
      appVersion?: () => Promise<string>;
      checkForUpdates?: () => Promise<UpdateCheckResult>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      downloadAndInstallUpdate?: (info: { version?: string; latest?: string; url: string; sha256?: string; size?: number; sources?: any }) => Promise<{ success: boolean; error?: string; path?: string }>;
      onUpdateProgress?: (cb: (p: { phase: string; percent: number }) => void) => () => void;
    };
  }).electronAPI ?? null;
}

const toFileUrl = (p: string) => 'file:///' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23');

export default function SettingsPage() {
  const isMobile = isMobileHost();
  const { settings, setSettings, appendLog } = useLauncherStore();
  const [bgPreview, setBgPreview] = useState<string | null>(settings.backgroundImage || null);
  const [bgVideo, setBgVideo] = useState<string>(settings.backgroundVideo || '');
  const [downloadDir, setDownloadDir] = useState(settings.downloadDir);
  const [sysMemory, setSysMemory] = useState<SystemMemory | null>(null);
  const [maxMemory, setMaxMemory] = useState(settings.maxMemoryMB || 4096);
  const [minMemory, setMinMemory] = useState(settings.minMemoryMB || 512);
  const [memoryMode, setMemoryMode] = useState<'auto' | 'custom'>(settings.memoryMode || 'auto');
  const [licenseOpen, setLicenseOpen] = useState(false);

  useEffect(() => {
    const api = getElectronAPI();
    if (api) {
      api.getSystemMemory().then(setSysMemory).catch(() => {});
    }
  }, []);

  // 手机端下载源（启动时已自动测速选源，这里允许手动覆盖）
  const [mobileSource, setMobileSource] = useState<string>('bmclapi');
  useEffect(() => {
    if (!isMobile) return;
    const a = getElectronAPI() as unknown as {
      getDownloadSource?: () => Promise<string>;
    };
    a.getDownloadSource?.().then(setMobileSource).catch(() => {});
  }, [isMobile]);
  const chooseMobileSource = async (s: string) => {
    setMobileSource(s);
    const a = getElectronAPI() as unknown as {
      setDownloadSource?: (x: string) => Promise<unknown>;
    };
    try {
      await a.setDownloadSource?.(s);
      toast.success(s === 'default' ? '已切换为官方源' : '已切换为 BMCL 镜像源');
    } catch {
      toast.error('切换失败，请重试');
    }
  };

  const handleThemeChange = (theme: ILauncherSettings['theme']) => {
    setSettings({ theme });
    document.documentElement.classList.toggle('dark', theme === 'dark');
  };

  const handleVersionIsolation = (isolated: boolean) => {
    setSettings({ versionIsolation: isolated });
    appendLog('INFO', `版本隔离已${isolated ? '开启' : '关闭'}`);
  };

  // 读取图片为 dataURL；手机端先按最大 1920px 等比缩放并以 JPEG 0.82 压缩，
  // 避免几 MB 的大图写进 localStorage 超出配额导致设置丢失。
  const fileToBackgroundDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!isMobile) {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('读取失败'));
        reader.readAsDataURL(file);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1920;
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            const k = maxDim / Math.max(width, height);
            width = Math.round(width * k);
            height = Math.round(height * k);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(reader.result as string); return; }
          ctx.drawImage(img, 0, 0, width, height);
          // 含透明通道的 PNG/WebP 用 png，否则用 jpeg 压缩体积
          const isLikelyPhoto = file.type === 'image/jpeg';
          resolve(canvas.toDataURL(isLikelyPhoto ? 'image/jpeg' : 'image/webp', 0.85));
        };
        img.onerror = () => reject(new Error('图片解析失败'));
        img.src = reader.result as string;
      };
      reader.onerror = () => reject(new Error('读取失败'));
      reader.readAsDataURL(file);
    });
  };

  const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('请选择图片文件'); return; }
    fileToBackgroundDataUrl(file).then((result) => {
      setBgPreview(result);
      setSettings({ backgroundImage: result });
      toast.success('背景图片已更新');
    }).catch((err) => toast.error(err.message || '背景图片处理失败'));
  };

  const clearBg = () => {
    setBgPreview(null);
    setSettings({ backgroundImage: '' });
  };

  const pickVideoBg = async () => {
    const api = getElectronAPI();
    const r = await api?.pickBackgroundVideo?.();
    if (!r || r.canceled || !r.path) return;
    setBgVideo(r.path);
    setSettings({ backgroundVideo: r.path });
    toast.success('视频背景已设置');
  };
  const clearVideoBg = () => {
    setBgVideo('');
    setSettings({ backgroundVideo: '' });
  };

  const saveDownloadDir = () => {
    setSettings({ downloadDir });
    toast.success('下载目录已保存');
  };

  const saveMemory = () => {
    setSettings({ maxMemoryMB: maxMemory, minMemoryMB: minMemory, memoryMode });
    toast.success('内存设置已保存');
    appendLog('INFO', `内存设置: ${minMemory}-${maxMemory}MB (${memoryMode === 'auto' ? '自动' : '自定义'})`);
  };

  // ---------- 在线更新 ----------
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'downloading' | 'ready'>('idle');
  const [updateMeta, setUpdateMeta] = useState<{ current?: string; latest?: string; notes?: string }>({});
  const [updatePct, setUpdatePct] = useState(0);
  const [appVer, setAppVer] = useState('');

  useEffect(() => {
    getElectronAPI()?.appVersion?.().then(setAppVer).catch(() => {});
  }, []);

  const handleCheckUpdate = async () => {
    if (updateState === 'checking' || updateState === 'downloading') return;
    const api = getElectronAPI();
    if (!api?.checkForUpdates || !api?.downloadAndInstallUpdate) {
      toast.error('仅桌面版支持在线更新');
      return;
    }
    setUpdateState('checking');
    const res = await api.checkForUpdates();
    if (!res.success) {
      setUpdateState('idle');
      toast.error(res.error || '检测更新失败，请检查网络');
      return;
    }
    setUpdateMeta({ current: res.current, latest: res.latest, notes: res.notes });
    if (!res.updateAvailable) {
      setUpdateState('idle');
      toast.success(`当前已是最新版本（正式版 ${res.current}）`);
      return;
    }
    toast.info(`发现新版本（正式版 ${res.latest}），开始自动下载安装包`);
    setUpdateState('downloading');
    setUpdatePct(0);
    const unsub = api.onUpdateProgress?.((p) => setUpdatePct(Math.max(0, p.percent || 0)));
    const r = await api.downloadAndInstallUpdate({
      version: res.latest,
      latest: res.latest,
      url: res.url || '',
      sha256: res.sha256,
      size: res.size,
      sources: res.sources,
    });
    unsub?.();
    if (r.success) {
      setUpdateState('ready');
      setUpdatePct(100);
      toast.success('最新安装包已下载，正在打开安装程序');
    } else {
      setUpdateState('idle');
      toast.error(r.error || '更新下载失败，请稍后重试');
    }
  };

  const autoMemory = sysMemory ? Math.max(2048, (sysMemory.totalGB - 2) * 1024) : 4096;
  const displayMax = memoryMode === 'auto' ? Math.round(autoMemory) : maxMemory;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">设置</h1>
        <p className="text-muted-foreground text-sm mt-1">配置启动器的各项偏好设置</p>
      </div>

      {/* 手机端：下载源（启动时自动测速，也可手动指定） */}
      {isMobile && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Download className="size-5" />下载源</CardTitle>
          <CardDescription>启动时会自动测速并选用更快的源；若仍觉得慢，可在此手动切换</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Button variant={mobileSource === 'bmclapi' ? 'default' : 'outline'}
              onClick={() => chooseMobileSource('bmclapi')}>BMCL 镜像</Button>
            <Button variant={mobileSource === 'default' ? 'default' : 'outline'}
              onClick={() => chooseMobileSource('default')}>官方源</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            BMCL 为国内公益镜像，多数网络更快；官方源在部分网络直连更快。版本、库、资源均走所选源。
          </p>
        </CardContent>
      </Card>
      )}

      {/* Update（手机端隐藏：更新走重新下载 APK） */}
      {!isMobile && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RefreshCw className="size-5" />检查更新</CardTitle>
          <CardDescription>检测启动器是否为最新版本；发现新版会自动下载安装包并打开安装向导</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">当前版本</span>
            <span className="font-mono font-medium">正式版 {appVer || '--'}</span>
          </div>
          {updateState !== 'idle' && updateMeta.latest && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">最新版本</span>
              <span className="font-mono font-medium text-primary">正式版 {updateMeta.latest}</span>
            </div>
          )}
          {updateState === 'downloading' && (
            <div className="space-y-2">
              <Progress value={updatePct} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>正在下载最新安装包，完成后将自动打开…</span>
                <span className="font-mono">{updatePct}%</span>
              </div>
            </div>
          )}
          {updateMeta.notes && updateState === 'downloading' && (
            <p className="text-xs text-muted-foreground whitespace-pre-line border-l-2 border-primary/40 pl-3">{updateMeta.notes}</p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" className="gap-2" onClick={handleCheckUpdate} disabled={updateState === 'checking' || updateState === 'downloading'}>
              {updateState === 'checking' ? <Loader2 className="size-4 animate-spin" /> : <DownloadCloud className="size-4" />}
              {updateState === 'checking' ? '正在检测…' : updateState === 'downloading' ? '下载中…' : updateState === 'ready' ? '安装程序已打开' : '检查更新'}
            </Button>
            <span className="text-xs text-muted-foreground">下载完成后自动打开安装向导，按提示覆盖安装即可，存档与配置不会丢失</span>
          </div>
        </CardContent>
      </Card>
      )}

      {/* 内存分配 / 版本隔离：手机端隐藏（RAM 与隔离由原生设置管理，此处不生效） */}
      {!isMobile && (<>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Cpu className="size-5" />内存分配</CardTitle>
          <CardDescription>配置游戏运行时的内存使用</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {sysMemory && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">系统内存</span>
                <span className="font-medium">{sysMemory.totalGB} GB</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary/60 rounded-full" style={{ width: `${(sysMemory.usedGB / sysMemory.totalGB) * 100}%` }} />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>已使用: {sysMemory.usedGB} GB</span>
                <span>可用: {sysMemory.freeGB} GB</span>
              </div>
            </div>
          )}

          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" checked={memoryMode === 'auto'} onChange={() => setMemoryMode('auto')} className="accent-primary" />
              <span className="text-sm">自动配置</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" checked={memoryMode === 'custom'} onChange={() => setMemoryMode('custom')} className="accent-primary" />
              <span className="text-sm">自定义</span>
            </label>
          </div>

          {memoryMode === 'auto' ? (
            <div className="bg-muted/40 rounded-lg p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">自动分配 (系统内存 - 保留量)</span>
                <span className="font-mono font-medium">{(autoMemory / 1024).toFixed(1)} GB</span>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">最大内存</Label>
                  <span className="font-mono text-sm bg-muted px-2 py-0.5 rounded">{maxMemory} MB ({(maxMemory / 1024).toFixed(1)} GB)</span>
                </div>
                <Slider value={[maxMemory]} onValueChange={([v]) => setMaxMemory(v)} min={1024} max={sysMemory ? sysMemory.totalGB * 1024 : 16384} step={256} />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1024 MB</span>
                  <span>{sysMemory ? sysMemory.totalGB * 1024 : 16384} MB</span>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">最小内存</Label>
                  <span className="font-mono text-sm bg-muted px-2 py-0.5 rounded">{minMemory} MB</span>
                </div>
                <Slider value={[minMemory]} onValueChange={([v]) => setMinMemory(v)} min={256} max={4096} step={128} />
              </div>
            </>
          )}

          <div className="flex justify-between items-center pt-2 border-t border-border/50">
            <div className="text-sm">
              <span className="text-muted-foreground">游戏分配内存: </span>
              <span className="font-mono font-medium">{(displayMax / 1024).toFixed(1)} GB</span>
            </div>
            <Button size="sm" onClick={saveMemory}>保存</Button>
          </div>
        </CardContent>
      </Card>

      {/* Version Isolation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="size-5" />版本隔离</CardTitle>
          <CardDescription>每个版本使用独立的游戏目录</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">隔离所有版本</p>
              <p className="text-xs text-muted-foreground mt-0.5">开启后每个版本拥有独立的 .minecraft 目录，Mod、存档、配置互不影响</p>
            </div>
            <Switch checked={settings.versionIsolation} onCheckedChange={handleVersionIsolation} />
          </div>
        </CardContent>
      </Card>
      </>)}

      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Palette className="size-5" />外观设置</CardTitle>
          <CardDescription>主题和背景</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>主题</Label>
            <Select value={settings.theme} onValueChange={handleThemeChange}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="light">浅色主题</SelectItem>
                <SelectItem value="dark">深色主题</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>背景图片</Label>
            <div className="flex gap-3 items-start">
              {bgPreview ? (
                <div className="relative w-32 h-20 rounded-lg overflow-hidden bg-muted border border-border shrink-0">
                  <img src={bgPreview} alt="背景预览" className="w-full h-full object-cover" />
                  <button type="button" onClick={clearBg} title="移除背景图片" className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full border border-white/80 bg-black/75 text-white shadow-md ring-1 ring-black/40 hover:bg-black/95 cursor-pointer">
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : (
                <div className="w-32 h-20 rounded-lg bg-muted border border-dashed border-border flex items-center justify-center shrink-0">
                  <ImageIcon className="size-6 text-muted-foreground" />
                </div>
              )}
              <div className="space-y-2 flex-1">
                <Label htmlFor="bg-upload" className="cursor-pointer">
                  <div className="flex items-center gap-2 px-3 py-2 border border-input rounded-lg hover:bg-accent transition-colors w-fit">
                    <Upload className="size-4" /><span className="text-sm">上传背景图片</span>
                  </div>
                  <input id="bg-upload" type="file" accept="image/*" className="hidden" onChange={handleBgUpload} />
                </Label>
                <p className="text-xs text-muted-foreground">支持 JPG / PNG / WebP{isMobile ? '，手机端会自动压缩' : '，建议 1920×1080'}</p>
              </div>
            </div>
          </div>
          {!isMobile && (
          <div className="space-y-2">
            <Label>视频背景</Label>
            <div className="flex gap-3 items-start">
              {bgVideo ? (
                <div className="relative w-32 h-20 rounded-lg overflow-hidden bg-muted border border-border shrink-0">
                  <video src={toFileUrl(bgVideo)} className="w-full h-full object-cover" muted loop autoPlay playsInline />
                  <button type="button" onClick={clearVideoBg} title="移除视频背景" className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full border border-white/80 bg-black/75 text-white shadow-md ring-1 ring-black/40 hover:bg-black/95 cursor-pointer">
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : (
                <div className="w-32 h-20 rounded-lg bg-muted border border-dashed border-border flex items-center justify-center shrink-0">
                  <Film className="size-6 text-muted-foreground" />
                </div>
              )}
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-2 px-3 py-2 border border-input rounded-lg hover:bg-accent transition-colors w-fit cursor-pointer" onClick={pickVideoBg}>
                  <Upload className="size-4" /><span className="text-sm">{bgVideo ? '更换视频背景' : '导入视频背景'}</span>
                </div>
                <p className="text-xs text-muted-foreground break-all">{bgVideo || '支持 MP4 / WebM / MOV，循环静音播放；设置图片背景时视频优先'}</p>
              </div>
            </div>
          </div>
          )}
        </CardContent>
      </Card>

      {/* Visual Effects */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="size-5" />视觉效果</CardTitle>
          <CardDescription>界面质感与性能</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">毛玻璃效果</p>
              <p className="text-xs text-muted-foreground mt-0.5">开启后界面元素将呈现半透明毛玻璃质感，关闭可提升性能</p>
            </div>
            <Switch
              checked={settings.glassEffect === true}
              onCheckedChange={(v) => setSettings({ glassEffect: v })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Download Settings：手机端隐藏（下载源已固定 BMCL，目录由原生管理） */}
      {!isMobile && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Download className="size-5" />下载设置</CardTitle>
          <CardDescription>下载目录相关配置</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>下载源（API）</Label>
            <Select value={settings.downloadSource || 'bmcl'} onValueChange={(v) => setSettings({ downloadSource: v as 'official' | 'bmcl' })}>
              <SelectTrigger className="w-[280px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bmcl">BMCLAPI 国内镜像（推荐，速度快）</SelectItem>
                <SelectItem value="official">Mojang 官方源</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">国内网络建议使用 BMCLAPI 镜像；版本、库、资源都会走所选下载源</p>
          </div>
          <div className="space-y-2">
            <Label>默认下载目录</Label>
            <div className="flex gap-2">
              <Input value={downloadDir} onChange={(e) => setDownloadDir(e.target.value)} placeholder="下载时会询问保存位置" />
              <Button onClick={saveDownloadDir}>保存</Button>
            </div>
            <p className="text-xs text-muted-foreground">下载资源时会弹出文件夹选择，此处仅作为默认值</p>
          </div>
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="size-5" />许可协议</CardTitle>
          <CardDescription>查看 Glowstone Launcher 最终用户许可协议与第三方组件声明</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="gap-2" onClick={() => setLicenseOpen(true)}>
            <ScrollText className="size-4" />查看许可协议
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            本启动器为自主研发软件，采用自有的专有许可协议，不使用任何第三方启动器的开源协议；
            Electron、React 等仅作为底层基础库使用。
          </p>
        </CardContent>
      </Card>

      {!isMobile && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RotateCcw className="size-5" />初始设置向导</CardTitle>
          <CardDescription>重新打开首次启动时的引导（Java 检查、主题、导入版本、添加角色）</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => {
              setSettings({ onboarded: false });
              toast.success('已重新打开初始设置向导');
            }}
          >
            <RotateCcw className="size-4" />重新打开向导
          </Button>
          <p className="text-xs text-muted-foreground mt-2">不会删除你现有的账号、版本和设置，仅重新展示引导步骤。</p>
        </CardContent>
      </Card>
      )}

      <Dialog open={licenseOpen} onOpenChange={setLicenseOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="size-5 text-primary" />{LICENSE_TITLE}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto pr-1 space-y-4 text-sm">
            <div className="text-xs text-muted-foreground">
              版本：{LICENSE_VERSION}　·　著作权人：{LICENSE_HOLDER}
            </div>
            {LICENSE_SECTIONS.map((s) => (
              <div key={s.h} className="space-y-1.5">
                <div className="font-semibold text-foreground">{s.h}</div>
                {s.p.map((t, i) => (
                  <p key={i} className="text-muted-foreground leading-relaxed">{t}</p>
                ))}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
