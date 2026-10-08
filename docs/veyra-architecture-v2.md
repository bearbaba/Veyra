# Veyra Architecture — Final Specification
**Version:** 1.0 — Post-review, approved with amendments  
**Date:** 2026-10-08  
**Status:** APPROVED — implementation may proceed against this document  
**Supersedes:** `docs/veyra-architecture.md` (v0.1 draft)

---

## Amendment Log (from v0.1 review)

| # | Amendment | Applied in section |
|---|-----------|-------------------|
| A1 | `xAccountId` is the canonical X identity key; `@handle` is display-only everywhere | §2 |
| A2 | Wallet bindings store proof version, nonce/challenge reference, `issuedAt`, `verifiedAt`, `revokedAt` | §2.3, §2.4 |
| A3 | Receiving preferences are preferences, not routing guarantees | §2.6 |
| A4 | Recipient identity frozen into immutable snapshot at review time; post-snapshot identity change invalidates review | §5.2, §7 |
| A5 | Duplicate-send protection includes sender, recipient snapshot, amount, asset, route, and a unique client intent ID | §5.5 |
| A6 | Critical chain/token logos and metadata bundled; external services are enrichment only | §3.3, §4.3 |
| A7 | Replace "BFF wins" conflict resolution with revision/version-based reconciliation | §7.3 |
| A8 | Preflight severity is provider-aware, not globally hard-coded | §6.3, §10.1 |
| A9 | Every `BridgeProviderAdapter` exposes a capability matrix | §10.1 |
| A10 | DEV E2E tooling fully isolated from production UX at build and module level | §12 |

**Architecture decisions locked:**
- PostgreSQL as system of record; IndexedDB is local cache/recovery only
- EIP-712 wallet proof (personal_sign fallback)
- Relayer: separate funded wallet per chain/environment; KMS/HSM signing only in production
- ENS/Farcaster not in MVP; resolver designed extensibly
- Normalized identity/wallet schema + append-only execution/audit events in Postgres
- Quote TTL: honor provider `expiresAt`; otherwise 10–15 s for price/liquidity-sensitive routes; never reuse RESERVED/BROADCAST/USED quotes
- Multi-hop: architecture-ready but disabled unless exact provider has passed lifecycle/E2E gate
- Cross-chain token swaps: supported by abstraction, not required for v1

---

## 0. Guiding Principles (unchanged from v0.1 except A3, A4, A5)

1. Shared modules, not per-page logic. Pay, Agent, Bridge are surfaces over the same stack.
2. LLM never touches money. Intent resolution only; every downstream step is deterministic code.
3. Provider model is pluggable. CCTP V2 is one provider among peers.
4. Testnet and mainnet are structurally different environments.
5. No burn without a HARD BLOCK-free preflight. Provider supplies the severity classifications.
6. Identity is user-owned and cryptographically proven. Receiving preferences are hints, not guarantees.
7. Recipient identity is frozen at review time. Any mutation before broadcast requires a new review.
8. External metadata services are enrichment. Critical data is always bundled.

---

## 1. Module Map (final)

```
┌──────────────────────────────────────────────────────────────────────┐
│                           UI SURFACES                                │
│   PayPage       AgentPage       BridgePage       ActivityPage        │
└──────┬──────────────┬──────────────┬───────────────────┬─────────────┘
       │              │              │                   │
       ▼              ▼              ▼                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        CORE ACTION LAYER                             │
│  IntentSchema  →  ActionRequest  →  TransactionPolicy  →  RouteEngine│
└──────┬──────────────────────────────────────────┬────────────────────┘
       │                                          │
       ▼                                          ▼
┌────────────────────────┐            ┌───────────────────────────────┐
│  VeyraIdentityResolver │            │  ProviderRegistry             │
│  ChainRegistry         │            │  CapabilityMatrix per adapter │
│  TokenRegistry         │            │  BridgeProviderAdapter (iface)│
└────────────────────────┘            └───────────────────────────────┘
       │                                          │
       ▼                                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       EXECUTION LAYER                                │
│  IdentitySnapshot  →  PreflightEngine  →  ProviderAdapter.execute() │
│                          (provider-supplied severity)                │
└─────────────────────────────────────────┬────────────────────────────┘
                                          │
                                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      PERSISTENCE LAYER                               │
│  ActivityReceipt  (IndexedDB cache + Postgres system of record)      │
│  AuditEventLog    (append-only Postgres)                             │
│  IdentityStore    (Postgres + IndexedDB cache)                       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. VeyraIdentityResolver

### 2.1 Canonical Key: xAccountId

`xAccountId` (numeric string, e.g. `"123456789"`) is assigned by Twitter/X and is never reassigned, even when a user deletes and re-creates an account with the same handle. It is the sole primary key across all Veyra identity records, wallet bindings, receipts, and audit logs.

`xHandle` is fetched at resolution time from the X API and stored as a display cache. It is never used as a lookup key. A handle change by the legitimate user does not invalidate their identity record. A different `xAccountId` claiming the same handle creates a new, separate identity record with no access to the prior account's wallets.

**Resolver lookup priority:**
1. `xAccountId` (exact match, authoritative)
2. `xHandle` (current, from X API — resolved to `xAccountId` first, then record fetched by ID)
3. Future: ENS name, Farcaster FID (resolver plugin interface, not implemented in MVP)

```typescript
interface ResolverPlugin {
  namespace: string;              // "ens", "farcaster", "x"
  resolve(identifier: string): Promise<{ xAccountId: string } | null>;
}
```

### 2.2 IdentityRecord Schema

```typescript
interface IdentityRecord {
  // Primary key
  xAccountId: string;

  // Display data — mutable, never used as keys
  xHandle: string;
  xHandleLastVerified: number;      // unix ms; staleness measured from this

  // Verified wallet bindings
  wallets: WalletBinding[];

  // User's receiving preferences (hints to RouteEngine, not guarantees)
  receivePreferences: ReceivePreference[];

  // Lifecycle
  status: IdentityStatus;
  statusReason?: string;
  createdAt: number;
  updatedAt: number;

  // Optimistic concurrency
  revision: number;                 // incremented on every write; used for reconciliation
}

type IdentityStatus = 'ACTIVE' | 'STALE' | 'REVOKED';
```

### 2.3 WalletBinding Schema (Amendment A2)

```typescript
interface WalletBinding {
  // Identity of the wallet
  address: string;                  // EIP-55 checksummed EVM address
  chainIds: number[];               // chains where this wallet is confirmed active

  // Proof fields (A2)
  proofVersion: number;             // 1 = EIP-712, 0 = personal_sign fallback
  proofChallengeId: string;         // UUID; single-use; references ChallengeRecord
  proofNonce: string;               // hex nonce embedded in the signed message
  proofSignature: string;           // hex; stored permanently for audit
  issuedAt: number;                 // unix ms; when the challenge was issued
  verifiedAt: number;               // unix ms; when the signature was confirmed
  revokedAt: number | null;         // unix ms; null if still active

