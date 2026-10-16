/**
 * Veyra Phase 6 — isolated, self-custodial Arc Mainnet USDC Pay canary.
 *
 * No AI-driven execution, Veyra ID, approval, CCTP, backend signing or retry.
 * This module is never imported by the existing Arc Testnet Vercel entry.
 * Execution requires the separately reviewed MAINNET_PAY build gate AND the
 * user's own EIP-1193 wallet confirmation. Real USDC is irrevocable.
 */
import { encodeFunctionData, getAddress, isAddress, parseAbi, parseUnits, toEventSelector, type Address, type Hex } from 'viem';
import { getMainnetChain } from '../config/mainnetCatalog.js';

export const ARC_MAINNET_CHAIN_ID = 5042;
export const ARC_MAINNET_USDC = '0x3600000000000000000000000000000000000000' as Address;
export const MAX_MAINNET_CANARY_UNITS = 1_000_000n; // 1 real USDC maximum per review
const FEE_RESERVE_MULTIPLIER = 2n;
const NATIVE_WEI_PER_USDC_BASE_UNIT = 1_000_000_000_000n; // native 18 decimals; ERC-20 6 decimals
const HEX = /^0x[0-9a-fA-F]+$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const TRANSFER = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);
const DECIMALS = '0x313ce567';
const TRANSFER_TOPIC = toEventSelector('Transfer(address,address,uint256)');
const ARC = getMainnetChain(ARC_MAINNET_CHAIN_ID);
const RPC = 'https://rpc.mainnet.arc.io'; // never user-controlled

export interface MainnetWallet {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
}
export type MainnetPlan = { from: Address; to: Address; token: Address; amount: string; units: bigint; data: Hex };
export type MainnetPreflight = { balance: bigint; gasLimit: bigint; gasPrice: bigint; feeReserveUnits: bigint };
export type MainnetReconciliation =
  | { state: 'PENDING'; hash: Hex; indexed: boolean }
  | { state: 'REVERTED'; hash: Hex }
  | { state: 'VERIFIED'; hash: Hex; blockHash: Hex; blockNumber: bigint; feeWei: bigint; explorerUrl: string };

function fail(message: string): never { throw new Error(message); }
function checkedHex(value: unknown): Hex {
  if (typeof value !== 'string' || !HEX.test(value)) return fail('Arc RPC returned invalid hexadecimal data.');
  return value as Hex;
}
function checkedQuantity(value: unknown): bigint { return BigInt(checkedHex(value)); }

