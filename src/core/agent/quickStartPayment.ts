/**
 * Agent Quick Start composes human-readable plans; it never creates transfer
 * actions or calls wallet signing methods. Execution remains the responsibility
 * of the verified Pay/Bridge review and their provider gates.
 */
import { isAddress, parseUnits } from 'viem';

export type QuickNetwork = 'arc' | 'ethereum-sepolia' | 'base-sepolia' | 'base-mainnet' | 'ethereum-mainnet';
export type QuickMode = 'SEND' | 'BRIDGE';
export type QuickRecipient = 'WALLET' | 'FRIEND';

export const QUICK_NETWORKS: ReadonlyArray<{
  id: QuickNetwork; label: string; availability: 'DIRECT' | 'BRIDGE' | 'PLANNED';
}> = [
  { id: 'arc', label: 'Arc Testnet', availability: 'DIRECT' },
  { id: 'ethereum-sepolia', label: 'Ethereum Sepolia', availability: 'BRIDGE' },
  { id: 'base-sepolia', label: 'Base Sepolia', availability: 'BRIDGE' },
  { id: 'base-mainnet', label: 'Base Mainnet', availability: 'PLANNED' },
  { id: 'ethereum-mainnet', label: 'Ethereum Mainnet', availability: 'PLANNED' },
];

export type QuickPaymentResult =
  | { ok: true; text: string; route: string }
  | { ok: false; reason: string };

export function buildQuickPaymentRequest(input: {
  mode: QuickMode;
  network: QuickNetwork;
  amount: string;
  recipient: string;
  recipientType: QuickRecipient;
  trustedFriendHandles?: readonly string[];
}): QuickPaymentResult {
  const chosen = QUICK_NETWORKS.find((network) => network.id === input.network);
  if (!chosen || chosen.availability === 'PLANNED')
    return { ok: false, reason: 'This network is not enabled for payments yet. Choose a supported Testnet route.' };
  if (input.mode === 'BRIDGE' && chosen.availability !== 'BRIDGE')
    return { ok: false, reason: 'Select Ethereum Sepolia or Base Sepolia for the CCTP bridge.' };
  if (input.recipientType === 'FRIEND' && chosen.availability !== 'DIRECT')
    return { ok: false, reason: 'Cross-chain Veyra ID recipient resolution is not enabled yet. Select an exact wallet address.' };

  const amount = input.amount.trim();
  if (!/^\d{1,18}(?:\.\d{1,6})?$/.test(amount))
    return { ok: false, reason: 'Enter a USDC amount with up to six decimal places.' };
  try {
    if (parseUnits(amount, 6) <= 0n)
      return { ok: false, reason: 'Amount must be greater than zero.' };
  } catch {
    return { ok: false, reason: 'Enter a valid USDC amount.' };
  }

  const recipient = input.recipient.trim();
  if (input.recipientType === 'WALLET') {
    if (!isAddress(recipient))
      return { ok: false, reason: 'Paste a complete, valid EVM wallet address (0x…).' };
  } else {
    // A typed or invented Veyra handle is NOT a trusted friend. The selector
    // can supply only authenticated CONNECTED friends for this wallet session.
    if (!/^@[a-z0-9_-]{2,32}\.veyra$/i.test(recipient)
      || !input.trustedFriendHandles?.includes(recipient))
      return { ok: false, reason: 'Choose one of your connected Veyra friends.' };
  }
  const text = chosen.availability === 'DIRECT'
    ? `Send ${amount} USDC to ${recipient} on Arc Testnet`
    : `Send ${amount} USDC from Arc Testnet to ${recipient} on ${chosen.label}`;
  return { ok: true, text, route: chosen.availability === 'DIRECT'
    ? 'Arc Testnet · direct USDC'
    : `Arc Testnet → ${chosen.label} · CCTP V2` };
}