  // Lifecycle
  status: 'ACTIVE' | 'REVOKED';
  revokedBy?: 'user' | 'admin';
  revokedReason?: string;
}
```

### 2.4 Wallet Proof / Signature Flow (EIP-712 preferred, personal_sign fallback)

```
1. Browser: POST /api/identity/challenge
   Body: { walletAddress, xAccountId }
   → Server writes ChallengeRecord { challengeId, nonce, message, expiresAt }
   → Returns { challengeId, domain, types, message }   (EIP-712 domain + typed data)
                                                        (or plain message if fallback)

2. Browser: wallet.signTypedData(domain, types, message)   ← EIP-712
   or        wallet.signMessage(plainMessage)               ← personal_sign fallback

3. Browser: POST /api/identity/verify-wallet
   Body: { challengeId, walletAddress, signature, proofVersion }

4. BFF:
   a. Load ChallengeRecord; assert not expired, not consumed, nonce matches
   b. Recover signer:
      proofVersion=1: recoverTypedDataAddress(domain, types, message, signature)
      proofVersion=0: recoverMessageAddress(plainMessage, signature)
   c. Assert recovered === walletAddress (EIP-55 normalised)
   d. Assert no existing ACTIVE WalletBinding for this address on a different xAccountId
   e. Write WalletBinding with issuedAt, verifiedAt, proofVersion, proofChallengeId, proofNonce
   f. Mark ChallengeRecord consumed (single-use)
   g. Emit AuditEvent WALLET_BINDING_CREATED

5. Challenge consumed — cannot be replayed.
```

**EIP-712 domain (production):**
```typescript
const VEYRA_PROOF_DOMAIN = {
  name: "Veyra",
  version: "1",
  chainId: sourceChainId,          // chain the wallet is being bound on
  verifyingContract: "0x000...000" // no contract needed; prevents cross-protocol replay
};

const VEYRA_PROOF_TYPES = {
  WalletProof: [
    { name: "xAccountId",   type: "string" },
    { name: "walletAddress", type: "address" },
    { name: "nonce",        type: "bytes32" },
    { name: "issuedAt",     type: "uint256" },
    { name: "expiresAt",    type: "uint256" },
  ]
};
```

### 2.5 Multi-Wallet and Multi-Chain Mappings

- One `xAccountId` may have N `WalletBinding` records.
- Each binding declares `chainIds[]`. The user maintains this list; the app suggests additions when it detects a non-zero balance on an unlisted chain but never auto-adds.
- `RouteEngine` queries all `ACTIVE` bindings. If `preferredReceive` is not set, the engine ranks by: chain match, balance, route cost.
- A wallet appearing on multiple chains is listed once with multiple `chainIds`; it is not duplicated per chain.

### 2.6 Receive Preferences (Amendment A3)

Preferences are routing hints. The engine is not obligated to honour them if no viable route exists to the preferred chain/token.

```typescript
interface ReceivePreference {
  rank: number;                     // 1 = highest preference; engine tries in rank order
  chainId: number;
  tokenAddress: string;
  walletAddress: string;            // must be in wallets[] with ACTIVE status
  note?: string;                    // user-supplied label, e.g. "my Base wallet"
}
```

When the engine cannot satisfy rank-1 preference it tries rank-2, then rank-3. If no preference can be satisfied, the engine returns `NO_ROUTE_AVAILABLE` with the reason `PREFERENCE_UNSATISFIABLE`, and the UI prompts the user to select a destination manually.

### 2.7 IdentitySnapshot — Frozen at Review Time (Amendment A4)

At the moment the `TransactionReviewSheet` is shown to the user, a point-in-time snapshot of the resolved identity is frozen:

```typescript
interface IdentitySnapshot {
  snapshotId: string;               // UUID
  xAccountId: string;
  xHandle: string;                  // display only
  resolvedWalletAddress: string;    // the exact address the route will send to
  resolvedChainId: number;
  resolvedTokenAddress: string;
  identityRevision: number;         // IdentityRecord.revision at snapshot time
  snapshotAt: number;               // unix ms
  expiresAt: number;                // unix ms; snapshot TTL from securityConfig
}
```

Before broadcast, `VeyraIdentityResolver.verifySnapshot(snapshot)` is called:
- Reloads the live `IdentityRecord` from Postgres.
- Compares `identityRevision`. If the live revision is higher, the snapshot is **stale**.
- Compares `resolvedWalletAddress` and `resolvedChainId`. If either changed, the snapshot is **invalid**.
- A stale or invalid snapshot causes `TransactionPolicy` to return `HARD_BLOCK` with reason `IDENTITY_CHANGED_SINCE_REVIEW`. The review sheet is dismissed and the user must re-initiate.
- Snapshot expiry also causes `HARD_BLOCK` with reason `REVIEW_EXPIRED`.

### 2.8 Stale and Revoked Identity States

| State | Trigger | TTL source | Effect |
|-------|---------|------------|--------|
| `ACTIVE` | Default post-proof | — | Full participation |
| `STALE` | `xHandleLastVerified` older than `IDENTITY_STALENESS_TTL` | `securityConfig` | Resolved with WARNING; execution blocked until re-verified |
| `REVOKED` | All wallets revoked, admin revocation, or `STALE` unresolvable for `IDENTITY_REVOCATION_GRACE_TTL` | `securityConfig` | Full block; no routing |

---

## 3. ChainRegistry

### 3.1 ChainRecord Schema

```typescript
interface ChainRecord {
  chainId: number;
  name: string;
  shortName: string;
  rpcUrl: string;                   // from onchain-facts or RPC proxy
  explorerUrl: string;
  explorerApiUrl?: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
    isUsdc: boolean;                // true for Arc
  };
  logoSource: LogoSource;           // bundled first (A6)
  environment: 'testnet' | 'mainnet';
  cctpDomain?: number;
  gatewaySupported: boolean;
  status: 'ACTIVE' | 'DEGRADED' | 'DISABLED';
  statusNote?: string;
}
```

### 3.2 Relationship to `onchain-facts.ts`

`ChainRegistry` wraps `getChain()` and `ONCHAIN_CHAINS` from the generated `onchain-facts.ts` module. It never duplicates those values. The registry adds the operational and display fields not present in `onchain-facts`.

### 3.3 Logo and Metadata Source Policy (Amendment A6)

All critical chain metadata (name, chainId, RPC, CCTP domain, native currency) is bundled at build time. No chain is allowed to be "unknown" at runtime.

**Logo source hierarchy (strictly ordered):**

| Priority | Source | When used |
|----------|--------|-----------|
| 1 | Bundled SVG in `/src/assets/chains/` | Always tried first — must exist for all chains Veyra supports |
| 2 | `@web3icons/react` by identifier | For chains covered by the package |
| 3 | Cached image in `/public/chain-logos/` | Pre-fetched at build time for chains not in @web3icons |
| 4 | Generated placeholder (symbol initials) | Always available; used if all above fail |

External logo URLs (CoinGecko, etc.) are fetched at **build time only** and written to `/public/chain-logos/`. They are never fetched at runtime on the critical path. A missing external URL at build time is a warning, not a build failure — the placeholder is used instead.

---

## 4. TokenRegistry

### 4.1 TokenRecord Schema

```typescript
interface TokenRecord {
  id: string;                       // "usdc", "usdt", "eth" — stable internal key
  symbol: string;
  name: string;
  decimals: number;                 // canonical ERC-20 decimals
  logoSource: LogoSource;           // bundled first (A6)
  deployments: TokenDeployment[];
  tags: TokenTag[];
  coingeckoId?: string;             // enrichment only — never used in routing or amounts
}

