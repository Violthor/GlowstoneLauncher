import { Outlet, useLocation } from 'react-router-dom';
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import AppSidebar from '@/components/AppSidebar';
import TitleBar from '@/components/TitleBar';
import { useLauncherStore } from '@/hooks/useLauncherStore';
import { memo, useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useIsMobile } from '@/hooks/use-mobile';
import { Menu, Package } from 'lucide-react';
import { toast } from 'sonner';
import FloatingDock from '@/components/FloatingDock';
import PageTransition from '@/components/PageTransition';
import { isMobileHost } from '@/mobile/bridge';
import { useNativeAccountSync } from '@/mobile/useNativeAccountSync';

const toFileUrl = (p: string) => 'file:///' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23');

// 移动端菜单按钮：直接调用 toggleSidebar，用普通 button（不经过 SidebarTrigger 的 asChild/Slot，
// 因为 SidebarTrigger 内部硬编码了 PanelLeft + sr-only 两个子节点，asChild 会导致 Slot 报错）
function MobileMenuButton() {
  const { toggleSidebar } = useSidebar();
  return (
    <button
      type="button"
      aria-label="打开菜单"
      onClick={() => toggleSidebar()}
      className="size-8 inline-flex items-center justify-center rounded-md bg-background/55 dark:bg-black/35 border border-border/60 backdrop-blur-md shadow-sm hover:bg-accent text-foreground"
    >
      <Menu className="size-4" />
    </button>
  );
}

