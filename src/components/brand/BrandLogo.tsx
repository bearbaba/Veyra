import { useState } from 'react';

const OFFICIAL_LOGOS: Partial<Record<string, string>> = {
  arc: 'https://cdn.prod.website-files.com/67116d0daddc92483c812e88/69dd3db99cf1d8ec9699856a_logo%20%285%29.avif',
  usdc: 'https://cdn.prod.website-files.com/67116d0daddc92483c812e88/69dd3dbaa10d052f7061dc70_logo%20%282%29.avif',
  eurc: 'https://cdn.prod.website-files.com/67116d0daddc92483c812e88/69dd3dba50e99a6dea4a964f_logo%20%283%29.avif',
  cirbtc: 'https://cdn.prod.website-files.com/67116d0daddc92483c812e88/6a3a95fde4bc6ee48d1ff749_cirbtc-pressroom.svg',
};

interface BrandLogoProps {
  logoKey: string;
  size?: number;
  className?: string;
}

export function BrandLogo({ logoKey, size = 36, className = '' }: BrandLogoProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const official = OFFICIAL_LOGOS[logoKey];
  if (official && !imageFailed) {
    return (
      <span
        className={`inline-flex items-center justify-center overflow-hidden rounded-full shrink-0 ${className}`}
        style={{ width: size, height: size, background: 'rgba(255,255,255,0.96)' }}
      >
        <img
          src={official}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-contain"
          onError={() => setImageFailed(true)}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center overflow-hidden rounded-full shrink-0 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <FallbackMark logoKey={logoKey} size={size} />
    </span>
  );
}

function FallbackMark({ logoKey, size }: { logoKey: string; size: number }) {
  const fontSize = Math.max(9, Math.round(size * 0.28));
  switch (logoKey) {
    case 'ethereum':
    case 'eth':
    case 'weth':
      return (
        <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="Ethereum">
          <circle cx="20" cy="20" r="20" fill="#eef0ff" />
          <path d="M20 5.6 11.4 20 20 25.1 28.6 20 20 5.6Z" fill="#627EEA" />
          <path d="M20 26.8 11.4 21.8 20 34.4 28.6 21.8 20 26.8Z" fill="#465BC4" />
        </svg>
      );
    case 'base':
      return (
        <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="Base">
          <circle cx="20" cy="20" r="20" fill="#0052FF" />
          <path d="M10 20h20" stroke="white" strokeWidth="5.2" strokeLinecap="round" />
        </svg>
      );
    case 'arbitrum':
      return (
        <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="Arbitrum">
          <path d="M20 2.5 35.2 11v18L20 37.5 4.8 29V11L20 2.5Z" fill="#213147" />
          <path d="m14 29 5.6-18h4.2L18.2 29H14Z" fill="#28A0F0" />
          <path d="m21 29 5.1-16.3 3.1 1.7L24.7 29H21Z" fill="#9DCCED" />
        </svg>
      );
    case 'optimism':
      return <CircleText size={size} background="#FF0420" text="OP" color="white" fontSize={fontSize} />;
    case 'avalanche':
      return <CircleText size={size} background="#E84142" text="A" color="white" fontSize={fontSize + 2} />;
    case 'polygon':
      return <CircleText size={size} background="#8247E5" text="⬡" color="white" fontSize={fontSize + 4} />;
    case 'wbtc':
      return <CircleText size={size} background="#F7931A" text="₿" color="white" fontSize={fontSize + 4} />;
    case 'usdt':
      return <CircleText size={size} background="#26A17B" text="₮" color="white" fontSize={fontSize + 4} />;
    case 'dai':
      return <CircleText size={size} background="#F5AC37" text="D" color="white" fontSize={fontSize + 2} />;
    case 'usyc':
      return <CircleText size={size} background="#1B73E8" text="Y" color="white" fontSize={fontSize + 2} />;
    case 'arc':
      return (
        <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="Arc">
          <defs><linearGradient id="arcg" x1="6" y1="33" x2="34" y2="7"><stop stopColor="#8B5CF6" /><stop offset="1" stopColor="#F43F5E" /></linearGradient></defs>
          <circle cx="20" cy="20" r="20" fill="#11162A" />
          <path d="M9 27.5a11 11 0 0 1 22 0" fill="none" stroke="url(#arcg)" strokeWidth="5" strokeLinecap="round" />
        </svg>
      );
    default:
      return <CircleText size={size} background="#24364f" text={logoKey.slice(0, 2).toUpperCase()} color="#dce9fa" fontSize={fontSize} />;
  }
}

function CircleText({ size, background, text, color, fontSize }: { size: number; background: string; text: string; color: string; fontSize: number }) {
  return (
    <span
      className="inline-flex h-full w-full items-center justify-center rounded-full font-bold"
      style={{ background, color, fontSize, letterSpacing: '-0.03em' }}
    >
      {text}
    </span>
  );
}