interface TokenDeployment {
  chainId: number;
  address: string;                  // ERC-20 address; NATIVE sentinel for gas token
  decimals: number;                 // may differ from canonical (Arc native vs ERC-20)
  bridgeable: boolean;
  cctpSupported: boolean;
  gatewaySupported: boolean;
  status: 'ACTIVE' | 'DEPRECATED' | 'DISABLED';
}

type TokenTag = 'stablecoin' | 'native' | 'lp-token' | 'wrapped';
```

### 4.2 Logo and Metadata Source Policy (Amendment A6)

Same hierarchy as chains:

| Priority | Source | When used |
|----------|--------|-----------|
| 1 | Bundled SVG in `/src/assets/tokens/` | All tokens Veyra supports |
| 2 | `@web3icons/react` by identifier | Tokens covered by the package |
| 3 | Cached image in `/public/token-logos/` | Pre-fetched at build time |
| 4 | Generated placeholder (symbol initials) | Always |

CoinGecko `coingeckoId` is stored for price enrichment (e.g. fiat amount estimates) and logo pre-fetch scripts. It is never used in amount calculations, routing decisions, or critical display paths.

---

## 5. RouteEngine

### 5.1 RouteOption Schema

```typescript
interface RouteOption {
  routeId: string;                  // deterministic hash — see §5.5
  provider: string;                 // provider ID: "cctp-v2", "circle-gateway", etc.
  providerVersion: string;

  sourceChainId: number;
  sourceTokenAddress: string;
  destinationChainId: number;
  destinationTokenAddress: string;
  destinationAddress: string;       // resolved at route-selection time from IdentitySnapshot

  amountIn: bigint;                 // raw, source decimals
  amountOut: bigint;                // raw, destination decimals (estimated)

  fees: RouteFee[];
  estimatedTimeMs: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';

  // Quote validity
  quotedAt: number;                 // unix ms
  expiresAt: number;                // unix ms — from provider or short TTL; honored strictly
  ttlMs: number;                    // expiresAt - quotedAt

  // Multi-hop
  hops: RouteHop[];                 // single entry for direct routes; N entries for multi-hop
  multiHopEnabled: boolean;         // false unless provider has passed lifecycle gate for multi-hop

  providerMetadata: Record<string, unknown>;
}

interface RouteHop {
  hopIndex: number;
  provider: string;
  sourceChainId: number;
  destinationChainId: number;
  sourceTokenAddress: string;
  destinationTokenAddress: string;
  estimatedTimeMs: number;
}

interface RouteFee {
  label: string;
  amountRaw: bigint;                // raw token units
  tokenAddress: string;
  chainId: number;
  amountUsdEstimate: number;        // display only
  paidBy: 'sender' | 'receiver' | 'relayer';
}
```

### 5.2 Quote TTL Policy

- Honor provider-supplied `expiresAt` if present.
- If the provider does not supply `expiresAt`, apply `ROUTE_DEFAULT_TTL_MS` from `securityConfig` (10 s for price/liquidity-sensitive routes, 15 s for stable/USDC-only routes).
- A quote in state `RESERVED`, `BROADCAST`, or `USED` (from `quoteReplayStore`) must never be reused for a new execution, even if still within TTL.
- `RouteEngine` calls `quoteReplayStore.checkQuoteState(routeId)` before returning a quote. If state is `RESERVED` or above, a fresh quote is requested.
- Expired quotes return `ROUTE_EXPIRED` to `TransactionPolicy`, which issues `HARD_BLOCK`.

### 5.3 Route Selection Algorithm

```
1. Load IdentitySnapshot for the recipient (or use supplied destination address for Bridge).
2. Filter ProviderRegistry: lifecycleStage === ENABLED, canRoute(src, dst, token) === true.
3. For each eligible provider, call provider.quoteRoute(params).
   - Run in parallel; timeout each at ROUTE_QUOTE_TIMEOUT_MS (securityConfig).
   - Null return or timeout = provider excluded from this selection.
4. Hard filter:
   - amountOut < amountIn * MIN_OUTPUT_RATIO (securityConfig) → discard
   - expiresAt already past → discard
   - multiHopEnabled: false and hops.length > 1 → discard
5. Sort: amountOut DESC, estimatedTimeMs ASC, confidence DESC.
6. Return top N routes (ROUTE_MAX_OPTIONS, default 3) for user review.
7. Zero candidates → NO_ROUTE_AVAILABLE { reason, checkedProviders[] }.
```

### 5.4 Cross-Chain Route Matrix

The engine is defined over the full matrix of `ChainRegistry.ACTIVE` chains. No chain pair is hard-coded in the engine. Each provider's `CapabilityMatrix.supportedRoutes` (§10.1) defines its coverage.

### 5.5 Duplicate-Send Protection (Amendment A5)

`routeId` is a deterministic hash of the full execution context, not just the route parameters. It includes:

```typescript
function buildRouteId(input: {
  clientIntentId: string;           // UUID generated in the browser at intent-creation time
  senderAddress: string;            // checksummed
  recipientSnapshotId: string;      // IdentitySnapshot.snapshotId — frozen at review time
  amountIn: bigint;
  sourceTokenAddress: string;
  sourceChainId: number;
  destinationTokenAddress: string;
  destinationChainId: number;
  provider: string;
  providerVersion: string;
}): string
// keccak256(canonical JSON of the above fields) → hex string
```

`clientIntentId` is a UUID generated in the browser the moment the user submits an intent. It persists through the review sheet. Even if every other field is identical, a new intent session generates a new `clientIntentId` and thus a new `routeId`, allowing a legitimate second send of the same amount to the same person.

Before `TransactionPolicy` passes, `ActivityReceipt.store.findByRouteId(routeId)` is checked:
- `PENDING`, `BROADCAST`, `SOURCE_CONFIRMED`, `ATTESTATION_PENDING`, `RECEIVE_PENDING` → `HARD_BLOCK: DUPLICATE_IN_FLIGHT`
- `CONFIRMED` → `HARD_BLOCK: ALREADY_SENT` (show existing receipt)
- `FAILED` or `CANCELLED` → allow (previous attempt failed)
- Not found → allow

---

## 6. TransactionPolicy

### 6.1 Policy Check Sequence

```typescript
type PolicyCheckResult =
  | { outcome: 'PASS' }
  | { outcome: 'HARD_BLOCK'; reason: PolicyBlockReason; detail: string }
  | { outcome: 'WARNING'; reason: PolicyWarnReason; detail: string; requiresAck: true }
  | { outcome: 'INFO'; reason: string; detail: string };

