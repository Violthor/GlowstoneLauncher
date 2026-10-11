import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Upload, ShieldCheck, Link2Off, Layers } from 'lucide-react';

interface PixelAvatarProps {
  username?: string;
  uuid?: string;
  size?: number;
  skinUrl?: string;
  onClick?: () => void;
  onRefresh?: () => void;
  onImportSkin?: (dataUrl: string) => void;
  /** 传入则显示“导入披风”（仅离线/外置账号由上层决定是否传入） */
  onImportCape?: (dataUrl: string) => void;
  /** 已有披风时显示“移除披风” */
  onRemoveCape?: () => void;
  hasCape?: boolean;
  onSwitchType?: (type: 'microsoft' | 'offline') => void;
  isLoggedIn?: boolean;
}

// Inline default Steve face (8x8 pixel grid scaled up) - no network needed
const STEVE_FACE_SVG = (s: number) => `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 8 8" shape-rendering="crispEdges">
<rect width="8" height="8" fill="#b07c54"/>
<rect y="0" width="8" height="2" fill="#5a3820"/>
<rect x="0" y="2" width="1" height="3" fill="#5a3820"/>
<rect x="7" y="2" width="1" height="3" fill="#5a3820"/>
<rect x="1" y="3" width="2" height="1" fill="#fff"/>
<rect x="5" y="3" width="2" height="1" fill="#fff"/>
<rect x="1" y="3" width="1" height="1" fill="#4a6a9a"/>
<rect x="6" y="3" width="1" height="1" fill="#4a6a9a"/>
<rect x="3" y="5" width="2" height="1" fill="#9a6840"/>
<rect x="2" y="6" width="4" height="1" fill="#8a5838"/>
</svg>`)}`;

const ALEX_FACE_SVG = (s: number) => `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 8 8" shape-rendering="crispEdges">
<rect width="8" height="8" fill="#d4a87a"/>
<rect y="0" width="8" height="2" fill="#c87838"/>
<rect x="0" y="2" width="1" height="4" fill="#c87838"/>
<rect x="7" y="2" width="1" height="4" fill="#c87838"/>
<rect x="1" y="3" width="2" height="1" fill="#fff"/>
<rect x="5" y="3" width="2" height="1" fill="#fff"/>
<rect x="2" y="3" width="1" height="1" fill="#5a8a4a"/>
<rect x="5" y="3" width="1" height="1" fill="#5a8a4a"/>
<rect x="3" y="5" width="2" height="1" fill="#c09060"/>
<rect x="2" y="6" width="4" height="1" fill="#b08050"/>
</svg>`)}`;

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Crop the 8x8 front face (+ hat overlay) from a 64x64 skin and return a crisp upscaled data URL.
function cropFace(skinSrc: string, out = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // A full skin is 64x64; a raw face is 8x8. Only crop when it looks like a skin sheet.
      if (img.naturalWidth < 32) { resolve(skinSrc); return; }
      const c = document.createElement('canvas');
      c.width = out; c.height = out;
      const ctx = c.getContext('2d');
      if (!ctx) { resolve(skinSrc); return; }
      ctx.imageSmoothingEnabled = false;
      const s = out / 8;
      // base face at (8,8)
      ctx.drawImage(img, 8, 8, 8, 8, 0, 0, out, out);
      // hat overlay at (40,8), drawn on top
      ctx.drawImage(img, 40, 8, 8, 8, 0, 0, out, out);
      void s;
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = skinSrc;
  });
}

