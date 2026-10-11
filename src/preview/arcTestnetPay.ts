/**
 * Narrow live Arc Testnet direct USDC transfer.
 * NOT Veyra ID, an authenticated BFF payment, Circle FX, or CCTP.
 *
 * Only the reviewed testnet chain/token can be used; wallet owns the signing
 * decision. No approval/permit, secret, auto-retry or arbitrary calldata.
 */
import { encodeFunctionData, getAddress, isAddress, parseAbi, parseUnits, toEventSelector, type Address, type Hex } from 'viem';
import { getUsdc, requireChain } from '../onchain-facts';
import type { InjectedPreviewProvider } from './PreviewWallet';

export const ARC_TESTNET_CHAIN_ID = 5042002;
export const MAX_TESTNET_PAYMENT_UNITS = 1_000_000n; // max 1 testnet USDC
export const ARC_PAY_FINALITY_CONFIRMATIONS = 12n; // both success and revert must settle
const HASH_RE = /^0x[\da-fA-F]{64}$/;
const HEX_RE = /^0x[\da-fA-F]+$/;
const TRANSFER_ABI = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);
const TRANSFER_TOPIC = toEventSelector('Transfer(address,address,uint256)');
const CHAIN = requireChain(ARC_TESTNET_CHAIN_ID);
const USDC = getUsdc(ARC_TESTNET_CHAIN_ID);

function fail(message: string): never { throw new Error(message); }
function assertConfig(): void {
  if (!CHAIN.isTestnet || !USDC || USDC.decimals !== 6 ||
      USDC.address.toLowerCase() !== '0x3600000000000000000000000000000000000000' ||
      !CHAIN.rpcUrls[0]?.startsWith('https://')) {
    fail('Arc testnet token/RPC registry mismatch: transfers disabled.');
  }
}
export type ArcPayPlan = { from: Address; to: Address; units: bigint; amount: string; token: Address; data: Hex };
export type ArcPayProof = { txHash: Hex; blockHash: Hex; blockNumber: number; confirmations: number; explorerUrl: string };
export type ArcPayStatus =
  | { state: 'PENDING'; txHash: Hex }
  | { state: 'VERIFIED'; proof: ArcPayProof }
  | { state: 'REVERTED'; txHash: Hex };

export function createArcTestnetPayPlan(from: string, to: string, amount: string): ArcPayPlan {
  assertConfig();
  if (!isAddress(from) || !isAddress(to)) fail('Send to a complete EVM wallet address only (not a Veyra ID).');
  const sender = getAddress(from), recipient = getAddress(to);
  if (sender.toLowerCase() === recipient.toLowerCase() ||
      recipient === '0x0000000000000000000000000000000000000000') {
    fail('Choose a nonzero destination wallet different from your sender.');
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount)) fail('Enter an amount with at most 6 decimal places.');
  const units = parseUnits(amount, 6);
  if (units < 1n || units > MAX_TESTNET_PAYMENT_UNITS) fail('Testnet beta limits each transfer to 0.000001–1 USDC.');
  const token = getAddress(USDC!.address);
  const data = encodeFunctionData({ abi: TRANSFER_ABI, functionName: 'transfer', args: [recipient, units] });
  return { from: sender, to: recipient, units, amount, token, data };
}

function assertReviewedArcPayPlan(plan: ArcPayPlan): ArcPayPlan {
  // Browser review objects may be restored or changed before an async wallet
  // or RPC response. Rebuild the ONLY supported fixed-chain USDC transfer.
  const reviewed = createArcTestnetPayPlan(plan.from, plan.to, plan.amount);
  if (reviewed.from !== plan.from || reviewed.to !== plan.to ||
      reviewed.token !== plan.token || reviewed.units !== plan.units ||
      reviewed.data !== plan.data) {
    fail('Payment details changed since review.');
  }
  return reviewed;
}

