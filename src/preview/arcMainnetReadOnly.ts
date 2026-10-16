/**
 * Public Arc Mainnet READ-ONLY observations for the unified Veyra workspace.
 * No wallet-signing methods, private keys, or money-moving provider imports.
 * This is deliberately separate from the isolated Phase 6 signing engine.
 */
import { encodeFunctionData, getAddress, isAddress, parseAbi, parseUnits, type Address } from 'viem';
import { getMainnetChain } from '../config/mainnetCatalog';

export const PREVIEW_ARC_MAINNET_CHAIN_ID = 5042;
export const PREVIEW_ARC_MAINNET_RPC = 'https://rpc.mainnet.arc.io';
export const PREVIEW_ARC_MAINNET_USDC = '0x3600000000000000000000000000000000000000' as Address;
export const PREVIEW_MAINNET_CANARY_MAX = 1_000_000n;
const NATIVE_TO_ERC20_UNITS = 1_000_000_000_000n; // 18 native decimals versus 6 ERC-20 decimals.
const HEX_RE = /^0x[0-9a-fA-F]+$/;
const TRANSFER_ABI = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);
const ARC = getMainnetChain(PREVIEW_ARC_MAINNET_CHAIN_ID);

export interface MainnetBalanceSnapshot { chainId: number; address: Address; units: bigint; decimals: 6 }
export interface MainnetQuote {
  sender: Address; recipient: Address; amount: string; units: bigint;
  token: Address; calldata: `0x${string}`; gasLimit: bigint; gasPrice: bigint;
  feeReserveUnits: bigint; availableUnits: bigint;
}

function fail(message: string): never { throw new Error(message); }
function strictQuantity(value: unknown): bigint {
  if (typeof value !== 'string' || !HEX_RE.test(value)) fail('Arc Mainnet RPC returned invalid hexadecimal data.');
  return BigInt(value);
}
export function assertMainnetReadCatalog(): void {
  if (!ARC || ARC.chainId !== 5042 || ARC.cctpDomain !== 26 ||
      ARC.usdc.toLowerCase() !== PREVIEW_ARC_MAINNET_USDC.toLowerCase() ||
      ARC.explorerUrl !== 'https://explorer.arc.io') fail('Arc Mainnet catalog mismatch: reads disabled.');
}
export async function mainnetReadRpc(method: string, params: unknown[]): Promise<unknown> {
  assertMainnetReadCatalog();
  let json: unknown;
  try {
    const response = await fetch(PREVIEW_ARC_MAINNET_RPC, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) fail('Arc Mainnet RPC is temporarily unavailable.');
    json = await response.json();
  } catch {
    fail('Arc Mainnet RPC is temporarily unavailable. No financial action was requested.');
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) fail('Arc Mainnet RPC returned an untrusted response.');
  const envelope = json as Record<string, unknown>;
  if (envelope.jsonrpc !== '2.0' || envelope.id !== 1 ||
      Object.prototype.hasOwnProperty.call(envelope, 'error') ||
      !Object.prototype.hasOwnProperty.call(envelope, 'result')) {
    fail('Arc Mainnet RPC returned an untrusted response.');
  }
  return envelope.result;
}
export async function verifyMainnetReadChain(): Promise<void> {
  if (strictQuantity(await mainnetReadRpc('eth_chainId', [])) !== 5042n) {
    fail('RPC chain mismatch: expected Arc Mainnet 5042.');
  }
}
function tokenCall(data: string, from?: Address): unknown[] {
  return [{ to: PREVIEW_ARC_MAINNET_USDC, data, ...(from ? { from } : {}) }, 'latest'];
}
function balanceCalldata(address: Address): string {
  return `0x70a08231${address.slice(2).toLowerCase().padStart(64, '0')}`;
}
export async function readMainnetBalance(address: string): Promise<MainnetBalanceSnapshot> {
  if (!isAddress(address)) fail('Connect a valid EVM wallet address first.');
  await verifyMainnetReadChain();
  const owner = getAddress(address);
  const [decimals, balance] = await Promise.all([
    mainnetReadRpc('eth_call', tokenCall('0x313ce567')),
    mainnetReadRpc('eth_call', tokenCall(balanceCalldata(owner))),
  ]);
  if (strictQuantity(decimals) !== 6n) fail('Unexpected Arc USDC decimals: balance read blocked.');
  return { chainId: PREVIEW_ARC_MAINNET_CHAIN_ID, address: owner,
    units: strictQuantity(balance), decimals: 6 };
}
export function createReadOnlyMainnetIntent(sender: string, destination: string, amount: string) {
  assertMainnetReadCatalog();
  if (!isAddress(sender) || !isAddress(destination)) fail('Use complete EVM wallet addresses (0x…).');
  const from = getAddress(sender), to = getAddress(destination);
  if (from.toLowerCase() === to.toLowerCase() || to === '0x0000000000000000000000000000000000000000') {
    fail('Recipient must be nonzero and different from the sender.');
  }
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(amount)) {
    fail('Use an exact decimal USDC amount with at most 6 decimal places.');
  }
  const units = parseUnits(amount, 6);
  if (units <= 0n || units > PREVIEW_MAINNET_CANARY_MAX) fail('The Mainnet Lab canary preview is limited to 1 USDC.');
  const calldata = encodeFunctionData({ abi: TRANSFER_ABI, functionName: 'transfer', args: [to, units] });
  return { sender: from, recipient: to, amount, units, token: getAddress(PREVIEW_ARC_MAINNET_USDC), calldata };
}
export function mainnetGasReserve(gasLimit: bigint, gasPrice: bigint): bigint {
  if (gasLimit <= 0n || gasPrice <= 0n) fail('Invalid Arc network gas estimate.');
  return (2n * gasLimit * gasPrice + NATIVE_TO_ERC20_UNITS - 1n) / NATIVE_TO_ERC20_UNITS;
}
export async function simulateReadOnlyMainnetIntent(
  sender: string, destination: string, amount: string,
): Promise<MainnetQuote> {
  const intent = createReadOnlyMainnetIntent(sender, destination, amount);
  await verifyMainnetReadChain();
  const transaction = { from: intent.sender, to: intent.token, data: intent.calldata, value: '0x0' };
  const [decimals, balance, simulated, estimatedGas, gasPrice] = await Promise.all([
    mainnetReadRpc('eth_call', tokenCall('0x313ce567')),
    mainnetReadRpc('eth_call', tokenCall(balanceCalldata(intent.sender))),
    mainnetReadRpc('eth_call', [transaction, 'latest']),
    mainnetReadRpc('eth_estimateGas', [transaction]),
    mainnetReadRpc('eth_gasPrice', []),
  ]);
  if (strictQuantity(decimals) !== 6n) fail('Arc USDC decimals mismatch. Simulation rejected.');
  if (typeof simulated !== 'string' || (simulated !== '0x' && strictQuantity(simulated) !== 1n)) {
    fail('USDC transfer simulation did not return success.');
  }
  const availableUnits = strictQuantity(balance);
  const gasLimit = strictQuantity(estimatedGas), price = strictQuantity(gasPrice);
  const feeReserveUnits = mainnetGasReserve(gasLimit, price);
  if (availableUnits < intent.units + feeReserveUnits) {
    fail('Insufficient Arc USDC for the payment and estimated gas reserve.');
  }
  return { ...intent, gasLimit, gasPrice: price, feeReserveUnits, availableUnits };
}
