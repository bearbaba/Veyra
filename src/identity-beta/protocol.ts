/**
 * Dedicated Phase 8H identity browser pilot.
 * No chain switching, USDC transfers, payment signatures or transaction RPCs.
 * The ONLY wallet signature is an explicitly verified EIP-712 identity/login.
 */
import { getAddress, recoverTypedDataAddress, zeroAddress, type Address, type Hex } from 'viem';

export const ARC_TESTNET_CHAIN_ID = 5042002;
export const BFF_ORIGIN = 'https://veyra-testnet-acceptance-bff.onrender.com';

/**
 * EIP-712 v4 providers (including MetaMask) require EIP712Domain to be
 * declared in the signature JSON. Viem reconstructs it from `domain`
 * when recovering a signature; an omitted wallet-side type risks the wallet
 * signing a different domain digest than our server verifies.
 * These exact fields match our server canonical claimDomain and loginDomain.
 */
export const EIP712_DOMAIN_FIELDS = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
] as const;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

type ObjectLike = Record<string, unknown>;
export interface BrowserProvider {
  request(options: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(name: string, listener: (...args: unknown[]) => void): void;
  removeListener?(name: string, listener: (...args: unknown[]) => void): void;
}
/** Linked X social proof belongs to the existing Veyra ID; it never signs payments. */
export interface LinkedXProfile {
  xAccountId: string;
  xHandle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  lastRefreshedAt: string | null;
}
export interface IdentityProfile {
  veyraUserId: string;
  veyraHandle: string;
  displayName: string;
  x?: LinkedXProfile | null;
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
    const [name, type] = fields[i].split(':');
    if (field.name !== name || field.type !== type) {
      throw new Error('Unrecognized wallet signature request.');
    }
  }
}

/**
 * Make the MetaMask EIP-712 v4 signature payload explicit and deterministic.
 * Never accept arbitrary server-specified EIP712Domain or extra typed structs.
 */
export function walletV4TypedData(checked: ObjectLike): ObjectLike {
  const types = obj(checked.types);
  const primary = checked.primaryType;
  if (typeof primary !== 'string' || Object.keys(types).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(types, primary) ||
      Object.prototype.hasOwnProperty.call(types, 'EIP712Domain')) {
    throw new Error('Unexpected wallet signing types. Signature cancelled.');
  }
  return {
    ...checked,
    types: { EIP712Domain: EIP712_DOMAIN_FIELDS, ...types },
  };
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

/**
 * Hosted pilot accepts only X's official OAuth authorization endpoint, with
 * a callback pinned to this Testnet BFF. Never open an unchecked server URL.
 */
export function verifyXAuthorizationUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 4096) {
    throw new Error('Invalid X authorization URL. No redirect opened.');
  }
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error('Invalid X authorization URL. No redirect opened.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'x.com' || url.port ||
      url.username || url.password || url.hash || url.pathname !== '/i/oauth2/authorize' ||
      url.searchParams.get('response_type') !== 'code' ||
      url.searchParams.get('code_challenge_method') !== 'S256' ||
      !/^[-_A-Za-z0-9]{20,}$/.test(url.searchParams.get('state') ?? '') ||
      !/^[-_A-Za-z0-9]{20,}$/.test(url.searchParams.get('code_challenge') ?? '') ||
      url.searchParams.get('redirect_uri') !== BFF_ORIGIN + '/api/auth/x/callback') {
    throw new Error('Unexpected X OAuth destination or callback. Authorization blocked.');
  }
  return url.toString();
}

export function readProvider(): BrowserProvider | null {
  const injected: unknown = (window as unknown as { ethereum?: unknown }).ethereum;
  if (injected && typeof injected === 'object' && 'request' in injected &&
      typeof injected.request === 'function') {
    return injected as BrowserProvider;
  }
  return null;
}

/**
 * Independently recover the signer in the browser before POSTing a signature.
 * This detects wallets/extensions signing under a different EOA or an
 * unexpected EIP-712 hash. We do not print the signature or recovered address.
 *
 * The backend remains the only authority that can issue a Veyra ID.
 */
