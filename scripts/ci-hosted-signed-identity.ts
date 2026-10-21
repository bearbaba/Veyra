/**
 * Test-only signed EIP-712 identity registration across the real HTTP BFF.
 * Uses two ephemeral, never-funded private keys generated inside ephemeral CI.
 * No private keys or tokens are logged, committed, or shipped to the frontend.
 *
 * Runs only after `ci-hosted-social-http.ts bootstrap` starts the actual
 * production-shaped BFF against fresh GitHub Actions PostgreSQL.
 */
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const ARC_TESTNET = 5042002;
const HOST = 'http://127.0.0.1:3001';
const ORIGIN = 'https://veyra.example';

assert.equal(process.env.CI, 'true', 'Signed wallet acceptance is CI-only.');
assert.equal(process.env.DATABASE_ADMIN_URL?.includes('127.0.0.1'), true,
  'Signed wallet acceptance requires the isolated loopback database.');

interface Challenge {
  claimToken: string;
  typedData: {
    domain: {name: string; version: string; chainId: number; verifyingContract: `0x${string}`};
    types: {IdentityClaim: Array<{name: string; type: string}>};
    primaryType: 'IdentityClaim';
    message: {
      handle: string; walletAddress: `0x${string}`; chainId: number;
      nonce: `0x${string}`; issuedAt: number; expiresAt: number;
    };
  };
}
interface Profile { veyraUserId: string; veyraHandle: string; }
interface Reply { ok?: boolean; error?: string; message?: string; challenge?: Challenge; profile?: Profile; sessionToken?: string; veyraUserId?: string; items?: Array<{veyraUserId: string; state: string}>; }

async function http(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  bearer?: string,
): Promise<{status: number; payload: Reply}> {
  const headers: Record<string, string> = {Origin: ORIGIN};
  if (body) headers['Content-Type'] = 'application/json';
  if (bearer) headers.Authorization = 'Bearer ' + bearer;
  const response = await fetch(HOST + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  return {status: response.status, payload: await response.json() as Reply};
}

function checkedChallenge(value: Challenge, address: string, handle: string): Challenge {
  assert.equal(value.typedData.domain.name, 'Veyra');
  assert.equal(value.typedData.domain.version, '1');
  assert.equal(value.typedData.domain.chainId, ARC_TESTNET);
  assert.equal(value.typedData.domain.verifyingContract, '0x0000000000000000000000000000000000000000');
  assert.equal(value.typedData.primaryType, 'IdentityClaim');
  assert.equal(value.typedData.message.walletAddress.toLowerCase(), address.toLowerCase());
  assert.equal(value.typedData.message.chainId, ARC_TESTNET);
  assert.equal(value.typedData.message.handle, handle);
  assert.deepEqual(value.typedData.types.IdentityClaim.map(({name, type}) => [name,type]), [
    ['handle', 'string'], ['walletAddress', 'address'], ['chainId', 'uint256'],
    ['nonce', 'bytes32'], ['issuedAt', 'uint256'], ['expiresAt', 'uint256'],
  ]);
  assert.ok(value.claimToken.length > 30);
  assert.ok(Date.now() < value.typedData.message.expiresAt);
  return value;
}

async function signedClaim(challenge: Challenge, privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);
  const { typedData } = challenge;
  return account.signTypedData({
    domain: typedData.domain,
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
    message: {
      ...typedData.message,
      chainId: BigInt(typedData.message.chainId),
      issuedAt: BigInt(typedData.message.issuedAt),
      expiresAt: BigInt(typedData.message.expiresAt),
    },
  });
}

const aliceKey = generatePrivateKey();
const bobKey = generatePrivateKey();
const alice = privateKeyToAccount(aliceKey);
const bob = privateKeyToAccount(bobKey);