export async function arcTestnetRpc(method: string, params: unknown[]): Promise<unknown> {
  assertConfig();
  const response = await fetch(CHAIN.rpcUrls[0], {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  if (!response.ok) fail('Arc Testnet public RPC temporarily unavailable.');
  const raw: unknown = await response.json();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('Arc RPC returned an untrusted response.');
  }
  const json = raw as Record<string, unknown>;
  // Do not accept a stale/mismatched JSON-RPC response, error envelope, or
  // echo provider-supplied error messages into the public payment interface.
  if (json.jsonrpc !== '2.0' || json.id !== 1 ||
      Object.prototype.hasOwnProperty.call(json, 'error') ||
      !Object.prototype.hasOwnProperty.call(json, 'result')) {
    fail('Arc RPC returned an untrusted response.');
  }
  return json.result;
}
function asHex(value: unknown): Hex {
  if (typeof value !== 'string' || !HEX_RE.test(value)) fail('Arc RPC returned unexpected hexadecimal data.');
  return value as Hex;
}
export async function assertArcRpcChain(): Promise<void> {
  const id = BigInt(asHex(await arcTestnetRpc('eth_chainId', [])));
  if (id !== BigInt(ARC_TESTNET_CHAIN_ID)) fail('The public Arc RPC is serving an unexpected network.');
}
export async function getArcTestnetUsdcBalance(owner: Address): Promise<bigint> {
  const data = `0x70a08231${owner.slice(2).toLowerCase().padStart(64, '0')}`;
  return BigInt(asHex(await arcTestnetRpc('eth_call', [{ to: USDC!.address, data }, 'latest'])));
}
export function arcPayExplorerUrl(hash: string): string {
  if (!HASH_RE.test(hash)) fail('Invalid transaction hash.');
  return `${CHAIN.explorerBase}/tx/${hash}`;
}

export async function submitArcTestnetPay(
  provider: InjectedPreviewProvider,
  plan: ArcPayPlan,
  onWalletRequest: () => void = () => undefined,
): Promise<Hex> {
  // Recheck the exact immutable original values immediately before the
  // signing RPC. Plan is not trusted, even if derived from a previous review.
  const rebuilt = assertReviewedArcPayPlan(plan);
  await assertArcRpcChain();
  const [chainRaw, accounts] = await Promise.all([
    provider.request({ method: 'eth_chainId' }),
    provider.request({ method: 'eth_accounts' }),
  ]);
  if (typeof chainRaw !== 'string' || !HEX_RE.test(chainRaw) ||
      BigInt(chainRaw) !== BigInt(ARC_TESTNET_CHAIN_ID)) {
    fail('Switch your wallet to Arc Testnet (5042002) before approving.');
  }
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' ||
      !isAddress(accounts[0]) || getAddress(accounts[0]) !== rebuilt.from) {
    fail('Wallet account changed. Reconnect and review before sending.');
  }
  if (await getArcTestnetUsdcBalance(rebuilt.from) < rebuilt.units) {
    fail('Insufficient testnet USDC to send.');
  }
  // The caller must know if the attempt reached a wallet submission RPC:
  // earlier preflight failures can safely unlock; an unknown wallet response
  // after this point must NEVER cause automatic resubmission.
  onWalletRequest();
  // This is the ONLY financial RPC in the beta frontend. The wallet opens
  // its own signing review; rejection never triggers a retry.
  const hash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{ from: rebuilt.from, to: rebuilt.token, data: rebuilt.data, value: '0x0' }],
  });
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) fail('Wallet submission result is uncertain. Do not send again.');
  return hash as Hex;
}

type RpcTransaction = { hash: string; from: string; to: string | null; input: string };
type RpcReceipt = {
  transactionHash: string; status: string; blockHash: string; blockNumber: string;
  logs: Array<{ address: string; topics: string[]; data: string }>;
};
function topicAddress(value: Address): string { return `0x${value.slice(2).toLowerCase().padStart(64, '0')}`; }

