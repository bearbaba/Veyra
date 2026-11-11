/**
 * Static, source-checked Circle CCTP V2 metadata. Not a real-money allow-list.
 *
 * Checked against:
 * https://developers.circle.com/stablecoins/usdc-contract-addresses
 * https://developers.circle.com/cctp/concepts/supported-chains-and-domains
 * https://developers.circle.com/cctp/references/contract-addresses
 * 2026-11-11
 *
 * IMPORTANT: Circle's published domain table calls 26 "Arc testnet" and
 * does not explicitly list Arc Mainnet. Circle's newer npm App Kit advertises
 * Arc Mainnet. Treat this as a documentation discrepancy until resolved by
 * provider verification; Veyra's independent prior acceptance is not a
 * promise that all Arc routes are supported.
 */
import {CIRCLE_USDC_BRIDGE_NETWORKS} from './circleBridgeNetworkDirectory';
import {CIRCLE_CCTP_MAINNET} from './circleBridgePolicy';
import {getMainnetChain} from '@/config/mainnetCatalog';

export type CircleChainEvidence={
 id:string;usdcNative:string;
 /** "documented" means only that Circle lists the domain on its mainnet
  * CCTP V2 contract page; not that a Veyra route passed live QA.
  */
 cctpV2Mainnet:'documented'|'provider-discrepancy';
};
export const CIRCLE_CHAIN_EVIDENCE:readonly CircleChainEvidence[]=[
 {id:'arc',usdcNative:'0x3600000000000000000000000000000000000000',cctpV2Mainnet:'provider-discrepancy'},
 {id:'base',usdcNative:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',cctpV2Mainnet:'documented'},
 {id:'arbitrum',usdcNative:'0xaf88d065e77c8cC2239327C5EDb3A432268e5831',cctpV2Mainnet:'documented'},
 {id:'optimism',usdcNative:'0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',cctpV2Mainnet:'documented'},
 {id:'polygon',usdcNative:'0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',cctpV2Mainnet:'documented'},
 {id:'ethereum',usdcNative:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',cctpV2Mainnet:'documented'},
 {id:'avalanche',usdcNative:'0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',cctpV2Mainnet:'documented'},
 {id:'unichain',usdcNative:'0x078D782b760474a361dDA0AF3839290b0EF57AD6',cctpV2Mainnet:'documented'},
 {id:'linea',usdcNative:'0x176211869cA2b568f2A7D4EE941E073a821EE1ff',cctpV2Mainnet:'documented'},
 {id:'sonic',usdcNative:'0x29219dd400f2Bf60E5a23d13Be72B486D4038894',cctpV2Mainnet:'documented'},
 {id:'monad',usdcNative:'0x754704Bc059F8C67012fEd69BC8A327a5aafb603',cctpV2Mainnet:'documented'},
 {id:'sei',usdcNative:'0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392',cctpV2Mainnet:'documented'},
 {id:'ink',usdcNative:'0x2D270e6886d130D724215A266106e6832161EAEd',cctpV2Mainnet:'documented'},
 {id:'world',usdcNative:'0x79A02482A880bCe3F13E09da970dC34dB4cD24D1',cctpV2Mainnet:'documented'},
 {id:'hyperevm',usdcNative:'0xb88339CB7199b77E23DB6E890353E22632Ba630f',cctpV2Mainnet:'documented'},
 {id:'plume',usdcNative:'0x222365EF19F7947e5484218551B56bb3965Aa7aF',cctpV2Mainnet:'documented'},
 {id:'codex',usdcNative:'0xd996633a415985DBd7D6D12f4A4343E31f5037cf',cctpV2Mainnet:'documented'},
 {id:'xdc',usdcNative:'0xfA2958CB79b0491CC627c1557F441eF849Ca8eb1',cctpV2Mainnet:'documented'},
 {id:'solana',usdcNative:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',cctpV2Mainnet:'documented'},
] as const;

export type BatchBridgeNetworkStatus={
 id:string;name:string;circleDomain:number;
 referenceChecked:boolean;
 providerDocs:'published-cctp-v2-mainnet'|'documentation-discrepancy';
 veyraQuoteIntegrated:boolean;
 // Even an integrated route is NOT an accepted or verified real-money transfer.
 requiresWalletQuoteAndLiveSettlementAcceptance:true;
};

export function bridgeBatchStatus():BatchBridgeNetworkStatus[]{
 const published=new Map(CIRCLE_CHAIN_EVIDENCE.map(x=>[x.id,x]));
 const veyraIntegrated=new Set<number>(CIRCLE_CCTP_MAINNET.map(x=>x.chainId));
 return CIRCLE_USDC_BRIDGE_NETWORKS.map(chain=>{
  const evidence=published.get(chain.id);
  const sourceChain=chain.chainId===null?undefined:getMainnetChain(chain.chainId);
  const verified=!!evidence&&(
   chain.vm==='svm'||
   !sourceChain||
   sourceChain.usdc.toLowerCase()===evidence.usdcNative.toLowerCase());
  return {
   id:chain.id,name:chain.name,circleDomain:chain.circleDomain,
   referenceChecked:verified,
   providerDocs:evidence?.cctpV2Mainnet==='documented'?
    'published-cctp-v2-mainnet':'documentation-discrepancy',
   veyraQuoteIntegrated:chain.chainId!==null&&veyraIntegrated.has(chain.chainId),
   requiresWalletQuoteAndLiveSettlementAcceptance:true,
  };
 });
}

export function validateBridgeBatchReferences():string[]{
 const problems:string[]=[];
 const directoryIds=new Set(CIRCLE_USDC_BRIDGE_NETWORKS.map(x=>x.id));
 const ids=new Set<string>();
 for(const entry of CIRCLE_CHAIN_EVIDENCE){
  if(ids.has(entry.id)||!directoryIds.has(entry.id))
   problems.push('Unknown or duplicate Circle network: '+entry.id);
  ids.add(entry.id);
  const chain=CIRCLE_USDC_BRIDGE_NETWORKS.find(x=>x.id===entry.id);
  if(!chain)continue;
  if(chain.vm==='evm'&&!/^0x[0-9a-fA-F]{40}$/.test(entry.usdcNative))
   problems.push('Invalid EVM native USDC: '+entry.id);
  if(chain.vm==='svm'&&!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(entry.usdcNative))
   problems.push('Invalid SVM native USDC: '+entry.id);
  if(chain.id==='arc'&&entry.cctpV2Mainnet!=='provider-discrepancy')
   problems.push('Arc Mainnet must not be represented as officially listed by Circle CCTP V2 docs.');
  if(chain.id!=='arc'&&entry.cctpV2Mainnet!=='documented')
   problems.push('Missing CCTP V2 documentation confirmation: '+entry.id);
  const existing=chain.chainId===null?undefined:getMainnetChain(chain.chainId);
  if(existing&&existing.usdc.toLowerCase()!==entry.usdcNative.toLowerCase())
   problems.push('Circle native-USDC contract conflicts with Veyra mainnet catalog: '+entry.id);
 }
 for(const chain of CIRCLE_USDC_BRIDGE_NETWORKS){
  if(!ids.has(chain.id))problems.push('Missing network evidence: '+chain.id);
 }
 return problems;
}
