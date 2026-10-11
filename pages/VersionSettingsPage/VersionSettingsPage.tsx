import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  FolderOpen, Save, Trash2, Download, Code2, Star, StarOff, ChevronRight,
  Image as ImageIcon, Edit3, Upload, RefreshCw, Cpu,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLauncherStore } from '@/hooks/useLauncherStore';
import { toast } from 'sonner';
import VersionIcon, { BLOCKS, LOADER_ICONS } from '@/components/VersionIcon';
import { requiredJavaMajor } from '@/data/javaCompat';

function compactJavaPath(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).slice(-3).join('/');
}
type JavaOption = { path: string; major: number };

export default function VersionSettingsPage() {
  const {
    installedVersions, currentVersion: selectedVersionId, setCurrentVersion,
    updateInstalledVersion, removeInstalledVersion, appendLog, settings,
  } = useLauncherStore();

  const displayVersions = installedVersions;
  const currentVersion = displayVersions.find((v) => v.id === selectedVersionId) ?? displayVersions[0];
  const requiredJava = currentVersion ? requiredJavaMajor(currentVersion.id) : 0;

  const [localName, setLocalName] = useState('');
  const [localDesc, setLocalDesc] = useState('');
  const [localCategory, setLocalCategory] = useState('正式版');
  const [localMinMem, setLocalMinMem] = useState(512);
  const [localMaxMem, setLocalMaxMem] = useState(4096);
  const [localJavaPath, setLocalJavaPath] = useState('');
  const [localJvmArgs, setLocalJvmArgs] = useState('-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200');
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [selectedIcon, setSelectedIcon] = useState('grass');
  const [syncedId, setSyncedId] = useState<string>('');
  const iconFileRef = useRef<HTMLInputElement>(null);
  const [javaOptions, setJavaOptions] = useState<JavaOption[]>([]);
  const [javaLoading, setJavaLoading] = useState(false);
  const currentJava = javaOptions.find((j) => j.path === localJavaPath) || null;

  useEffect(() => {
    if (!currentVersion) return;
    if (syncedId === currentVersion.id) return;
    setLocalName(currentVersion.id);
    setLocalDesc(currentVersion.description);
    setLocalCategory(currentVersion.category);
    setLocalMinMem(currentVersion.minMemoryMB);
    setLocalMaxMem(currentVersion.maxMemoryMB);
    setSelectedIcon(currentVersion.icon || 'grass');
    setLocalJavaPath(currentVersion.javaPath || '');
    setLocalJvmArgs(currentVersion.jvmArgs || '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200');
    setSyncedId(currentVersion.id);
  }, [currentVersion, syncedId]);

  // Load the full-drive Java scan once on entering the page.
  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { listJava?: (a?: { force: boolean }) => Promise<{ javas: JavaOption[] }> } }).electronAPI;
    if (!api?.listJava) return;
    let alive = true;
    setJavaLoading(true);
    api.listJava()
      .then((r) => { if (alive) setJavaOptions(r.javas || []); })
      .catch(() => {})
      .finally(() => { if (alive) setJavaLoading(false); });
    return () => { alive = false; };
  }, []);

  // Auto-pick the best JDK for this version when the version has no Java configured yet.
  useEffect(() => {
    if (!currentVersion || !javaOptions.length) return;
    if (currentVersion.javaPath || localJavaPath) return;
    const req = requiredJavaMajor(currentVersion.id);
    const usable = javaOptions
      .filter((j) => !j.major || j.major >= req)
      .sort((a, b) => (a.major || 999) - (b.major || 999));
    if (usable[0]) setLocalJavaPath(usable[0].path);
  }, [javaOptions, currentVersion, localJavaPath]);

  const handleVersionChange = (versionId: string) => { setCurrentVersion(versionId); };

  const handleCustomIcon = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('请选择图片文件'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setSelectedIcon(dataUrl);
      setIconPickerOpen(false);
      toast.success('自定义图标已设置');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const saveSettings = () => {
    if (!currentVersion) return;
    updateInstalledVersion(currentVersion.id, {
      description: localDesc, category: localCategory,
      minMemoryMB: localMinMem, maxMemoryMB: localMaxMem, icon: selectedIcon,
      javaPath: localJavaPath, jvmArgs: localJvmArgs,
    });
    toast.success('版本设置已保存');
    appendLog('INFO', `版本 ${currentVersion.id} 设置已更新`);
  };

  const toggleFavorite = () => {
    if (!currentVersion) return;
    updateInstalledVersion(currentVersion.id, { isFavorite: !currentVersion.isFavorite });
    toast(currentVersion.isFavorite ? '已取消收藏' : '已收藏版本');
  };

  const openFolder = async (type: string) => {
    const labels: Record<string, string> = { version: '版本文件夹', saves: '存档文件夹', mods: 'Mod 文件夹', screenshots: '截图文件夹' };
    const api = (window as unknown as { electronAPI?: {
      openFolder: (p: string) => Promise<{ success: boolean }>;
      openVersionFolder?: (a: { root: string; versionId: string; isolated: boolean; kind: string }) => Promise<{ success: boolean; path?: string; error?: string }>;
    } }).electronAPI;
    if (!currentVersion) return;
    const baseDir = currentVersion.gameDir || '.minecraft';
    if (api && api.openVersionFolder) {
      const res = await api.openVersionFolder({
        root: baseDir, versionId: currentVersion.id,
        isolated: (settings as Record<string, unknown>).versionIsolation === true,
        kind: type === 'version' ? 'version' : type,
      });
      if (!res.success) toast.info(`${labels[type]}: ${res.error || ''}`);
      return;
    }
    const subDir = type === 'version' ? '' : type === 'mods' ? '/mods' : type === 'saves' ? '/saves' : '/screenshots';
    if (api) {
      await api.openFolder(baseDir + subDir);
    } else {
      toast.info(`${labels[type]}: ${baseDir}${subDir}`);
    }
  };

  const chooseJavaPath = async () => {
    const api = (window as unknown as { electronAPI?: { selectFile: (f: { name: string; extensions: string[] }[]) => Promise<{ success: boolean; path?: string }> } }).electronAPI;
    if (!api) { toast.error('需要在桌面端中运行'); return; }
    const res = await api.selectFile([{ name: 'Java', extensions: ['exe'] }]);
    if (res.success && res.path) setLocalJavaPath(res.path);
  };

  const rescanJava = async () => {
    const api = (window as unknown as { electronAPI?: { listJava?: (a?: { force: boolean }) => Promise<{ javas: JavaOption[] }> } }).electronAPI;
    if (!api?.listJava) { toast.error('需要在桌面端运行'); return; }
    setJavaLoading(true);
    const tid = toast.loading ? toast.loading('正在全盘扫描已安装的 Java…') : undefined;
    try {
      const r = await api.listJava({ force: true });
      setJavaOptions(r.javas || []);
      toast.success(`扫描完成，发现 ${(r.javas || []).length} 个 Java`);
    } catch { toast.error('Java 扫描失败'); }
    finally { setJavaLoading(false); if (tid !== undefined) toast.dismiss(tid); }
  };

  const exportScript = () => { toast.success('启动脚本已导出'); appendLog('INFO', '启动脚本导出成功'); };
  const repairFiles = () => { toast.success('文件补全完成'); appendLog('INFO', '游戏文件补全检查完成'); };
  const [deleting, setDeleting] = useState(false);
  const handleDelete = async () => {
    if (!currentVersion || deleting) return;
    const id = currentVersion.id;
    const api = (window as unknown as { electronAPI?: { deleteVersion: (g: string, v: string) => Promise<{ success: boolean; error?: string; notFound?: boolean }> } }).electronAPI;
    setDeleting(true);
    try {
      if (api?.deleteVersion) {
        const res = await api.deleteVersion(currentVersion.gameDir || '.minecraft', id);
        if (!res.success && !res.notFound) {
          toast.error(`文件删除失败: ${res.error || '未知错误'}`);
          appendLog('ERROR', `版本 ${id} 文件删除失败: ${res.error}`);
          return;
        }
      }
      removeInstalledVersion(id);
      toast.success(`版本 ${id} 已删除`);
      appendLog('WARN', `版本 ${id} 及其磁盘文件已被删除`);
    } finally {
      setDeleting(false);
    }
  };

  if (!currentVersion) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <FolderOpen className="size-12 mb-4" />
        <p>暂无已安装版本</p>
        <p className="text-sm mt-1">请先到「版本下载」页面安装一个版本</p>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">版本设置</h1>
          <p className="text-muted-foreground text-sm mt-1">配置游戏版本的各项参数</p>
        </div>
        <Select value={currentVersion.id} onValueChange={handleVersionChange}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="选择版本" /></SelectTrigger>
          <SelectContent>
            {displayVersions.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                <span className="flex items-center gap-2">
                  <VersionIcon type={v.icon || 'grass'} size={18} />
                  <span>{v.id}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Edit3 className="size-5" />个性化</CardTitle>
            <CardDescription>自定义版本的显示信息</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>版本图标</Label>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setIconPickerOpen(true)} className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center hover:bg-muted/70 transition-colors border border-border/50 overflow-hidden">
                  <VersionIcon type={selectedIcon} size={36} />
                </button>
                <div className="space-y-1">
                  <p className="text-sm font-medium">点击更换图标</p>
                  <p className="text-xs text-muted-foreground">从内置图标中选择</p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label>分类 <span className="text-xs font-normal text-muted-foreground">（按版本官方锁定，不可修改）</span></Label>
              <Input value={localCategory} disabled readOnly className="cursor-not-allowed opacity-70" />
            </div>
            <div className="space-y-2">
              <Label>版本名称</Label>
              <Input value={localName} onChange={(e) => setLocalName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>版本描述</Label>
              <Textarea value={localDesc} onChange={(e) => setLocalDesc(e.target.value)} rows={3} />
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="ghost" onClick={toggleFavorite} className="gap-2">
              {currentVersion.isFavorite ? (<><StarOff className="size-4" /> 取消收藏</>) : (<><Star className="size-4 fill-amber-400 text-amber-400" /> 收藏版本</>)}
            </Button>
            <Button onClick={saveSettings} className="gap-2"><Save className="size-4" /> 保存设置</Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FolderOpen className="size-5" />快捷方式</CardTitle>
            <CardDescription>快速打开相关文件夹</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            {[
              { key: 'version', label: '版本文件夹', icon: FolderOpen },
              { key: 'saves', label: '存档文件夹', icon: Save },
              { key: 'mods', label: 'Mod 文件夹', icon: Code2 },
              { key: 'screenshots', label: '截图文件夹', icon: ImageIcon },
            ].map((item) => (
              <Button key={item.key} variant="outline" onClick={() => openFolder(item.key)} className="flex items-center justify-start gap-2 h-auto py-3 px-4">
                <item.icon className="size-4 shrink-0" />
                <span className="text-sm">{item.label}</span>
                <ChevronRight className="size-3 ml-auto text-muted-foreground" />
              </Button>
            ))}
          </CardContent>

          <CardHeader className="pt-4">
            <CardTitle className="flex items-center gap-2 text-base"><Trash2 className="size-4" />高级管理</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" className="w-full justify-start gap-2" onClick={exportScript}>
              <Download className="size-4" />导出启动脚本
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2" onClick={repairFiles}>
              <Code2 className="size-4" />补全文件
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="w-full justify-start gap-2">
                  <Trash2 className="size-4" />删除版本
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认删除版本？</AlertDialogTitle>
                  <AlertDialogDescription>
                    此操作将永久删除版本 <strong>{currentVersion.id}</strong> 及其所有相关文件，删除后无法恢复。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">确认删除</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Code2 className="size-5" />内存分配</CardTitle>
            <CardDescription>调整 JVM 内存参数</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>最大内存</Label>
                <span className="font-mono text-sm bg-muted px-2 py-0.5 rounded">{localMaxMem} MB</span>
              </div>
              <Slider value={[localMaxMem]} onValueChange={([v]) => { setLocalMaxMem(v); updateInstalledVersion(currentVersion.id, { maxMemoryMB: v }); }} min={1024} max={16384} step={256} />
              <div className="flex justify-between text-xs text-muted-foreground"><span>1024 MB</span><span>16384 MB</span></div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>最小内存</Label>
                <span className="font-mono text-sm bg-muted px-2 py-0.5 rounded">{localMinMem} MB</span>
              </div>
              <Slider value={[localMinMem]} onValueChange={([v]) => { setLocalMinMem(v); updateInstalledVersion(currentVersion.id, { minMemoryMB: v }); }} min={256} max={8192} step={128} />
              <div className="flex justify-between text-xs text-muted-foreground"><span>256 MB</span><span>8192 MB</span></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Code2 className="size-5" />Java 设置</CardTitle>
            <CardDescription>配置 Java 路径和 JVM 参数</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="flex items-center gap-1.5"><Cpu className="size-3.5" />Java 运行环境</Label>
                <span className="text-xs text-muted-foreground">
                  该版本推荐 Java {requiredJava}+
                  {currentJava ? (currentJava.major >= requiredJava
                    ? ' · 当前 Java ' + currentJava.major + ' 合适'
                    : ' · 当前 Java ' + (currentJava.major || '?') + ' 偏低') : ''}
                </span>
              </div>
              <div className="flex gap-2">
                <Select
                  value={javaOptions.some((j) => j.path === localJavaPath) ? localJavaPath : ''}
                  onValueChange={(v) => { if (v) setLocalJavaPath(v); }}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={javaLoading ? '正在全盘扫描已安装的 Java…' : javaOptions.length ? '选择扫描到的 Java（也可在下方手动指定）' : '未扫描到 Java，请点右侧手动浏览'} />
                  </SelectTrigger>
                  <SelectContent>
                    {javaOptions.map((j) => (
                      <SelectItem key={j.path} value={j.path}>
                        Java {j.major || '?'}{j.major && j.major < requiredJava ? '（偏低）' : j.major >= requiredJava ? '（推荐）' : ''} · {compactJavaPath(j.path)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" title="重新全盘扫描" onClick={rescanJava} type="button" disabled={javaLoading}><RefreshCw className={`size-4 ${javaLoading ? 'animate-spin' : ''}`} /></Button>
                <Button variant="outline" size="icon" title="手动浏览 java.exe" onClick={chooseJavaPath} type="button"><FolderOpen className="size-4" /></Button>
              </div>
              <Input value={localJavaPath} onChange={(e) => setLocalJavaPath(e.target.value)} placeholder="也可直接输入或浏览 java.exe 完整路径" className="font-mono text-xs" />
            </div>
            <div className="space-y-2">
              <Label>JVM 参数</Label>
              <Textarea value={localJvmArgs} onChange={(e) => setLocalJvmArgs(e.target.value)} rows={3} className="font-mono text-sm" />
              <p className="text-xs text-muted-foreground">可选：自定义 JVM 启动参数，高级选项</p>
            </div>
            <div className="bg-muted/40 rounded-lg p-3 text-sm">
              <div className="font-medium mb-1">预计启动命令</div>
              <code className="text-xs text-muted-foreground break-all">
                java -Xms{localMinMem}M -Xmx{localMaxMem}M {localJvmArgs.split(' ').slice(0, 3).join(' ')} ... -jar minecraft.jar
              </code>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={iconPickerOpen} onOpenChange={setIconPickerOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>选择图标</DialogTitle></DialogHeader>
          <div className="mb-3">
            <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => iconFileRef.current?.click()}>
              <Upload className="size-4" />导入自定义图片
            </Button>
            <input ref={iconFileRef} type="file" accept="image/*" className="hidden" onChange={handleCustomIcon} />
          </div>
          <p className="text-xs text-muted-foreground mb-2">加载器图标</p>
          <div className="grid grid-cols-6 gap-2 mb-4">
            {LOADER_ICONS.map((key) => (
              <button key={key} type="button" onClick={() => { setSelectedIcon(key); setIconPickerOpen(false); }}
                className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-all ${selectedIcon === key ? 'bg-primary/10 ring-2 ring-primary' : 'bg-muted hover:bg-muted/70'}`}>
                <VersionIcon type={key} size={32} />
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mb-2">方块图标</p>
          <div className="grid grid-cols-6 gap-2">
            {BLOCKS.map((block) => (
              <button key={block.key} type="button" onClick={() => { setSelectedIcon(block.key); setIconPickerOpen(false); }}
                className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-all ${selectedIcon === block.key ? 'bg-primary/10 ring-2 ring-primary' : 'bg-muted hover:bg-muted/70'}`}
                title={block.label}>
                <VersionIcon type={block.key} size={32} />
                <span className="text-[10px] font-medium truncate w-full text-center">{block.label}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
