import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { chooseRecipientWallet } from '../../server/services/paymentRecipientService';
import {
  displayVeyraHandle, parseRecipientHandle, VeyraIdLookupError,
} from '../../server/services/veyraIdNamespace';

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('Veyra ID canonical public namespace', () => {
  it('displays the friendly alias while preserving the existing bare database key', () => {
    expect(displayVeyraHandle('bearcrypto')).toBe('@bearcrypto.veyra');
    expect(displayVeyraHandle('BEAR_CRYPTO')).toBe('@bear_crypto.veyra');
    expect(parseRecipientHandle('@BeAr_Crypto.VEYRA')).toEqual({
      handle: 'bear_crypto', explicitVeyraId: true,
    });
    expect(parseRecipientHandle('bearcrypto.veyra')).toEqual({
      handle: 'bearcrypto', explicitVeyraId: true,
    });
  });

  it('preserves bare historical handles and contact nicknames as legacy input only', () => {
    expect(parseRecipientHandle('@BearCrypto')).toEqual({
      handle: 'BearCrypto', explicitVeyraId: false,
    });
    expect(parseRecipientHandle('My Friend')).toEqual({
      handle: 'My Friend', explicitVeyraId: false,
    });
  });

  it('rejects lookalike, malformed, embedded and spoofed .veyra namespaces', () => {
    const invalid = [
      '@ab.veyra', '@_alice.veyra', '@alice_.veyra',
      '@alice__bob.veyra', '@alice.bob.veyra', '@alice.veyra.evil',
      '@alice.veyra@example.com', '@аlice.veyra',
      '@alice.veyra.veyra', '@alice.veyra/', '@.veyra',
      '@alice🙃.veyra', '@' + 'a'.repeat(31) + '.veyra',
    ];
    for (const candidate of invalid) {
      expect(() => parseRecipientHandle(candidate), candidate).toThrow(VeyraIdLookupError);
    }
    expect(() => displayVeyraHandle('alice.veyra')).toThrow(VeyraIdLookupError);
  });

  it('does not let contact aliases or X handles take over an explicitly namespaced Veyra ID', () => {
    const resolver = source('server/services/identityResolver.ts');
    const contacts = source('server/services/contactService.ts');
    expect(resolver).toContain('if (senderUserId && !explicitVeyraId)');
    expect(resolver).toContain('if (explicitVeyraId)');
    expect(resolver).toContain("throw new IdentityResolutionError('RECIPIENT_NOT_FOUND'");
    expect(contacts).toContain('if (!contactUserId && !explicitVeyraId)');
    expect(resolver).toContain('isBlockedEither');
    expect(contacts).toContain('isBlockedEither');
  });

  it('selects the only verified wallet on a chain, or an explicit matching primary', () => {
    const wallets = [
      { walletId: 'wallet-arc-primary', walletAddress: '0x0000000000000000000000000000000000000001', chainId: 5042002 },
      { walletId: 'wallet-arc-alt', walletAddress: '0x0000000000000000000000000000000000000002', chainId: 5042002 },
      { walletId: 'wallet-base', walletAddress: '0x0000000000000000000000000000000000000003', chainId: 8453 },
    ];
    expect(chooseRecipientWallet(wallets, 5042002, {})).toBeNull();
    expect(chooseRecipientWallet(wallets, 5042002, { primaryWalletId: 'unrecognized-wallet' })).toBeNull();
    expect(chooseRecipientWallet(wallets, 5042002, { primaryWalletId: 'wallet-base' })).toBeNull();
    expect(chooseRecipientWallet(wallets, 5042002, { primaryWalletId: 'wallet-arc-alt' })?.walletId)
      .toBe('wallet-arc-alt');
    expect(chooseRecipientWallet(wallets, 8453, {})?.walletId).toBe('wallet-base');
    expect(chooseRecipientWallet(wallets, 1, {})).toBeNull();
  });

  it('never bypasses the existing 30-second freeze-and-recheck before Pay by ID', () => {
    const resolver = source('server/services/identityResolver.ts');
    const payment = source('server/services/paymentRecipientService.ts');
    expect(resolver).toContain('const SNAPSHOT_TTL_MS = 30_000');
    expect(payment).toContain('freezeSnapshot(db, resolved.veyraUserId)');
    expect(payment).toContain('verifySnapshot(db, input.snapshotId)');
    expect(payment).toContain('RECIPIENT_WALLET_AMBIGUOUS');
    expect(payment).not.toMatch(/eth_sendTransaction|eth_signTypedData|depositForBurn/);
  });
});
