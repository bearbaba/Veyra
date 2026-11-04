/**
 * User-facing route catalogue for the Arc Mainnet release.
 * Quote-capable does NOT mean a completed transaction; wallet authorization,
 * provider execution and destination receipt checks remain mandatory.
 * Do not use this catalogue as a financial signing authorization.
 */
export type MainnetRoute = 'pay'|'settlement'|'swap'|'bridge'|'gateway'|'identity';
export type RouteReadiness = 'wallet-signature'|'live-quote'|'backend-required';
export type RouteCapability = {
  title:string; network:string; readiness:RouteReadiness; summary:string;
  destination:'pay'|'settlement'|'convert'|'bridge'|'agent'|'settings'|'social';
};
export const MAINNET_ROUTES: Record<MainnetRoute,RouteCapability> = {
  pay:{title:'Settlement',network:'Arc Mainnet · 5042',readiness:'wallet-signature',
    summary:'Compatibility alias. One Settlement page contains contract payment and the controlled direct-transfer fallback.',destination:'settlement'},
  settlement:{title:'Settlement',network:'Arc Mainnet · 5042',readiness:'wallet-signature',
    summary:'Contract-first USDC settlement with verified receiving wallet, fee review and onchain receipt evidence.',destination:'settlement'},
  swap:{title:'Exchange',network:'Arc default · multi-network asset picker',readiness:'live-quote',
    summary:'Choose input and output assets. Veyra checks a provider route, minimum received and proof before completion.',destination:'convert'},
  bridge:{title:'Exchange · cross-network',network:'Arc ↔ Base USDC route',readiness:'live-quote',
    summary:'Exchange automatically chooses a supported Bridge route when source and destination networks differ.',destination:'convert'},
  gateway:{title:'Unified Gateway',network:'Provider not connected',readiness:'backend-required',
    summary:'Wallet funds are separate; Gateway available funds are not readable on Mainnet yet.',destination:'agent'},
  identity:{title:'Veyra ID / X',network:'Backend verification required',readiness:'backend-required',
    summary:'Veyra ID and linked X require verified backend authentication. Local contacts are not verified identities.',destination:'social'},
};
export function routeLabel(route:MainnetRoute){
  const state=MAINNET_ROUTES[route].readiness;
  return state==='wallet-signature'?'Wallet-confirmed':
    state==='live-quote'?'Live quote required':'Not connected';
}
