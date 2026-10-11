import { useState } from 'react';
import { motion } from 'framer-motion';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Server as ServerIcon, Network, Globe } from 'lucide-react';
import ServerPage from '@/pages/ServerPage/ServerPage';
import LanPage from '@/pages/LanPage/LanPage';
import RemoteLanPanel from './RemoteLanPanel';

type TabId = 'server' | 'lan' | 'remote';

// 联机统一入口：本地开服 / 陶瓦联机 / 异地联机（仅赞助版）。
// 三个面板常驻、非激活仅用 hidden 隐藏：切换标签即时、且下载进度/控制台/日志完全不丢。
export default function MultiplayerPage() {
  const [tab, setTab] = useState<TabId>('server');
  const hide = (id: TabId) => (tab === id ? '' : 'hidden');

  // 切换时在三个标签间平滑滑动的高亮胶囊（framer layoutId 共享，自动补间位移/尺寸）
  const pill = (id: TabId) =>
    tab === id ? (
      <motion.span
        layoutId="multiplayer-tab-pill"
        className="absolute inset-0 rounded-md bg-background shadow-sm"
        transition={{ type: 'spring', stiffness: 480, damping: 42, mass: 0.7 }}
      />
    ) : null;

  const triggerCls =
    'relative bg-transparent data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none';
  const labelCls = 'relative z-10 inline-flex items-center gap-1';

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="gap-5">
      <TabsList className="grid grid-cols-3 w-full max-w-md">
        <TabsTrigger value="server" className={triggerCls}>
          {pill('server')}
          <span className={labelCls}><ServerIcon className="size-4" />本地开服</span>
        </TabsTrigger>
        <TabsTrigger value="lan" className={triggerCls}>
          {pill('lan')}
          <span className={labelCls}><Network className="size-4" />陶瓦联机</span>
        </TabsTrigger>
        <TabsTrigger value="remote" className={triggerCls}>
          {pill('remote')}
          <span className={labelCls}><Globe className="size-4" />异地联机</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="server" forceMount className={hide('server') + ' mt-0'}>
        <ServerPage />
      </TabsContent>
      <TabsContent value="lan" forceMount className={hide('lan') + ' mt-0'}>
        <LanPage />
      </TabsContent>
      <TabsContent value="remote" forceMount className={hide('remote') + ' mt-0'}>
        <RemoteLanPanel />
      </TabsContent>
    </Tabs>
  );
}