export function assertArcMainnetCatalog(): void {
  if (!ARC || ARC.chainId !== ARC_MAINNET_CHAIN_ID || ARC.cctpDomain !== 26 ||
    ARC.usdc.toLowerCase() !== ARC_MAINNET_USDC.toLowerCase() ||
    ARC.rpcEnvKey !== 'ARC_MAINNET_RPC_URL' || ARC.explorerUrl !== 'https://explorer.arc.io') {
    fail('Arc Mainnet is not verified in the Veyra catalog. All operations are blocked.');
  }
}
export function buildMainnetPayPlan(from: string, to: string, amount: string): MainnetPlan {
  assertArcMainnetCatalog();
  if (!isAddress(from) || !isAddress(to)) fail('Enter complete EVM wallet addresses.');
  const sender = getAddress(from), recipient = getAddress(to);
  if (sender.toLowerCase() === recipient.toLowerCase() ||
    recipient === '0x0000000000000000000000000000000000000000') {
    fail('The recipient cannot be the sender or zero address.');
  }
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(amount)) {
    fail('Amount must be a decimal string with at most 6 places.');
  }
  const units = parseUnits(amount, 6);
  if (units < 1n || units > MAX_MAINNET_CANARY_UNITS) fail('Mainnet canary limit: 0.000001–1 USDC per transfer.');
  return { from: sender, to: recipient, token: getAddress(ARC_MAINNET_USDC), amount, units,
    data: encodeFunctionData({ abi: TRANSFER, functionName: 'transfer', args: [recipient, units] }) };
}
export function assertUntamperedMainnetPlan(plan: MainnetPlan): MainnetPlan {
  const rebuilt = buildMainnetPayPlan(plan.from, plan.to, plan.amount);
  if (plan.from !== rebuilt.from || plan.to !== rebuilt.to || plan.token !== rebuilt.token ||
    plan.units !== rebuilt.units || plan.data !== rebuilt.data) {
    fail('Payment details changed after review. Start again.');
  }
  return rebuilt;
}
export async function arcMainnetRpc(method: string, params: unknown[]): Promise<unknown> {
  assertArcMainnetCatalog();
  let raw: unknown;
  try {
    const response = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) fail('Arc Mainnet RPC is unavailable.');
    raw = await response.json();
  } catch {
    fail('Arc Mainnet RPC request failed. Do not retry a transaction without checking its status.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Untrusted Arc Mainnet RPC response.');
  const json = raw as Record<string, unknown>;
  if (json.jsonrpc !== '2.0' || json.id !== 1 || Object.hasOwn(json, 'error') ||
    !Object.hasOwn(json, 'result')) fail('Untrusted Arc Mainnet RPC response.');
  return json.result;
}
export async function assertArcMainnetNetwork(): Promise<void> {
  if (checkedQuantity(await arcMainnetRpc('eth_chainId', [])) !== BigInt(ARC_MAINNET_CHAIN_ID)) {
    fail('RPC network mismatch: expected Arc Mainnet 5042. Execution disabled.');
  }
}
async function assertWalletIdentity(wallet: MainnetWallet, from: Address): Promise<void> {
  const [chain, accounts] = await Promise.all([
    wallet.request({ method: 'eth_chainId' }),
    wallet.request({ method: 'eth_accounts' }),
  ]);
  if (checkedQuantity(chain) !== BigInt(ARC_MAINNET_CHAIN_ID)) fail('Switch your wallet to Arc Mainnet (5042) manually.');
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || !isAddress(accounts[0]) ||
    getAddress(accounts[0]) !== from) fail('Wallet account changed since review.');
}
export function reserveGasInUsdcUnits(gasLimit: bigint, gasPrice: bigint): bigint {
  if (gasLimit <= 0n || gasPrice <= 0n) fail('Invalid gas estimate.');
  const wei = gasLimit * gasPrice * FEE_RESERVE_MULTIPLIER;
  return (wei + NATIVE_WEI_PER_USDC_BASE_UNIT - 1n) / NATIVE_WEI_PER_USDC_BASE_UNIT;
}
export async function mainnetPreflight(wallet: MainnetWallet, plan: MainnetPlan): Promise<MainnetPreflight> {
  const reviewed = assertUntamperedMainnetPlan(plan);
  await assertArcMainnetNetwork();
  await assertWalletIdentity(wallet, reviewed.from);
  const [decimalsRaw, balanceRaw, simulationRaw, gasRaw, priceRaw] = await Promise.all([
    arcMainnetRpc('eth_call', [{ to: reviewed.token, data: DECIMALS }, 'latest']),
    arcMainnetRpc('eth_call', [{ to: reviewed.token,
      data: `0x70a08231${reviewed.from.slice(2).toLowerCase().padStart(64, '0')}` }, 'latest']),
    arcMainnetRpc('eth_call', [{ from: reviewed.from, to: reviewed.token, data: reviewed.data, value: '0x0' }, 'latest']),
    arcMainnetRpc('eth_estimateGas', [{ from: reviewed.from, to: reviewed.token, data: reviewed.data, value: '0x0' }]),
    arcMainnetRpc('eth_gasPrice', []),
  ]);
  if (checkedQuantity(decimalsRaw) !== 6n) fail('Arc USDC interface decimals mismatch. Payment blocked.');
  const simulated = checkedHex(simulationRaw);
  if (simulated !== '0x' && BigInt(simulated) !== 1n) fail('USDC transfer simulation did not approve execution.');
  const balance = checkedQuantity(balanceRaw);
  const gasLimit = checkedQuantity(gasRaw), gasPrice = checkedQuantity(priceRaw);
  const feeReserveUnits = reserveGasInUsdcUnits(gasLimit, gasPrice);
  // Arc ERC-20 balance and native fee balance are the SAME underlying USDC.
  if (balance < reviewed.units + feeReserveUnits) {
    fail('Insufficient Arc USDC for amount plus estimated network fee reserve.');
  }
  return { balance, gasLimit, gasPrice, feeReserveUnits };
}
export async function requestMainnetCanaryTransfer(
  wallet: MainnetWallet, plan: MainnetPlan, onWalletRequest: () => void,
): Promise<Hex> {
  if (import.meta.env.VITE_VEYRA_MAINNET_PAY !== '1') fail('Mainnet signing is disabled in this build.');
  const reviewed = assertUntamperedMainnetPlan(plan);
  await mainnetPreflight(wallet, reviewed);
  // Repeat both identity checks directly before invoking the wallet.
  await assertArcMainnetNetwork();
  await assertWalletIdentity(wallet, reviewed.from);
  onWalletRequest();
  const hash = await wallet.request({ method: 'eth_sendTransaction',
    params: [{ from: reviewed.from, to: reviewed.token, data: reviewed.data, value: '0x0' }] });
  if (typeof hash !== 'string' || !HASH.test(hash)) fail('Wallet submission is uncertain. Do not retry.');
  return hash as Hex;
}
function topicAddress(address: Address): string { return `0x${address.slice(2).toLowerCase().padStart(64, '0')}`; }
export function mainnetExplorerTx(hash: string): string {
  if (!HASH.test(hash)) fail('Invalid transaction hash.');
  assertArcMainnetCatalog();
  return `${ARC!.explorerUrl}/tx/${hash}`;
}
export async function reconcileMainnetCanary(plan: MainnetPlan, hash: string): Promise<MainnetReconciliation> {
  if (!HASH.test(hash)) fail('Enter a valid transaction hash.');
  const reviewed = assertUntamperedMainnetPlan(plan);
  await assertArcMainnetNetwork();
  const rawTx = await arcMainnetRpc('eth_getTransactionByHash', [hash]);
  if (!rawTx) return { state: 'PENDING', hash: hash as Hex, indexed: false };
  if (typeof rawTx !== 'object' || Array.isArray(rawTx)) fail('Malformed indexed transaction.');
  const tx = rawTx as Record<string, unknown>;
  if (typeof tx.hash !== 'string' || tx.hash.toLowerCase() !== hash.toLowerCase() ||
    typeof tx.from !== 'string' || tx.from.toLowerCase() !== reviewed.from.toLowerCase() ||
    typeof tx.to !== 'string' || tx.to.toLowerCase() !== reviewed.token.toLowerCase() ||
    typeof tx.input !== 'string' || tx.input.toLowerCase() !== reviewed.data.toLowerCase() ||
    checkedQuantity(tx.value) !== 0n) fail('Indexed transaction differs from the reviewed payment.');
  const rawReceipt = await arcMainnetRpc('eth_getTransactionReceipt', [hash]);
  if (!rawReceipt) return { state: 'PENDING', hash: hash as Hex, indexed: true };
  if (typeof rawReceipt !== 'object' || Array.isArray(rawReceipt)) fail('Malformed transaction receipt.');
  const receipt = rawReceipt as Record<string, unknown>;
  if (typeof receipt.transactionHash !== 'string' || receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
    typeof receipt.blockHash !== 'string' || !HASH.test(receipt.blockHash) ||
    checkedQuantity(receipt.blockNumber) < 0n) fail('Transaction receipt does not identify a finalized block.');
  if (receipt.status !== '0x1' && receipt.status !== '0x0') fail('Unknown receipt status.');
  const block = await arcMainnetRpc('eth_getBlockByNumber', [receipt.blockNumber, false]);
  if (!block || typeof block !== 'object' || Array.isArray(block) ||
    (block as { hash?: unknown }).hash !== receipt.blockHash) fail('Receipt block hash does not match canonical block.');
  if (receipt.status === '0x0') return { state: 'REVERTED', hash: hash as Hex };
  if (!Array.isArray(receipt.logs) || !receipt.logs.some((item: unknown) => {
    if (!item || typeof item !== 'object') return false;
    const log = item as { address?: string; topics?: string[]; data?: string };
    return log.address?.toLowerCase() === reviewed.token.toLowerCase() &&
      Array.isArray(log.topics) && log.topics.length === 3 &&
      log.topics[0]?.toLowerCase() === TRANSFER_TOPIC.toLowerCase() &&
      log.topics[1]?.toLowerCase() === topicAddress(reviewed.from) &&
      log.topics[2]?.toLowerCase() === topicAddress(reviewed.to) &&
      typeof log.data === 'string' && HEX.test(log.data) && BigInt(log.data) === reviewed.units;
  })) fail('Successful receipt has no matching USDC Transfer event.');
  return { state: 'VERIFIED', hash: hash as Hex, blockHash: receipt.blockHash as Hex,
    blockNumber: checkedQuantity(receipt.blockNumber),
    feeWei: checkedQuantity(receipt.gasUsed) * checkedQuantity(receipt.effectiveGasPrice),
    explorerUrl: mainnetExplorerTx(hash) };
}
