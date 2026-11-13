/**
 * Circle's publicly listed USDC Bridge destination/source networks (2026-11-11).
 * Sources:
 * https://bridge.usdc.com/
 * https://help.circle.com/support/en/get-started-with-the-usdc-bridge
 * https://developers.circle.com/cctp/references/supported-blockchains
 *
 * A listed network is NOT an accepted Veyra route. All real-money eligibility
 * continues to come exclusively from reviewedExchangeRoutes / wallet gates.
 *
 * Circle CCTP domain IDs are not EVM chain IDs. Solana requires SVM signing.
 */
export type BridgeNetworkDirectoryEntry={
 id:string;name:string;circleDomain:number;
 chainId:number|null;vm:'evm'|'svm';logo:string;
};
export const CIRCLE_USDC_BRIDGE_NETWORKS:readonly BridgeNetworkDirectoryEntry[]=[
 {id:'arc',name:'Arc',circleDomain:26,chainId:5042,vm:'evm',logo:'arc'},
 {id:'base',name:'Base',circleDomain:6,chainId:8453,vm:'evm',logo:'base'},
 {id:'arbitrum',name:'Arbitrum One',circleDomain:3,chainId:42161,vm:'evm',logo:'arbitrum'},
 {id:'optimism',name:'OP Mainnet',circleDomain:2,chainId:10,vm:'evm',logo:'optimism'},
 {id:'polygon',name:'Polygon PoS',circleDomain:7,chainId:137,vm:'evm',logo:'polygon'},
 {id:'ethereum',name:'Ethereum',circleDomain:0,chainId:1,vm:'evm',logo:'ethereum'},
 {id:'avalanche',name:'Avalanche C-Chain',circleDomain:1,chainId:43114,vm:'evm',logo:'avalanche'},
 {id:'unichain',name:'Unichain',circleDomain:10,chainId:130,vm:'evm',logo:'unichain'},
 {id:'linea',name:'Linea',circleDomain:11,chainId:59144,vm:'evm',logo:'linea'},
 {id:'sonic',name:'Sonic',circleDomain:13,chainId:146,vm:'evm',logo:'sonic'},
 {id:'monad',name:'Monad',circleDomain:15,chainId:143,vm:'evm',logo:'monad'},
 {id:'sei',name:'Sei',circleDomain:16,chainId:1329,vm:'evm',logo:'sei'},
 {id:'ink',name:'Ink',circleDomain:21,chainId:57073,vm:'evm',logo:'ink'},
 {id:'world',name:'World Chain',circleDomain:14,chainId:480,vm:'evm',logo:'world'},
 {id:'hyperevm',name:'HyperEVM',circleDomain:19,chainId:999,vm:'evm',logo:'hyperevm'},
 {id:'plume',name:'Plume',circleDomain:22,chainId:98866,vm:'evm',logo:'plume'},
 // Codex chain ID intentionally unbound until the production RPC, chain ID
 // and native-USDC contract are verified together.
 {id:'codex',name:'Codex',circleDomain:12,chainId:null,vm:'evm',logo:'codex'},
 {id:'xdc',name:'XDC Network',circleDomain:18,chainId:50,vm:'evm',logo:'xdc'},
 {id:'solana',name:'Solana',circleDomain:5,chainId:null,vm:'svm',logo:'solana'},
] as const;

export function listedBridgeNetwork(chainId:number){
 return CIRCLE_USDC_BRIDGE_NETWORKS.find(network=>network.chainId===chainId)??null;
}

export function validateCircleBridgeDirectory():string[]{
 const problems:string[]=[];
 const ids=new Set<string>(),domains=new Set<number>(),chainIds=new Set<number>();
 if(CIRCLE_USDC_BRIDGE_NETWORKS.length!==19)problems.push('Circle USDC Bridge directory must list 19 networks.');
 for(const network of CIRCLE_USDC_BRIDGE_NETWORKS){
  if(ids.has(network.id))problems.push('Duplicate network ID: '+network.id);
  if(domains.has(network.circleDomain))problems.push('Duplicate Circle CCTP domain: '+network.circleDomain);
  if(network.chainId!==null&&chainIds.has(network.chainId))problems.push('Duplicate EVM chain ID: '+network.chainId);
  if(network.vm==='svm'&&network.chainId!==null)problems.push('SVM network cannot use an EVM chain ID.');
  ids.add(network.id);domains.add(network.circleDomain);
  if(network.chainId!==null)chainIds.add(network.chainId);
 }
 return problems;
}