export async function reconcileArcTestnetPay(
  plan: ArcPayPlan, txHash: string,
): Promise<ArcPayStatus> {
  if (!HASH_RE.test(txHash)) fail('Enter a complete transaction hash.');
  // Capture validated immutable values BEFORE any await. Never verify against
  // a caller-mutated plan after the network request has been started.
  const reviewed = assertReviewedArcPayPlan(plan);
  await assertArcRpcChain();
  const rawTx = await arcTestnetRpc('eth_getTransactionByHash', [txHash]);
  if (!rawTx) return { state: 'PENDING', txHash: txHash as Hex };
  const tx = rawTx as RpcTransaction;
  if (!tx.hash || tx.hash.toLowerCase() !== txHash.toLowerCase() ||
      tx.from?.toLowerCase() !== reviewed.from.toLowerCase() ||
      tx.to?.toLowerCase() !== reviewed.token.toLowerCase() ||
      tx.input?.toLowerCase() !== reviewed.data.toLowerCase()) {
    fail('Indexed transaction does not match the originally reviewed USDC payment.');
  }
  const rawReceipt = await arcTestnetRpc('eth_getTransactionReceipt', [txHash]);
  if (!rawReceipt) return { state: 'PENDING', txHash: txHash as Hex };
  const receipt = rawReceipt as RpcReceipt;
  if (receipt.transactionHash?.toLowerCase() !== txHash.toLowerCase() ||
      !HASH_RE.test(receipt.blockHash ?? '') || !HEX_RE.test(receipt.blockNumber ?? '')) {
    fail('Receipt identity or block information does not match the transaction.');
  }
  // A receipt (INCLUDING a revert) is only tentative until its block is
  // canonical and confirmed. An early revert may be replaced by a successful
  // transaction in a reorg; unlocking the next send before finality risks
  // a duplicate transfer. Only successful receipts need a Transfer log.
  if (receipt.status !== '0x0' && receipt.status !== '0x1') {
    fail('Unrecognized receipt status. Payment is unverified.');
  }
  const matched = receipt.status === '0x1' && Array.isArray(receipt.logs) && receipt.logs.some((log) => (
    log.address?.toLowerCase() === reviewed.token.toLowerCase() &&
    log.topics?.length === 3 &&
    log.topics[0]?.toLowerCase() === TRANSFER_TOPIC.toLowerCase() &&
    log.topics[1]?.toLowerCase() === topicAddress(reviewed.from) &&
    log.topics[2]?.toLowerCase() === topicAddress(reviewed.to) &&
    HEX_RE.test(log.data) && BigInt(log.data) === reviewed.units
  ));
  if (receipt.status === '0x1' && !matched) {
    fail('Successful receipt has no matching USDC Transfer evidence.');
  }
  const number = BigInt(receipt.blockNumber);
  const block = await arcTestnetRpc('eth_getBlockByNumber', [receipt.blockNumber, false]) as { hash?: string } | null;
  if (!block || !HASH_RE.test(block.hash ?? '') ||
      block.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) {
    fail('Canonical block hash changed; payment remains unverified.');
  }
  const head = BigInt(asHex(await arcTestnetRpc('eth_blockNumber', [])));
  if (head < number || head - number + 1n < ARC_PAY_FINALITY_CONFIRMATIONS) {
    return { state: 'PENDING', txHash: txHash as Hex };
  }
  if (number > BigInt(Number.MAX_SAFE_INTEGER) ||
      head - number + 1n > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail('Unsafe block number.');
  }
  if (receipt.status === '0x0') {
    return { state: 'REVERTED', txHash: txHash as Hex };
  }
  return {
    state: 'VERIFIED',
    proof: { txHash: txHash as Hex, blockHash: receipt.blockHash as Hex,
      blockNumber: Number(number), confirmations: Number(head - number + 1n),
      explorerUrl: arcPayExplorerUrl(txHash) },
  };
}
