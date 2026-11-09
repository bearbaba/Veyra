/**
 * Turns a live provider quote into the rows the user reviews before signing.
 *
 * Display only. It never changes, approves or blocks a quote: `Quote.fees` keeps
 * the provider's own strings, because the Swap re-check compares them verbatim,
 * and the minimum-output and fee-cap guards stay the safety boundary.
 *
 * Rules
 *  - Every fee line the provider sends is shown. A line that cannot be parsed is
 *    shown as received, never dropped.
 *  - Costs are rounded UP to 6 decimals, so a displayed cost is never lower than
 *    the real one (the provider reports gas with up to 18 decimals).
 *  - Network gas the provider does not itemize is not invented: the row says the
 *    wallet shows it when the user confirms.
 *  - The proportional-fee warning compares like with like only: USDC fees against
 *    a USDC input. It never converts between assets and never guesses a price.
 */
import { assessFeeBurden, type FeeBurden } from './feeBurden';

export type QuoteMode = 'swap' | 'bridge';

export interface QuoteSummaryInput {
  mode: QuoteMode;
  /** Amount the user sends, in source-token units (up to 6 decimals). */
  amount: string;
  fromToken: string;
  toToken: string;
  expected: string;
  minimum: string;
  /** The provider's own fee strings, exactly as stored on the quote. */
  fees: readonly string[];
  /** CCTP on-chain fee cap, when the quote is a bridge. */
  bridgeMaxFee?: string;
}

export interface QuoteSummaryRow {
  label: string;
  value: string;
  note?: string;
  strong?: boolean;
  muted?: boolean;
}

export interface QuoteSummary {
  rows: QuoteSummaryRow[];
  burden: FeeBurden | null;
  /** Word used in the warning ("this swap" / "this transfer"). */
  burdenSubject: 'swap' | 'transfer';
}

export interface ParsedFeeLine {
  kind: 'provider' | 'forwarder' | 'gas' | 'other';
  rawType: string;
  amount: string;
  token: string;
}

/** Parses the "type: amount TOKEN" strings produced for each provider fee. */
export function parseFeeLine(line: string): ParsedFeeLine | null {
  const match = /^([^:]+):\s*([0-9]+(?:\.[0-9]+)?)\s*(\S*)\s*$/.exec(line);
  if (!match) return null;
  const rawType = (match[1] ?? '').trim();
  const lower = rawType.toLowerCase();
  const kind = lower === 'gas' ? 'gas' : lower === 'provider' ? 'provider' : lower === 'forwarder' ? 'forwarder' : 'other';
  return { kind, rawType, amount: match[2] ?? '0', token: match[3] ?? '' };
}

export interface CeilResult {
  /** The amount scaled by 10^places, rounded up. */
  units: bigint;
  /** Display text with trailing zeros trimmed. */
  text: string;
  /** True when digits beyond `places` were rounded up. */
  rounded: boolean;
}

export function formatScaled(units: bigint, places: number): string {
  const base = 10n ** BigInt(places);
  const whole = units / base;
  const fraction = (units % base).toString().padStart(places, '0').replace(/0+$/, '');
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

/** Rounds a non-negative decimal string UP to `places` decimals, with no floating point. */
export function ceilDecimal(amount: string, places = 6): CeilResult {
  const [whole = '0', fraction = ''] = amount.split('.');
  const kept = fraction.slice(0, places).padEnd(places, '0');
  const dropped = fraction.slice(places);
  const rounded = /[1-9]/.test(dropped);
  const units = BigInt(whole) * 10n ** BigInt(places) + BigInt(kept || '0') + (rounded ? 1n : 0n);
  return { units, text: formatScaled(units, places), rounded };
}

const LABELS: Record<ParsedFeeLine['kind'], string> = {
  provider: 'Provider fee',
  forwarder: 'Forwarding fee',
  gas: 'Network gas',
  other: 'Fee',
};

function titleCase(value: string): string {
  const lower = value.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function summarizeQuote(input: QuoteSummaryInput): QuoteSummary {
  const destination = input.toToken;
  const rows: QuoteSummaryRow[] = [
    { label: 'Expected received', value: `${input.expected} ${destination}` },
    {
      label: 'Minimum received',
      value: `${input.minimum} ${destination}`,
      note: input.mode === 'swap' ? '1% slippage limit' : 'Fee capped',
      strong: true,
    },
  ];

  let sawGas = false;
  let allParsed = true;
  let usdcUnits = 0n;
  let usdcLines = 0;
  let otherTokenLines = 0;

  for (const line of input.fees) {
    const parsed = parseFeeLine(line);
    if (!parsed) {
      allParsed = false;
      rows.push({ label: 'Fee', value: line });
      continue;
    }
    if (parsed.kind === 'gas') sawGas = true;
    const ceil = ceilDecimal(parsed.amount);
    const label = parsed.kind === 'other' ? `${titleCase(parsed.rawType)} fee` : LABELS[parsed.kind];
    rows.push({ label, value: `${ceil.rounded ? '≈ ' : ''}${ceil.text} ${parsed.token}`.trim() });
    if (parsed.token.toUpperCase() === 'USDC') {
      usdcUnits += ceil.units;
      usdcLines += 1;
    } else {
      otherTokenLines += 1;
    }
  }

  if (!sawGas) {
    rows.push({ label: 'Network gas', value: 'In your wallet', note: 'Estimated when you confirm', muted: true });
  }

  const totalText = formatScaled(usdcUnits, 6);
  if (usdcLines >= 2) {
    rows.push({
      label: 'Total fees',
      value: `≈ ${totalText} USDC`,
      note: otherTokenLines > 0 ? 'USDC fees only' : undefined,
      strong: true,
    });
  }

  // Proportional-fee warning: only when the comparison is like with like.
  let burden: FeeBurden | null = null;
  if (input.mode === 'bridge') {
    burden = input.bridgeMaxFee !== undefined ? assessFeeBurden(input.amount, input.bridgeMaxFee) : null;
  } else if (allParsed && usdcLines > 0 && otherTokenLines === 0 && input.fromToken.toUpperCase() === 'USDC') {
    burden = assessFeeBurden(input.amount, totalText);
  }

  return { rows, burden, burdenSubject: input.mode === 'swap' ? 'swap' : 'transfer' };
}