interface PolicyResult {
  allowed: boolean;                 // false if any HARD_BLOCK present
  checks: PolicyCheckResult[];
  warnings: PolicyCheckResult[];    // extracted for UI
  infos: PolicyCheckResult[];
  evaluatedAt: number;
  snapshotId: string;               // IdentitySnapshot used
}
```

### 6.2 Global Policy Checks (always run, provider-independent)

| # | Check | Failure |
|---|-------|---------|
| P1 | Sender wallet connected, on correct source chain | `HARD_BLOCK: WRONG_CHAIN` |
| P2 | Source balance ≥ amountIn + max(fees) | `HARD_BLOCK: INSUFFICIENT_BALANCE` |
| P3 | Recipient identity status is `ACTIVE` | `HARD_BLOCK: IDENTITY_NOT_ACTIVE` |
| P4 | IdentitySnapshot is valid and not expired | `HARD_BLOCK: IDENTITY_CHANGED_SINCE_REVIEW` or `REVIEW_EXPIRED` |
| P5 | `routeId` not already in receipt store as in-flight or confirmed | `HARD_BLOCK: DUPLICATE_IN_FLIGHT` or `ALREADY_SENT` |
| P6 | RouteOption not expired | `HARD_BLOCK: ROUTE_EXPIRED` |
| P7 | amountIn ≤ `POLICY_MAX_SINGLE_TRANSFER` | `HARD_BLOCK: EXCEEDS_SINGLE_LIMIT` |
| P8 | 24 h rolling total ≤ `POLICY_DAILY_LIMIT` | `HARD_BLOCK: EXCEEDS_DAILY_LIMIT` |
| P9 | Recipient address is not zero | `HARD_BLOCK: ZERO_RECIPIENT` |

### 6.3 Provider-Supplied Preflight Checks (Amendment A8)

After global checks pass, `TransactionPolicy` calls `provider.preflight(routeOption)` and receives `PreflightResult[]`. Severity (`HARD_BLOCK | WARNING | INFO`) is **set by the provider**, not by the global policy layer. The policy engine only aggregates and enforces:

- Any `PreflightResult` with `severity: 'HARD_BLOCK'` and `passed: false` → policy result `allowed: false`.
- Any `PreflightResult` with `severity: 'WARNING'` and `passed: false` → added to `warnings[]`; UI requires user acknowledgement.
- Any `PreflightResult` with `severity: 'INFO'` → added to `infos[]`.

This means the set of hard-blocking checks for a Gateway provider differs from CCTP V2 — correctly, because their destination mechanics differ. The global policy layer never needs to know about destination contract addresses.

**CCTP V2 default preflight classification (as shipped — providers may change these):**

HARD BLOCK:
- `DESTINATION_TRANSMITTER_MISSING` — MessageTransmitterV2 bytecode absent
- `DESTINATION_MESSENGER_MISSING` — TokenMessengerV2 bytecode absent
- `ATTESTATION_SERVICE_DOWN` — Circle attestation API unreachable
- `DESTINATION_CHAIN_DISABLED` — ChainRegistry status not ACTIVE
- `ZERO_RECIPIENT` — destination address is zero
- `TOKEN_NOT_SUPPORTED` — token not CCTP-enabled on destination chain

WARNING:
- `DESTINATION_LOW_GAS` — destination wallet native gas < `MIN_RECEIVE_GAS_WARNING` (irrelevant if relayer is available — provider sets this to INFO when relayer is confirmed available)
- `ATTESTATION_SLOW` — attestation latency > `ATTESTATION_LATENCY_WARNING_MS`
- `LARGE_TRANSFER` — amount > `POLICY_LARGE_TRANSFER_WARNING`
- `ROUTE_CONFIDENCE_LOW` — `RouteOption.confidence === 'LOW'`

INFO:
- `ESTIMATED_ARRIVAL` — display only
- `RELAYER_AVAILABLE` — BFF relayer will handle destination tx
- `FIRST_SEND_TO_RECIPIENT` — new recipient
- `FEE_BREAKDOWN` — per-fee-item display

---

## 7. ActivityReceipt

### 7.1 ActivityReceipt Schema

```typescript
interface ActivityReceipt {
  receiptId: string;                // generateExecutionReceiptId(...)
  clientIntentId: string;           // browser-generated UUID; part of routeId
  routeId: string;                  // deterministic per §5.5
  planReceiptId: string;

  surface: 'PAY' | 'AGENT' | 'BRIDGE';
  action: ActionType;

  // Revision / concurrency (Amendment A7)
  revision: number;                 // starts at 1; incremented on every write
  lastWrittenBy: 'browser' | 'bff';
  lastWrittenAt: number;

  // Sender
  senderAddress: string;
  senderChainId: number;

  // Recipient (immutable after creation — frozen from IdentitySnapshot)
  recipientSnapshot: IdentitySnapshot;    // full snapshot, stored with receipt
  recipientAddress: string;               // denormalised from snapshot
  recipientChainId: number;

  // Asset
  tokenId: string;
  amountIn: string;                 // stringified bigint
  amountOut: string | null;
  sourceTokenAddress: string;
  destinationTokenAddress: string;

  // Route
  provider: string;
  providerVersion: string;
  routeOption: RouteOption;         // stored at plan time; not updated after broadcast

  // Status
  status: ActivityReceiptStatus;

  // Execution trace
  trace: ActivityTrace[];

  // Timestamps
  createdAt: number;
  confirmedAt: number | null;
  failedAt: number | null;
  cancelledAt: number | null;

  // Recovery
  resumable: boolean;
  resumePayload: ResumePayload | null;

  // Audit
  policyResult: PolicyResult;       // stored at plan time
  preflightResults: PreflightResult[];
}

type ActivityReceiptStatus =
  | 'PENDING'
  | 'BROADCAST'
  | 'SOURCE_CONFIRMED'
  | 'ATTESTATION_PENDING'
  | 'RECEIVE_PENDING'
  | 'RECEIVE_FAILED_RETRYABLE'
  | 'CONFIRMED'
  | 'FAILED'
  | 'CANCELLED';

interface ActivityTrace {
  step: string;
  txHash?: string;
  chainId?: number;
  timestamp: number;
  data?: Record<string, unknown>;
}

interface ResumePayload {
  provider: string;
  version: number;
  payload: Record<string, unknown>;   // validated against provider-registered Zod schema
}
```

### 7.2 Storage Architecture

```
Browser (IndexedDB)                     BFF (Postgres)
──────────────────────────────          ──────────────────────────────────
receipts table                          activity_receipts table
  PK: receiptId                           PK: receipt_id
  + all fields above                      + all fields above
  + localRevision: number                 + server_revision: number
  + syncedRevision: number                + created_at, updated_at
  + syncPending: boolean
```

IndexedDB is a local cache for the current device. Postgres is the system of record. A receipt present in IndexedDB but absent from Postgres is a pending sync. A receipt in Postgres but absent from IndexedDB is hydrated on the next full load.

### 7.3 Revision-Based Reconciliation (Amendment A7)

The "BFF always wins" rule from v0.1 is replaced with explicit version-based logic:

```
On browser write:
  localRevision += 1
  syncPending = true
  POST /api/receipts/sync { receiptId, localRevision, ...fields }

