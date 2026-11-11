import { useState } from 'react';
import {NetworkIcon} from '@web3icons/react/dynamic';
import { TokenUSDC, TokenEURC, TokenETH, TokenWBTC, TokenUSDT, TokenDAI,
 NetworkEthereum, NetworkBase, NetworkArbitrumOne, NetworkOptimism, NetworkAvalanche, NetworkPolygon } from '@web3icons/react';

const TOKEN_MARKS = {
  usdc: TokenUSDC, eurc: TokenEURC, eth: TokenETH, wbtc: TokenWBTC,
  usdt: TokenUSDT, dai: TokenDAI,
} as const;

const OFFICIAL_LOGOS: Partial<Record<string, string>> = {
  cirbtc: 'https://cdn.prod.website-files.com/67116d0daddc92483c812e88/6a3a95fde4bc6ee48d1ff749_cirbtc-pressroom.svg',
};

function ArcMark({size}:{size:number}) {
  return <svg width={size} height={size} viewBox="0 0 400 400" role="img" aria-label="Arc network">
    <defs><linearGradient id="veyra-arc-silver" x1="0" y1="0" x2=".85" y2="1"><stop stopColor="#fff"/><stop offset=".55" stopColor="#d8e1eb"/><stop offset="1" stopColor="#8a9db0"/></linearGradient></defs>
    <circle cx="200" cy="200" r="200" fill="#092541"/>
    <path d="M73 333 C77 193 116 67 199 67 C282 67 320 183 327 333 C290 302 233 292 177 299 L183 252 C216 251 246 255 273 261 C258 169 231 114 199 114 C160 114 125 194 120 333 Z" fill="url(#veyra-arc-silver)"/>
  </svg>;
}

const NETWORK_MARKS = {
 ethereum:NetworkEthereum,base:NetworkBase,arbitrum:NetworkArbitrumOne,
 optimism:NetworkOptimism,avalanche:NetworkAvalanche,polygon:NetworkPolygon,
} as const;

/** Exact Web3Icons registry keys, not generated URLs. A visible local
 * network-specific fallback remains if an icon package/asset cannot load.
 * https://github.com/0xa3k5/web3icons/blob/main/docs/icons.md
 */
export const VIRTUAL_NETWORK_ICON_IDS:Readonly<Record<string,string>>={
 unichain:'unichain',linea:'linea',sonic:'sonic',monad:'monad',
 sei:'sei-network',ink:'ink',world:'world-chain',hyperevm:'hyper-evm',
 plume:'plume',codex:'codex',xdc:'xdc',solana:'solana',
} as const;
const VIRTUAL_ICON_STYLE:Readonly<Record<string,{background:string;label:string}>>={
 unichain:{background:'#f64f28',label:'U'},
 linea:{background:'#151f30',label:'L'},
 sonic:{background:'#f97328',label:'S'},
 monad:{background:'#8767dc',label:'M'},
 sei:{background:'#cb2f4e',label:'SEI'},
 ink:{background:'#181818',label:'INK'},
 world:{background:'#202020',label:'W'},
 hyperevm:{background:'#122521',label:'HYPE'},
 plume:{background:'#d35d32',label:'P'},
 codex:{background:'#2b3847',label:'CX'},
 xdc:{background:'#16609f',label:'XDC'},
 solana:{background:'#191722',label:'SOL'},
};
interface BrandLogoProps {
  logoKey: string;
  size?: number;
  className?: string;
}

export function BrandLogo({ logoKey, size = 36, className = '' }: BrandLogoProps) {
  const [failedForKey, setFailedForKey] = useState<string | null>(null);
  const official = OFFICIAL_LOGOS[logoKey];
  if(logoKey==='arc') return <span className={`inline-flex shrink-0 overflow-hidden rounded-full ${className}`} style={{width:size,height:size}}><ArcMark size={size}/></span>;
  // Do not reuse image failure state when a recycled component changes token.
  if (official && failedForKey !== logoKey) {
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
          onError={() => setFailedForKey(logoKey)}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      </span>
    );
  }

  const networkIcon=VIRTUAL_NETWORK_ICON_IDS[logoKey];
  if(networkIcon){
    const fallback=VIRTUAL_ICON_STYLE[logoKey]??{background:'#24364f',label:logoKey.slice(0,2).toUpperCase()};
    return <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`}
      style={{width:size,height:size,background:fallback.background}} role="img" aria-label={logoKey+' network'}>
      <NetworkIcon network={networkIcon} size={size} variant="branded"
       fallback={<CircleText size={size} background={fallback.background} text={fallback.label}
        color="#fff" fontSize={Math.max(9,Math.round(size*(fallback.label.length>2?0.21:0.36)))}/>}/>
    </span>;
  }

  const TokenMark = TOKEN_MARKS[logoKey as keyof typeof TOKEN_MARKS];
  if (TokenMark) return (
    <span className={`inline-flex items-center justify-center overflow-hidden rounded-full shrink-0 ${className}`}
      style={{width:size,height:size}} role="img" aria-label={logoKey.toUpperCase()}>
      <TokenMark variant="branded" size={size} aria-hidden="true"/>
    </span>
  );
  const NetworkMark=NETWORK_MARKS[logoKey as keyof typeof NETWORK_MARKS];
  if(NetworkMark) return <span className={`inline-flex items-center justify-center overflow-hidden rounded-full shrink-0 ${className}`}
    style={{width:size,height:size}}><NetworkMark variant="branded" size={size} aria-label={logoKey}/></span>;
  return <span className={`inline-flex items-center justify-center overflow-hidden rounded-full shrink-0 ${className}`}
    style={{width:size,height:size}} aria-hidden="true"><FallbackMark logoKey={logoKey} size={size}/></span>;
}

function FallbackMark({ logoKey, size }: { logoKey: string; size: number }) {
  const fontSize = Math.max(9, Math.round(size * 0.28));
  switch (logoKey) {
    case 'weth':
      // The pinned icon catalog has no distinct WETH component. Label it
      // honestly instead of rendering ETH as if it were the wrapped token.
      return <CircleText size={size} background="#3A5176" text="WETH" color="white" fontSize={Math.max(8, Math.round(size * 0.2))} />;
    case 'ethereum':
    case 'eth':
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
      // Neutral label until a verified asset-specific icon is available;
      // never fabricate an official trademark.
      return <CircleText size={size} background="#304158" text="USYC" color="white" fontSize={Math.max(8, Math.round(size*0.2))} />;
    case 'arc': return <ArcMark size={size}/>;
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