for (const id of [5042, 1, 84532, 11155111]) {
  const denied = await http('POST', '/api/identity/register/challenge', {
    handle: 'wrongtestnet' + id, walletAddress: alice.address, chainId: id,
  });
  assert.equal(denied.status, 400, 'wrong chain must be rejected before any signature');
  assert.equal(denied.payload.error, 'UNSUPPORTED_TESTNET_CHAIN');
}

async function begin(handle: string, walletAddress: string) {
  const r = await http('POST', '/api/identity/register/challenge', {
    handle, walletAddress, chainId: ARC_TESTNET,
  });
  assert.equal(r.status, 201, 'EIP-712 claim challenge must be issued: ' + r.payload.error);
  assert.ok(r.payload.challenge);
  return checkedChallenge(r.payload.challenge, walletAddress, handle);
}

const aliceChallenge = await begin('acceptsignedalice', alice.address);
const wrongSignature = await signedClaim(aliceChallenge, bobKey);
const spoof = await http('POST', '/api/identity/register/complete', {
  claimToken: aliceChallenge.claimToken, signature: wrongSignature,
});
assert.equal(spoof.status, 401, 'wrong signer must never claim another address');
assert.equal(spoof.payload.error, 'INVALID_SIGNATURE');

const aliceSignature = await signedClaim(aliceChallenge, aliceKey);
const registeredA = await http('POST', '/api/identity/register/complete', {
  claimToken: aliceChallenge.claimToken, signature: aliceSignature,
});
assert.equal(registeredA.status, 201, 'valid Alice signature should register: ' + registeredA.payload.error);
assert.ok(registeredA.payload.sessionToken);
assert.ok(registeredA.payload.profile?.veyraUserId);

const replay = await http('POST', '/api/identity/register/complete', {
  claimToken: aliceChallenge.claimToken, signature: aliceSignature,
});
assert.equal(replay.status, 409, 'replaying the accepted claim must not create duplicate identity');

const bobChallenge = await begin('acceptsignedbob', bob.address);
const registeredB = await http('POST', '/api/identity/register/complete', {
  claimToken: bobChallenge.claimToken,
  signature: await signedClaim(bobChallenge, bobKey),
});
assert.equal(registeredB.status, 201, 'valid Bob signature should register: ' + registeredB.payload.error);
assert.ok(registeredB.payload.sessionToken);
assert.ok(registeredB.payload.profile?.veyraUserId);
assert.notEqual(registeredA.payload.profile.veyraUserId, registeredB.payload.profile.veyraUserId);

const tokenA = registeredA.payload.sessionToken;
const tokenB = registeredB.payload.sessionToken;
const profileA = await http('GET', '/api/profile/me', undefined, tokenA);
assert.equal(profileA.status, 200);
assert.equal(profileA.payload.profile?.veyraUserId, registeredA.payload.profile.veyraUserId);
const profileB = await http('GET', '/api/profile/me', undefined, tokenB);
assert.equal(profileB.status, 200);
assert.equal(profileB.payload.profile?.veyraUserId, registeredB.payload.profile.veyraUserId);

const anon = await http('GET', '/api/social/friends');
assert.equal(anon.status, 401);

const request = await http('POST', '/api/social/friend/request', {
  veyraUserId: registeredB.payload.profile.veyraUserId,
}, tokenA);
assert.equal(request.status, 200, 'signed identity owner can request friendship');

const inboxB = await http('GET', '/api/social/friends', undefined, tokenB);
assert.equal(inboxB.status, 200);
assert.deepEqual(inboxB.payload.items?.map(x => [x.veyraUserId, x.state]), [
  [registeredA.payload.profile.veyraUserId, 'INCOMING_PENDING'],
]);

const accept = await http('POST', '/api/social/friend/respond', {
  veyraUserId: registeredA.payload.profile.veyraUserId, decision: 'ACCEPT',
}, tokenB);
assert.equal(accept.status, 200, 'Bob can accept the real signed-session friendship');
const finalA = await http('GET', '/api/social/friends', undefined, tokenA);
const finalB = await http('GET', '/api/social/friends', undefined, tokenB);
assert.equal(finalA.payload.items?.[0]?.state, 'CONNECTED');
assert.equal(finalB.payload.items?.[0]?.state, 'CONNECTED');