export default function PixelAvatar({
  username, uuid, size = 128, skinUrl, onClick, onRefresh, onImportSkin, onImportCape, onRemoveCape, hasCape, onSwitchType, isLoggedIn = false,
}: PixelAvatarProps) {
  const isAlex = username ? hashCode(username) % 2 === 1 : false;
  const localDefault = isAlex ? ALEX_FACE_SVG(128) : STEVE_FACE_SVG(128);
  const [currentSrc, setCurrentSrc] = useState(localDefault);
  const [triedRemote, setTriedRemote] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [imgKey, setImgKey] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const capeRef = useRef<HTMLInputElement>(null);

  // Resolve the avatar source: skin sheet -> cropped face; real UUID -> mc-heads; else local default
  useEffect(() => {
    let alive = true;
    if (skinUrl) {
      // data: or imported/local skin sheet -> crop the face
      cropFace(skinUrl)
        .then((face) => { if (alive) { setCurrentSrc(face); setTriedRemote(false); } })
        .catch(() => { if (alive) { setCurrentSrc(localDefault); setTriedRemote(true); } });
      return () => { alive = false; };
    }
    if (uuid && uuid.length >= 32) {
      setCurrentSrc(`https://mc-heads.net/avatar/${uuid}/128`);
      setTriedRemote(false);
      return;
    }
    setCurrentSrc(localDefault);
    setTriedRemote(true);
  }, [skinUrl, uuid, localDefault]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    if (menuOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const handleImgError = () => {
    if (!triedRemote) {
      setCurrentSrc(localDefault);
      setTriedRemote(true);
    }
  };

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (isLoggedIn) setMenuOpen(true);
  }, [isLoggedIn]);

  const handleRefresh = () => {
    setImgKey((k) => k + 1);
    setTriedRemote(false);
    if (skinUrl) {
      cropFace(skinUrl).then(setCurrentSrc).catch(() => setCurrentSrc(localDefault));
    } else if (uuid && uuid.length >= 32) {
      setCurrentSrc(`https://mc-heads.net/avatar/${uuid}/128?t=${Date.now()}`);
    } else {
      setCurrentSrc(localDefault);
    }
    onRefresh?.();
    setMenuOpen(false);
  };

  const handleImport = () => {
    fileRef.current?.click();
    setMenuOpen(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => onImportSkin?.(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleImportCape = () => {
    capeRef.current?.click();
    setMenuOpen(false);
  };

  const handleCapeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => onImportCape?.(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="relative inline-block" ref={menuRef}>
      <div
        className={`relative ${onClick ? 'cursor-pointer' : ''}`}
        onClick={onClick}
        onContextMenu={handleContextMenu}
      >
        <img
          key={imgKey}
          src={currentSrc}
          alt=""
          width={size}
          height={size}
          className="rounded-lg"
          style={{ imageRendering: 'pixelated', width: size, height: size }}
          onError={handleImgError}
          referrerPolicy="no-referrer"
          draggable={false}
        />
      </div>

      <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleFileChange} />
      <input ref={capeRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleCapeChange} />

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: -5 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -5 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 bg-popover border border-border rounded-xl shadow-xl py-1.5 min-w-[160px]"
            onContextMenu={(e) => e.preventDefault()}
          >
            <button onClick={handleRefresh} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm hover:bg-accent transition-colors">
              <RefreshCw className="size-4 text-muted-foreground" />刷新头像
            </button>
            <button onClick={handleImport} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm hover:bg-accent transition-colors">
              <Upload className="size-4 text-muted-foreground" />导入皮肤贴图
            </button>
            {onImportCape && (
              <button onClick={handleImportCape} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm hover:bg-accent transition-colors">
                <Layers className="size-4 text-muted-foreground" />导入披风
              </button>
            )}
            {onImportCape && hasCape && onRemoveCape && (
              <button onClick={() => { onRemoveCape(); setMenuOpen(false); }} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm hover:bg-accent transition-colors text-destructive">
                <Layers className="size-4" />移除披风
              </button>
            )}
            {onSwitchType && (
              <>
                <div className="h-px bg-border my-1" />
                <button onClick={() => { onSwitchType('microsoft'); setMenuOpen(false); }} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm hover:bg-accent transition-colors">
                  <ShieldCheck className="size-4 text-green-500" />切换正版
                </button>
                <button onClick={() => { onSwitchType('offline'); setMenuOpen(false); }} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm hover:bg-accent transition-colors">
                  <Link2Off className="size-4 text-amber-500" />切换离线
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
