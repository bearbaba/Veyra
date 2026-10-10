import { describe, expect, it } from 'vitest';
import { quoteVeyraFee } from '../core/fees/feeEngine';

const TREASURY = '0x1111111111111111111111111111111111111111';

describe('Phase 4B fee engine', () => {
  it('keeps Pay free', () => {
    const fee = quoteVeyraFee({
      capability: 'PAY',
      providerId: 'arc-erc20-transfer',
      environment: 'testnet',
      treasuryAddress: TREASURY,
    });
    expect(fee.percentageBps).toBe(0);
    expect(fee.veyraAddedSignatures).toBe(0);
  });

  it('collects 10 bps only on verified embedded App Kit swap fee path', () => {
    const fee = quoteVeyraFee({
      capability: 'SWAP',
      providerId: 'circle-appkit-swap',
      environment: 'testnet',
      treasuryAddress: TREASURY,
    });
    expect(fee.status).toBe('COLLECTIBLE');
    expect(fee.percentageBps).toBe(10);
    expect(fee.treasuryAddress).toBe(TREASURY);
    expect(fee.veyraAddedSignatures).toBe(0);
  });

  it('disables collection when Treasury is missing', () => {
    const fee = quoteVeyraFee({
      capability: 'SWAP',
      providerId: 'circle-appkit-swap',
      environment: 'testnet',
      treasuryAddress: null,
    });
    expect(fee.percentageBps).toBe(0);
    expect(fee.status).toBe('TREASURY_NOT_CONFIGURED');
  });

  it('keeps bridge fee at zero until embedded support is verified', () => {
    const fee = quoteVeyraFee({
      capability: 'BRIDGE',
      providerId: 'cctp-v2-bridge',
      environment: 'testnet',
      treasuryAddress: TREASURY,
    });
    expect(fee.percentageBps).toBe(0);
    expect(fee.veyraAddedSignatures).toBe(0);
  });
});
