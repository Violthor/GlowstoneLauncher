interface LogoProps {
  size?: number;
  className?: string;
}

import logoUrl from '@/assets/logo.png';

export default function Logo({ size = 36, className = '' }: LogoProps) {
  return (
    <img
      src={logoUrl}
      alt="Glowstone Launcher"
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        borderRadius: '20%',
        filter: 'drop-shadow(0 0 6px rgba(255,255,255,0.3))',
      }}
      className={className}
      draggable={false}
    />
  );
}
