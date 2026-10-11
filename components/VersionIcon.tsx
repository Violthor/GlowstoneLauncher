import { useEffect, useRef } from 'react';
// 加载器品牌图标：直接使用真实游戏图片（Fabric 布卷、NeoForge 狐狸头），不用 canvas 手绘
import fabricLogoUrl from '../assets/loaders/fabric.png';
import neoforgeLogoUrl from '../assets/loaders/neoforge.png';

// Official Minecraft block textures (bundled locally, inlined at build)
const texModules = import.meta.glob('../assets/blocks/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
function tex(file: string): string {
  return texModules[`../assets/blocks/${file}.png`] || '';
}

// Plains grass biome tint applied to the grayscale grass textures
const GRASS_TINT = '#7CBD4A';

interface FaceTex {
  file?: string;          // texture file name without .png
  color?: string;         // flat color instead of texture
  tint?: string;          // multiply tint for grayscale textures
  overlay?: string;       // second texture drawn on top (e.g. grass fringe)
  overlayTint?: string;
}
interface VBox { x: [number, number]; y: [number, number]; z: [number, number]; top: FaceTex; side: FaceTex; front?: FaceTex; }
interface BlockModel { boxes: VBox[]; }

const f = (file: string, extra: Partial<FaceTex> = {}): FaceTex => ({ file, ...extra });
const cube = (top: FaceTex, side: FaceTex, front?: FaceTex): BlockModel => ({
  boxes: [{ x: [0, 16], y: [0, 16], z: [0, 16], top, side, front }],
});

const MODELS: Record<string, { label: string } & BlockModel> = {
  grass: {
    label: '草方块',
    boxes: cube(
      f('grass_block_top', { tint: GRASS_TINT }),
      { file: 'dirt', overlay: 'grass_block_side_overlay', overlayTint: GRASS_TINT },
    ).boxes,
  },
  command: {
    label: '命令方块',
    boxes: cube(f('command_block_side'), f('command_block_side'), f('command_block_front')).boxes,
  },
  cobble: { label: '原石', boxes: cube(f('cobblestone'), f('cobblestone')).boxes },
  gold: { label: '金块', boxes: cube(f('gold_block'), f('gold_block')).boxes },
  dirt: { label: '泥土', boxes: cube(f('dirt'), f('dirt')).boxes },
  stone: { label: '石头', boxes: cube(f('stone'), f('stone')).boxes },
  diamond: { label: '钻石块', boxes: cube(f('diamond_block'), f('diamond_block')).boxes },
  iron: { label: '铁块', boxes: cube(f('iron_block'), f('iron_block')).boxes },
  emerald: { label: '绿宝石块', boxes: cube(f('emerald_block'), f('emerald_block')).boxes },
  redstone: { label: '红石块', boxes: cube(f('redstone_block'), f('redstone_block')).boxes },
  lapis: { label: '青金石块', boxes: cube(f('lapis_block'), f('lapis_block')).boxes },
  coal: { label: '煤矿石', boxes: cube(f('coal_ore'), f('coal_ore')).boxes },
  iron_ore: { label: '铁矿石', boxes: cube(f('iron_ore'), f('iron_ore')).boxes },
  gold_ore: { label: '金矿石', boxes: cube(f('gold_ore'), f('gold_ore')).boxes },
  diamond_ore: { label: '钻石矿石', boxes: cube(f('diamond_ore'), f('diamond_ore')).boxes },
  oak_log: { label: '橡木原木', boxes: cube(f('oak_log_top'), f('oak_log')).boxes },
  oak_planks: { label: '橡木木板', boxes: cube(f('oak_planks'), f('oak_planks')).boxes },
  spruce_planks: { label: '云杉木板', boxes: cube(f('spruce_planks'), f('spruce_planks')).boxes },
  birch_planks: { label: '白桦木板', boxes: cube(f('birch_planks'), f('birch_planks')).boxes },
  sand: { label: '沙子', boxes: cube(f('sand'), f('sand')).boxes },
  gravel: { label: '沙砾', boxes: cube(f('gravel'), f('gravel')).boxes },
  brick: { label: '砖块', boxes: cube(f('bricks'), f('bricks')).boxes },
  bookshelf: { label: '书架', boxes: cube(f('oak_planks'), f('bookshelf')).boxes },
  obsidian: { label: '黑曜石', boxes: cube(f('obsidian'), f('obsidian')).boxes },
  netherrack: { label: '下界岩', boxes: cube(f('netherrack'), f('netherrack')).boxes },
  glowstone: { label: '荧石', boxes: cube(f('glowstone'), f('glowstone')).boxes },
  sea_lantern: { label: '海晶灯', boxes: cube(f('sea_lantern'), f('sea_lantern')).boxes },
  pumpkin: { label: '南瓜', boxes: cube(f('pumpkin_top'), f('pumpkin_side'), f('pumpkin_side')).boxes },
  melon: { label: '西瓜', boxes: cube(f('melon_top'), f('melon_side')).boxes },
  tnt: { label: 'TNT', boxes: cube(f('tnt_top'), f('tnt_side')).boxes },
  crafting_table: { label: '工作台', boxes: cube(f('crafting_table_top'), f('crafting_table_side')).boxes },
  furnace: { label: '熔炉', boxes: cube(f('furnace_top'), f('furnace_side'), f('furnace_side')).boxes },
  chest: { label: '箱子', boxes: cube(f('oak_planks'), f('oak_planks')).boxes },
  ender_chest: { label: '末影箱', boxes: cube(f('obsidian'), f('obsidian')).boxes },
  beacon: { label: '信标', boxes: cube(f('beacon'), f('beacon')).boxes },
  enchanting_table: { label: '附魔台', boxes: cube(f('enchanting_table_top'), f('enchanting_table_side')).boxes },
  hay: { label: '干草块', boxes: cube(f('hay_block_top'), f('hay_block_side')).boxes },
  wool_white: { label: '白色羊毛', boxes: cube(f('white_wool'), f('white_wool')).boxes },
  wool_red: { label: '红色羊毛', boxes: cube(f('red_wool'), f('red_wool')).boxes },
  wool_blue: { label: '蓝色羊毛', boxes: cube(f('blue_wool'), f('blue_wool')).boxes },
  wool_green: { label: '绿色羊毛', boxes: cube(f('green_wool'), f('green_wool')).boxes },
  wool_yellow: { label: '黄色羊毛', boxes: cube(f('yellow_wool'), f('yellow_wool')).boxes },
  wool_purple: { label: '紫色羊毛', boxes: cube(f('purple_wool'), f('purple_wool')).boxes },
  wool_cyan: { label: '青色羊毛', boxes: cube(f('cyan_wool'), f('cyan_wool')).boxes },
  glass: { label: '玻璃', boxes: cube(f('glass'), f('glass')).boxes },
  ice: { label: '冰', boxes: cube(f('ice'), f('ice')).boxes },
  snow: { label: '雪', boxes: cube(f('snow'), f('snow')).boxes },
  clay: { label: '粘土', boxes: cube(f('clay'), f('clay')).boxes },
  prismarine: { label: '海晶石', boxes: cube(f('prismarine'), f('prismarine')).boxes },
  purpur: { label: '紫珀块', boxes: cube(f('purpur_block'), f('purpur_block')).boxes },
  end_stone: { label: '末地石', boxes: cube(f('end_stone'), f('end_stone')).boxes },
  nether_brick: { label: '下界砖', boxes: cube(f('nether_bricks'), f('nether_bricks')).boxes },
  quartz: { label: '石英块', boxes: cube(f('quartz_block_top'), f('quartz_block_side')).boxes },
  slime: { label: '粘液块', boxes: cube(f('slime_block'), f('slime_block')).boxes },
  honey: { label: '蜂蜜块', boxes: cube(f('honey_block_top'), f('honey_block_side')).boxes },
  shroomlight: { label: '菌光体', boxes: cube(f('shroomlight'), f('shroomlight')).boxes },
  basalt: { label: '玄武岩', boxes: cube(f('basalt_top'), f('basalt_side')).boxes },
  blackstone: { label: '黑石', boxes: cube(f('blackstone'), f('blackstone')).boxes },
  copper: { label: '铜块', boxes: cube(f('copper_block'), f('copper_block')).boxes },
  amethyst: { label: '紫水晶块', boxes: cube(f('amethyst_block'), f('amethyst_block')).boxes },
  deepslate: { label: '深板岩', boxes: cube(f('deepslate_top'), f('deepslate')).boxes },
  moss: { label: '苔藓块', boxes: cube(f('moss_block'), f('moss_block')).boxes },
  // --- non-cube voxel models ---
  // 铁砧：严格按原版 assets/minecraft/models/block/template_anvil.json 的 4 段元素重建（底座/下沿/腰/顶面），
  // 全部使用原版 anvil.png / anvil_top.png 贴图，形状与游戏内物品图标一致。
  anvil: {
    label: '铁砧',
    boxes: [
      { x: [2, 14], y: [0, 4], z: [2, 14], top: f('anvil'), side: f('anvil') },
      { x: [4, 12], y: [4, 5], z: [3, 13], top: f('anvil'), side: f('anvil') },
      { x: [6, 10], y: [5, 10], z: [4, 12], top: f('anvil'), side: f('anvil') },
      { x: [3, 13], y: [10, 16], z: [0, 16], top: f('anvil_top'), side: f('anvil') },
    ],
  },
  brewing_stand: {
    label: '酿造台',
    boxes: [
      { x: [6, 10], y: [0, 2], z: [6, 10], top: { color: '#6e6e74' }, side: { color: '#6e6e74' } },
      { x: [7, 9], y: [2, 12], z: [7, 9], top: { color: '#d8b04a' }, side: { color: '#c9a044' } },
      { x: [3, 13], y: [11, 13], z: [7, 9], top: { color: '#8b8b91' }, side: { color: '#7c7c82' } },
      { x: [7, 9], y: [11, 13], z: [3, 13], top: { color: '#8b8b91' }, side: { color: '#7c7c82' } },
      { x: [6, 10], y: [13, 15], z: [6, 10], top: { color: '#d8b04a' }, side: { color: '#c9a044' } },
    ],
  },
};

const CATEGORY_TO_BLOCK: Record<string, string> = {
  release: 'grass', snapshot: 'command', old: 'cobble', old_alpha: 'cobble', old_beta: 'cobble', april_fools: 'gold',
};
const BLOCKS = Object.entries(MODELS).map(([key, v]) => ({ key, label: v.label }));

// ---------- image cache (deterministic: pre-decode EVERYTHING, then draw synchronously) ----------
const imgCache = new Map<string, HTMLImageElement>();

// Collect every texture file referenced by any model so we can decode them all up front.
function collectAllSrcs(): string[] {
  const set = new Set<string>();
  Object.values(MODELS).forEach((m) => {
    m.boxes.forEach((b) => {
      [b.top, b.side, b.front].forEach((ft) => {
        if (!ft) return;
        if (ft.file) { const s = tex(ft.file); if (s) set.add(s); }
        if (ft.overlay) { const s = tex(ft.overlay); if (s) set.add(s); }
      });
    });
  });
  return [...set];
}
const ALL_SRCS = collectAllSrcs();
let texturesReady = false;
let readyPromise: Promise<void> | null = null;
function ensureTextures(): Promise<void> {
  if (texturesReady) return Promise.resolve();
  if (readyPromise) return readyPromise;
  readyPromise = Promise.all(ALL_SRCS.map((src) => new Promise<void>((resolve) => {
    let im = imgCache.get(src);
    if (!im) { im = new Image(); imgCache.set(src, im); }
    if (im.complete && im.naturalWidth > 0) { resolve(); return; }
    im.onload = () => resolve();
    im.onerror = () => resolve(); // never block rendering on a missing texture
    im.src = src;
  }))).then(() => { texturesReady = true; });
  return readyPromise;
}
function getImg(src: string): HTMLImageElement {
  let im = imgCache.get(src);
  if (!im) { im = new Image(); im.src = src; imgCache.set(src, im); }
  return im;
}
const tintCache = new Map<string, HTMLCanvasElement>();
function getTinted(src: string, tint: string): HTMLCanvasElement {
  const key = `${src}|${tint}`;
  const cached = tintCache.get(key);
  if (cached) return cached;
  const base = getImg(src);
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const cc = c.getContext('2d')!;
  cc.clearRect(0, 0, 16, 16);
  cc.imageSmoothingEnabled = false;
  // only first frame of an animated strip
  const sh = Math.min(base.naturalHeight || 16, 16);
  cc.drawImage(base, 0, 0, base.naturalWidth || 16, sh, 0, 0, 16, 16);
  // per-pixel multiply that PRESERVES alpha (so transparent overlay pixels stay transparent)
  const tr = parseInt(tint.slice(1, 3), 16), tg = parseInt(tint.slice(3, 5), 16), tb = parseInt(tint.slice(5, 7), 16);
  const img = cc.getImageData(0, 0, 16, 16);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    d[i] = (d[i] * tr) / 255; d[i + 1] = (d[i + 1] * tg) / 255; d[i + 2] = (d[i + 2] * tb) / 255;
  }
  cc.putImageData(img, 0, 0);
  tintCache.set(key, c);
  return c;
}
// Warm the decode pipeline as soon as the module loads so the first paint is already correct.
if (typeof window !== 'undefined') void ensureTextures();

