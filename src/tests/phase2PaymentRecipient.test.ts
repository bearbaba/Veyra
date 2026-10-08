import { describe, expect, it } from 'vitest';
import { chooseRecipientWallet } from '../../server/services/paymentRecipientService';

const wallets = [
  { walletId: 'wlt_arc', walletAddress: '0x0000000000000000000000000000000000000001', chainId: 5042002 },
  { walletId: 'wlt_eth', walletAddress: '0x0000000000000000000000000000000000000002', chainId: 11155111 },
];

describe('Phase 2C payment recipient selection', () => {
  it('prefers the declared primary wallet when it matches the desired chain', () => {
    expect(chooseRecipientWallet(wallets, 5042002, { primaryWalletId: 'wlt_arc' })?.walletId).toBe('wlt_arc');
  });

  it('falls back to another verified wallet on the desired chain', () => {
    expect(chooseRecipientWallet(wallets, 11155111, { primaryWalletId: 'wlt_arc' })?.walletId).toBe('wlt_eth');
  });

  it('fails closed when no verified wallet exists on the desired chain', () => {
    expect(chooseRecipientWallet(wallets, 84532, {})).toBeNull();
  });
});
