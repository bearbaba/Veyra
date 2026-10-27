/**
 * Wallet network is transient transport state, not the payment's reviewed
 * source network. Only call on an EXPLICIT user action that requires signing.
 * No wallet transaction, signature, allowance or transfer is issued here.
 */
export async function ensureWalletNetworkForSigning(
  getWalletChainId: () => Promise<number>,
  requestSwitch: (chainId: number) => Promise<unknown>,
  targetChainId: number,
  networkLabel: string,
  timeoutMs = 45_000,
): Promise<'ALREADY_SELECTED' | 'SWITCHED'> {
  if (!Number.isSafeInteger(targetChainId) || targetChainId <= 0) {
    throw new Error('Unsupported signing network. No transaction was submitted.');
  }
  if (await getWalletChainId() === targetChainId) return 'ALREADY_SELECTED';

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      requestSwitch(targetChainId),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(
          `Network selection timed out. Check your wallet's selected network before trying again. No payment was submitted.`
        )), timeoutMs);
      }),
    ]);
  } catch (error) {
    const typed = error as { code?: number; cause?: {code?:number}; shortMessage?:string };
    if (typed?.code === 4001 || typed?.cause?.code === 4001 ||
        /rejected|denied|cancelled|canceled|user rejected/i.test(
          (error instanceof Error ? error.message : '') + ' ' + (typed?.shortMessage ?? '')
        )) {
      throw new Error('Network switch cancelled. Your payment details are preserved. Nothing was signed.');
    }
    if (error instanceof Error && error.message.startsWith('Network selection timed out.')) throw error;
    throw new Error(`Could not select ${networkLabel} in your wallet. Check whether the network is supported and retry; nothing was signed.`);
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  // A wallet may report switch success while retaining a different chain.
  // Never infer success from the switch promise alone.
  if (await getWalletChainId() !== targetChainId) {
    throw new Error(`Your wallet has not confirmed ${networkLabel}. No signature was requested; check the network before trying again.`);
  }
  return 'SWITCHED';
}
