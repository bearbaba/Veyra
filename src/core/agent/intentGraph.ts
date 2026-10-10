import type { VeyraCapability } from '../capabilities/capabilityTypes';

export interface CapabilityIntentNode {
  nodeId: string;
  capability: VeyraCapability;
  sourceText: string;
  recipientRaw?: string;
  amountRaw?: string;
  assetRaw?: string;
  destinationNetworkRaw?: string;
  dependsOn: string[];
}

export interface CapabilityIntentGraph {
  raw: string;
  nodes: CapabilityIntentNode[];
}

const AMOUNT = /\b(\d+(?:[.,]\d+)?|half|all|everything|remainder|rest|phần còn lại|một nửa)\b/iu;
const ASSET = /\b(USDC|EURC|USDT|DAI|ETH|WETH|WBTC|cirBTC|USYC)\b/iu;
const RECIPIENT = /(^|\s)(@[A-Za-z0-9_]{1,30}|0x[0-9a-fA-F]{40})(?=$|[\s,.;])/u;
const DESTINATION = /\b(?:on|to|onto|sang|trên)\s+(Arc|Ethereum|Arbitrum|Optimism|OP|Avalanche|Polygon|Base|Solana)(?:\s+(?:Mainnet|Testnet|Devnet))?\b/iu;

function capabilityFor(text: string): VeyraCapability | null {
  const t = text.toLowerCase();
  if (/\b(earn|yield|vault|kiếm lợi suất|sinh lời)\b/u.test(t)) return 'EARN';
  if (/\b(swap|convert|exchange|đổi)\b/u.test(t)) return 'SWAP';
  if (/\b(bridge|cross[- ]?chain|cầu nối)\b/u.test(t)) return 'BRIDGE';
  if (/\b(unified|unify|any chain|wherever|bất kỳ chain|chain nào cũng được)\b/u.test(t)) return 'UNIFIED';
  if (/\b(keep|reserve|giữ lại|để lại)\b/u.test(t)) return 'RESERVE';
  if (/\b(onramp|add funds|buy usdc|nạp tiền|mua usdc)\b/u.test(t)) return 'ONRAMP';
  if (/\b(send|pay|transfer|gửi|chuyển cho)\b/u.test(t) || RECIPIENT.test(text)) return 'PAY';
  return null;
}

function splitClauses(raw: string): string[] {
  return raw
    .split(/\s*(?:;|,|\band then\b|\bthen\b|\brồi\b|\bsau đó\b)\s*/iu)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 12);
}

/**
 * Deterministic local clause splitter used only as a safe fallback/planning aid.
 * Values remain raw strings; deterministic resolvers must verify everything
 * before an executable action exists.
 */
export function buildCapabilityIntentGraph(raw: string): CapabilityIntentGraph {
  const clauses = splitClauses(raw.slice(0, 4000));
  const nodes: CapabilityIntentNode[] = [];

  for (const clause of clauses) {
    const capability = capabilityFor(clause);
    if (!capability) continue;
    const nodeId = `node-${nodes.length + 1}`;
    const recipient = clause.match(RECIPIENT)?.[2];
    const amount = clause.match(AMOUNT)?.[1];
    const asset = clause.match(ASSET)?.[1]?.toUpperCase();
    const destination = clause.match(DESTINATION)?.[1];

    nodes.push({
      nodeId,
      capability,
      sourceText: clause,
      ...(recipient ? { recipientRaw: recipient } : {}),
      ...(amount ? { amountRaw: amount.replace(',', '.') } : {}),
      ...(asset ? { assetRaw: asset } : {}),
      ...(destination ? { destinationNetworkRaw: destination } : {}),
      dependsOn: nodes.length ? [nodes[nodes.length - 1].nodeId] : [],
    });
  }

  return { raw, nodes };
}