function LayoutInner() {
  const { settings, installedVersions, addInstalledVersion, appendLog, currentVersionObj, mergeScannedVersions } = useLauncherStore();
  const location = useLocation();
  const isMobile = useIsMobile();
  const mobileHost = isMobileHost();
  // 手机端：当前账号（任意类型）变化即同步到原生，保证启动游戏能读到账号
  useNativeAccountSync();
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);
  const [isMax, setIsMax] = useState(false);
  // 关闭收托盘 / 最小化前的淡出缩小，还原时淡入（动画结束再通知主进程真正隐藏）
  const [winAnim, setWinAnim] = useState<'in' | 'out'>('in');
  const animDir = useRef<'in' | 'out'>('in');
  // 最大化/还原全屏时的一次轻微展开/收拢脉冲（首次挂载不触发）
  const [maxPulse, setMaxPulse] = useState(false);
  const firstMax = useRef(true);

  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { isMaximized?: () => Promise<boolean>; onMaximizeChange?: (cb: (m: boolean) => void) => () => void; onPlayAnim?: (cb: (d: 'in' | 'out') => void) => () => void; animFinished?: () => void } }).electronAPI;
    if (!api) return;
    api.isMaximized?.().then((m) => setIsMax(m));
    const offMax = api.onMaximizeChange?.((m) => setIsMax(m));
    const offAnim = api.onPlayAnim?.((d) => { animDir.current = d; setWinAnim(d); });
    return () => { offMax?.(); offAnim?.(); };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
    document.documentElement.classList.toggle('glass-mode', settings.glassEffect === true);
  }, [settings.theme, settings.glassEffect]);

  // 启动后静默自动识别本机已装版本及其加载器（默认 .minecraft + 已记录的游戏目录），
  // 无需用户手动「导入版本」，保证在任何电脑上都能自动识别 Fabric/Forge/Quilt/NeoForge。
  useEffect(() => {
    const api = (window as unknown as {
      electronAPI?: {
        autoScanVersions?: (dirs: string[]) => Promise<{
          success: boolean;
          versions?: Array<{ id: string; versionId?: string; gameDir?: string; versionType?: string; loader?: string; loaderVersion?: string }>;
        }>;
      }
    }).electronAPI;
    if (!api?.autoScanVersions) return;
    let cancelled = false;
    const dirs = Array.from(new Set(installedVersions.map((v) => v.gameDir).filter(Boolean) as string[]));
    api.autoScanVersions(dirs).then((r) => {
      if (cancelled || !r?.success || !Array.isArray(r.versions) || r.versions.length === 0) return;
      const res = mergeScannedVersions(r.versions);
      if (res.added > 0) toast.success(`自动识别到 ${res.added} 个本机版本`);
    }).catch((e) => console.error('[auto-scan] 自动识别本机版本失败', e));
    return () => { cancelled = true; };
    // 仅在主界面挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 最大化 ↔ 还原切换时播放一次缩放脉冲（进入全屏轻微放大、退出全屏轻微收回）
  useEffect(() => {
    if (firstMax.current) { firstMax.current = false; return; }
    setMaxPulse(true);
    const t = setTimeout(() => setMaxPulse(false), 280);
    return () => clearTimeout(t);
  }, [isMax]);

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types || []).includes('Files');
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!hasFiles(e)) return;
    dragCounter.current += 1;
    setDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (hasFiles(e)) setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // enter/leave fire on every child element; only hide once the cursor truly leaves.
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0 || !e.relatedTarget) setDragOver(false);
  }, []);

  const resetDrag = useCallback(() => { dragCounter.current = 0; setDragOver(false); }, []);

  // Safety net: releasing outside the window / pressing Esc fires dragend (and the window can
  // blur); always clear the overlay so it can never stay stuck on screen.
  useEffect(() => {
    const end = () => resetDrag();
    document.addEventListener('dragend', end);
    window.addEventListener('blur', end);
    return () => { document.removeEventListener('dragend', end); window.removeEventListener('blur', end); };
  }, [resetDrag]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resetDrag();
    const files = Array.from(e.dataTransfer.files).filter((f) => /\.(mrpack|zip|jar)$/i.test(f.name));
    if (!files.length) {
      toast.error('请拖入整合包（.mrpack/.zip）、Mod（.jar）或资源包（.zip）');
      return;
    }
    const api = (window as unknown as {
      electronAPI?: {
        pathForFile?: (f: File) => string;
        selectFolder?: () => Promise<{ success: boolean; path?: string }>;
        classifyArchive?: (a: { srcPath: string }) => Promise<{ success: boolean; kind: string }>;
        installDrop?: (a: Record<string, unknown>) => Promise<{ success: boolean; dest?: string; error?: string }>;
        importModpack?: (a: { srcPath: string; parentDir: string; name: string }) => Promise<{ success: boolean; gameDir?: string; loader?: string; name?: string; error?: string }>;
      }
    }).electronAPI;
    if (!api?.pathForFile) { toast.error('拖入导入仅支持桌面端'); return; }

    for (const file of files) {
      const srcPath = api.pathForFile!(file) || '';
      if (!srcPath) continue;
      const cls = await api.classifyArchive?.({ srcPath }).catch(() => null);
      const kind = cls?.kind || (/\.mrpack$/i.test(file.name) ? 'modpack' : /\.jar$/i.test(file.name) ? 'mod' : 'resourcepack');

      // ---- Mod (.jar) / resource pack (.zip) -> copy straight into the current version ----
      if (kind === 'mod' || kind === 'resource' || kind === 'datapack') {
        if (!currentVersionObj) { toast.error('请先在首页选择一个版本，再拖入 ' + (kind === 'mod' ? 'Mod' : '资源包')); continue; }
        const res = await api.installDrop?.({
          srcPath, kind,
          root: currentVersionObj.gameDir || '.minecraft',
          versionId: currentVersionObj.id,
          isolated: settings.versionIsolation === true,
        });
        if (res?.success) {
          toast.success(kind === 'mod' ? `Mod 已加入版本 ${currentVersionObj.id} 的 mods 文件夹` : '资源包已放入 resourcepacks 文件夹');
          appendLog('INFO', `拖入${kind === 'mod' ? 'Mod' : '资源包'}: ${file.name} -> ${res.dest}`);
        } else toast.error(`导入失败：${res?.error || '未知错误'}`);
        continue;
      }

      // ---- Modpack (.mrpack / packed .zip) -> extract into a folder the user chooses ----
      const name = file.name.replace(/\.(mrpack|zip|jar)$/i, '');
      if (installedVersions.some((v) => v.id === name)) { toast.error(`导入失败：版本 "${name}" 已存在`); continue; }
      if (!api.importModpack) { toast.error('整合包解压导入仅支持桌面端'); continue; }
      const picked = await api.selectFolder!();
      if (!picked.success || !picked.path) { toast.message('已取消整合包导入'); continue; }
      const tid = toast.loading ? toast.loading('正在解压整合包…') : undefined;
      const res = await api.importModpack({ srcPath, parentDir: picked.path, name });
      if (tid !== undefined) toast.dismiss(tid);
      if (!res.success || !res.gameDir) { toast.error(`整合包导入失败：${res.error || '未知错误'}`); appendLog('ERROR', `整合包导入失败: ${res.error}`); continue; }
      const id = res.name || name;
      addInstalledVersion({
        id,
        versionId: id,
        loader: (res.loader as 'vanilla' | 'forge' | 'fabric' | 'quilt' | 'neoforge') || 'fabric',
        icon: 'grass',
        category: '导入整合包',
        description: `从 ${file.name} 导入 · 安装于 ${res.gameDir}`,
        isFavorite: false,
        installTime: Date.now(),
        gameDir: res.gameDir,
        minMemoryMB: 1024,
        maxMemoryMB: 4096,
        versionType: 'release',
      });
      toast.success(`整合包 "${name}" 已安装到所选位置`);
      appendLog('INFO', `整合包导入成功: ${name} -> ${res.gameDir} (${res.loader})`);
    }
  }, [installedVersions, addInstalledVersion, appendLog, resetDrag, currentVersionObj, settings.versionIsolation]);

  const hasImgBg = !!settings.backgroundImage;
  const hasVideoBg = !!settings.backgroundVideo;

  // 自定义背景层（桌面/手机共用）
  const backgroundLayers = (
    <>
      <AnimatePresence>
        {hasImgBg && !hasVideoBg && (
          <motion.div
            key={settings.backgroundImage}
            className="absolute inset-0 z-0 bg-cover bg-center rounded-none"
            style={{ backgroundImage: `url(${settings.backgroundImage})` }}
            initial={{ opacity: 0, scale: 1.06 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          />
        )}
        {hasVideoBg && (
          <motion.video
            key={settings.backgroundVideo}
            src={toFileUrl(settings.backgroundVideo as string)}
            className="absolute inset-0 z-0 w-full h-full object-cover pointer-events-none rounded-none"
            muted loop autoPlay playsInline
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          />
        )}
      </AnimatePresence>
      {(hasImgBg || hasVideoBg) && (
        <div className="absolute inset-0 bg-black/10 dark:bg-black/25 pointer-events-none z-0 rounded-none" />
      )}
    </>
  );

  // ================= 手机版：左侧栏固定为收起的图标条（icon rail），不可展开、无底部导航 =================
  if (mobileHost) {
    return (
      <div className={`relative flex h-screen w-full overflow-hidden text-foreground ${(hasImgBg || hasVideoBg) ? '' : 'bg-background'}`}>
        {backgroundLayers}
        <SidebarProvider open={false}>
          <AppSidebar />
          <SidebarInset className={`flex flex-col min-w-0 overflow-hidden relative z-10 ${(hasImgBg || hasVideoBg) ? 'bg-transparent' : 'bg-background'}`}>
            <TitleBar />
            <PageTransition className="flex-1 w-full overflow-y-auto p-3 landscape:p-4">
              <Outlet />
            </PageTransition>
          </SidebarInset>
        </SidebarProvider>
        <FloatingDock />
      </div>
    );
  }

  // ================= 桌面版 =================
  return (
    <motion.div
      initial={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)', rotate: 0, borderRadius: 14 }}
      animate={winAnim === 'out'
        ? { opacity: 0, scale: 0.68, y: 140, filter: 'blur(16px)', rotate: -3.5 }
        : {
            opacity: 1, y: 0, filter: 'blur(0px)', rotate: 0,
            scale: maxPulse ? (isMax ? 0.985 : 1.012) : 1,
            borderRadius: isMax ? 0 : 14,
          }}
      transition={winAnim === 'out'
        ? { duration: 0.34, ease: [0.5, 0, 0.75, 0] }
        : { type: 'spring', stiffness: 260, damping: 24, borderRadius: { duration: 0.28, ease: 'easeOut' } }}
      onAnimationComplete={() => { if (animDir.current === 'out') (window as unknown as { electronAPI?: { animFinished?: () => void } }).electronAPI?.animFinished?.(); }}
      className={`relative flex h-screen w-full overflow-hidden text-foreground [contain:paint] ${isMax ? 'rounded-none' : 'rounded-[14px]'} ${(hasImgBg || hasVideoBg) ? '' : 'bg-background'}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {backgroundLayers}
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className={`flex flex-col min-w-0 overflow-hidden relative z-10 ${(hasImgBg || hasVideoBg) ? 'bg-transparent' : 'bg-background'}`}>
          <TitleBar />
          <header className={`flex h-10 items-center justify-between px-4 shrink-0 ${(hasImgBg || hasVideoBg) ? 'bg-transparent' : 'bg-background border-b border-border/30'}`}>
            <div className="flex items-center gap-2">
              {isMobile && <MobileMenuButton />}
              {!isMobile && (
                <SidebarTrigger
                  variant="ghost"
                  size="sm"
                  className="bg-background/55 dark:bg-black/35 border border-border/60 backdrop-blur-md shadow-sm hover:bg-accent text-foreground data-[state=open]:bg-accent"
                />
              )}
            </div>
            <div className="w-10" />
          </header>
          <PageTransition className="flex-1 w-full overflow-y-auto p-4 md:p-6 lg:p-8">
            <Outlet />
          </PageTransition>
        </SidebarInset>
      </SidebarProvider>

      {dragOver && (
        <div className="fixed inset-0 z-50 bg-primary/20 backdrop-blur-sm flex items-center justify-center rounded-xl border-4 border-dashed border-primary pointer-events-none">
          <div className="bg-card rounded-2xl p-8 shadow-2xl text-center space-y-3">
            <Package className="size-16 mx-auto text-primary" />
            <p className="text-xl font-bold">松开以导入</p>
            <p className="text-sm text-muted-foreground">整合包（.mrpack/.zip）自动安装为版本；Mod（.jar）、资源包（.zip）加入当前版本</p>
          </div>
        </div>
      )}

      <FloatingDock />
    </motion.div>
  );
}

export const Layout = memo(LayoutInner);
