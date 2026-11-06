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
    summary:'Compatibility alias. Wallet and Friends share one Settlement contract payment. Previous direct-payment records remain visible in Activity.',destination:'settlement'},
  settlement:{title:'Settlement',network:'Arc Mainnet · 5042',readiness:'wallet-signature',
    summary:'Contract-first USDC settlement with verified receiving wallet, fee review and onchain receipt evidence.',destination:'settlement'},
  swap:{title:'Swap',network:'Arc USDC ↔ EURC',readiness:'live-quote',
    summary:'Live quote and review available; real signing remains paused during the M0 payment pilot.',destination:'convert'},
  bridge:{title:'Bridge',network:'Ethereum ↔ Base USDC',readiness:'live-quote',
    summary:'Ethereum/Base native USDC quote candidates; Arc Mainnet has no published CCTP V2 Mainnet domain. Signing requires independent E2E acceptance.',destination:'bridge'},
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
