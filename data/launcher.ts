export interface IAccount {
  /** internal unique key, produced by accountKey() */
  id?: string;
  type: 'offline' | 'microsoft' | 'external';
  username: string;
  uuid?: string;
  accessToken?: string;
  /** Microsoft refreshToken，用于过期后刷新 accessToken */
  refreshToken?: string;
  avatar: 'steve' | 'alex' | string;
  skinUrl?: string;
  /** 自定义披风贴图（dataURL），仅离线/外置账号可用 */
  capeUrl?: string;
  /** 是否为纤细（Alex）模型：外置皮肤站可返回，决定 3D 手臂宽度 */
  slim?: boolean;
  externalServer?: string;
  addedAt?: number;
}

// Stable identity for an account so the same login is not added twice.
export function accountKey(a: IAccount): string {
  const name = (a.username || '').toLowerCase();
  if (a.type === 'offline') return `offline:${name}`;
  if (a.type === 'external') return `external:${(a.externalServer || '').toLowerCase()}:${name}`;
  return `ms:${a.uuid || name}`;
}

export function accountTypeLabel(t: IAccount['type']): string {
  return t === 'microsoft' ? '正版' : t === 'external' ? '外置' : '离线';
}

export const LOADER_LABELS: Record<string, string> = {
  vanilla: '原版',
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
  quilt: 'Quilt',
  optifine: 'OptiFine',
};

export function loaderLabel(loader?: string): string {
  return LOADER_LABELS[loader || 'vanilla'] || loader || '原版';
}

export interface ISavedSkin {
  id: string;
  name: string;
  skinUrl: string;
  createdAt: number;
}

export interface IInstalledVersion {
  id: string;
  versionId: string;
  loader: 'vanilla' | 'forge' | 'fabric' | 'quilt' | 'neoforge' | 'optifine';
  loaderVersion?: string;
  icon: string;
  category: string;
  description: string;
  isFavorite: boolean;
  installTime: number;
  gameDir: string;
  javaPath?: string;
  jvmArgs?: string;
  minMemoryMB: number;
  maxMemoryMB: number;
  versionType: 'release' | 'snapshot' | 'old_alpha' | 'old_beta' | 'april_fools';
}

export interface IMod {
  id: string;
  slug: string;
  name: string;
  nameZh?: string;
  description: string;
  iconUrl: string;
  version: string;
  author: string;
  categories: string[];
  gameVersions: string[];
  loaders: string[];
  downloads: number;
  updatedAt: string;
  source: 'modrinth' | 'local';
  fileName?: string;
  enabled: boolean;
  installedVersionId: string;
  /** 本地 Mod 文件哈希（Modrinth 精确识别用，等同 PCL2） */
  sha1?: string;
  sha512?: string;
  /** 哈希识别出的 Modrinth 项目 / 已装版本 id（检查更新用） */
  projectId?: string;
  installedMrVersionId?: string;
}

export interface ILauncherSettings {
  theme: 'light' | 'dark';
  backgroundImage?: string;
  /** 本地视频背景的绝对路径（file:// 由界面层转换） */
  backgroundVideo?: string;
  downloadDir: string;
  versionIsolation: boolean;
  language: 'zh-CN';
  /** 版本/资源下载源：official=Mojang 官方，bmcl=BMCLAPI 国内镜像 */
  downloadSource?: 'official' | 'bmcl';
  maxMemoryMB?: number;
  minMemoryMB?: number;
  memoryMode?: 'auto' | 'custom';
  /** 毛玻璃效果：开启后界面元素呈现半透明毛玻璃质感，关闭可提升性能 */
  glassEffect?: boolean;
  azureClientId?: string;
  /** 是否已完成首装向导（未完成时首次启动弹向导） */
  onboarded?: boolean;
  /** 已同意的许可协议版本号；与当前 LICENSE_VERSION 一致则自动跳过协议门，协议改版后才重新弹出 */
  eulaAgreedVersion?: string;
}

export interface ILogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  source: 'launcher' | 'game';
}

export interface IVersionManifestItem {
  id: string;
  type: 'release' | 'snapshot' | 'old_alpha' | 'old_beta';
  url: string;
  time: string;
  releaseTime: string;
  sha1: string;
  complianceLevel: number;
}

export interface IModrinthProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  categories: string[];
  client_side: string;
  server_side: string;
  body: string;
  additional_categories: string[];
  project_type: 'mod' | 'modpack' | 'resourcepack' | 'datapack' | 'shader';
  downloads: number;
  icon_url?: string;
  published: string;
  updated: string;
  followers: number;
  status: string;
  versions: string[];
  game_versions: string[];
  loaders: string[];
  team: string;
  gallery: string[];
  title_zh?: string;
  description_zh?: string;
}

export const DEFAULT_ACCOUNT: IAccount | null = null;

export const MOCK_INSTALLED_MODS: IMod[] = [];

export const MOCK_INITIAL_LOGS: ILogEntry[] = [
  { timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }), level: 'INFO', message: 'Glowstone Launcher 已启动', source: 'launcher' },
];

export const DEFAULT_SETTINGS: ILauncherSettings = {
  theme: 'light',
  downloadDir: '',
  versionIsolation: true,
  language: 'zh-CN',
  downloadSource: 'bmcl',
  maxMemoryMB: 4096,
  minMemoryMB: 512,
  memoryMode: 'auto',
  glassEffect: false,
};