function faceSource(ft: FaceTex | undefined): CanvasImageSource | null {
  if (!ft) return null;
  if (ft.color) return null;
  if (!ft.file) return null;
  const src = tex(ft.file);
  if (!src) return null;
  if (ft.tint) return getTinted(src, ft.tint);
  return getImg(src);
}
function overlaySource(ft: FaceTex | undefined): CanvasImageSource | null {
  if (!ft || !ft.overlay) return null;
  const src = tex(ft.overlay);
  if (!src) return null;
  return ft.overlayTint ? getTinted(src, ft.overlayTint) : getImg(src);
}

type P = [number, number];

function drawModel(canvas: HTMLCanvasElement, model: BlockModel) {
  const css = canvas.clientWidth || 40;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const px = Math.max(24, Math.round(css * dpr));
  if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Isometric basis (congruent rhombus faces) in a virtual 0..100 space
  // Scale chosen so a full 16^3 isometric cube fits inside the 0..100 virtual frame with margin.
  const A = 19, B = A * Math.tan(Math.PI / 6);
  // True isometric basis: three axes share one scale so every cube edge is the same
  // screen length and faces are congruent (previous factors were half, squashing blocks).
  const proj = (vx: number, vy: number, vz: number, oy: number): P => [
    50 + (vx - 8) * (A / 8) - (vz - 8) * (A / 8),
    (vx - 8) * (B / 8) + (vz - 8) * (B / 8) - (vy - 8) * (B / 4) + oy,
  ];
  // vertical centering offset based on the model bounds
  let minY = Infinity, maxY = -Infinity;
  for (const b of model.boxes) {
    [[b.y[1], b.x[0], b.z[0]], [b.y[1], b.x[1], b.z[0]], [b.y[1], b.x[1], b.z[1]], [b.y[1], b.x[0], b.z[1]],
    [b.y[0], b.x[0], b.z[0]], [b.y[0], b.x[1], b.z[1]]].forEach(([vy, vx, vz]) => {
      const [, sy] = proj(vx, vy, vz, 0); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    });
  }
  const oy = 50 - (minY + maxY) / 2;
  const K = px / 100;

  // painter order: farther first
  const boxes = model.boxes
    .map((b) => ({ b, depth: (b.x[0] + b.x[1]) / 2 + (b.z[0] + b.z[1]) / 2 - (b.y[0] + b.y[1]) }))
    .sort((p, q) => p.depth - q.depth);

  const pathPts = (pts: P[]) => {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  };

  // quad: screen points [origin, uEnd, uvEnd, vEnd]; crop in 0..16 texel units
  const drawFace = (quad: P[], ft: FaceTex, cropU: [number, number], cropV: [number, number], shade: string) => {
    const [u0, u1] = cropU, [v0, v1] = cropV;
    const su = u1 - u0, sv = v1 - v0;
    const uVec: P = [(quad[1][0] - quad[0][0]) / su, (quad[1][1] - quad[0][1]) / su];
    const vVec: P = [(quad[3][0] - quad[0][0]) / sv, (quad[3][1] - quad[0][1]) / sv];
    ctx.save();
    ctx.scale(K, K);
    pathPts(quad); ctx.clip();
    if (ft.color) {
      ctx.setTransform(K, 0, 0, K, 0, 0);
      pathPts(quad); ctx.fillStyle = ft.color; ctx.fill();
    } else {
      const src = faceSource(ft);
      if (src) {
        ctx.setTransform(uVec[0] * K, uVec[1] * K, vVec[0] * K, vVec[1] * K, quad[0][0] * K, quad[0][1] * K);
        ctx.imageSmoothingEnabled = false;
        try { ctx.drawImage(src, u0, v0, su, sv, 0, 0, su, sv); } catch {}
        const ov = overlaySource(ft);
        if (ov) { try { ctx.drawImage(ov, u0, v0, su, sv, 0, 0, su, sv); } catch {} }
      }
    }
    ctx.setTransform(K, 0, 0, K, 0, 0);
    pathPts(quad); ctx.fillStyle = shade; ctx.fill();
    ctx.restore();
  };

  const render = () => {
    ctx.clearRect(0, 0, px, px);
    for (const { b } of boxes) {
      const [x0, x1] = b.x, [y0, y1] = b.y, [z0, z1] = b.z;
      const P_ = (vx: number, vy: number, vz: number) => proj(vx, vy, vz, oy);
      // top (y=y1): origin (x0,z0), u -> x, v -> z
      const t0 = P_(x0, y1, z0), t1 = P_(x1, y1, z0), t2 = P_(x1, y1, z1), t3 = P_(x0, y1, z1);
      drawFace([t0, t1, t2, t3], b.top, [x0, x1], [z0, z1], 'rgba(255,255,255,0.06)');
      // left face = z=z1 (lighter): origin (x0,y0,z1) u->x v->y
      const l0 = P_(x0, y0, z1), l1 = P_(x1, y0, z1), l2 = P_(x1, y1, z1), l3 = P_(x0, y1, z1);
      drawFace([l0, l1, l2, l3], b.side, [x0, x1], [16 - y1, 16 - y0], 'rgba(0,0,0,0.13)');
      // right face = x=x1 (darker); front override shown here
      const r0 = P_(x1, y0, z0), r1 = P_(x1, y0, z1), r2 = P_(x1, y1, z1), r3 = P_(x1, y1, z0);
      drawFace([r0, r1, r2, r3], b.front || b.side, [z0, z1], [16 - y1, 16 - y0], 'rgba(0,0,0,0.27)');
      // edges
      ctx.save(); ctx.scale(K, K); ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(0,0,0,0.14)';
      [[t0, t1, t2, t3], [l0, l1, l2, l3], [r0, r1, r2, r3]].forEach((q) => pathPts(q as P[]));
      ctx.stroke(); ctx.restore();
    }
  };

  // Textures are pre-decoded by ensureTextures() before this runs, so a single synchronous
  // paint is enough and every block (e.g. grass tint) is drawn deterministically — no race.
  render();
}

