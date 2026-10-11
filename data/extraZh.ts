// 社区通用中文译名补充表（slug -> “中文主名 (英文原名)”）。
// 原则（严格，宁缺毋滥，避免“机翻/乱译”感）：
//  1) PCL2 官方百科 WikiEntries 几乎只覆盖 Mod；本表只补整合包/数据包/资源包/光影。
//  2) 作者自造的“品牌专名”（如 Solas / Bliss / Photon / Rethinking Voxels / Terralith 等），
//     中文社区没有压倒性通用译名的，一律保留英文原名，绝不逐字意译生造。
//  3) 只收录两类：a. 中文社区有公认固定译名的知名项目（如 Create=机械动力、OptiFine=高清修复、
//     Faithful=忠实材质、Complementary=互补光影、Cobblemon=方块宝可梦）；
//     b. 名字本身是英文描述、直译唯一且准确的功能型项目（如 Better Leaves=更好的树叶、3D Crops=立体作物）。
// 命中优先级：PCL2 官方库 wikiZh > 本表 EXTRA_ZH > launcher.ts 小字典。
export const EXTRA_ZH: Record<string, string> = {
  // ============ 光影 Shaders（绝大多数光影国内直接叫英文原名，只保留公认称呼）============
  'complementary-reimagined': '互补光影：重塑 (Complementary Reimagined)',
  'complementary-unbound': '互补光影：无界 (Complementary Unbound)',
  'bsl-shaders': 'BSL 光影 (BSL Shaders)',
  'potato-shaders': '土豆光影 (Potato Shaders)',

  // ============ 整合包 Modpacks ============
  'fabulously-optimized': '极致优化 (Fabulously Optimized)',
  'the-pixelmon-modpack': '像素宝可梦 (The Pixelmon Modpack)',
  'cobblemon-fabric': '方块宝可梦官方整合包 (Cobblemon Official Modpack)',
  'cobblemon-neoforge': '方块宝可梦官方整合包 (Cobblemon Official Modpack)',
  'optifine-for-fabric': '高清修复 Fabric 版 (OptiFine for Fabric)',
  'lucky-block-challenge': '幸运方块挑战 (Lucky Block Challenge)',
  'create-live-5': '机械动力生存 5 (Create: Live 5)',
  'create_plus': '机械动力增强 (Create+)',
  'kimetsunoyaiba': '鬼灭之刃 (Demon Slayer Modpack)',
  'jujutsu-kaisen-sorcery-fight': '咒术回战 (Jujutsu Kaisen)',
  'distant-horizons-iris-shaders': '远景与 Iris 光影整合 (Distant Horizons + Iris)',

  // ============ 数据包 Datapacks（只保留直译唯一、功能描述准确的）============
  'armor-stand-arms': '盔甲架手臂 (Armor Stand Arms)',
  'players-drop-heads': '玩家掉落头颅 (Players Drop Heads)',
  'tool-trims': '工具纹饰 (Tool Trims)',
  'spawn-animations': '生物生成动画 (Spawn Animations)',
  'smelting-plus': '更多熔炼 (Smelting Plus)',
  'ships': '沉船扩展 (Ships)',
  'villager-transportation': '村民运输 (Villager Transportation)',
  'daycounter': '天数计数器 (Day Counter)',

  // ============ 资源包 Resource Packs ============
  'fresh-animations': '全新生物动画 (Fresh Animations)',
  'fresh-animations-extensions': '全新生物动画扩展 (Fresh Animations Extensions)',
  'fa-player-extension': '全新动画玩家扩展 (FA Player Extension)',
  'detailed-animations': '精细动画 (Detailed Animations)',
  'translations-for-sodium': 'Sodium 汉化包 (Translations for Sodium)',
  'chat-reporting-helper': '聊天举报助手汉化 (Chat Reporting Helper)',
  'better-leaves': '更好的树叶 (Better Leaves)',
  'low-on-fire': '低矮火焰 (Low On Fire)',
  'low-fire-pack': '低矮火焰 (Low Fire)',
  'low-shield-pack': '低矮盾牌 (Low Shield)',
  'fast-better-grass': '更好的草方块 (Fast Better Grass)',
  'simple-grass-flowers': '简约花草 (Simple Grass Flowers)',
  'fullbright-ub': '夜视全亮 (Fullbright UB)',
  'night-vision': '夜视材质 (Night Vision)',
  'faithful-32x': '忠实材质 32x (Faithful 32x)',
  'faithful-64x': '忠实材质 64x (Faithful 64x)',
  'new-glowing-ores': '发光矿石 (New Glowing Ores)',
  'glowing-glints': '附魔轮廓光效 (Enchantment Glints)',
  'enchant-icons-countxd': '附魔图标 (Enchant Icons)',
  'rainbow-enchantment-glint': '彩虹附魔光效 (Rainbow Enchantment Glint)',
  'default-dark-mode': '原版深色界面 (Default Dark Mode)',
  'round-trees': '圆润树木 (Round Trees)',
  '3d-crops': '立体作物 (3D Crops)',
  'better-lanterns': '更好的灯笼 (Better Lanterns)',
  'cubic-sun-moon': '立体太阳与月亮 (Cubic Sun & Moon)',
  'visual-armor-trims': '可见盔甲纹饰 (Visual Armor Trims)',
  'animated-items': '动态物品 (Animated Items)',
  'blinking-ender-eyes': '闪烁末影之眼 (Blinking Ender Eyes)',
  'fancy-crops': '精美作物 (Fancy Crops)',
  'redstone-tweaks': '红石微调 (Redstone Tweaks)',
  'just-expressions': '生动表情 (Just Expressions)',
  'dramatic-skys': '戏剧化天空 (Dramatic Skys)',
  'tras-fresh-player': '全新动作 (Fresh Player Animations)',
};
