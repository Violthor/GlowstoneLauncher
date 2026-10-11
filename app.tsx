import { Routes, Route } from "react-router-dom";
import { lazy, Suspense, useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import OnboardingWizard from "@/components/Onboarding/OnboardingWizard";
import LicenseGate from "@/components/LicenseGate";
import NotFoundPage from "@/pages/NotFoundPage/NotFoundPage";
import HomePage from "@/pages/HomePage/HomePage";
import { HAS_LAN } from "@/data/edition";
import { LICENSE_VERSION } from "@/data/licenseText";
import { useLauncherStore } from "@/hooks/useLauncherStore";

// 非首屏页面全部按需懒加载：首包只含首页，显著缩短启动时 JS 解析/编译时间，
// 消除"刚打开点侧栏很卡、几秒后才恢复"。各页面打成独立 chunk，点击时才加载。
const AccountPage = lazy(() => import("@/pages/AccountPage/AccountPage"));
const VersionDownloadPage = lazy(() => import("@/pages/VersionDownloadPage/VersionDownloadPage"));
const ResourceDownloadPage = lazy(() => import("@/pages/ResourceDownloadPage/ResourceDownloadPage"));
const ModManagePage = lazy(() => import("@/pages/ModManagePage/ModManagePage"));
const VersionSettingsPage = lazy(() => import("@/pages/VersionSettingsPage/VersionSettingsPage"));
const JavaPage = lazy(() => import("@/pages/JavaPage/JavaPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage/SettingsPage"));
const TreasureBoxPage = lazy(() => import("@/pages/TreasureBoxPage/TreasureBoxPage"));
const ToolboxPage = lazy(() => import("@/pages/ToolboxPage/ToolboxPage"));
const AboutPage = lazy(() => import("@/pages/AboutPage/AboutPage"));
// 赞助版：联机（版本开服 / 陶瓦联机 / 异地联机）整合在一个页面（HAS_LAN=false 时被摇除）
const MultiplayerPage = HAS_LAN ? lazy(() => import("@/pages/MultiplayerPage/MultiplayerPage")) : null;

const PageFall = () => (
  <div className="flex h-full w-full items-center justify-center py-24 text-muted-foreground">
    <div className="size-6 border-2 border-current border-t-transparent rounded-full animate-spin" />
  </div>
);
const wrap = (node: React.ReactNode) => <Suspense fallback={<PageFall />}>{node}</Suspense>;

export default function App() {
  const { settings, setSettings } = useLauncherStore();
  // 协议同意状态按协议版本号持久化：已同意当前版本则每次启动自动跳过协议门；
  // 仅当许可协议升级（LICENSE_VERSION 变化）后才重新弹出一次。
  const [agreed, setAgreed] = useState(settings.eulaAgreedVersion === LICENSE_VERSION);
  const agreeLicense = () => {
    setSettings({ eulaAgreedVersion: LICENSE_VERSION });
    setAgreed(true);
  };
  // 赞助版：进入前必须已激活密钥（普通版 HAS_LAN=false 直接跳过）
  const [licReady, setLicReady] = useState(!HAS_LAN);
  const [licActivated, setLicActivated] = useState(false);
  useEffect(() => {
    if (!HAS_LAN) return;
    let on = true;
    const api = (window as unknown as { electronAPI?: { licenseStatus?: () => Promise<{ activated?: boolean }> } }).electronAPI;
    api?.licenseStatus?.()
      .then((s) => { if (on) { setLicActivated(s?.activated === true); setLicReady(true); } })
      .catch(() => { if (on) { setLicActivated(false); setLicReady(true); } });
    return () => { on = false; };
  }, []);

  // 同意协议后：进入独立向导（启动器外壳完全不渲染、无白底）。
  // 赞助版激活状态检查中：深色简洁加载；首次未完成向导，或赞助版尚未激活密钥，都进向导。
  const needWizard = settings.onboarded !== true || (HAS_LAN && !licActivated);
  if (agreed) {
    if (HAS_LAN && !licReady) {
      return (
        <div className="dark fixed inset-0 flex items-center justify-center bg-[#0b0e14]">
          <div className="size-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }
    if (needWizard) return <OnboardingWizard onFinish={() => setLicActivated(true)} />;
  }

  // 启动器主体始终挂载：协议未同意时，它在协议浮层后面可见（协议要求能看到启动器）；
  // 同意且无需向导时即为正常界面。提前挂载也让"同意后进入"零等待。
  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="account" element={wrap(<AccountPage />)} />
          <Route path="version-download" element={wrap(<VersionDownloadPage />)} />
          <Route path="resource-download" element={wrap(<ResourceDownloadPage />)} />
          <Route path="mod-manage" element={wrap(<ModManagePage />)} />
          <Route path="version-settings" element={wrap(<VersionSettingsPage />)} />
          <Route path="java" element={wrap(<JavaPage />)} />
          <Route path="settings" element={wrap(<SettingsPage />)} />
          <Route path="treasure-box" element={wrap(<TreasureBoxPage />)} />
          <Route path="toolbox" element={wrap(<ToolboxPage />)} />
          <Route path="about" element={wrap(<AboutPage />)} />
          {HAS_LAN && MultiplayerPage && (
            <Route path="multiplayer" element={wrap(<MultiplayerPage />)} />
          )}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      {!agreed && <LicenseGate onAgree={agreeLicense} />}
    </>
  );
}