On BFF receive:
  Load server record.
  If server_revision >= localRevision:
    // BFF has a newer or equal version — return server record to browser
    Response: { conflict: true, serverRecord }
  Else:
    // Browser has a newer version — write to Postgres
    server_revision = localRevision
    Response: { conflict: false }

On browser receive conflict:
  Merge strategy (per-field):
    status:   take the higher state in the ordered status enum (CONFIRMED > BROADCAST > PENDING)
    trace:    union of both trace arrays, deduplicated by (step, txHash, timestamp)
    resumePayload: take server version if present; browser version if server is null
    All other fields: server wins (server has audit authority)
  Write merged record back to both IndexedDB and BFF.
```

This prevents a browser tab that was offline during confirmation from overwriting a server-confirmed receipt with a stale PENDING state.

### 7.4 Append-Only Audit Event Log

Every state transition writes a `ReceiptAuditEvent` to Postgres. IndexedDB does not store audit events.

```typescript
interface ReceiptAuditEvent {
  eventId: string;
  receiptId: string;
  xAccountId: string;
  eventType: ReceiptAuditEventType;
  fromStatus: ActivityReceiptStatus;
  toStatus: ActivityReceiptStatus;
  actor: 'user' | 'bff' | 'relayer' | 'system';
  data: Record<string, unknown>;
  timestamp: number;
}

type ReceiptAuditEventType =
  | 'RECEIPT_CREATED'
  | 'BROADCAST'
  | 'SOURCE_CONFIRMED'
  | 'ATTESTATION_RECEIVED'
  | 'RECEIVE_SUBMITTED'
  | 'RECEIVE_CONFIRMED'
  | 'RECEIVE_FAILED'
  | 'RESUMED'
  | 'FAILED'
  | 'CANCELLED';
```

---

## 8. How All Three Surfaces Consume Shared Modules

All three surfaces follow the same pipeline. Differences are in the entry point and `surface` field only.

```
PayPage / AgentPage / BridgePage
  │
  ▼ 1. User submits intent
IntentSchema.parse(llmResponse | formInput)
  │  → validated ActionRequest; LLM output stripped of trusted fields
  │
  ▼ 2. Resolve recipient
VeyraIdentityResolver.resolve(identifier)
  │  → IdentityRecord (ACTIVE) or error
  │
  ▼ 3. Freeze snapshot
IdentitySnapshot.create(identityRecord, resolvedPreference)
  │  → IdentitySnapshot { snapshotId, revision, resolvedAddress, ... }
  │
  ▼ 4. Resolve assets
TokenRegistry.get(tokenId, sourceChainId)
ChainRegistry.get(sourceChainId, destinationChainId)
  │
  ▼ 5. Get routes
RouteEngine.selectRoutes({ source, destination, snapshot })
  │  → RouteOption[]  (provider-agnostic; sorted by output/time/confidence)
  │
  ▼ 6. Evaluate policy
TransactionPolicy.evaluate(actionRequest, selectedRoute, snapshot)
  │  → PolicyResult (includes provider preflight results)
  │  → HARD_BLOCK → show error, stop
  │  → WARNINGS → show review sheet with ack checkboxes
  │
  ▼ 7. User reviews and confirms
TransactionReviewSheet (shared component)
  │  → user acknowledges warnings, confirms
  │  → snapshot re-validated at this point (VerifySnapshot before enabling Confirm button)
  │
  ▼ 8. Create receipt
ActivityReceipt.create(PENDING, { routeOption, snapshot, policyResult, clientIntentId })
  │  → persisted to IndexedDB immediately
  │  → async sync to BFF Postgres
  │
  ▼ 9. Execute
ProviderAdapter.execute(routeOption, signer, onProgress)
  │  → trace events flow back → ActivityReceipt.update(trace)
  │  → status transitions: BROADCAST → SOURCE_CONFIRMED → ATTESTATION_PENDING → ...
  │
  ▼ 10. Completion
ActivityReceipt.update(CONFIRMED) or update(RECEIVE_FAILED_RETRYABLE)
ActivityPage shows live state for all in-progress and recent receipts.
```

**BridgePage** skips step 2 (identity resolution) for self-transfers and manual-address bridges. It still produces an `IdentitySnapshot`-shaped object (a `DirectAddressSnapshot`) so the downstream pipeline is unchanged.

**AgentPage** step 1 is an LLM intent parse. Steps 2–10 are identical. The agent is the entry point; it is not the executor.

---

## 9. Production-Grade Relayer Architecture

`RELAY_PRIVATE_KEY` must not exist in any production `.env`. It is permitted only in `.env.development` and only when `NODE_ENV !== 'production'`. `env.ts` asserts this at startup.

### 9.1 Component Architecture

```
Veyra BFF
  POST /api/bridge/relay-receive
  ├── Auth: validate session, xAccountId
  ├── Auth: receipt must belong to authenticated xAccountId
  ├── Auth: receipt status must be ATTESTATION_COMPLETE or RECEIVE_FAILED_RETRYABLE
  ├── Replay: check relayNonce in Postgres (per-receipt, monotonic)
  ├── Rate-limit: per-user and global (Redis or Postgres counter)
  ├── Reconstruct calldata from stored receipt (never trust client calldata)
  └── Call RelayerService via internal mTLS channel
        │
        ▼
RelayerService  (separate Node/Go process, no user-facing port)
  ├── Receive: unsignedTx + receiptId + relayNonce
  ├── Simulate tx (eth_call) — catch nonce-already-used before spending gas
  ├── If simulation passes: call SignerService.sign(unsignedTx)
  ├── Broadcast signed tx
  ├── Poll for confirmation (receipt, not just inclusion)
  ├── Record: gas used, txHash, chainId, relayNonce, timestamp
  └── Return: { txHash } | { alreadyReceived: true } | { error, retryable }
        │
        ▼
SignerService  (AWS KMS | GCP Cloud HSM | HashiCorp Vault Transit)
  ├── Private key never leaves HSM boundary
  ├── Signing policy: only calldata matching receiveMessage(bytes,bytes) selector
  ├── All signing requests logged to immutable audit store
  └── Returns: signed tx bytes
```

### 9.2 Per-Chain/Environment Wallet

One funded gas wallet per (chain, environment) pair. The wallet address is public configuration; only the signing key is secret. Funding is an ops process:
- Monitored balance; alert at < `RELAY_WALLET_LOW_BALANCE_ETH` (securityConfig).
- Refill is manual or via a dedicated funding bot — not in scope for v1.
- Wallet address is stored in `ChainRegistry.relayerAddress` for the relevant chain.

### 9.3 Rate Limits (all values from securityConfig)

| Limit | Config key |
|-------|-----------|
| Per-user relay requests / hour | `RELAY_RATE_LIMIT_PER_USER_HOUR` |
| Per-user relay requests / day | `RELAY_RATE_LIMIT_PER_USER_DAY` |
| Global relay requests / minute | `RELAY_RATE_LIMIT_GLOBAL_MINUTE` |
| Max gas per relay tx (wei) | `RELAY_MAX_GAS_PER_TX` |
| Daily USD gas budget | `RELAY_DAILY_GAS_BUDGET_USD` |

Exceeded limits return HTTP 429 with `Retry-After`. The browser falls back to self-relay prompt.

### 9.4 Replay Protection

Two independent layers:
1. **DB nonce**: `relay_nonce` increments per `receiptId`. Any request with a used nonce is rejected before touching the chain.
2. **On-chain revert**: `MessageTransmitterV2.receiveMessage` reverts on duplicate message. This is the terminal safety net; the DB nonce is the first-line guard.

### 9.5 Self-Relay Fallback

If the RelayerService is unavailable, rate-limited, or refuses, the BFF returns `{ selfRelay: true }`. The browser prompts the user to sign `receiveMessage` directly. The fallback path uses the same `ResumePayload` and transitions the receipt to `RECEIVE_PENDING` identically.

---

## 10. Pluggable Provider Model

### 10.1 BridgeProviderAdapter Interface (Amendment A9)

```typescript
interface CapabilityMatrix {
  providerId: string;
  version: string;
  lifecycleStage: ProviderLifecycleStage;

