import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { NavLink, useLocation } from 'react-router-dom';
import { HAS_LAN } from '@/data/edition';
import {
  Home,
  Download,
  Boxes,
  Puzzle,
  Network,
  Settings2,
  Settings,
  User,
  Coffee,
  Gift,
  Wrench,
  Info,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  SidebarGroupLabel,
} from '@/components/ui/sidebar';
import Logo from '@/components/Logo';
import { isMobileHost } from '@/mobile/bridge';

type NavItem = { path: string; label: string; icon: typeof Home };

// 赞助版：版本开服 / 陶瓦联机 / 异地联机统一收进单一「联机」入口（普通版摇除）
const MULTI_NAV: NavItem[] = HAS_LAN ? [{ path: '/multiplayer', label: '联机', icon: Network }] : [];

const BASE_NAV: NavItem[] = [
  { path: '/', label: '首页', icon: Home },
  { path: '/account', label: '账号管理', icon: User },
  { path: '/version-download', label: '版本下载', icon: Download },
  { path: '/resource-download', label: '资源下载', icon: Boxes },
  { path: '/mod-manage', label: 'Mod 管理', icon: Puzzle },
  { path: '/treasure-box', label: '百宝箱', icon: Gift },
  { path: '/toolbox', label: '工具箱', icon: Wrench },
  ...MULTI_NAV,
  { path: '/java', label: 'Java', icon: Coffee },
  { path: '/version-settings', label: '版本设置', icon: Settings2 },
  { path: '/settings', label: '设置', icon: Settings },
];
const OTHER_NAV: NavItem[] = [
  { path: '/about', label: '关于', icon: Info },
];

// 手机端隐藏原生桥未实现、用不了的页面
const MOBILE_HIDDEN = new Set(['/mod-manage', '/treasure-box', '/java', '/version-settings']);
const filterMobile = (list: NavItem[]) =>
  (isMobileHost() ? list.filter((i) => !MOBILE_HIDDEN.has(i.path)) : list);

function NavMenu({ items }: { items: NavItem[] }) {
  const { pathname } = useLocation();
  return (
    <SidebarMenu>
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = item.path === '/'
          ? pathname === '/'
          : pathname === item.path || pathname.startsWith(`${item.path}/`);
        return (
          <SidebarMenuItem key={item.path}>
            <SidebarMenuButton asChild tooltip={item.label} isActive={isActive}>
              <NavLink to={item.path} end={item.path === '/'} className="relative flex items-center gap-2">
                {isActive && (
                  <motion.span
                    layoutId="glow-nav-active-bar"
                    transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                    className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
                  />
                )}
                <Icon className="size-4 shrink-0" />
                <span className="group-data-[state=collapsed]:hidden">{item.label}</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

export default function AppSidebar() {
  const [ver, setVer] = useState('');
  useEffect(() => { (window as unknown as { electronAPI?: { appVersion?: () => Promise<string> } }).electronAPI?.appVersion?.().then(setVer).catch(() => {}); }, []);

  return (
    <Sidebar collapsible="icon" className="border-r border-border/30">
      <SidebarHeader className="px-2 py-4">
        <div className="flex items-center gap-3 group-data-[state=collapsed]:px-0 group-data-[state=collapsed]:justify-center">
          <div className="relative shrink-0">
            <Logo size={36} className="rounded-lg" />
          </div>
          <div className="flex-1 min-w-0 group-data-[state=collapsed]:hidden">
            <div className="text-base font-bold truncate text-foreground">Glowstone Launcher</div>
            <div className="text-xs text-muted-foreground truncate">Minecraft Java Edition</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="p-2">
          <NavMenu items={filterMobile(BASE_NAV)} />
        </SidebarGroup>
        <SidebarGroup className="p-2">
          <SidebarGroupLabel className="group-data-[state=collapsed]:hidden">其他</SidebarGroupLabel>
          <NavMenu items={filterMobile(OTHER_NAV)} />
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3">
        <div className="group-data-[state=collapsed]:hidden text-xs text-muted-foreground text-center">
          正式版 {ver}
        </div>
        {!isMobileHost() && (
          <div className="group-data-[state=expanded]:hidden flex justify-center">
            <SidebarTrigger />
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
