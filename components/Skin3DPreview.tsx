import { useEffect, useRef, useState } from 'react';
import {
  SkinViewer,
  IdleAnimation, WalkingAnimation, RunningAnimation, CrouchAnimation, SwimAnimation,
  type PlayerAnimation,
} from 'skinview3d';
// 3D 渲染与全部角色动作均由 skin3d（cosmic-fi/skinview3d，MIT）项目提供
import {
  PersonStanding, Footprints, Zap, ArrowDownToLine, Waves,
} from 'lucide-react';
import { motion, useAnimationControls } from 'framer-motion';
import { DirectionalLight, HemisphereLight, type Light } from 'three';

interface Skin3DPreviewProps {
  skinUrl: string;
  /** 披风贴图（标准 64x32 披风图，dataURL 亦可）；为空则不渲染披风 */
  capeUrl?: string;
  size?: number;
  slim?: boolean;
  autoRotate?: boolean;
}

type PoseId = 'idle' | 'walk' | 'run' | 'sneak' | 'swim';
type BgId = 'light' | 'dark';

const POSE_LIST: { id: PoseId; label: string; Icon: typeof PersonStanding }[] = [
  { id: 'idle', label: '站立', Icon: PersonStanding },
  { id: 'walk', label: '行走', Icon: Footprints },
  { id: 'run', label: '奔跑', Icon: Zap },
  { id: 'sneak', label: '蹲下', Icon: ArrowDownToLine },
  { id: 'swim', label: '游泳', Icon: Waves },
];

// 内置 Steve（仅当皮肤缺失/加载失败时兜底，保证预览框永不空白）
function steveCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const x = c.getContext('2d')!;
  const px = (u: number, v: number, w: number, h: number, col: string) => { x.fillStyle = col; x.fillRect(u, v, w, h); };
  px(8, 8, 8, 8, '#b98a5e'); px(8, 8, 8, 2, '#6b4a2c');
  px(9, 10, 1, 1, '#fff'); px(12, 10, 1, 1, '#4a6a9a'); px(14, 10, 1, 1, '#fff'); px(13, 10, 1, 1, '#4a6a9a');
  px(20, 20, 8, 12, '#1ea0a0');
  px(44, 20, 4, 12, '#b98a5e'); px(36, 52, 4, 12, '#b98a5e');
  px(4, 20, 4, 12, '#3a3a8a'); px(20, 52, 4, 12, '#3a3a8a');
  return c;
}