  // Route coverage
  supportedRoutes: SupportedRoute[];      // explicit list; RouteEngine iterates this

  // Feature flags
  relaySupported: boolean;               // can the provider's BFF relay the receive step?
  resumeSupported: boolean;              // can a partially-complete flow be resumed?
  multiHopSupported: boolean;            // and has it passed the lifecycle gate?
  swapSupported: boolean;                // can the provider do source-token → USDC swaps?

  // Destination requirements
  destinationGasRequired: boolean;       // does the receiver need native gas at the destination?
  minDestinationGasWei: bigint | null;   // null if destinationGasRequired === false

  // Quote behaviour
  quoteTtlMs: number;                    // provider-supplied TTL; used if no expiresAt on quote
  supportsLiveQuotes: boolean;           // true if quoteRoute makes a live network/API call
}

interface SupportedRoute {
  sourceChainId: number;
  destinationChainId: number;
  sourceTokenAddress: string;
  destinationTokenAddress: string;
  minAmountIn: bigint | null;
  maxAmountIn: bigint | null;
}

interface BridgeProviderAdapter {
  readonly providerId: string;
  readonly version: string;
  readonly capabilities: CapabilityMatrix;

  // Route query
  canRoute(sourceChainId: number, destinationChainId: number, tokenAddress: string): boolean;
  quoteRoute(params: RouteQuoteParams): Promise<RouteOption | null>;

  // Pre-execution checks — provider sets severity for each result (A8)
  preflight(routeOption: RouteOption): Promise<PreflightResult[]>;

  // Execution — signer callback, never holds keys
  execute(
    routeOption: RouteOption,
    signer: TransactionSigner,
    onProgress: (trace: ActivityTrace) => void
  ): Promise<ExecutionResult>;

  // Resume a paused flow
  resume(
    resumePayload: ResumePayload,
    signer: TransactionSigner,
    onProgress: (trace: ActivityTrace) => void
  ): Promise<ExecutionResult>;
}

interface PreflightResult {
  checkId: string;
  severity: 'HARD_BLOCK' | 'WARNING' | 'INFO';
  passed: boolean;
  message: string;                  // user-facing (plain language)
  detail?: string;                  // developer/support detail
}

interface TransactionSigner {
  signAndSend(tx: PreparedTransaction): Promise<`0x${string}`>;
  signTypedData(domain: unknown, types: unknown, value: unknown): Promise<`0x${string}`>;
  address: string;
  chainId: number;
}
```

### 10.2 ProviderRegistry Lookup

```typescript
interface ProviderRegistry {
  // Return all ENABLED adapters capable of the given route
  getEligibleAdapters(
    sourceChainId: number,
    destinationChainId: number,
    tokenAddress: string
  ): BridgeProviderAdapter[];

  // Lifecycle gate — enforced here, not in the adapter
  checkLifecycle(providerId: string): ProviderEligibilityStatus;
}
```

Adapters are registered at startup. The registry enforces `lifecycleStage === ENABLED` before any adapter is returned from `getEligibleAdapters`. An adapter's `CapabilityMatrix` is inspected to filter by route — the registry does not call `canRoute()` directly; it reads the static `supportedRoutes` list.

### 10.3 Anticipated Future Providers

| Provider ID | Mechanism | Notes |
|-------------|-----------|-------|
| `circle-gateway` | Circle Gateway burn/mint | Fast, ~500ms, mainnet |
| `across-v3` | UMA optimistic bridge | Wide chain coverage, solver model |
| `stargate-v3` | LayerZero OFT | USDC + multi-token |
| `relay-protocol` | Intent-based, solver | Low latency |

Each is a new `BridgeProviderAdapter` implementation. `RouteEngine`, `TransactionPolicy`, and `ActivityReceipt` require no changes.

---

## 11. PostgreSQL Schema (Normalized)

### 11.1 Identity and Wallet

```sql
-- Identity records
CREATE TABLE identity_records (
  xaccount_id         TEXT PRIMARY KEY,
  x_handle            TEXT NOT NULL,
  x_handle_verified_at BIGINT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'ACTIVE',
  status_reason       TEXT,
  revision            INTEGER NOT NULL DEFAULT 1,
  created_at          BIGINT NOT NULL,
  updated_at          BIGINT NOT NULL
);

-- Wallet bindings (one row per verified wallet)
CREATE TABLE wallet_bindings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  xaccount_id         TEXT NOT NULL REFERENCES identity_records(xaccount_id),
  address             TEXT NOT NULL,           -- EIP-55
  proof_version       INTEGER NOT NULL,        -- 1=EIP-712, 0=personal_sign
  proof_challenge_id  UUID NOT NULL,
  proof_nonce         TEXT NOT NULL,
  proof_signature     TEXT NOT NULL,
  issued_at           BIGINT NOT NULL,
  verified_at         BIGINT NOT NULL,
  revoked_at          BIGINT,
  revoked_by          TEXT,
  revoked_reason      TEXT,
  status              TEXT NOT NULL DEFAULT 'ACTIVE',
  UNIQUE(address, xaccount_id)
);

-- Chain IDs for each wallet binding
CREATE TABLE wallet_binding_chains (
  binding_id          UUID NOT NULL REFERENCES wallet_bindings(id),
  chain_id            INTEGER NOT NULL,
  PRIMARY KEY (binding_id, chain_id)
);

-- Receive preferences (ordered by rank)
CREATE TABLE receive_preferences (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  xaccount_id         TEXT NOT NULL REFERENCES identity_records(xaccount_id),
  rank                INTEGER NOT NULL,
  chain_id            INTEGER NOT NULL,
  token_address       TEXT NOT NULL,
  wallet_address      TEXT NOT NULL,
  note                TEXT,
  UNIQUE(xaccount_id, rank)
);