export function IsometricBlock({ blockKey, size = 36, className = '' }: { blockKey: string; size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const model = MODELS[blockKey] || MODELS.grass;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let cancelled = false;
    const paint = () => { if (!cancelled) drawModel(c, model); };
    // Kick off global pre-decode; paint once now (fast placeholder) and once when ready.
    if (texturesReady) paint();
    else { paint(); ensureTextures().then(paint); }
    return () => { cancelled = true; };
  }, [blockKey, model]);
  return (
    <canvas ref={ref} className={`shrink-0 ${className}`}
      style={{ width: size, height: size, imageRendering: 'pixelated' }} />
  );
}

interface VersionIconProps { type: string; size?: number; className?: string }

// 加载器 -> 等距方块模型：Forge 用铁砧、OptiFine 用泥土方块
const LOADER_BLOCK: Record<string, string> = { forge: 'anvil', optifine: 'dirt' };

// 加载器品牌真实图片（来自游戏/官方素材）：Fabric 布卷、NeoForge 狐狸头；
// Forge→铁砧等距体素、OptiFine→泥土方块、Quilt→文字徽章（见下方 LOADER_BLOCK / LOADER_BADGE）。
const LOADER_LOGO: Record<string, string> = { fabric: fabricLogoUrl, neoforge: neoforgeLogoUrl };
const LOADER_BADGE: Record<string, { bg: string; fg: string; text: string; title: string }> = {
  quilt:    { bg: 'linear-gradient(135deg,#b6a0ff,#7d5fe6)', fg: '#ffffff', text: 'Qu', title: 'Quilt' },
};
export const LOADER_ICONS = ['fabric', 'forge', 'neoforge', 'optifine', 'quilt'];