export default function Skin3DPreview({ skinUrl, capeUrl, size = 200, slim = false, autoRotate = false }: Skin3DPreviewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<SkinViewer | null>(null);
  const animsRef = useRef<Record<PoseId, PlayerAnimation> | null>(null);
  const [ready, setReady] = useState(false);
  const [pose, setPose] = useState<PoseId>('idle');
  const [bg, setBg] = useState<BgId>('light');
  const [failed, setFailed] = useState(false);
  const pop = useAnimationControls();

  const width = Math.round(size * 0.8);
  const height = Math.round(size * 1.4);

  // 创建 / 销毁 viewer（尺寸变化才重建）
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const viewer = new SkinViewer({
      width,
      height,
      fov: 46,
      zoom: 0.92,
      enableControls: true,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    });
    viewer.canvas.style.width = `${width}px`;
    viewer.canvas.style.height = `${height}px`;
    viewer.canvas.style.display = 'block';
    viewer.canvas.style.touchAction = 'none';
    // 仅允许拖拽旋转，关闭缩放/平移，保持取景稳定
    viewer.controls.enableZoom = false;
    viewer.controls.enablePan = false;
    // 初始 3/4 侧视角（OrbitControls 在 three 0.169 未公开 rotateLeft，直接转模型包装层）
    viewer.playerWrapper.rotation.y = -0.55;
    viewer.autoRotateSpeed = 0.8;

    // 立体光影：默认环境光很强(3)导致画面偏平。降低环境光，改用 主光/补光/轮廓光 三点布光，
    // 轮廓光从背后勾边，让人物更立体、更有层次感。
    viewer.globalLight.intensity = 0.85;
    viewer.cameraLight.intensity = 0.3;
    const hemi = new HemisphereLight(0xffffff, 0x8c7b66, 0.45);
    const key = new DirectionalLight(0xfff3e2, 2.1);   // 主光：暖白，前上偏右
    key.position.set(4.5, 8, 6);
    const fill = new DirectionalLight(0xdfe9ff, 0.75); // 补光：冷色，左侧，弱化阴影
    fill.position.set(-6, 3.5, 4);
    const rim = new DirectionalLight(0xbfd4ff, 1.7);   // 轮廓光：背后偏上，勾出边缘
    rim.position.set(-2, 6, -8);
    const added: Light[] = [hemi, key, fill, rim];
    added.forEach((l) => viewer.scene.add(l));

    animsRef.current = {
      idle: new IdleAnimation(),
      walk: new WalkingAnimation(),
      run: new RunningAnimation(),
      sneak: new CrouchAnimation(),
      swim: new SwimAnimation(),
    };
    viewer.animation = animsRef.current.idle;

    mount.innerHTML = '';
    mount.appendChild(viewer.canvas);
    viewerRef.current = viewer;
    setReady(true);

    return () => {
      setReady(false);
      added.forEach((l) => viewer.scene.remove(l));
      viewer.dispose();
      viewerRef.current = null;
      animsRef.current = null;
      mount.innerHTML = '';
    };
  }, [width, height]);

  // 加载皮肤（slim 模型随账号类型）；失败回退内置 Steve
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    let cancelled = false;
    const apply = async () => {
      try {
        if (skinUrl) {
          await viewer.loadSkin(skinUrl, { model: slim ? 'slim' : 'default' });
          if (!cancelled) setFailed(false);
        } else {
          viewer.loadSkin(steveCanvas(), { model: 'default' });
          if (!cancelled) setFailed(true);
        }
      } catch {
        if (!cancelled) {
          viewer.loadSkin(steveCanvas(), { model: 'default' });
          setFailed(true);
        }
      }
    };
    void apply();
    return () => { cancelled = true; };
  }, [skinUrl, slim, ready]);

  // 加载/移除披风（官方 10x16x1 布料披风，随动作倾斜；拖拽旋转相机不会甩动披风）
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    if (capeUrl) {
      viewer.loadCape(capeUrl).catch(() => viewer.resetCape());
    } else {
      viewer.resetCape();
    }
  }, [capeUrl, ready]);

  // 切换动作（全部为 skinview3d 官方动画：行走/奔跑/蹲下/游泳/打击）
  useEffect(() => {
    const viewer = viewerRef.current;
    const anims = animsRef.current;
    if (!viewer || !anims || !ready) return;
    viewer.animation = anims[pose];
  }, [pose, ready]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    viewer.autoRotate = autoRotate;
  }, [autoRotate, ready]);

  const onPick = (id: PoseId) => {
    setPose(id);
    // Q 弹：切换动作时预览框轻微回弹一下
    pop.start({ scale: [1, 1.045, 0.985, 1], transition: { duration: 0.42, ease: [0.34, 1.56, 0.64, 1] } });
  };

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <motion.div
        animate={pop}
        className="rounded-xl border"
        style={{
          width: width + 16,
          backgroundColor: bg === 'light' ? '#ffffff' : '#141414',
          borderColor: bg === 'light' ? '#e5e5e5' : '#2a2a2a',
          transition: 'background-color .35s ease, border-color .35s ease',
        }}
      >
        <div
          ref={mountRef}
          className="flex items-center justify-center"
          style={{ width, height, margin: '0 auto' }}
        />
      </motion.div>

      {/* 动作选择 */}
      <div className="flex items-center gap-1.5 flex-wrap justify-center max-w-[260px]">
        {POSE_LIST.map(({ id, label, Icon }) => (
          <motion.button
            key={id}
            title={label}
            onClick={() => onPick(id)}
            whileTap={{ scale: 0.82 }}
            whileHover={{ scale: 1.1 }}
            transition={{ type: 'spring', stiffness: 520, damping: 16 }}
            className={`size-9 rounded-lg flex items-center justify-center border ${
              pose === id ? 'bg-foreground text-background border-foreground' : 'bg-card text-muted-foreground border-border hover:text-foreground'
            }`}
          >
            <Icon className="size-4" />
          </motion.button>
        ))}
      </div>

      {/* 背景黑白切换 + 提示（颜色切换带 .35s 过渡） */}
      <div className="flex items-center gap-2">
        <motion.button
          title="白色背景"
          onClick={() => setBg('light')}
          whileTap={{ scale: 0.85 }}
          className={`size-5 rounded-[5px] border bg-white ${bg === 'light' ? 'ring-2 ring-primary ring-offset-1' : 'border-neutral-300'}`}
        />
        <motion.button
          title="黑色背景"
          onClick={() => setBg('dark')}
          whileTap={{ scale: 0.85 }}
          className={`size-5 rounded-[5px] border bg-black ${bg === 'dark' ? 'ring-2 ring-primary ring-offset-1' : 'border-neutral-600'}`}
        />
        <span className="text-xs text-muted-foreground ml-1">{failed ? '拖动旋转（内置默认皮肤）' : '拖动旋转 · 可切换动作/背景'}</span>
      </div>
    </div>
  );
}
