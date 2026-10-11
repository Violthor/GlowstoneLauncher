import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  PersonStanding, Footprints, Zap, ArrowDownToLine, Waves, Sword,
} from 'lucide-react';

interface Skin3DPreviewProps {
  skinUrl: string;
  /** 披风贴图（标准 64x32 披风图，dataURL 亦可）；为空则不渲染披风 */
  capeUrl?: string;
  size?: number;
  slim?: boolean;
  autoRotate?: boolean;
}

type PoseId = 'idle' | 'walk' | 'run' | 'sneak' | 'swim' | 'attack';
type BgId = 'light' | 'dark';

type FaceRegions = {
  px: [number, number, number, number]; // right (+X)
  nx: [number, number, number, number]; // left (-X)
  py: [number, number, number, number]; // top (+Y)
  ny: [number, number, number, number]; // bottom (-Y)
  pz: [number, number, number, number]; // front (+Z)
  nz: [number, number, number, number]; // back (-Z)
};

const TEX = 64;

// Assign per-face UVs of a BoxGeometry from pixel rectangles in a 64x64 skin.
function applyFaceUVs(geo: THREE.BoxGeometry, regions: FaceRegions) {
  const order: (keyof FaceRegions)[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  order.forEach((key, face) => {
    const [u, v, fw, fh] = regions[key];
    const base = face * 4;
    const corners: Array<[number, number]> = [
      [0, 1], [1, 1], [0, 0], [1, 0],
    ];
    corners.forEach(([lu, lv], i) => {
      const uu = u + lu * fw;
      const vv = v + (1 - lv) * fh;
      uv.setXY(base + i, uu / TEX, 1 - vv / TEX);
    });
  });
  uv.needsUpdate = true;
}

function makeBox(w: number, h: number, d: number, regions: FaceRegions, mat: THREE.Material) {
  const geo = new THREE.BoxGeometry(w, h, d);
  applyFaceUVs(geo, regions);
  return new THREE.Mesh(geo, mat);
}

// 披风：一块 8×16、厚 0.5 的薄板，使用披风图自身的实际宽高归一化（标准披风为 64×32，
// 与 64×64 皮肤不同，故不能套用 applyFaceUVs 的固定分母）。
function applyCapeUVs(geo: THREE.BoxGeometry, w: number, h: number) {
  // 顺序与 BoxGeometry 一致：px,nx,py,ny,pz,nz（像素矩形）
  const R: Record<keyof FaceRegions, [number, number, number, number]> = {
    px: [11, 1, 1, 16], nx: [22, 1, 1, 16],
    py: [1, 0, 10, 1], ny: [10, 0, 10, 1],
    pz: [12, 1, 10, 16], nz: [1, 1, 10, 16], // pz=贴背内面，nz=外侧可见面
  };
  const order: (keyof FaceRegions)[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  order.forEach((key, face) => {
    const [u, v, fw, fh] = R[key];
    const base = face * 4;
    const corners: Array<[number, number]> = [[0, 1], [1, 1], [0, 0], [1, 0]];
    corners.forEach(([lu, lv], i) => {
      uv.setXY(base + i, (u + lu * fw) / w, 1 - (v + (1 - lv) * fh) / h);
    });
  });
  uv.needsUpdate = true;
}

// Base + overlay pixel regions for every limb (classic 4px arms)
const REGIONS = {
  head: {
    base: { px: [0, 8, 8, 8], nx: [16, 8, 8, 8], py: [8, 0, 8, 8], ny: [16, 0, 8, 8], pz: [8, 8, 8, 8], nz: [24, 8, 8, 8] } as FaceRegions,
    over: { px: [32, 8, 8, 8], nx: [48, 8, 8, 8], py: [40, 0, 8, 8], ny: [48, 0, 8, 8], pz: [40, 8, 8, 8], nz: [56, 8, 8, 8] } as FaceRegions,
  },
  body: {
    base: { px: [16, 20, 4, 12], nx: [28, 20, 4, 12], py: [20, 16, 8, 4], ny: [28, 16, 8, 4], pz: [20, 20, 8, 12], nz: [32, 20, 8, 12] } as FaceRegions,
    over: { px: [16, 36, 4, 12], nx: [28, 36, 4, 12], py: [20, 32, 8, 4], ny: [28, 32, 8, 4], pz: [20, 36, 8, 12], nz: [32, 36, 8, 12] } as FaceRegions,
  },
  rArm: {
    base: { px: [40, 20, 4, 12], nx: [48, 20, 4, 12], py: [44, 16, 4, 4], ny: [48, 16, 4, 4], pz: [44, 20, 4, 12], nz: [52, 20, 4, 12] } as FaceRegions,
    over: { px: [40, 36, 4, 12], nx: [48, 36, 4, 12], py: [44, 32, 4, 4], ny: [48, 32, 4, 4], pz: [44, 36, 4, 12], nz: [52, 36, 4, 12] } as FaceRegions,
  },
  lArm: {
    base: { px: [32, 52, 4, 12], nx: [40, 52, 4, 12], py: [36, 48, 4, 4], ny: [40, 48, 4, 4], pz: [36, 52, 4, 12], nz: [44, 52, 4, 12] } as FaceRegions,
    over: { px: [48, 52, 4, 12], nx: [56, 52, 4, 12], py: [52, 48, 4, 4], ny: [56, 48, 4, 4], pz: [52, 52, 4, 12], nz: [60, 52, 4, 12] } as FaceRegions,
  },
  rLeg: {
    base: { px: [0, 20, 4, 12], nx: [8, 20, 4, 12], py: [4, 16, 4, 4], ny: [8, 16, 4, 4], pz: [4, 20, 4, 12], nz: [12, 20, 4, 12] } as FaceRegions,
    over: { px: [0, 36, 4, 12], nx: [8, 36, 4, 12], py: [4, 32, 4, 4], ny: [8, 32, 4, 4], pz: [4, 36, 4, 12], nz: [12, 36, 4, 12] } as FaceRegions,
  },
  lLeg: {
    base: { px: [16, 52, 4, 12], nx: [24, 52, 4, 12], py: [20, 48, 4, 4], ny: [24, 48, 4, 4], pz: [20, 52, 4, 12], nz: [28, 52, 4, 12] } as FaceRegions,
    over: { px: [0, 52, 4, 12], nx: [8, 52, 4, 12], py: [4, 48, 4, 4], ny: [8, 48, 4, 4], pz: [4, 52, 4, 12], nz: [12, 52, 4, 12] } as FaceRegions,
  },
};

// Procedural fallback Steve texture (used only if the skin image fails to load)
function fallbackTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const x = c.getContext('2d')!;
  const px = (u: number, v: number, w: number, h: number, col: string) => { x.fillStyle = col; x.fillRect(u, v, w, h); };
  px(8, 8, 8, 8, '#b98a5e'); px(8, 8, 8, 2, '#6b4a2c');
  px(9, 10, 1, 1, '#fff'); px(12, 10, 1, 1, '#4a6a9a'); px(14, 10, 1, 1, '#fff'); px(13, 10, 1, 1, '#4a6a9a');
  px(20, 20, 8, 12, '#1ea0a0');
  px(44, 20, 4, 12, '#b98a5e'); px(36, 52, 4, 12, '#b98a5e');
  px(4, 20, 4, 12, '#3a3a8a'); px(20, 52, 4, 12, '#3a3a8a');
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 所有“基础层”面的像素矩形（不含第二层）。部分皮肤手臂背面/底面留空（alpha=0），
// 直接渲染会发黑或看穿，这里逐面用该面已有实色像素的均值把空位补成不透明。
const BASE_RECTS: Array<[number, number, number, number]> = Object.values(REGIONS).flatMap(
  (part) => Object.values(part.base),
);
function solidifyBaseLayer(img: TexImageSource): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TEX; c.height = TEX;
  const g = c.getContext('2d')!;
  g.drawImage(img as CanvasImageSource, 0, 0);
  const image = g.getImageData(0, 0, TEX, TEX);
  const d = image.data;
  for (const [u, v, w, h] of BASE_RECTS) {
    let r = 0, gg = 0, b = 0, n = 0;
    for (let y = v; y < v + h; y++) for (let x = u; x < u + w; x++) {
      const i = (TEX * y + x) * 4;
      if (d[i + 3] > 200) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
    }
    if (n === 0) continue; // 整面都空（如旧版皮肤），不臆造颜色
    r = Math.round(r / n); gg = Math.round(gg / n); b = Math.round(b / n);
    for (let y = v; y < v + h; y++) for (let x = u; x < u + w; x++) {
      const i = (TEX * y + x) * 4;
      if (d[i + 3] < 128) { d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255; }
    }
  }
  g.putImageData(image, 0, 0);
  return c;
}

// 动作：站立/行走/奔跑/蹲下/游泳/打击。行走、奔跑严格对齐 skinview3d 的
// WalkingAnimation(t/250ms,摆幅0.7) 与 RunningAnimation(t/180ms,腿1.1/臂1.3) 关键帧。
const POSE_LIST: { id: PoseId; label: string; Icon: typeof PersonStanding }[] = [
  { id: 'idle', label: '站立', Icon: PersonStanding },
  { id: 'walk', label: '行走', Icon: Footprints },
  { id: 'run', label: '奔跑', Icon: Zap },
  { id: 'sneak', label: '蹲下', Icon: ArrowDownToLine },
  { id: 'swim', label: '游泳', Icon: Waves },
  { id: 'attack', label: '打击', Icon: Sword },
];

export default function Skin3DPreview({ skinUrl, capeUrl, size = 200, slim = false, autoRotate = false }: Skin3DPreviewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [pose, setPose] = useState<PoseId>('idle');
  const [bg, setBg] = useState<BgId>('light');
  const poseRef = useRef<PoseId>('idle');
  poseRef.current = pose;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = Math.round(size * 0.8);
    const height = Math.round(size * 1.4);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, width / height, 0.1, 1000);
    camera.position.set(0, 1, 120);

    // 光照：基础环境光 + 前上方向光 + 微弱天光，使立方体六个面按法线产生明暗，
    // 看起来是立体体素模型而不是一张平贴的画（MeshBasicMaterial 不受光、各面同色会显平）
    scene.add(new THREE.AmbientLight(0xffffff, 0.78));
    const key = new THREE.DirectionalLight(0xffffff, 0.55);
    key.position.set(0.6, 1.1, 1.0);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.22);
    fill.position.set(-0.8, 0.3, -0.6);
    scene.add(fill);

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    // spin 负责拖拽/自动旋转；player 负责动作（位移/整体倾斜），二者互不干扰
    const spin = new THREE.Group();
    const player = new THREE.Group();
    // upperBody 包住头/身体/手臂：潜行时只让上半身绕胯前倾，双腿保持竖直
    const upperBody = new THREE.Group();
    scene.add(spin); spin.add(player); player.add(upperBody);

    // 关节引用
    const bones: Record<'head' | 'body' | 'rArm' | 'lArm' | 'rLeg' | 'lLeg', THREE.Group> = {} as never;
    // 披风枢轴（独立于关节，供 applyPose 做随动作的轻微摆动）
    let capePivot: THREE.Group | null = null;

    const buildModel = (texture: THREE.Texture, capeImg?: TexImageSource | null) => {
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      // 基础层在加载时已把未绘制像素补成实色（solidifyBaseLayer）；Lambert 受光产生立体明暗
      const baseMat = new THREE.MeshLambertMaterial({ map: texture, side: THREE.FrontSide, alphaTest: 0.5 });
      // 第二层（帽子/外套等）：未绘制像素用 alphaTest 直接丢弃，避免透明区混成黑块/黑边
      const overMat = new THREE.MeshLambertMaterial({
        map: texture, side: THREE.FrontSide, transparent: false, alphaTest: 0.5,
      });
      while (upperBody.children.length) { const ch = upperBody.children.pop()!; ch.removeFromParent(); }
      while (player.children.length) { const ch = player.children.pop()!; ch.removeFromParent(); }
      player.add(upperBody);

      const armW = slim ? 3 : 4;
      // 关节枢轴：肩 y=8、胯 y=-4、颈 y=8；部件 mesh 在枢轴内向下偏移，使枢轴位于关节顶端
      const legTop = -4, bodyTop = 8;
      const yBody = bodyTop - 6;

      // 头（绕脖子）
      const head = new THREE.Group(); head.position.set(0, bodyTop, 0);
      const hb = makeBox(8, 8, 8, REGIONS.head.base, baseMat); hb.position.y = 4;
      const ho = makeBox(8.5, 8.5, 8.5, REGIONS.head.over, overMat); ho.position.y = 4;
      head.add(hb, ho); bones.head = head; upperBody.add(head);

      // 身体（不动关节，直接挂 upperBody）
      const body = new THREE.Group(); body.position.set(0, 0, 0);
      const bb = makeBox(8, 12, 4, REGIONS.body.base, baseMat); bb.position.y = yBody;
      const bo = makeBox(8.5, 12.5, 4.5, REGIONS.body.over, overMat); bo.position.y = yBody;
      body.add(bb, bo); bones.body = body; upperBody.add(body);

      // 披风：枢轴在肩后，薄板向下垂；贴在身体背面（z≈-2.1），随上半身一起前倾
      capePivot = null;
      if (capeImg) {
        const cw = (capeImg as HTMLImageElement).naturalWidth || 64;
        const ch = (capeImg as HTMLImageElement).naturalHeight || 32;
        const capeTex = new THREE.Texture(capeImg);
        capeTex.magFilter = THREE.NearestFilter; capeTex.minFilter = THREE.NearestFilter;
        capeTex.generateMipmaps = false; capeTex.colorSpace = THREE.SRGBColorSpace;
        capeTex.needsUpdate = true;
        const capeMat = new THREE.MeshLambertMaterial({ map: capeTex, side: THREE.DoubleSide, alphaTest: 0.5 });
        const capeGeo = new THREE.BoxGeometry(8, 16, 0.5);
        applyCapeUVs(capeGeo, cw, ch);
        const capeMesh = new THREE.Mesh(capeGeo, capeMat);
        capeMesh.position.y = -8; // 枢轴在顶端，整块向下垂
        const pivot = new THREE.Group();
        pivot.position.set(0, bodyTop, -2.1);
        pivot.add(capeMesh);
        capePivot = pivot; upperBody.add(pivot);
      }

      // 手臂（绕肩）
      const armX = 4 + armW / 2;
      const mkArm = (side: number, reg: typeof REGIONS.rArm) => {
        const g = new THREE.Group(); g.position.set(side * armX, bodyTop, 0);
        const a = makeBox(armW, 12, 4, reg.base, baseMat); a.position.y = -6;
        const o = makeBox(armW + 0.5, 12.5, 4.5, reg.over, overMat); o.position.y = -6;
        g.add(a, o); return g;
      };
      bones.rArm = mkArm(-1, REGIONS.rArm); bones.lArm = mkArm(1, REGIONS.lArm);
      upperBody.add(bones.rArm, bones.lArm);

      // 腿（绕胯）
      const mkLeg = (side: number, reg: typeof REGIONS.rLeg) => {
        const g = new THREE.Group(); g.position.set(side * 2, legTop, 0);
        const a = makeBox(4, 12, 4, reg.base, baseMat); a.position.y = -6;
        const o = makeBox(4.5, 12.5, 4.5, reg.over, overMat); o.position.y = -6;
        g.add(a, o); return g;
      };
      bones.rLeg = mkLeg(-1, REGIONS.rLeg); bones.lLeg = mkLeg(1, REGIONS.lLeg);
      player.add(bones.rLeg, bones.lLeg);
    };

    let active = true;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const loadTex = (url?: string): Promise<THREE.Texture | null> => new Promise((resolve) => {
      if (!url) return resolve(null);
      loader.load(url, (t) => resolve(t), undefined, () => resolve(null));
    });
    void (async () => {
      const [skinTex, capeTex] = await Promise.all([loadTex(skinUrl), loadTex(capeUrl)]);
      if (!active) { skinTex?.dispose(); capeTex?.dispose(); return; }
      // 披风取原始图像（建模时单独建纹理），随后即可释放 loader 纹理
      const capeImg = capeTex ? (capeTex.image as TexImageSource) : null;
      if (skinTex) {
        setFailed(false);
        // 补实基础层空位后再交给 three，避免手臂背面/底面发黑或看穿
        const fixed = new THREE.CanvasTexture(solidifyBaseLayer(skinTex.image as TexImageSource));
        skinTex.dispose(); capeTex?.dispose();
        buildModel(fixed, capeImg);
      } else {
        setFailed(true);
        capeTex?.dispose();
        buildModel(fallbackTexture(), capeImg);
      }
    })();

    // 目标姿态 q（由动作关键帧计算），当前姿态 cur 每帧向 q 做 Lerp，实现平滑切换/播放
    interface Pose {
      hx: number; hy: number; hz: number; hpx: number; hpy: number; hpz: number;
      rax: number; raz: number; lax: number; laz: number; rlx: number; llx: number;
      bpy: number; px: number; py: number; pz: number; prx: number; pry: number; prz: number; urx: number; upy: number;
    }
    const defaultPose = (): Pose => ({
      hx: 0, hy: 0, hz: 0, hpx: 0, hpy: 8, hpz: 0,
      rax: 0, raz: 0, lax: 0, laz: 0, rlx: 0, llx: 0,
      bpy: 0, px: 0, py: 0, pz: 0, prx: 0, pry: 0, prz: 0, urx: 0, upy: 0,
    });
    const cur = defaultPose();
    const damp = (a: number, b: number, k: number) => a + (b - a) * k;

    const computePose = (p: PoseId, t: number): Pose => {
      const q = defaultPose();
      switch (p) {
        case 'idle': {
          const b = Math.sin(t * 1.8) * 0.06;
          q.bpy = b; q.hpy = 8 + b;
          q.rax = Math.sin(t * 1.8) * 0.04; q.lax = -Math.sin(t * 1.8) * 0.04;
          break;
        }
        case 'walk': {
          // skinview3d WalkingAnimation：相位 t/250ms≈4rad/s，四肢摆幅 0.7，对侧手脚反向
          const s = Math.sin(t * 4);
          q.rlx = s * 0.7; q.llx = -s * 0.7; q.rax = -s * 0.7; q.lax = s * 0.7;
          q.bpy = Math.abs(Math.cos(t * 4)) * 0.3; q.hpy = 8 + q.bpy;
          break;
        }
        case 'run': {
          // skinview3d RunningAnimation：相位 t/180ms≈5.56rad/s，腿 1.1、臂 1.3，上身直立
          const s = Math.sin(t * 5.56);
          q.rlx = s * 1.1; q.llx = -s * 1.1; q.rax = -s * 1.3; q.lax = s * 1.3;
          q.bpy = Math.abs(Math.cos(t * 5.56)) * 0.45; q.hpy = 8 + q.bpy;
          break;
        }
        case 'sneak': {
          // 原版蹲下（HumanoidModel）：头+身体+手臂整体前倾 0.5rad，双腿保持竖直（原版无膝关节），
          // 双臂向后收，整个人下沉。
          q.py = -2; q.urx = 0.5;
          q.rax = -0.3; q.lax = -0.3;
          q.rlx = 0; q.llx = 0;
          break;
        }
        case 'swim': {
          // 原版游泳/滑翔姿态：身体水平，双臂向前伸直做交替划水，双腿向后并拢轻踢
          const stroke = Math.sin(t * 5);
          q.prx = Math.PI / 2;
          q.rax = -1.7 + stroke * 0.22;
          q.lax = -1.7 - stroke * 0.22;
          q.rlx = 0.15 + stroke * 0.12;
          q.llx = 0.15 - stroke * 0.12;
          break;
        }
        case 'attack': {
          // Minecraft 攻击：右臂向前下挥击，左臂自然垂放，身体微沉
          const swing = Math.sin(t * 6) * 0.25;
          q.rax = -1.35 + swing; q.lax = 0.1; q.bpy = -0.3; q.hpy = 8 - 0.3;
          break;
        }
      }
      return q;
    };

    const applyPose = (p: PoseId, t: number) => {
      if (!bones.head) return;
      const q = computePose(p, t);
      const k = 0.22;
      (Object.keys(q) as (keyof Pose)[]).forEach((key) => { cur[key] = damp(cur[key], q[key], k); });
      const { head, body, rArm, lArm, rLeg, lLeg } = bones;
      head.rotation.set(cur.hx, cur.hy, cur.hz);
      head.position.set(cur.hpx, cur.hpy, cur.hpz);
      body.position.set(0, cur.bpy, 0);
      rArm.rotation.set(cur.rax, 0, cur.raz);
      lArm.rotation.set(cur.lax, 0, cur.laz);
      rLeg.rotation.set(cur.rlx, 0, 0);
      lLeg.rotation.set(cur.llx, 0, 0);
      player.position.set(cur.px, cur.py, cur.pz);
      player.rotation.set(cur.prx, cur.pry, cur.prz);
      upperBody.rotation.set(cur.urx, 0, 0);
      upperBody.position.set(0, cur.upy, 0);
      // 披风随动作轻摆（相对上半身；走路/奔跑向后飘，游泳贴背）
      if (capePivot) {
        let capeX = 0;
        switch (p) {
          case 'idle': capeX = Math.sin(t * 1.8) * 0.03; break;
          case 'walk': capeX = 0.05 + Math.sin(t * 4) * 0.10; break;
          case 'run': capeX = 0.12 + Math.sin(t * 5.56) * 0.18; break;
          case 'sneak': capeX = 0.2; break;
          case 'swim': capeX = -0.5; break;
          case 'attack': capeX = 0.05; break;
        }
        capePivot.rotation.x = capeX;
      }
    };

    // 拖拽旋转
    let rotY = -0.5; let rotX = 0.08;
    let velX = 0; let dragging = false; let lastPX = 0; let lastPY = 0;
    const onDown = (e: PointerEvent) => { dragging = true; lastPX = e.clientX; lastPY = e.clientY; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastPX; const dy = e.clientY - lastPY;
      lastPX = e.clientX; lastPY = e.clientY;
      rotY += dx * 0.012; rotX = Math.max(-0.9, Math.min(0.9, rotX + dy * 0.012));
      velX = dx * 0.012;
    };
    const onUp = () => { dragging = false; };
    const el = renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    const clock = new THREE.Clock();
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (!dragging) {
        if (autoRotate) rotY += 0.008;
        else { rotY += velX; velX *= 0.92; }
      }
      spin.rotation.y = rotY; spin.rotation.x = rotX;
      applyPose(poseRef.current, clock.getElapsedTime());
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      active = false;
      cancelAnimationFrame(raf);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      renderer.dispose();
      scene.traverse((o) => {
        if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
      });
      mount.removeChild(renderer.domElement);
    };
  }, [skinUrl, capeUrl, size, slim, autoRotate]);

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div
        className="rounded-xl border transition-colors"
        style={{
          width: Math.round(size * 0.8) + 16,
          background: bg === 'light' ? '#ffffff' : '#141414',
          borderColor: bg === 'light' ? '#e5e5e5' : '#2a2a2a',
        }}
      >
        <div ref={mountRef} className="cursor-grab active:cursor-grabbing flex items-center justify-center" style={{ width: Math.round(size * 0.8), height: Math.round(size * 1.4), margin: '0 auto' }} />
      </div>

      {/* 动作选择 */}
      <div className="flex items-center gap-1.5 flex-wrap justify-center max-w-[260px]">
        {POSE_LIST.map(({ id, label, Icon }) => (
          <button
            key={id}
            title={label}
            onClick={() => setPose(id)}
            className={`size-9 rounded-lg flex items-center justify-center border transition-colors ${
              pose === id ? 'bg-foreground text-background border-foreground' : 'bg-card text-muted-foreground border-border hover:text-foreground'
            }`}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>

      {/* 背景黑白切换 + 提示 */}
      <div className="flex items-center gap-2">
        <button
          title="白色背景"
          onClick={() => setBg('light')}
          className={`size-5 rounded-[5px] border bg-white ${bg === 'light' ? 'ring-2 ring-primary ring-offset-1' : 'border-neutral-300'}`}
        />
        <button
          title="黑色背景"
          onClick={() => setBg('dark')}
          className={`size-5 rounded-[5px] border bg-black ${bg === 'dark' ? 'ring-2 ring-primary ring-offset-1' : 'border-neutral-600'}`}
        />
        <span className="text-xs text-muted-foreground ml-1">{failed ? '拖动旋转（内置默认皮肤）' : '拖动旋转 · 可切换动作/背景'}</span>
      </div>
    </div>
  );
}