-- Single-use proof challenges
CREATE TABLE proof_challenges (
  challenge_id        UUID PRIMARY KEY,
  xaccount_id         TEXT NOT NULL,
  wallet_address      TEXT NOT NULL,
  nonce               TEXT NOT NULL,
  issued_at           BIGINT NOT NULL,
  expires_at          BIGINT NOT NULL,
  consumed_at         BIGINT,
  consumed            BOOLEAN NOT NULL DEFAULT FALSE
);
```

### 11.2 Activity Receipts and Audit Events

```sql
-- Activity receipts
CREATE TABLE activity_receipts (
  receipt_id          TEXT PRIMARY KEY,
  client_intent_id    UUID NOT NULL UNIQUE,    -- duplicate-send guard
  route_id            TEXT NOT NULL,
  plan_receipt_id     TEXT NOT NULL,
  surface             TEXT NOT NULL,
  action              TEXT NOT NULL,
  server_revision     INTEGER NOT NULL DEFAULT 1,
  last_written_by     TEXT NOT NULL,
  last_written_at     BIGINT NOT NULL,
  sender_address      TEXT NOT NULL,
  sender_chain_id     INTEGER NOT NULL,
  recipient_snapshot  JSONB NOT NULL,          -- IdentitySnapshot, immutable after insert
  recipient_address   TEXT NOT NULL,
  recipient_chain_id  INTEGER NOT NULL,
  token_id            TEXT NOT NULL,
  amount_in           TEXT NOT NULL,           -- stringified bigint
  amount_out          TEXT,
  source_token_address TEXT NOT NULL,
  dest_token_address  TEXT NOT NULL,
  provider            TEXT NOT NULL,
  provider_version    TEXT NOT NULL,
  route_option        JSONB NOT NULL,
  status              TEXT NOT NULL,
  trace               JSONB NOT NULL DEFAULT '[]',
  policy_result       JSONB NOT NULL,
  preflight_results   JSONB NOT NULL DEFAULT '[]',
  resume_payload      JSONB,
  resumable           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          BIGINT NOT NULL,
  confirmed_at        BIGINT,
  failed_at           BIGINT,
  cancelled_at        BIGINT,
  INDEX idx_receipts_sender (sender_address),
  INDEX idx_receipts_route_id (route_id),
  INDEX idx_receipts_status (status),
  INDEX idx_receipts_xaccount (((recipient_snapshot->>'xAccountId')))
);

-- Relay nonces (per-receipt, monotonic, replay guard)
CREATE TABLE relay_nonces (
  receipt_id          TEXT NOT NULL REFERENCES activity_receipts(receipt_id),
  nonce               INTEGER NOT NULL,
  used_at             BIGINT NOT NULL,
  PRIMARY KEY (receipt_id, nonce)
);

-- Append-only audit events
CREATE TABLE receipt_audit_events (
  event_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id          TEXT NOT NULL,           -- no FK — audit log is independent
  xaccount_id         TEXT NOT NULL,
  event_type          TEXT NOT NULL,
  from_status         TEXT NOT NULL,
  to_status           TEXT NOT NULL,
  actor               TEXT NOT NULL,
  data                JSONB NOT NULL DEFAULT '{}',
  timestamp           BIGINT NOT NULL
  -- No UPDATE, no DELETE on this table
);
CREATE INDEX idx_audit_receipt ON receipt_audit_events(receipt_id);
CREATE INDEX idx_audit_xaccount ON receipt_audit_events(xaccount_id);
```

---

## 12. DEV vs Production Separation (Amendment A10)

### 12.1 Build-Time Isolation

```
src/
  components/
    dev/               ← ONLY imported by DevRouter; tree-shaken from production
      CctpE2EPage.tsx
      (future raw-calldata tools)
    pages/             ← production surfaces only
      PayPage.tsx
      BridgePage.tsx
      AgentPage.tsx
      ActivityPage.tsx
      SettingsPage.tsx
