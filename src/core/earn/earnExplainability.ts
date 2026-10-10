export interface EarnEvidenceSource {
  sourceUrl: string;
  verifiedAt: string;
}

export interface EarnExplainabilityInput {
  vaultAddress?: string | null;
  providerId?: string | null;
  chain?: string | null;
  asset?: string | null;
  amount?: string | null;
  apyCurrent?: number | null;
  apyVerifiedAt?: string | null;
  apySourceUrl?: string | null;
  yieldMechanism?: string | null;
  positionReceived?: string | null;
  withdrawalAvailability?: string | null;
  withdrawalDelay?: string | null;
  withdrawalLimits?: string | null;
  fees?: string | null;
  liquidity?: string | null;
  riskSummary?: string | null;
  provenance?: EarnEvidenceSource | null;
}

export interface EarnExplainabilityGateResult {
  executable: boolean;
  missing: string[];
  answers: {
    whereIsMyMoneyGoing: string | null;
    whatWillItDoThere: string | null;
    howCanItEarnMoney: string | null;
    whatCanGoWrong: string | null;
    howDoIGetMyMoneyBack: string | null;
  };
}

/**
 * A Veyra Earn deposit is not signable unless the UI can answer the five core
 * user questions from verified provider data. Missing metadata is a hard block,
 * never an invitation for the Agent to invent an explanation.
 */
export function evaluateEarnExplainability(
  input: EarnExplainabilityInput,
): EarnExplainabilityGateResult {
  const missing: string[] = [];

  const requireText = (key: string, value: string | null | undefined): string | null => {
    const normalized = value?.trim() ?? '';
    if (!normalized) {
      missing.push(key);
      return null;
    }
    return normalized;
  };

  const vaultAddress = requireText('vaultAddress', input.vaultAddress);
  const providerId = requireText('providerId', input.providerId);
  const chain = requireText('chain', input.chain);
  const asset = requireText('asset', input.asset);
  const amount = requireText('amount', input.amount);
  const yieldMechanism = requireText('yieldMechanism', input.yieldMechanism);
  const positionReceived = requireText('positionReceived', input.positionReceived);
  const withdrawalAvailability = requireText(
    'withdrawalAvailability',
    input.withdrawalAvailability,
  );
  const fees = requireText('fees', input.fees);
  const liquidity = requireText('liquidity', input.liquidity);
  const riskSummary = requireText('riskSummary', input.riskSummary);

  if (typeof input.apyCurrent !== 'number' || !Number.isFinite(input.apyCurrent) || input.apyCurrent < 0) {
    missing.push('apyCurrent');
  }
  const apyVerifiedAt = requireText('apyVerifiedAt', input.apyVerifiedAt);
  const apySourceUrl = requireText('apySourceUrl', input.apySourceUrl);

  if (!input.provenance) {
    missing.push('provenance');
  } else {
    requireText('provenance.sourceUrl', input.provenance.sourceUrl);
    requireText('provenance.verifiedAt', input.provenance.verifiedAt);
  }

  const whereIsMyMoneyGoing =
    vaultAddress && providerId && chain && asset && amount
      ? `${amount} ${asset} on ${chain} to vault ${vaultAddress} via ${providerId}.`
      : null;

  const whatWillItDoThere =
    positionReceived
      ? `The deposit is expected to create/credit: ${positionReceived}.`
      : null;

  const howCanItEarnMoney =
    yieldMechanism && typeof input.apyCurrent === 'number' && apyVerifiedAt && apySourceUrl
      ? `${yieldMechanism} Current APY: ${input.apyCurrent} (verified ${apyVerifiedAt}; source: ${apySourceUrl}).`
      : null;

  const whatCanGoWrong =
    riskSummary && fees && liquidity
      ? `${riskSummary} Fees: ${fees}. Liquidity: ${liquidity}.`
      : null;

  const withdrawalParts = [
    withdrawalAvailability,
    input.withdrawalDelay?.trim() || null,
    input.withdrawalLimits?.trim() || null,
  ].filter(Boolean);
  const howDoIGetMyMoneyBack =
    withdrawalParts.length > 0 ? withdrawalParts.join(' ') : null;

  if (!howDoIGetMyMoneyBack) missing.push('withdrawalRecovery');

  return {
    executable: missing.length === 0,
    missing: [...new Set(missing)].sort(),
    answers: {
      whereIsMyMoneyGoing,
      whatWillItDoThere,
      howCanItEarnMoney,
      whatCanGoWrong,
      howDoIGetMyMoneyBack,
    },
  };
}

export function assertEarnExplainabilityComplete(input: EarnExplainabilityInput): void {
  const gate = evaluateEarnExplainability(input);
  if (!gate.executable) {
    throw new Error(
      `Earn deposit blocked: missing verified explainability fields: ${gate.missing.join(', ')}`,
    );
  }
}
