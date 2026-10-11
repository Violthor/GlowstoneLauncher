import { NavLink, useLocation } from 'react-router-dom';
import { Home, User, Download, Boxes, Wrench, Settings } from 'lucide-react';

// 手机版底部导航：6 个功能项。左侧栏在手机端不再渲染、不可展开。
const ITEMS = [
  { path: '/', label: '首页', icon: Home },
  { path: '/account', label: '账号', icon: User },
  { path: '/version-download', label: '版本', icon: Download },
  { path: '/resource-download', label: '资源', icon: Boxes },
  { path: '/toolbox', label: '工具箱', icon: Wrench },
  { path: '/settings', label: '设置', icon: Settings },
];

export default function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-[100] border-t border-border/40 bg-background/85 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
      <div className="grid grid-cols-6 h-14 landscape:h-12">
        {ITEMS.map(({ path, label, icon: Icon }) => {
          const active = path === '/'
            ? pathname === '/'
            : pathname === path || pathname.startsWith(`${path}/`);
          return (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              className="flex flex-col items-center justify-center gap-0.5"
            >
              <Icon className={`size-5 landscape:size-4 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
              <span className={`text-[10px] leading-none landscape:hidden ${active ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                {label}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
