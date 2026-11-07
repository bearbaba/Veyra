/** Distinguish before-wallet failures from uncertain financial submissions.
 * A wallet error code is NOT proof that no transaction was broadcast after
 * eth_sendTransaction was requested. Only the pre-wallet phase may release
 * the original payment reservation.
 */
export type PayFailureOutcome='before-wallet'|'unknown-after-wallet';
export function classifyMainnetPayFailure(
 walletRequestStarted:boolean,
 _error:unknown,
):PayFailureOutcome{
 return walletRequestStarted?'unknown-after-wallet':'before-wallet';
}
