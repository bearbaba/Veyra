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
  destination:'pay'|'settlement'|'convert'|'bridge'|'agent'|'settings';
};
export const MAINNET_ROUTES: Record<MainnetRoute,RouteCapability> = {
  pay:{title:'Send USDC',network:'Arc Mainnet · 5042',readiness:'wallet-signature',
    summary:'Direct wallet payment. Review and approve each transfer in your wallet.',destination:'pay'},
  settlement:{title:'Contract payment',network:'Arc Mainnet · 5042',readiness:'wallet-signature',
    summary:'VeyraSettlement.pay with onchain receipt and USDC transfer checks.',destination:'settlement'},
  swap:{title:'Swap',network:'Arc Mainnet · 5042',readiness:'live-quote',
    summary:'USDC ↔ EURC. Execution depends on a valid live Circle quote.',destination:'convert'},
  bridge:{title:'Bridge',network:'Arc ↔ Base Mainnet',readiness:'live-quote',
    summary:'Circle CCTP. Complete only after destination USDC is verified.',destination:'bridge'},
  gateway:{title:'Unified Gateway',network:'Provider not connected',readiness:'backend-required',
    summary:'Wallet funds are separate; Gateway available funds are not readable on Mainnet yet.',destination:'agent'},
  identity:{title:'Veyra ID / X',network:'Backend verification required',readiness:'backend-required',
    summary:'Wallet connection is not an authenticated Veyra ID or linked X account.',destination:'settings'},
};
export function routeLabel(route:MainnetRoute){
  const state=MAINNET_ROUTES[route].readiness;
  return state==='wallet-signature'?'Wallet-confirmed':
    state==='live-quote'?'Live quote required':'Not connected';
}
