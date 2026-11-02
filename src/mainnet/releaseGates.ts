/**
 * Emergency rollback: read-only by default when this release profile is enabled.
 * All signing entrypoints must call the guard BEFORE opening a wallet request.
 * Browsers may still read and verify existing onchain receipts and local journals.
 */
export const MAINNET_EMERGENCY_READ_ONLY =
  import.meta.env.VITE_VEYRA_EMERGENCY_READ_ONLY === '1';

export function assertMainnetSigningAllowed(readOnly=MAINNET_EMERGENCY_READ_ONLY):void{
  if(readOnly)throw new Error(
    'Veyra is in read-only recovery mode. Existing transactions can be checked, but no new wallet signing is permitted.');
}