export async function assertBrowserSignedIdentityOwner(
  challenge: SignedChallenge,
  mode: 'register' | 'login',
  address: string,
  origin: string,
  signature: `0x${string}`,
): Promise<void> {
  const data = verifiedTypedData(challenge, mode, address, origin);
  const message = obj(data.message);
  const domain = {
    name: mode === 'register' ? 'Veyra' : 'Veyra Login',
    version: '1',
    chainId: ARC_TESTNET_CHAIN_ID,
    verifyingContract: zeroAddress,
  } as const;
  const walletAddress = valueString(message, 'walletAddress') as Address;
  const shared = {
    walletAddress,
    chainId: BigInt(valueInteger(message, 'chainId')),
    nonce: valueString(message, 'nonce') as Hex,
    issuedAt: BigInt(valueInteger(message, 'issuedAt')),
    expiresAt: BigInt(valueInteger(message, 'expiresAt')),
  };
  let recovered: Address;
  try {
    if (mode === 'register') {
      recovered = await recoverTypedDataAddress({
        domain,
        types: {
          IdentityClaim: [
            { name: 'handle', type: 'string' },
            { name: 'walletAddress', type: 'address' },
            { name: 'chainId', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
            { name: 'issuedAt', type: 'uint256' },
            { name: 'expiresAt', type: 'uint256' },
          ],
        },
        primaryType: 'IdentityClaim',
        message: { handle: valueString(message, 'handle'), ...shared },
        signature,
      });
    } else {
      recovered = await recoverTypedDataAddress({
        domain,
        types: {
          WalletLogin: [
            { name: 'veyraUserId', type: 'string' },
            { name: 'walletAddress', type: 'address' },
            { name: 'chainId', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
            { name: 'issuedAt', type: 'uint256' },
            { name: 'expiresAt', type: 'uint256' },
            { name: 'appOrigin', type: 'string' },
            { name: 'purpose', type: 'string' },
          ],
        },
        primaryType: 'WalletLogin',
        message: {
          veyraUserId: valueString(message, 'veyraUserId'),
          ...shared,
          appOrigin: valueString(message, 'appOrigin'),
          purpose: valueString(message, 'purpose'),
        },
        signature,
      });
    }
  } catch {
    throw new Error(
      'The wallet signature could not be independently verified. Reconnect one wallet extension and request a fresh challenge.',
    );
  }
  if (getAddress(recovered) !== getAddress(address)) {
    throw new Error(
      'The wallet signed with a different account than the connected address. Check your active MetaMask/Rabby account and disable conflicting wallet extensions before trying again.',
    );
  }
}

export async function requireMatchingAccount(provider: BrowserProvider, address: string): Promise<void> {
  const accounts = await provider.request({ method: 'eth_accounts' });
  const chain = parseArcChainId(await provider.request({ method: 'eth_chainId' }));
  const current: unknown = Array.isArray(accounts) ? accounts[0] : undefined;
  requireArcWallet(current, chain);
  if (typeof current !== 'string' || current.toLowerCase() !== address.toLowerCase()) {
    throw new Error('Your connected wallet changed during signing. Please reconnect.');
  }
}

/**
 * Wallet extensions may leave an eth_signTypedData_v4 promise unresolved when
 * their popup is behind Chrome or a request is queued. We cannot cancel a
 * provider RPC. Expiring only Veyra's *wait* prevents a permanently frozen UI;
 * a late signature is ignored and is NEVER forwarded automatically.
 */
export const WALLET_RESPONSE_TIMEOUT_MS = 90_000;
export async function awaitWalletResponse<T>(
  response: Promise<T>, timeoutMs = WALLET_RESPONSE_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      response,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(
          'No response from your wallet. Open MetaMask and reject any old pending signature before retrying. Veyra did not submit this claim.',
        )), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
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
  const walletData = walletV4TypedData(data);
  const result = await awaitWalletResponse(provider.request({
    method: 'eth_signTypedData_v4',
    params: [address, JSON.stringify(walletData)],
  }));
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(result)) {
    throw new Error('The wallet did not return a valid signature.');
  }
  await requireMatchingAccount(provider, address);
  await assertBrowserSignedIdentityOwner(challenge, mode, address, origin, result as `0x${string}`);
  return result as `0x${string}`;
}
