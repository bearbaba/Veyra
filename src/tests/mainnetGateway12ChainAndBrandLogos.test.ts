import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {CIRCLE_USDC_BRIDGE_NETWORKS} from '../mainnet/circleBridgeNetworkDirectory';
import {GATEWAY_MAINNET_CHAINS,GATEWAY_MAINNET_LEDGER_CHAINS,
 parseGatewayMainnetBalance,verifiedGatewaySigningBalance} from '../mainnet/gatewayMainnetBalances';
import {chooseGatewaySource} from '../components/pages/MainnetUnifiedBalancePanel';
import {planGatewayMultiSource} from '../mainnet/gatewayMultiSourceAllocation';

const owner='0x1111111111111111111111111111111111111111';
const source=(f:string)=>readFileSync(new URL('../'+f,import.meta.url),'utf8');

describe('Circle Gateway EVM ledger completeness and independent signing scope',()=>{
 it('has 12 unique supported EVM domains and excludes non-EVM Solana from EVM owner reads',()=>{
  expect(GATEWAY_MAINNET_LEDGER_CHAINS).toHaveLength(12);
  expect(new Set(GATEWAY_MAINNET_LEDGER_CHAINS.map(x=>x.domain)).size).toBe(12);
  expect(GATEWAY_MAINNET_LEDGER_CHAINS.find(x=>x.chain==='World_Chain')?.chainId).toBe(480);
  expect(GATEWAY_MAINNET_LEDGER_CHAINS.find(x=>x.chain==='HyperEVM')?.domain).toBe(19);
  expect(GATEWAY_MAINNET_LEDGER_CHAINS.some(x=>x.chain==='Solana')).toBe(false);
  expect(GATEWAY_MAINNET_CHAINS.map(x=>x.chain)).toEqual(['Arc','Ethereum','Base']);
 });
 it('reads confirmed extra-chain Gateway credit, while spend-ready excludes unintegrated source funds',()=>{
  const balance=parseGatewayMainnetBalance({
   token:'USDC',totalConfirmedBalance:'1.500001',totalPendingBalance:'0.4',
   breakdown:[{depositor:owner,totalConfirmed:'1.500001',breakdown:[
    {chain:'Base',confirmedBalance:'0.2'},
    {chain:'Arbitrum',confirmedBalance:'1.300001'},
   ]}],
  },owner);
  expect(balance.available).toBe(1_500_001n);
  expect(balance.pending).toBe(400_000n);
  expect(balance.chains).toHaveLength(12);
  expect(balance.chains.find(x=>x.chain==='Arbitrum')?.available).toBe(1_300_001n);
  expect(verifiedGatewaySigningBalance(balance)).toBe(200_000n);
  expect(chooseGatewaySource(balance,'0.21')).toBeNull();
  expect(()=>planGatewayMultiSource(balance,'0.21')).toThrow();
  expect(chooseGatewaySource(balance,'0.1')).toBe(8453);
  expect(planGatewayMultiSource(balance,'0.1')).toEqual([{chainId:8453,chain:'Base',amount:'0.1'}]);
 });
 it('rejects unknown, duplicated or mislabeled chain entries without treating them as zero',()=>{
  const full={token:'USDC',totalConfirmedBalance:'1',breakdown:[{depositor:owner,
   totalConfirmed:'1',breakdown:[{chain:'Arbitrum',confirmedBalance:'1'}]}]};
  expect(parseGatewayMainnetBalance(full,owner).available).toBe(1_000_000n);
  expect(()=>parseGatewayMainnetBalance({...full,breakdown:[{...full.breakdown[0],
   breakdown:[{chain:'OtherNetwork',confirmedBalance:'1'}]}]},owner)).toThrow();
  expect(()=>parseGatewayMainnetBalance({...full,breakdown:[{...full.breakdown[0],
   breakdown:[{chain:'Arbitrum',confirmedBalance:'0.5'},{chain:'Arbitrum',confirmedBalance:'0.5'}]}]},owner)).toThrow();
 });
 it('renders icons for all Circle Bridge listed networks without unsupported blank network selectors',()=>{
  const src=source('components/brand/BrandLogo.tsx');
  const existing=['arc','ethereum','base','arbitrum','optimism','avalanche','polygon'];
  for(const network of CIRCLE_USDC_BRIDGE_NETWORKS){
   if(!existing.includes(network.logo))expect(src).toContain(network.logo+":");
  }
  expect(src).toContain("from '@web3icons/react/dynamic'");
  expect(src).toContain('fallback={<CircleText');
  const unified=source('components/pages/MainnetUnifiedBalancePanel.tsx');
  expect(unified).toContain('GATEWAY_MAINNET_LEDGER_CHAINS.find');
  expect(unified).toContain('verifiedGatewaySigningBalance(current)');
  expect(unified).toContain('Solana requires a separate SVM wallet');
 });
});
