/**
 * Why Swap/Bridge signing is unavailable, and what to tell the user.
 *
 * `exchangeSigningBlock` is the single source of truth for the decision: signing
 * is ready if and only if it returns null. It keeps the exact release-gate
 * semantics of the original expression
 *
 *   releaseEnv === 'production' && !emergencyReadOnly && publicBeta &&
 *   (mode === 'swap' || bridgeWriteEnabled)
 *
 * and adds the REASON, so the screen can say what is actually true. A Studio or
 * Vercel Preview build is not a "pause": it is a Preview. A test checks every
 * input combination against the original expression.
 */
export type ExchangeMode = 'swap' | 'bridge';

export type SigningBlock = 'preview' | 'emergency' | 'beta-off' | 'bridge-off';

export interface SigningGateInput {
  /** The build's release environment: 'production' only on the authorized Production release. */
  releaseEnv: string;
  emergencyReadOnly: boolean;
  publicBeta: boolean;
  bridgeWriteEnabled: boolean;
  mode: ExchangeMode;
}

export function exchangeSigningBlock(input: SigningGateInput): SigningBlock | null {
  if (input.releaseEnv !== 'production') return 'preview';
  if (input.emergencyReadOnly) return 'emergency';
  if (!input.publicBeta) return 'beta-off';
  if (input.mode === 'bridge' && !input.bridgeWriteEnabled) return 'bridge-off';
  return null;
}

export interface SigningNotice {
  /** Short status for the banner. */
  headline: string;
  /** One or two plain sentences under the headline. */
  body: string;
  /** Even shorter text for inside the quote card. */
  compact: string;
  /** Label for the disabled primary button while a valid quote is showing. */
  buttonLabel: string;
}

export const PREVIEW_HEADLINE = 'Preview mode — quotes available, wallet signing disabled.';
export const PREVIEW_BODY = 'Real financial transactions are available only through the authorized Production release, subject to all existing safety checks.';
export const PREVIEW_BUTTON = 'Signing disabled in Preview';

export function signingNotice(block: SigningBlock): SigningNotice {
  switch (block) {
    case 'preview':
      return {
        headline: PREVIEW_HEADLINE,
        body: PREVIEW_BODY,
        compact: 'Preview mode: this quote cannot be signed here.',
        buttonLabel: PREVIEW_BUTTON,
      };
    case 'emergency':
      return {
        headline: 'Quotes only · Transfers temporarily paused',
        body: 'Veyra has paused transfers. Quotes stay available and nothing can be signed until transfers resume.',
        compact: 'Transfers are paused. Nothing can be signed right now.',
        buttonLabel: 'Transfers paused',
      };
    case 'bridge-off':
      return {
        headline: 'Quotes only · Bridge signing is not enabled',
        body: 'Bridge transfers are not enabled in this release. Quotes stay available.',
        compact: 'Bridge signing is not enabled in this release.',
        buttonLabel: 'Signing not enabled',
      };
    case 'beta-off':
      return {
        headline: 'Quotes only · Signing is not enabled',
        body: 'Wallet signing is not enabled in this release. Quotes stay available.',
        compact: 'Signing is not enabled in this release.',
        buttonLabel: 'Signing not enabled',
      };
  }
}
