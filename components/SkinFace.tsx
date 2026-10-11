import { useEffect, useState } from 'react';

interface SkinFaceProps {
  skinUrl: string;
  size?: number;
  className?: string;
}

// Lightweight 2D front-face crop from a 64x64 skin (no WebGL context per card).
export default function SkinFace({ skinUrl, size = 72, className = '' }: SkinFaceProps) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    let alive = true;
    if (!skinUrl) return;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      if (img.naturalWidth < 32) { setSrc(skinUrl); return; }
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const ctx = c.getContext('2d');
      if (!ctx) { setSrc(skinUrl); return; }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64);
      ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 64, 64);
      setSrc(c.toDataURL('image/png'));
    };
    img.onerror = () => { if (alive) setSrc(skinUrl); };
    img.src = skinUrl;
    return () => { alive = false; };
  }, [skinUrl]);

  return (
    <img
      src={src || skinUrl}
      alt=""
      width={size}
      height={size}
      className={className}
      style={{ imageRendering: 'pixelated', width: size, height: size }}
      draggable={false}
    />
  );
}
