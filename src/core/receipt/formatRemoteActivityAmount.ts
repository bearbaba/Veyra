import { formatUnits } from 'viem';
import type { ActivityReceiptRemoteRecord } from '../../lib/api/activityReceiptApi';

/** Display only. The BFF/chain remains the authority on token, raw amount and
 *  decimals. Never use a formatted display value as an execution argument. */
export function formatRemoteActivityAmount(
  receipt: Pick<ActivityReceiptRemoteRecord, 'amountRaw' | 'amountDecimals' | 'assetId'>,
): string {
  if (
    typeof receipt.amountRaw !== 'string' ||
    !/^(0|[1-9][0-9]{0,79})$/.test(receipt.amountRaw) ||
    !Number.isInteger(receipt.amountDecimals) ||
    receipt.amountDecimals < 0 ||
    receipt.amountDecimals > 18 ||
    typeof receipt.assetId !== 'string' ||
    !/^[A-Za-z0-9_-]{2,32}$/.test(receipt.assetId)
  ) {
    return 'Amount unavailable';
  }
  try {
    const value = formatUnits(BigInt(receipt.amountRaw), receipt.amountDecimals);
    // Preserve the backend's identity. Do not silently label unknown assets USDC.
    const asset = receipt.assetId.toLowerCase() === 'usdc'
      ? 'USDC' : receipt.assetId;
    return `${value} ${asset}`;
  } catch {
    return 'Amount unavailable';
  }
}