```

`DevRouter` is guarded:
```tsx
// src/components/dev/DevRouter.tsx
if (import.meta.env.VITE_DEV_TOOLS !== 'true') {
  throw new Error('DEV_TOOLS not enabled');
}
// This module is never imported from AppRouter or any production component.
```

`AppRouter` (production) has a hard `import` ban on `src/components/dev/*`. Enforced via an `oxlint` rule (`no-restricted-imports`) applied to all files outside `src/components/dev/`.

### 12.2 Runtime Guard

`DevOnlyRoute` wraps all `/dev/*` paths. It checks `import.meta.env.VITE_DEV_TOOLS` at render time and returns a hard 404 if the flag is not set. This is a second layer; the primary isolation is the import ban.

### 12.3 What DEV Tooling May Do That Production UX May Not

| Capability | DEV tooling | Production UX |
|------------|-------------|---------------|
| Display raw tx calldata | Yes | No |
| Show provider lifecycle stage | Yes | No |
| Show CCTP domain numbers | Yes | No |
| Expose "force advance step" buttons | Yes | No |
| Show internal receipt status names | Yes | No |
| Display RELAY_PRIVATE_KEY presence | Yes | No |
| Multi-step manual CCTP flow | Yes | No |
| Access `/dev/*` routes | Yes | 404 |

Production UX shows: what was sent, to whom, how much, arrival estimate, success/failure. Nothing internal.

### 12.4 Feature Flags

All non-MVP features use `VITE_FEATURE_*` flags. The production `.env` contains no `VITE_FEATURE_*` flag for any feature that has not passed the full lifecycle gate. `.env.development` may set flags freely.

---

## 13. Implementation Phases

Each phase ends with a defined acceptance criteria. No code from a later phase may be merged until the current phase's criteria are met.

---

### Phase 1 — Foundation and Storage (no UI changes)

**Scope:**
- Postgres schema from §11, applied via migrations (using `drizzle-orm` or raw `pg` migrations — TBD)
- BFF database connection and connection pool
- `IdentityStore` service: CRUD for `identity_records`, `wallet_bindings`, `wallet_binding_chains`, `receive_preferences`, `proof_challenges`
- `ActivityReceiptStore` service: CRUD for `activity_receipts`, `receipt_audit_events`, `relay_nonces`
- Revision-based sync endpoint: `POST /api/receipts/sync`
- All DB operations wrapped in transactions where writes touch multiple tables
- `securityConfig.ts` extended with all new timing constants from §6, §9
- `env.ts` updated: assert `RELAY_PRIVATE_KEY` absent in production; assert `VITE_DEV_TOOLS` absent in production build

**Acceptance criteria:**
- All migrations apply cleanly to a local Postgres instance
- `IdentityStore` unit tests: CRUD, revision increment, conflict detection
- `ActivityReceiptStore` unit tests: state transitions, audit log append, relay nonce uniqueness
- `POST /api/receipts/sync` correctly applies merge strategy from §7.3
- `bun run check` passes; `bun test` passes
- `RELAY_PRIVATE_KEY` in `.env.production` → startup hard error

---

### Phase 2 — Identity Core

**Scope:**
- `VeyraIdentityResolver` module: `resolve(identifier)`, `verifySnapshot(snapshot)`
- `IdentitySnapshot` creation and expiry
- EIP-712 wallet proof flow: `/api/identity/challenge`, `/api/identity/verify-wallet`
- `personal_sign` fallback path
- Identity staleness and revocation logic
- `WalletBinding` full schema with all §2.3 fields
- `ReceivePreference` CRUD endpoints

**Not in scope:**
- ENS / Farcaster resolver plugins (interface defined, no implementations)
- X handle resolution (stubbed with hardcoded test accounts for integration tests)

**Acceptance criteria:**
- EIP-712 proof: end-to-end test proves challenge → sign → verify → WalletBinding written to Postgres
- personal_sign fallback: same test with `proofVersion: 0`
- `verifySnapshot` detects: expired snapshot, identity revision mismatch, address change since snapshot
- `STALE` transition fires correctly at `IDENTITY_STALENESS_TTL`
- Revocation removes wallet from routing; second wallet still participates
- `bun run check` passes; `bun test` passes

---

### Phase 3 — Registry and Route Engine

**Scope:**
- `ChainRegistry` wrapping `onchain-facts.ts`, adding operational fields, bundled logos
- `TokenRegistry` with all §4 fields; bundled logos for all supported tokens
- Logo build script: fetch from external sources at build time → `/public/chain-logos/`, `/public/token-logos/`
- `RouteEngine` with quote TTL, deduplication, `routeId` generation per §5.5
- `CapabilityMatrix` on `CctpV2Adapter`
- `RouteEngine.selectRoutes` fully provider-agnostic
- `quoteReplayStore` integration (already exists — wire to new `routeId` scheme)

**Acceptance criteria:**
- `ChainRegistry` and `TokenRegistry` unit tests: no hardcoded addresses outside these registries
- `RouteEngine` unit tests: expired quote discarded, RESERVED quote forces re-fetch, duplicate `clientIntentId` produces same `routeId`
- `CctpV2Adapter.capabilities` exposes full `CapabilityMatrix`
- `bun run check` passes; `bun test` passes

---

### Phase 4 — Policy Engine Extensions

**Scope:**
- `TransactionPolicy` extended with all §6.2 global checks
- Provider-supplied preflight integration (§6.3, §8)
- `IdentitySnapshot` validation in policy (`P4`)
- Duplicate-send check using full §5.5 `routeId` (`P5`)
- `TransactionReviewSheet` updated: provider-supplied preflight results, warning ack checkboxes, snapshot countdown timer, re-validate snapshot on confirm

**Acceptance criteria:**
- Policy unit tests: all P1–P9 checks verified
- Provider-supplied `HARD_BLOCK` preflight → `allowed: false`
- Provider-supplied `WARNING` preflight → `requiresAck: true` in UI
- Snapshot expired/changed → confirm button disabled
- Duplicate in-flight `routeId` → `HARD_BLOCK: DUPLICATE_IN_FLIGHT`
- `bun run check` passes; `bun test` passes

---

### Phase 5 — Production Bridge Flow

**Scope:**
- `BridgePage` rewrite: simple 3-step user flow (amount/token → review → confirm)
- Fully powered by `RouteEngine` → `TransactionPolicy` → `ProviderAdapter.execute()`
- `ActivityReceipt` full lifecycle integration (all status transitions)
- `ActivityPage` live receipt state, resume cards for `RECEIVE_PENDING` / `RECEIVE_FAILED_RETRYABLE`
- Resume flow: `ProviderAdapter.resume()` from stored `ResumePayload`
- DEV import ban enforcement (oxlint rule)

**Not in scope:**
- Production relayer (RelayerService + KMS) — Phase 6
- X identity resolution with live X API — Phase 6

**Acceptance criteria:**
- E2E integration test (fork-based or live testnet): full CCTP V2 Arc→Sepolia flow through production UI, no DEV page
- `BridgePage` does not import anything from `src/components/dev/`
- `ActivityPage` shows correct state for all status values
- Resume from reload restores correct state from IndexedDB and reconciles with Postgres
- DEV routes return 404 in production build
- `bun run check` passes; `bun test` passes

---

### Phase 6 — Production Relayer and X Identity

**Scope:**
- `RelayerService`: separate process, receives unsigned tx from BFF, calls SignerService
- `SignerService` interface + AWS KMS implementation (local dev: stub with in-memory key, never `RELAY_PRIVATE_KEY`)
- BFF `/api/bridge/relay-receive`: auth, ownership check, nonce guard, calldata reconstruction, rate limit
- X handle resolution: live X API integration in `VeyraIdentityResolver`
- Identity staleness re-verification via X OAuth session
- Relayer wallet balance monitoring and alerting

**Acceptance criteria:**
- Relayer integration test: BFF calls RelayerService → KMS signs → tx broadcast → receipt confirmed
- Nonce replay protection: second call with used nonce → 400 before any chain call
- Rate limit: 11th call in an hour → 429 with `Retry-After`
- `RELAY_PRIVATE_KEY` absent from production environment verified by startup assertion
- X identity resolution: handle `@alice` resolves to `xAccountId` via live API
- `bun run check` passes; `bun test` passes

---

### Phase 7 — Additional Providers and Multi-Hop Gate

**Scope:**
- `CircleGatewayAdapter`: implements `BridgeProviderAdapter`, `CapabilityMatrix`
- `RouteEngine` selects between CCTP V2 and Gateway based on route/cost
- Multi-hop gate: if a provider's `CapabilityMatrix.multiHopSupported === true` AND `lifecycleStage === ENABLED`, multi-hop routes are surfaced
- `across-v3` adapter stub (DISCOVERED lifecycle, not available to users)

**Acceptance criteria:**
- `RouteEngine` returns both CCTP and Gateway routes for a supported pair
- User sees two route options with fee/time comparison
- Multi-hop routes only visible when provider has passed lifecycle gate
- `bun run check` passes; `bun test` passes

---

## 14. Open Items (Resolved from v0.1)

All v0.1 open questions are resolved by the architecture decisions above:

| v0.1 question | Resolution |
|---------------|-----------|
| Identity storage backend | Postgres (§11); IndexedDB cache only |
| EIP-712 vs personal_sign | EIP-712 preferred; personal_sign fallback (§2.4) |
| Relayer gas funding | One funded wallet per chain/environment; ops-managed (§9.2) |
| @handle scope | X only for MVP; extensible plugin interface for ENS/Farcaster (§2.1) |
| Receipt BFF persistence | Postgres; normalized schema in §11.2 |
| Quote caching | Honor `expiresAt`; 10–15 s fallback TTL; never reuse used quotes (§5.2) |
| Multi-hop | Architecture-ready; disabled without lifecycle gate (§5.1, Phase 7) |
| Cross-chain swaps | Supported by abstraction; not required for v1 (Phase 7+) |

---

## 15. What Is Not Changing

- Phase A engines (policy, risk, intent, receipt types) are authoritative. All new code adapts to them.
- LLM never signs, never holds financial data, never calls chain RPCs.
- Provider lifecycle `DISCOVERED → VERIFIED → IMPLEMENTED → TESTED → ENABLED` is mandatory for all providers.
- `RELAY_PRIVATE_KEY` is dev-only. Production signing is KMS/HSM only.
- Provider-supplied HARD BLOCK preflight results unconditionally prevent execution.
- No duplicate abstractions.
- Testnet default. Mainnet requires explicit confirmation and a separate gated release.
- `cctp-v2-bridge` being `ENABLED` means the dev E2E path is proven. Production-readiness requires Phase 5 completion.

---

*End of Veyra Architecture v1.0. Implementation may proceed phase by phase. No code may skip a phase's acceptance criteria.*