// Re-login uses a DIFFERENT one-use EIP-712 purpose and a durable PostgreSQL
// challenge. It must not allow binding proofs or stale login prompts.
interface WalletLoginChallenge {
  challengeId: string;
  typedData: {
    domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
    primaryType: 'WalletLogin';
    message: {
      veyraUserId: string; walletAddress: `0x${string}`;
      chainId: number; nonce: `0x${string}`;
      issuedAt: number; expiresAt: number; appOrigin: string; purpose: string;
    };
  };
}
async function loginChallenge(walletAddress: string): Promise<WalletLoginChallenge> {
  const response = await http('POST', '/api/auth/wallet-login/challenge', {
    walletAddress, chainId: ARC_TESTNET,
  });
  assert.equal(response.status, 201, 'registered owner should obtain login challenge');
  const challenge = (response.payload as unknown as {challenge: WalletLoginChallenge}).challenge;
  assert.equal(challenge.typedData.domain.name, 'Veyra Login');
  assert.equal(challenge.typedData.domain.chainId, ARC_TESTNET);
  assert.equal(challenge.typedData.message.appOrigin, ORIGIN);
  assert.equal(challenge.typedData.message.purpose, 'Sign in to Veyra Testnet. No payments or transfers.');
  return challenge;
}
async function signLogin(challenge: WalletLoginChallenge, privateKey: `0x${string}`) {
  return privateKeyToAccount(privateKey).signTypedData({
    domain: challenge.typedData.domain,
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
      ...challenge.typedData.message,
      chainId: BigInt(challenge.typedData.message.chainId),
      issuedAt: BigInt(challenge.typedData.message.issuedAt),
      expiresAt: BigInt(challenge.typedData.message.expiresAt),
    },
  });
}
const wrongChainLogin = await http('POST', '/api/auth/wallet-login/challenge', {
  walletAddress: alice.address, chainId: 5042,
});
assert.equal(wrongChainLogin.status, 400);
const loginA = await loginChallenge(alice.address);
const impersonation = await http('POST', '/api/auth/wallet-login/complete', {
  challengeId: loginA.challengeId, signature: await signLogin(loginA, bobKey),
});
assert.equal(impersonation.status, 401);
const loggedInA = await http('POST', '/api/auth/wallet-login/complete', {
  challengeId: loginA.challengeId, signature: await signLogin(loginA, aliceKey),
});
assert.equal(loggedInA.status, 200, 'valid previously registered wallet re-login must succeed');
assert.ok(loggedInA.payload.sessionToken);
assert.equal(loggedInA.payload.veyraUserId, registeredA.payload.profile.veyraUserId);
const reprofileA = await http('GET', '/api/profile/me', undefined, loggedInA.payload.sessionToken);
assert.equal(reprofileA.status, 200);
assert.equal(reprofileA.payload.profile?.veyraUserId, registeredA.payload.profile.veyraUserId);
const replayLogin = await http('POST', '/api/auth/wallet-login/complete', {
  challengeId: loginA.challengeId, signature: await signLogin(loginA, aliceKey),
});
assert.equal(replayLogin.status, 409, 'a previously consumed login proof cannot mint another session');

const loginB = await loginChallenge(bob.address);
const loggedInB = await http('POST', '/api/auth/wallet-login/complete', {
  challengeId: loginB.challengeId, signature: await signLogin(loginB, bobKey),
});
assert.equal(loggedInB.status, 200);
assert.equal((await http('GET', '/api/social/friends', undefined, loggedInB.payload.sessionToken))
  .payload.items?.[0]?.state, 'CONNECTED');

console.log('Arc Testnet EIP-712 signed ownership, two-wallet Friends and persisted single-use wallet re-login: PASS (isolated CI only)');
