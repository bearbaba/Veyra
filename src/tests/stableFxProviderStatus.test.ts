import { describe, expect, it } from 'vitest';
import { isStableFxProviderTradeComplete, type StableFxTradeStatus } from '../providers/stablefx/stableFxAdapter';

const trade=(status:StableFxTradeStatus['status']):StableFxTradeStatus=>({
  id:'c2558cd1-98b5-4ccd-90b8-96891512af20',
  contractTradeId:'24',status,
  from:{currency:'USDC',amount:'1.00'},to:{currency:'EURC',amount:'0.91'},
});
describe('StableFX provider lifecycle — not a verified on-chain receipt',()=>{
  it('accepts Circle taker completed and legacy complete as provider terminal only',()=>{
    expect(isStableFxProviderTradeComplete(trade('completed'))).toBe(true);
    expect(isStableFxProviderTradeComplete(trade('complete'))).toBe(true);
  });
  it('does not treat funding, creation or failed trades as settlement success',()=>{
    for(const s of ['pending_settlement','taker_funded','failed'] as const)
      expect(isStableFxProviderTradeComplete(trade(s))).toBe(false);
  });
});