/**
 * Dedicated Phase 8H identity browser pilot.
 * No chain switching, USDC transfers, payment signatures or transaction RPCs.
 * The ONLY wallet signature is an explicitly verified EIP-712 identity/login.
 */
export const ARC_TESTNET_CHAIN_ID = 5042002;
export const BFF_ORIGIN = 'https://veyra-testnet-acceptance-bff.onrender.com';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

type ObjectLike = Record<string, unknown>;
export interface BrowserProvider {
  request(options: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(name: string, listener: (...args: unknown[]) => void): void;
  removeListener?(name: string, listener: (...args: unknown[]) => void): void;
}
export interface IdentityProfile {
  veyraUserId: string;
  veyraHandle: string;
  displayName: string;
}
export interface Friend {
  veyraUserId: string;
  state: 'CONNECTED' | 'INCOMING_PENDING' | 'OUTGOING_PENDING';
  updatedAt: string;
}
export interface SignedChallenge {
  typedData: ObjectLike;
  challengeId?: string;
  claimToken?: string;
}
function obj(value: unknown): ObjectLike {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Unexpected identity verification response.');
  }
  return value as ObjectLike;
}
function valueString(record: ObjectLike, field: string): string {
  if (typeof record[field] !== 'string') throw new Error('Invalid signature field: ' + field);
  return record[field];
}
function valueInteger(record: ObjectLike, field: string): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error('Invalid signature field: ' + field);
  }
  return value;
}
function expectedTypes(value: unknown, fields: readonly string[]): void {
  if (!Array.isArray(value) || value.length !== fields.length) {
    throw new Error('Unrecognized wallet signature request.');
  }
  for (let i = 0; i < fields.length; i++) {
    const field = obj(value[i]);
    const [name, type] = fields[i]!.split(':');
    if (field.name !== name || field.type !== type) {
      throw new Error('Unrecognized wallet signature request.');
    }
  }
}

export function parseArcChainId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  const n = Number.parseInt(value, 16);
  return Number.isSafeInteger(n) ? n : null;
}

export function requireArcWallet(address: unknown, chainId: number | null): string {
  if (typeof address !== 'string' || !ADDRESS.test(address)) {
    throw new Error('Connect a supported browser wallet before continuing.');
  }
  if (chainId !== ARC_TESTNET_CHAIN_ID) {
    throw new Error('Switch your wallet to Arc Testnet (chain ID 5042002) manually. No automatic network switch.');
  }
  return address;
}

export function normalizeBetaHandle(value: string): string {
  const handle = value.trim().replace(/^@/, '').toLowerCase();
  if (handle.length < 3 || handle.length > 30 || !/^[a-z0-9_]+$/.test(handle) ||
      handle.startsWith('_') || handle.endsWith('_') || handle.includes('__')) {
    throw new Error('Veyra ID must be 3–30 letters, numbers or single underscores (no edge underscores).');
  }
  return handle;
}

/**
 * Verify the *entire* server-owned signing request before any wallet popup.
 * A compromised backend/request cannot silently turn "Sign in" into a
 * transfer/approval/unrelated EIP-712 signature through this browser pilot.
 */
export function verifiedTypedData(
  challenge: SignedChallenge,
  mode: 'register' | 'login',
  address: string,
  origin: string,
): ObjectLike {
  const data = obj(challenge.typedData);
  const domain = obj(data.domain);
  const message = obj(data.message);
  const types = obj(data.types);
  const isLogin = mode === 'login';
  if (domain.name !== (isLogin ? 'Veyra Login' : 'Veyra') ||
      domain.version !== '1' || domain.chainId !== ARC_TESTNET_CHAIN_ID ||
      String(domain.verifyingContract).toLowerCase() !== ZERO_ADDRESS ||
      data.primaryType !== (isLogin ? 'WalletLogin' : 'IdentityClaim')) {
    throw new Error('Unexpected domain, chain, or signing purpose. Signature cancelled.');
  }
  const expected = isLogin
    ? ['veyraUserId:string','walletAddress:address','chainId:uint256','nonce:bytes32',
       'issuedAt:uint256','expiresAt:uint256','appOrigin:string','purpose:string']
    : ['handle:string','walletAddress:address','chainId:uint256','nonce:bytes32',
       'issuedAt:uint256','expiresAt:uint256'];
  expectedTypes(types[isLogin ? 'WalletLogin' : 'IdentityClaim'], expected);
  if (valueString(message, 'walletAddress').toLowerCase() !== address.toLowerCase() ||
      valueInteger(message, 'chainId') !== ARC_TESTNET_CHAIN_ID ||
      !/^0x[0-9a-fA-F]{64}$/.test(valueString(message, 'nonce'))) {
    throw new Error('Wallet, chain or nonce mismatch. Signature cancelled.');
  }
  const now = Date.now();
  const issued = valueInteger(message, 'issuedAt');
  const expires = valueInteger(message, 'expiresAt');
  const max = isLogin ? 5 * 60_000 : 10 * 60_000;
  if (issued > now + 30_000 || expires <= now || expires - issued > max || expires <= issued) {
    throw new Error('Signature challenge is expired or invalid. Please retry.');
  }
  if (isLogin) {
    if (message.appOrigin !== origin ||
        message.purpose !== 'Sign in to Veyra Testnet. No payments or transfers.' ||
        !/^usr_[1-9A-HJ-NP-Za-km-z]{10,}$/.test(valueString(message, 'veyraUserId')) ||
        !/^lgn_[0-9a-f]{32}$/.test(challenge.challengeId ?? '')) {
      throw new Error('Unexpected login origin or purpose. Signature cancelled.');
    }
  } else if (normalizeBetaHandle(valueString(message, 'handle')) !== message.handle ||
             typeof challenge.claimToken !== 'string' || challenge.claimToken.length < 30) {
    throw new Error('Unexpected registration claim. Signature cancelled.');
  }
  return data;
}

export function readProvider(): BrowserProvider | null {
  const injected: unknown = (window as unknown as { ethereum?: unknown }).ethereum;
  if (injected && typeof injected === 'object' && 'request' in injected &&
      typeof injected.request === 'function') {
    return injected as BrowserProvider;
  }
  return null;
}

export async function requireMatchingAccount(provider: BrowserProvider, address: string): Promise<void> {
  const accounts = await provider.request({ method: 'eth_accounts' });
  const chain = parseArcChainId(await provider.request({ method: 'eth_chainId' }));
  const current = Array.isArray(accounts) ? accounts[0] : undefined;
  requireArcWallet(current, chain);
  if (typeof current !== 'string' || current.toLowerCase() !== address.toLowerCase()) {
    throw new Error('Your connected wallet changed during signing. Please reconnect.');
  }
}

export async function signReviewedIdentity(
  provider: BrowserProvider,
  challenge: SignedChallenge,
  mode: 'register' | 'login',
  address: string,
  origin: string,
): Promise<`0x${string}`> {
  await requireMatchingAccount(provider, address);
  const data = verifiedTypedData(challenge, mode, address, origin);
  const result = await provider.request({
    method: 'eth_signTypedData_v4',
    params: [address, JSON.stringify(data)],
  });
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(result)) {
    throw new Error('The wallet did not return a valid signature.');
  }
  await requireMatchingAccount(provider, address);
  return result as `0x${string}`;
}