export const STORAGE_KEYS = {
  ACCOUNT: '__glowstone_account',
  ACCOUNTS: '__glowstone_accounts',
  CURRENT_ACCOUNT: '__glowstone_currentAccountId',
  CURRENT_VERSION: '__glowstone_currentVersion',
  INSTALLED_VERSIONS: '__glowstone_installedVersions',
  INSTALLED_MODS: '__glowstone_installedMods',
  SETTINGS: '__glowstone_settings',
  LOGS: '__glowstone_logs',
  SAVED_SKINS: '__glowstone_savedSkins',
} as const;

// Official Minecraft default skins - bundled locally so 3D preview works offline
import skinSteve from '../assets/skins/steve.png';
import skinAlex from '../assets/skins/alex.png';
import skinAri from '../assets/skins/ari.png';
import skinEfe from '../assets/skins/efe.png';
import skinKai from '../assets/skins/kai.png';
import skinMakena from '../assets/skins/makena.png';
import skinNoor from '../assets/skins/noor.png';
import skinSunny from '../assets/skins/sunny.png';
import skinZuri from '../assets/skins/zuri.png';

export const OFFICIAL_SKINS = [
  { id: 'steve', name: 'Steve', url: skinSteve },
  { id: 'alex', name: 'Alex', url: skinAlex },
  { id: 'ari', name: 'Ari', url: skinAri },
  { id: 'efe', name: 'Efe', url: skinEfe },
  { id: 'kai', name: 'Kai', url: skinKai },
  { id: 'makena', name: 'Makena', url: skinMakena },
  { id: 'noor', name: 'Noor', url: skinNoor },
  { id: 'sunny', name: 'Sunny', url: skinSunny },
  { id: 'zuri', name: 'Zuri', url: skinZuri },
];

// Pick one of the nine official skins at random (used as the default for accounts without a chosen skin).
export function randomOfficialSkin(): string {
  return OFFICIAL_SKINS[Math.floor(Math.random() * OFFICIAL_SKINS.length)].url;
}

// Deterministic official skin for a given name (stable across restarts), used to
// backfill offline/external accounts that were created without a chosen skin.
export function defaultSkinForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) { h = ((h << 5) - h) + name.charCodeAt(i); h |= 0; }
  return OFFICIAL_SKINS[Math.abs(h) % OFFICIAL_SKINS.length].url;
}

// Chinese name mapping for popular Modrinth projects
export const MODRINTH_ZH_MAP: Record<string, { name: string; desc: string }> = {
  sodium: { name: '钠', desc: '现代渲染引擎，大幅提升游戏性能' },
  lithium: { name: '锂', desc: '游戏逻辑优化模组' },
  'ferrite-core': { name: '铁氧体磁芯', desc: '内存使用优化' },
  'entity-culling': { name: '实体渲染优化', desc: '异步隐藏不可见的实体' },
  'mod-menu': { name: '模组菜单', desc: '查看已安装模组列表' },
  'iris-shaders': { name: '鸢尾光影', desc: '光影加载模组' },
  immediatelyfast: { name: '立即加速', desc: '渲染优化' },
  indium: { name: '铟', desc: 'Sodium 渲染器扩展' },
  lambdynamiclights: { name: '动态光源', desc: '手持光源发光' },
  jade: { name: 'Jade', desc: '显示方块/实体信息' },
  wthit: { name: 'WTHIT', desc: '显示方块/实体信息' },
  rei: { name: 'REI', desc: '物品管理器' },
  emi: { name: 'EMI', desc: '物品和配方查看器' },
  jei: { name: 'JEI', desc: '物品管理器' },
  'xaeros-minimap': { name: 'Xaero 小地图', desc: '小地图模组' },
  'sodium-extra': { name: '钠扩展', desc: 'Sodium 额外功能' },
  'dynamic-fps': { name: '动态帧率', desc: '窗口未聚焦时降低帧率' },
  'cloth-config': { name: 'Cloth 配置', desc: '配置界面库' },
  'architectury-api': { name: 'Architectury API', desc: '跨加载器 API 库' },
  'fabric-api': { name: 'Fabric API', desc: 'Fabric 核心 API' },
  'forge-config-api-port': { name: 'Forge Config API', desc: 'Forge 配置接口' },
  'kotlin-for-forge': { name: 'Kotlin for Forge', desc: 'Kotlin 语言支持' },
  'fabric-language-kotlin': { name: 'Fabric Kotlin', desc: 'Fabric Kotlin 支持' },
  yungsapi: { name: 'YUNG API', desc: 'YUNG 系列模组 API' },
  'better-minecraft': { name: '更好的 Minecraft', desc: '整合包' },
  'fabulously-optimized': { name: '极致优化', desc: '性能优化整合包' },
  'optifine': { name: 'OptiFine', desc: '经典优化+光影模组' },
  'complementary-shaders': { name: '互补光影', desc: '高质量光影包' },
  'bsl-shaders': { name: 'BSL 光影', desc: '经典光影包' },
  'seus-shaders': { name: 'SEUS 光影', desc: '光影包' },
  'continuity': { name: '连续性', desc: '连接纹理' },
  'lambdabettergrass': { name: '更好的草', desc: '草方块连接纹理' },
  'visual-overhaul': { name: '视觉革新', desc: '视觉改进' },
  'citresewn': { name: 'CIT 重生', desc: '自定义物品纹理' },
  'chimes': { name: '风铃', desc: '自定义物品模型' },
  'debugify': { name: 'Bug 修复', desc: '修复已知 Bug' },
  'moreculling': { name: '更多剔除', desc: '深度剔除优化' },
  'modernfix': { name: '现代修复', desc: '性能和内存优化' },
  'spark': { name: 'Spark', desc: '性能分析工具' },
  'chunky': { name: 'Chunky', desc: '区块预生成' },
  'lazurite': { name: '天青石', desc: '光影优化' },
  'exordium': { name: '开篇', desc: 'UI 渲染优化' },
};
