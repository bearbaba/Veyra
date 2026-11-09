import { PREVIEW_BODY, PREVIEW_BUTTON } from './exchangeSigningGate';

/**
 * Pay (Settlement V1) signing availability, for display.
 *
 * On Mainnet only the authorized Production release may sign. SettlementPage
 * enforces that again, independently, at the top of `handleApprove` and
 * `handleSettle` (`__VEYRA_RELEASE_ENV__ !== 'production'`); those guards stay.
 * This function only lets the screen say so BEFORE the user clicks, instead of
 * showing an apparently live "Approve" button that refuses afterwards.
 *
 * It never grants anything: a null result does not mean signing will succeed,
 * only that the release environment itself is not what blocks it. Deployment
 * verification, sign-in, balance, allowance, gas, simulation, duplicate and
 * journal checks all still apply.
 */
export type PaySigningBlock = 'preview';

export function paySigningBlock(input: { mainnet: boolean; releaseEnv: string }): PaySigningBlock | null {
  return input.mainnet && input.releaseEnv !== 'production' ? 'preview' : null;
}

export const PAY_PREVIEW_HEADLINE = 'Preview mode — payment review available, wallet signing disabled.';

export const payPreviewNotice = {
  headline: PAY_PREVIEW_HEADLINE,
  body: PREVIEW_BODY,
  buttonLabel: PREVIEW_BUTTON,
} as const;
