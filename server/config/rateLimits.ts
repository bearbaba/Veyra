export interface RateLimitPolicy {
  globalPerMinute: number;
  agentPerMinute: number;
  stableFxPerMinute: number;
  identityPerMinute: number;
}

function readPositiveInt(raw: string | undefined, fallback: number, max: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function getRateLimitPolicy(env: NodeJS.ProcessEnv = process.env): RateLimitPolicy {
  return {
    globalPerMinute: readPositiveInt(env.VEYRA_RATE_GLOBAL_PER_MIN, 100, 5_000),
    agentPerMinute: readPositiveInt(env.VEYRA_RATE_AGENT_PER_MIN, 30, 1_000),
    stableFxPerMinute: readPositiveInt(env.VEYRA_RATE_STABLEFX_PER_MIN, 20, 1_000),
    identityPerMinute: readPositiveInt(env.VEYRA_RATE_IDENTITY_PER_MIN, 20, 1_000),
  };
}
