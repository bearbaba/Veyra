import { describe, expect, it } from 'vitest';
import { formatRemoteActivityAmount } from '../core/receipt/formatRemoteActivityAmount';

describe('human-readable remote Activity amounts (display only)', () => {
  it('formats 6-decimal USDC precisely without floating point rounding', () => {
    expect(formatRemoteActivityAmount({amountRaw:'1000000',amountDecimals:6,assetId:'USDC'}))
      .toBe('1 USDC');
    expect(formatRemoteActivityAmount({amountRaw:'1',amountDecimals:6,assetId:'usdc'}))
      .toBe('0.000001 USDC');
    expect(formatRemoteActivityAmount({amountRaw:'123456789',amountDecimals:6,assetId:'USDC'}))
      .toBe('123.456789 USDC');
    expect(formatRemoteActivityAmount({amountRaw:'1000000000000000000000000',amountDecimals:6,assetId:'USDC'}))
      .toBe('1000000000000000000 USDC');
  });
  it('does not mislabel an unknown asset as USDC', () => {
    expect(formatRemoteActivityAmount({amountRaw:'1234',amountDecimals:2,assetId:'EURC'}))
      .toBe('12.34 EURC');
    expect(formatRemoteActivityAmount({amountRaw:'1',amountDecimals:0,assetId:'token-1'}))
      .toBe('1 token-1');
  });
  it('never crashes or fabricates an amount for malformed backend data', () => {
    const cases = [
      {amountRaw:'1.0',amountDecimals:6,assetId:'USDC'},
      {amountRaw:'1e6',amountDecimals:6,assetId:'USDC'},
      {amountRaw:'-1',amountDecimals:6,assetId:'USDC'},
      {amountRaw:'',amountDecimals:6,assetId:'USDC'},
      {amountRaw:'01',amountDecimals:6,assetId:'USDC'},
      {amountRaw:'1',amountDecimals:-1,assetId:'USDC'},
      {amountRaw:'1',amountDecimals:19,assetId:'USDC'},
      {amountRaw:'1',amountDecimals:6.3,assetId:'USDC'},
      {amountRaw:'1',amountDecimals:6,assetId:'<script>'},
      {amountRaw:'1'.repeat(81),amountDecimals:6,assetId:'USDC'},
    ];
    for (const record of cases) expect(formatRemoteActivityAmount(record)).toBe('Amount unavailable');
  });
});