// 按“加载器优先、版本类型兜底”给出自动图标：模组加载器用各自品牌图标，原版按正式/快照等取方块
export function defaultVersionIcon(
  loader?: string,
  versionType?: string,
): string {
  if (loader && loader !== 'vanilla' && LOADER_ICONS.includes(loader)) return loader;
  if (versionType === 'snapshot') return 'command';
  if (versionType === 'april_fools') return 'gold';
  if (versionType === 'old_alpha' || versionType === 'old_beta' || versionType === 'old') return 'cobble';
  return 'grass';
}

export default function VersionIcon({ type, size = 28, className = '' }: VersionIconProps) {
  if (!type) type = 'grass';
  if (type.startsWith('data:') || type.startsWith('custom:')) {
    const src = type.startsWith('custom:') ? type.slice(7) : type;
    return (
      <img src={src} alt="" width={size} height={size} className={`shrink-0 rounded ${className}`}
        style={{ width: size, height: size, objectFit: 'cover', imageRendering: 'pixelated' }} referrerPolicy="no-referrer" />
    );
  }
  if (LOADER_LOGO[type]) {
    return (
      <img src={LOADER_LOGO[type]} alt={type} width={size} height={size}
        className={`shrink-0 ${className}`} draggable={false}
        style={{ width: size, height: size, objectFit: 'contain', imageRendering: 'pixelated' }} />
    );
  }
  if (LOADER_BLOCK[type]) return <IsometricBlock blockKey={LOADER_BLOCK[type]} size={size} className={className} />;
  if (LOADER_BADGE[type]) {
    const b = LOADER_BADGE[type];
    return (
      <span className={`shrink-0 inline-flex items-center justify-center rounded-md font-bold ${className}`}
        title={b.title}
        style={{ width: size, height: size, background: b.bg, color: b.fg, fontSize: size * 0.32, lineHeight: 1 }}>
        {b.text}
      </span>
    );
  }
  const key = MODELS[type] ? type : (CATEGORY_TO_BLOCK[type] || 'grass');
  return <IsometricBlock blockKey={key} size={size} className={className} />;
}

export { BLOCKS, MODELS };
