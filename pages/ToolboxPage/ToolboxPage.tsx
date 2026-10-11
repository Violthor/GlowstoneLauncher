import { useState } from 'react';
import { motion } from 'framer-motion';
import { Globe, ExternalLink, ArrowUpRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import Logo from '@/components/Logo';

type Site = { name: string; url: string; desc: string };
type Section = { category: string; sites: Site[] };

// 网站数据提取自 VersePC2 工具箱；第一个为启动器官网（置顶单独展示）
const SECTIONS: Section[] = [
  {
    category: '百科攻略',
    sites: [
      { name: 'Minecraft Wiki', url: 'https://zh.minecraft.wiki', desc: '最权威的官方百科' },
      { name: 'MC百科', url: 'https://www.mcmod.cn', desc: '中文 Mod 百科数据库' },
      { name: 'DigMinecraft', url: 'https://www.digminecraft.com', desc: '全物品 / 方块 ID 查询' },
    ],
  },
  {
    category: '模组与整合包',
    sites: [
      { name: 'CurseForge', url: 'https://www.curseforge.com/minecraft', desc: '全球最大 Mod 整合包平台' },
      { name: 'Modrinth', url: 'https://modrinth.com', desc: '新兴开源 Mod 平台' },
      { name: 'Planet Minecraft', url: 'https://www.planetminecraft.com', desc: '全球最大 MC 社区' },
      { name: 'MCBBS', url: 'https://www.mcbbs.co/forum.php', desc: '国内最大 MC 中文论坛' },
      { name: 'MCPEDL', url: 'https://mcpedl.com', desc: '基岩版资源大全' },
    ],
  },
  {
    category: '玩家社区',
    sites: [
      { name: 'MineBBS', url: 'https://www.minebbs.com', desc: '国内 MC 中文论坛' },
      { name: '苦力怕论坛', url: 'https://klpbbs.com', desc: '资源丰富的中文社区' },
      { name: 'Bilibili MC', url: 'https://search.bilibili.com/all?keyword=我的世界', desc: '视频教程 / 实况 / 攻略' },
    ],
  },
  {
    category: '材质与光影',
    sites: [
      { name: 'ResourcePack', url: 'https://resourcepack.net', desc: '海量材质包下载' },
      { name: 'ShadersMods', url: 'https://shadersmods.com', desc: '光影资源合集' },
      { name: 'Vanilla Tweaks', url: 'https://vanillatweaks.net', desc: '原版微调增强包' },
    ],
  },
  {
    category: '地图与建筑',
    sites: [
      { name: 'Plotz', url: 'https://www.plotz.co.uk', desc: '圆形 / 球形建造蓝图' },
      { name: 'Block Palettes', url: 'https://www.blockpalettes.com', desc: '方块配色方案库' },
      { name: 'MinecraftShapes', url: 'https://minecraftshapes.com', desc: '几何形状建造指南' },
      { name: 'Minecraft Maps', url: 'https://www.minecraftmaps.com', desc: '冒险 / 解谜地图下载' },
    ],
  },
  {
    category: '在线工具',
    sites: [
      { name: 'Chunkbase', url: 'https://www.chunkbase.com', desc: '种子地图 / 结构定位' },
      { name: 'MCStacker', url: 'https://mcstacker.net', desc: '命令在线生成器' },
      { name: 'MC Tools', url: 'https://minecraft.tools', desc: '合成 / 烟花 / 药水 / 旗帜' },
      { name: 'Misode', url: 'https://misode.github.io', desc: '数据包 / 世界编辑器' },
      { name: 'mclo.gs', url: 'https://mclo.gs', desc: '游戏日志分析工具' },
      { name: 'Minecraft Heads', url: 'https://minecraft-heads.com', desc: '头颅数据库 / give 指令' },
      { name: 'Colorize FUN', url: 'https://colorize.fun', desc: 'MC 彩色文本生成器' },
      { name: 'Textcraft', url: 'https://textcraft.net', desc: 'MC 风格 Logo 生成' },
      { name: 'CraftMC Tools', url: 'https://www.craftmc.net', desc: '红石模拟 / 圆形生成' },
    ],
  },
  {
    category: '皮肤资源',
    sites: [
      { name: 'NameMC', url: 'https://namemc.com', desc: '正版皮肤 / UUID 查询' },
      { name: 'LittleSkin', url: 'https://littleskin.cn', desc: '国内皮肤站' },
      { name: 'Nova Skin', url: 'https://novaskin.me', desc: '3D 皮肤编辑器' },
      { name: 'The Skindex', url: 'https://www.minecraftskins.com', desc: '百万皮肤分享社区' },
      { name: 'SkinMC', url: 'https://skinmc.net', desc: '3D 皮肤查看器' },
    ],
  },
  {
    category: '服务器与插件',
    sites: [
      { name: 'FindMCServer', url: 'https://findmcserver.com', desc: 'Mojang 官方服务器列表' },
      { name: 'MC Servers', url: 'https://minecraftservers.org', desc: '国际服务器列表' },
      { name: 'SpigotMC', url: 'https://www.spigotmc.org', desc: '服务器插件 / Paper 核心' },
      { name: '找服网', url: 'https://www.mczfw.com', desc: '国内服务器大全' },
    ],
  },
  {
    category: '资源导航',
    sites: [
      { name: 'MCNav', url: 'https://www.mcnav.net', desc: 'MC 资源大全一站导航' },
      { name: 'MinecraftXZ', url: 'https://www.minecraftxz.com', desc: '中文资源下载站' },
    ],
  },
];

const openUrl = (url: string) =>
  (window as unknown as { electronAPI?: { openExternal?: (u: string) => void } }).electronAPI?.openExternal?.(url);

// 站点小图标：DuckDuckGo 国内被墙，改用 icon.horse（实测 22 站全可用），
// 失败再回退站点直连 /favicon.ico，最后回退 Globe，保证不裂图。
function SiteIcon({ url, name }: { url: string; name: string }) {
  const [srcIdx, setSrcIdx] = useState(0);
  let host = '';
  try { host = new URL(url).hostname; } catch { host = ''; }
  const sources = host
    ? [`https://icon.horse/icon/${host}`, `https://${host}/favicon.ico`]
    : [];
  if (!host || srcIdx >= sources.length) {
    return (
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Globe className="size-4" />
      </div>
    );
  }
  return (
    <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
      <img
        src={sources[srcIdx]}
        alt={name}
        loading="lazy"
        className="size-6 object-contain"
        referrerPolicy="no-referrer"
        onError={() => setSrcIdx((i) => i + 1)}
      />
    </div>
  );
}

export default function ToolboxPage() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">工具箱</h1>
        <p className="text-muted-foreground text-sm mt-1">Minecraft 实用网站导航集合</p>
      </div>

      {/* 第一个：启动器官网，置顶大卡片 */}
      <Card
        className="flex items-center gap-4 p-5 cursor-pointer hover:shadow-md transition-shadow group"
        onClick={() => openUrl('https://glowstonelauncher.cn')}
      >
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
          <Logo size={40} className="rounded-lg" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Glowstone Launcher 官网</div>
          <div className="text-xs text-muted-foreground mt-0.5">启动器最新版下载、更新日志与使用说明</div>
        </div>
        <span className="flex items-center gap-1 text-xs text-primary shrink-0">
          访问官网 <ArrowUpRight className="size-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
        </span>
      </Card>

      {SECTIONS.map((section) => (
        <div key={section.category} className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">{section.category}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {section.sites.map((site) => (
              <Card
                key={site.name}
                className="flex items-center gap-3 p-3.5 cursor-pointer hover:shadow-md transition-shadow group"
                onClick={() => openUrl(site.url)}
              >
                <SiteIcon url={site.url} name={site.name} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{site.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{site.desc}</div>
                </div>
                <ExternalLink className="size-3.5 shrink-0 text-muted-foreground/50 group-hover:text-primary transition-colors" />
              </Card>
            ))}
          </div>
        </div>
      ))}
    </motion.div>
  );
}
