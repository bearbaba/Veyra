# Veyra Architecture Plan
**Version:** 0.1 — Pre-implementation review draft  
**Date:** 2026-10-08  
**Status:** AWAITING REVIEW — no code may be written until this document is approved

---

## 0. Guiding Principles

1. **Shared modules, not per-page logic.** Payment, Agent, and Bridge are three _surfaces_ consuming the same registry, routing, and policy stack. Logic that lives in a page is a bug.
2. **LLM never touches money.** The LLM resolves intent and populates an `ActionRequest`. Every subsequent step — route selection, policy check, signing, receipt — runs in deterministic, auditable code.
3. **Provider model is pluggable from day one.** CCTP V2 is the first bridge provider. The architecture must be indifferent to which providers exist.
4. **Testnet and mainnet are structurally different environments.** Code, config, and UX that applies only to one must not bleed into the other. DEV tooling (E2E pages, raw calldata explorers) is compiled out of production builds.
5. **No burn without a hard-pass preflight.** A failed critical destination check is an unconditional block, not a warning the user can click through.
6. **Identity is owned by the user, not inferred by the app.** Wallet proof, multi-chain mappings, and preferred receive settings are user-supplied and cryptographically verified — never guessed.

---

## 1. Module Map

```
┌─────────────────────────────────────────────────────────────────┐
│                        UI SURFACES                              │
│   PayPage    AgentPage    BridgePage    (ActivityPage future)   │
└──────┬──────────┬──────────┬────────────────────────────────────┘
       │          │          │   All surfaces call the same API:
       ▼          ▼          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CORE ACTION LAYER                          │
│  IntentSchema → ActionRequest → TransactionPolicy → RouteEngine │
└─────┬────────────────────────────────────────────┬─────────────┘
      │                                            │
      ▼                                            ▼
┌─────────────────────┐              ┌─────────────────────────────┐
│  VeyraIdentityResolver │           │  ProviderRegistry           │
│  ChainRegistry       │           │  (pluggable: CCTP, future)  │
│  TokenRegistry       │           └─────────────────────────────┘
└─────────────────────┘
      │                                            │
      ▼                                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXECUTION LAYER                              │
│   PreflightEngine   →   ProviderAdapter   →   ActivityReceipt  │
└─────────────────────────────────────────────────────────────────┘
```

Every surface passes through every layer. No surface has a private routing, policy, or identity path.

---

## 2. VeyraIdentityResolver

### 2.1 Purpose

Maps a human-readable identifier (X handle, ENS name, email address) to a set of verified wallet addresses with metadata about preferred receive chain and token. Handles identity staleness and revocation.

### 2.2 Immutable X Account ID vs Mutable @handle

| Field | Type | Mutability | Source of truth |
|-------|------|------------|----------------|
| `xAccountId` | `string` (numeric, e.g. `"123456789"`) | **Immutable** — Twitter/X assigns once, never reassigned | Returned by X OAuth2 `GET /2/users/me` — only the ID, never the handle |
| `xHandle` | `string` (e.g. `"@alice"`) | **Mutable** — user may change at any time | Cached at proof time; re-fetched on each identity resolution, never used as a stable key |

**Rule:** All internal records, receipts, and policy decisions key on `xAccountId`. The handle is display-only. A change of handle does not invalidate an existing identity record; a handle reuse by a different account ID creates a new record and must never inherit the old one's wallets.

### 2.3 Wallet Proof / Signature Flow

```
1. User connects wallet W to Veyra frontend.
2. Frontend requests a proof challenge from BFF:
     POST /api/identity/challenge
     → { challengeId, message, expiresAt }
   The message is deterministic:
     "Veyra wallet proof\nxAccountId: {id}\nchallenge: {uuid}\nexpires: {iso8601}"
3. User signs the challenge with W (EIP-191 personal_sign or EIP-712 — TBD at design review).
   The signature is created in the browser wallet. BFF never sees the private key.
4. Frontend submits:
     POST /api/identity/verify-wallet
     { challengeId, walletAddress, signature, chainId }
5. BFF recovers the signer from the signature and verifies:
   a. Recovered address === walletAddress
   b. challengeId is known and not expired (TTL from securityConfig)
   c. xAccountId in the challenge matches the authenticated session
   d. No existing record has a conflicting proof for this wallet on a different xAccountId
6. BFF writes an IdentityWalletRecord to persistent storage.
7. Challenge is consumed (single-use).
```

The challenge message is a canonical string, not a JSON object, so wallets that only support `personal_sign` can participate. EIP-712 structured data is preferred for hardware wallets and will be the mainnet default.

### 2.4 IdentityRecord Schema

```typescript
interface IdentityRecord {
  xAccountId: string;           // immutable primary key
  xHandle: string;              // display only, re-fetched on resolution
  xHandleLastVerified: number;  // unix ms
  wallets: IdentityWalletRecord[];
  preferredReceive: PreferredReceive | null;
  status: 'ACTIVE' | 'STALE' | 'REVOKED';
  createdAt: number;
  updatedAt: number;
}

interface IdentityWalletRecord {
  address: string;                   // checksummed EVM address (EIP-55)
  proofSignature: string;            // hex, stored permanently for audit
  proofChallengeId: string;
  proofTimestamp: number;
  chainIds: number[];                // chains where this wallet is confirmed funded/active
  status: 'ACTIVE' | 'REVOKED';
  revokedAt?: number;
  revokedBy?: 'user' | 'admin';
}

interface PreferredReceive {
  chainId: number;
  tokenAddress: string;   // ERC-20 address or native sentinel
  walletAddress: string;  // must be in wallets[] with ACTIVE status
}
```

### 2.5 Multi-Wallet and Multi-Chain Mappings

- A single `xAccountId` may have N verified wallets.
- Each wallet may declare which chain IDs it is active on (funded, user-confirmed).
- A wallet's `chainIds` list is maintained by the user; the app may suggest additions when it detects a non-zero balance on an unlisted chain, but never auto-adds.
- `RouteEngine` queries all ACTIVE wallets for a given identity to find the best destination address and chain.

### 2.6 Preferred Receive Chain / Token

The user explicitly sets a `preferredReceive` record:
- `chainId` — the chain they want to receive on by default
- `tokenAddress` — the token (almost always USDC but extensible)
- `walletAddress` — must be one of their verified ACTIVE wallets on that chain

`RouteEngine` treats `preferredReceive` as highest-priority input. If absent, the engine uses heuristics (highest USDC balance, cheapest route) and surfaces the result for user confirmation before execution.

### 2.7 Stale and Revoked Identity States

| State | Trigger | Effect |
|-------|---------|--------|
| `ACTIVE` | Default after proof | Full participation |
| `STALE` | `xHandleLastVerified` older than `IDENTITY_STALENESS_TTL` (from securityConfig) | Resolved with a warning; execution blocked until re-verified |
| `REVOKED` | User revokes a wallet proof, or admin revocation | That wallet's address is excluded from all routing; if all wallets are revoked, identity is fully blocked |

A `STALE` identity that cannot be re-verified (X account deleted, deauthorized) transitions to `REVOKED` after `IDENTITY_REVOCATION_GRACE_TTL`.

---

## 3. ChainRegistry

### 3.1 Purpose

Single source of truth for all chain metadata. Replaces any chain constant scattered across adapters or pages.

### 3.2 ChainRecord Schema

```typescript
interface ChainRecord {
  chainId: number;
  name: string;                   // "Arc Testnet", "Ethereum Sepolia", etc.
  shortName: string;              // "arc-testnet", "sepolia"
  rpcUrl: string;                 // from RPC proxy or onchain-facts
  explorerUrl: string;
  explorerApiUrl?: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
    isUsdc: boolean;              // true for Arc
  };
  logoSource: ChainLogoSource;
  environment: 'testnet' | 'mainnet';
  cctpDomain?: number;            // set if CCTP V2 supports this chain
  gatewaySupported: boolean;
  status: 'ACTIVE' | 'DEGRADED' | 'DISABLED';
  statusNote?: string;
}

type ChainLogoSource =
  | { type: 'web3icons'; identifier: string }   // @web3icons/react chain icon
  | { type: 'url'; url: string }
  | { type: 'inline'; svgDataUri: string };
```

### 3.3 Relationship to `onchain-facts.ts`

`ChainRegistry` reads its initial seed from `onchain-facts.ts` (the generated, registry-backed module). It wraps `getChain` and `ONCHAIN_CHAINS` rather than duplicating them. The registry adds `logoSource`, `environment`, `status`, and the operational fields not in `onchain-facts`.

---

## 4. TokenRegistry

### 4.1 Purpose

All token metadata — address per chain, decimals, logo, symbol, supported operations — in one place. No component or adapter may hardcode a token address.

### 4.2 TokenRecord Schema

```typescript
interface TokenRecord {
  id: string;                     // "usdc", "usdt", "eth", etc.
  symbol: string;
  name: string;
  decimals: number;               // canonical ERC-20 decimals (not gas-token decimals)
  logoSource: TokenLogoSource;
  deployments: TokenDeployment[]; // one per chain
  tags: TokenTag[];
}

interface TokenDeployment {
  chainId: number;
  address: string;                // ERC-20 address; use NATIVE sentinel for gas token
  decimals: number;               // may differ from canonical (e.g. Arc native vs ERC-20)
  bridgeable: boolean;
  cctpSupported: boolean;
  gatewaySupported: boolean;
  status: 'ACTIVE' | 'DEPRECATED' | 'DISABLED';
}

type TokenLogoSource =
  | { type: 'web3icons'; identifier: string }
  | { type: 'url'; url: string }
  | { type: 'inline'; svgDataUri: string };

type TokenTag = 'stablecoin' | 'native' | 'lp-token' | 'wrapped';
```

### 4.3 Logo and Metadata Source Policy

1. **Primary:** `@web3icons/react` — covers most major tokens and chains with consistent styling. Use `identifier` from the package's registry.
2. **Secondary:** CoinGecko asset image URL (fetched at build time, cached in `/public/token-logos/` and `/public/chain-logos/`). Never fetched at runtime on the critical path.
3. **Fallback:** Generated placeholder from the token symbol initial.
4. No logo fetch may block a transaction flow. Logo loading is always async with a placeholder shown immediately.

---

## 5. RouteEngine

### 5.1 Purpose

Given a source (wallet, chain, token, amount) and a destination (identity, preferred chain/token), return an ordered list of `RouteOption` objects. The UI renders these for user confirmation. The user selects one. The selected route becomes the `ExecutionPlan`.

### 5.2 RouteOption Schema

```typescript
interface RouteOption {
  routeId: string;                     // deterministic hash of inputs + provider + path
  provider: string;                    // provider ID: "cctp-v2", "gateway", "uniswap-v4", etc.
  sourceChainId: number;
  sourceToken: string;
  destinationChainId: number;
  destinationToken: string;
  destinationAddress: string;
  amountIn: bigint;                    // raw, source decimals
  amountOut: bigint;                   // raw, destination decimals (estimated)
  fees: RouteFee[];
  estimatedTimeMs: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  expiresAt: number;                   // unix ms — route quote validity window
  providerMetadata: Record<string, unknown>; // provider-specific (CCTP domain, swap path, etc.)
}

interface RouteFee {
  label: string;          // "Gas (Arc Testnet)", "CCTP relayer fee", "Protocol fee"
  amountUsd: number;      // estimated, display only
  paidBy: 'sender' | 'receiver' | 'relayer';
}
```

### 5.3 Route Selection Algorithm

```
1. Collect candidate providers from ProviderRegistry
   (filter: lifecycleStage === ENABLED, supports source/destination chains)
2. For each provider, call provider.quoteRoute(sourceChainId, destinationChainId, token, amount)
   → returns RouteOption or null (unsupported pair)
3. Score candidates:
   a. Hard filter: amountOut < amountIn * MIN_OUTPUT_RATIO → discard
   b. Sort by: amountOut DESC, estimatedTimeMs ASC, confidence DESC
4. Return top N (configurable, default 3) for user selection.
5. If zero candidates: RouteEngine returns NO_ROUTE_AVAILABLE with a structured reason.
```

### 5.4 Cross-Chain Routes (Not Only Arc → Sepolia)

The engine is defined over the full matrix of `ChainRegistry.ACTIVE` chains. Any ENABLED provider that declares a `supportedRoutes` list contributes to the matrix. CCTP V2 currently supports:

- Arc Testnet ↔ Ethereum Sepolia (testnet)
- Arc ↔ Ethereum, Base, Arbitrum, OP, Polygon, Solana (mainnet, to be added)

Gateway providers, future DEX aggregators, and intent-based bridges contribute additional routes. The UI shows the union of all available routes without any hard-coded chain pair list.

### 5.5 Duplicate-Send Prevention

`RouteEngine` generates a `routeId` before any execution begins. This ID is committed to `ActivityReceipt` storage at the point the user confirms. Before executing, `ActivityReceipt.store.findByRouteId(routeId)` is checked:

- `PENDING` or `CONFIRMED` receipt with the same `routeId` → execution is blocked, user is shown the existing receipt.
- `FAILED` receipt → execution is allowed (a failed attempt is not a completed send).
- No receipt → execution proceeds normally.

The `routeId` is deterministic and includes: sender address, recipient identity, amount, token, source chain, destination chain, and a nonce from the user's last signed nonce. It cannot be forged by a third party. A duplicate confirmation (browser double-click, double wallet prompt) will produce the same `routeId` and be blocked at the receipt check.

---

## 6. TransactionPolicy

### 6.1 Purpose

Centralized, auditable evaluation of whether a given `ActionRequest` may proceed. Returns a structured `PolicyResult`, never a boolean. Every execution path in every surface calls this before any signing.

### 6.2 Policy Checks (ordered)

| # | Check | Failure mode |
|---|-------|-------------|
| 1 | Sender wallet is connected and on correct source chain | `HARD_BLOCK` |
| 2 | Source token balance ≥ amount + estimated fees | `HARD_BLOCK` |
| 3 | Recipient identity is `ACTIVE` (not `STALE`/`REVOKED`) | `HARD_BLOCK` |
| 4 | Recipient has at least one ACTIVE wallet on destination chain | `HARD_BLOCK` |
| 5 | RouteOption is not expired | `HARD_BLOCK` |
| 6 | `routeId` not already in `ActivityReceipt` store as PENDING/CONFIRMED | `HARD_BLOCK` |
| 7 | Amount ≤ `POLICY_MAX_SINGLE_TRANSFER` (from securityConfig) | `HARD_BLOCK` |
| 8 | Amount within 24h rolling limit for this sender | `HARD_BLOCK` |
| 9 | Destination chain passes **HARD BLOCK preflight** (see §6.3) | `HARD_BLOCK` |
| 10 | Destination chain passes **WARNING preflight** (see §6.3) | `WARNING` — user must explicitly acknowledge |
| 11 | Destination chain passes **INFORMATIONAL preflight** (see §6.3) | `INFO` — shown, no confirmation required |

### 6.3 Pre-Burn / Pre-Execute Preflight Classification

All preflight checks run on the BFF (never the browser) so they have access to chain RPCs, Circle attestation status, and the relayer service.

#### HARD BLOCK — burn/execution must not proceed if any of these fail

| Check | Reason |
|-------|--------|
| Destination `MessageTransmitterV2` bytecode present and non-empty | Contract not deployed on destination: funds cannot be claimed |
| Destination `TokenMessengerV2` bytecode present and non-empty | Same |
| Circle attestation service reachable (`/v1/attestations` returns 2xx) | No attestation = unclaimed burn forever |
| Source token allowance ≥ amount (ERC-20 approve already submitted) | Burn will revert immediately |
| `routeId` not already in receipt store as CONFIRMED | Duplicate send |
| Recipient address is not zero address | Funds irretrievably lost |
| Destination chain `status` in ChainRegistry is `ACTIVE` (not `DEGRADED`/`DISABLED`) | Chain is operationally blocked |

#### WARNING — surfaced to user, requires explicit acknowledgement before execution

| Check | Reason |
|-------|--------|
| Destination wallet native gas balance < `MIN_RECEIVE_GAS_WARNING` | User may be unable to move funds after receipt (not required for CCTP relay path) |
| Estimated route time > `ROUTE_TIME_WARNING_MS` (from securityConfig) | Unusually long bridge |
| Amount > `POLICY_LARGE_TRANSFER_WARNING` (from securityConfig) | Large transfer confirmation |
| Attestation service latency > `ATTESTATION_LATENCY_WARNING_MS` | Circle infra may be slow |
| `RouteOption.confidence === 'LOW'` | Quote is uncertain |

#### INFORMATIONAL — shown in transaction review UI, no action required

| Check | Reason |
|-------|--------|
| Estimated destination gas cost in USD | Cost awareness |
| Route provider name and version | Transparency |
| Expected arrival time window | UX |
| First send to this recipient | New recipient notice |
| First use of this destination chain | New chain notice |

---

## 7. ActivityReceipt

### 7.1 Purpose

Immutable, append-only log of every user-initiated action. Shared data structure used by all three surfaces (Pay, Agent, Bridge). The receipt store is the canonical record of what happened; no surface may reconstruct history from chain state alone.

### 7.2 ActivityReceipt Schema

```typescript
interface ActivityReceipt {
  receiptId: string;             // generateExecutionReceiptId(...)
  routeId: string;               // from RouteEngine
  planReceiptId: string;         // from policy evaluation
  surface: 'PAY' | 'AGENT' | 'BRIDGE';
  action: ActionType;            // from ActionSchema
  status: ActivityReceiptStatus;

  // Sender
  senderAddress: string;
  senderChainId: number;

  // Recipient
  recipientIdentity: ResolvedIdentity | null;   // null for self-send
  recipientAddress: string;
  recipientChainId: number;

  // Asset
  tokenId: string;               // TokenRegistry id
  amountIn: string;              // stringified bigint, source decimals
  amountOut: string | null;      // stringified bigint, destination decimals; null until confirmed
  tokenAddress: string;

  // Route
  provider: string;
  routeOption: RouteOption;

  // Execution trace
  trace: ActivityTrace[];

  // Timestamps
  createdAt: number;
  confirmedAt: number | null;
  failedAt: number | null;

  // Recovery
  resumable: boolean;
  resumePayload: ResumePayload | null;
}

type ActivityReceiptStatus =
  | 'PENDING'
  | 'BROADCAST'
  | 'SOURCE_CONFIRMED'       // source-chain tx mined
  | 'ATTESTATION_PENDING'    // waiting for Circle attestation (CCTP)
  | 'RECEIVE_PENDING'        // destination tx not yet mined
  | 'RECEIVE_FAILED_RETRYABLE' // destination tx failed, can retry without re-burn
  | 'CONFIRMED'              // fully settled on destination
  | 'FAILED'                 // terminal failure, requires user action
  | 'CANCELLED';

interface ActivityTrace {
  step: string;
  txHash?: string;
  chainId?: number;
  timestamp: number;
  data?: Record<string, unknown>;
}

interface ResumePayload {
  // Enough data to retry the next step without repeating completed steps.
  // Shape is provider-specific but must be validated against a Zod schema.
  provider: string;
  version: number;
  payload: Record<string, unknown>;
}
```

### 7.3 Storage

- **Browser (IndexedDB via `receiptStore.ts`)**: all receipts for the current user. Persisted across reloads. Max 1000 receipts; oldest CONFIRMED receipts evicted first.
- **BFF (persistent DB — to be designed in DB design phase)**: server-side mirror for cross-device access and audit. The browser is not the system of record; BFF is.
- **Sync model**: browser writes optimistically; BFF confirms. On conflict (browser has `CONFIRMED`, BFF has `RECEIVE_PENDING`), BFF wins.

### 7.4 Recovery / Resume Semantics

On app load, `ActivityReceipt.store.getResumable()` returns all receipts in states:
- `RECEIVE_PENDING`
- `RECEIVE_FAILED_RETRYABLE`
- `ATTESTATION_PENDING`

For each, the app:
1. Checks if the step has now completed on-chain (poll once, no polling loop on load).
2. If completed: updates status to `CONFIRMED`, writes to BFF.
3. If still pending: surfaces a "Resume" card in the Activity view.
4. Never re-executes a source-chain step (burn, approve) for a resumable receipt.

The `ResumePayload` is the only data an adapter may use to continue a paused flow. If `resumePayload` is missing or fails schema validation, the receipt transitions to `FAILED` with `requiresManualReview: true`.

---

## 8. How All Three Surfaces Consume Shared Modules

```
PayPage
  │ user types "@alice 10 USDC"
  ▼
IntentSchema.parse(llmResponse)         ← validates LLM output, strips untrusted fields
  ▼
VeyraIdentityResolver.resolve("@alice") ← returns IdentityRecord or STALE/NOT_FOUND
  ▼
TokenRegistry.get("usdc", sourceChainId)  ← resolves token address, decimals
ChainRegistry.get(sourceChainId)           ← resolves chain metadata
  ▼
RouteEngine.selectRoutes({               ← queries all ENABLED providers
  source: { chainId, token, address, amount },
  destination: { identity, preferredReceive }
})
  ▼
TransactionPolicy.evaluate(actionRequest, routes[0])  ← runs all policy checks
  ▼
TransactionReviewSheet shown to user     ← displays PolicyResult warnings + RouteOption
  ▼
User confirms
  ▼
ActivityReceipt.create(PENDING)          ← committed before any tx
  ▼
ProviderAdapter.execute(routeOption)     ← CCTP, Gateway, etc.
  ▼
ActivityReceipt.update(trace steps)
  ▼
ActivityPage shows result
```

`AgentPage` follows the identical path from `IntentSchema.parse` onward. The agent surface is a different _entry point_ into the same pipeline, not a different pipeline.

`BridgePage` is the same pipeline with `surface: 'BRIDGE'` and no identity resolution step (the user supplies a destination address directly, or selects from their own verified wallets).

---

## 9. Production-Grade Relayer Architecture

`RELAY_PRIVATE_KEY` in `.env` is **dev-only**. It must not exist in any production environment. The following design replaces it.

### 9.1 Relayer Components

```
┌──────────────────────────────────────────────────┐
│                  Veyra BFF                       │
│  POST /api/bridge/relay-receive                  │
│   - authenticates user session                    │
│   - validates receipt ID and status               │
│   - rate-limits per sender address                │
│   - checks replay protection (receiptId nonce)    │
│   - calls RelayerService.submitReceiveMessage()   │
└─────────────────────┬────────────────────────────┘
                      │  internal mTLS / service token
                      ▼
┌──────────────────────────────────────────────────┐
│              RelayerService (separate process)    │
│   - holds NO private keys directly                │
│   - constructs unsigned tx                        │
│   - calls SignerService.sign(unsignedTx)          │
│   - broadcasts signed tx                          │
│   - records gas used, tx hash, success/failure    │
└─────────────────────┬────────────────────────────┘
                      │  isolated signing API
                      ▼
┌──────────────────────────────────────────────────┐
│              SignerService (HSM / KMS)            │
│   AWS KMS | GCP Cloud HSM | HashiCorp Vault      │
│   - private key never leaves HSM boundary        │
│   - signing policy: only known selector/calldata  │
│   - logs all signing requests                     │
└──────────────────────────────────────────────────┘
```

### 9.2 Authentication and Authorization

- The BFF relay endpoint requires a valid Veyra user session (cookie or Bearer token).
- The request must reference an existing `ActivityReceipt` in state `ATTESTATION_COMPLETE` or `RECEIVE_FAILED_RETRYABLE`.
- The `receiptId` must belong to the authenticated user's `xAccountId`.
- The destination address in the receipt must match the calldata — the BFF reconstructs and verifies the `receiveMessage` calldata from the stored receipt before sending to RelayerService. It never trusts client-supplied calldata.

### 9.3 Rate Limits

| Limit | Default (from securityConfig) |
|-------|-------------------------------|
| Per-user relay requests per hour | `RELAY_RATE_LIMIT_PER_USER_HOUR` |
| Per-user relay requests per day | `RELAY_RATE_LIMIT_PER_USER_DAY` |
| Global relay requests per minute | `RELAY_RATE_LIMIT_GLOBAL_MINUTE` |
| Max gas per relay tx | `RELAY_MAX_GAS_PER_TX` |
| Daily gas budget (total relayer wallet) | `RELAY_DAILY_GAS_BUDGET_USD` |

Rate limits are enforced in the BFF before calling RelayerService. Exceeded limits return `429` with `retryAfter`.

### 9.4 Replay Protection

Each relay call includes a `receiptId` and a `relayNonce` (monotonically incrementing per-receipt counter, stored in the DB). The RelayerService rejects any relay attempt where `relayNonce` has already been used for that `receiptId`. This is separate from the on-chain nonce check (`receiveMessage` reverts on duplicate message), which is a second layer of protection.

### 9.5 Gas Policy

- The relayer wallet is pre-funded with destination-chain gas.
- Before broadcasting, `RelayerService.estimateGas()` is called. If `estimatedGas > RELAY_MAX_GAS_PER_TX`, the relay is refused and the user falls back to self-relay.
- Gas spend is recorded per `receiptId`. Daily spend is tracked against `RELAY_DAILY_GAS_BUDGET_USD`. If exceeded, relay is suspended and ops is alerted.
- The relayer does **not** charge users for gas in the initial release. Gas cost is a Veyra platform cost. Charging for relay gas is a future billing feature, not an architecture assumption.

### 9.6 Fallback to Self-Relay

If `RelayerService` is unavailable, rate-limited, or refuses the request, the BFF returns `{ selfRelay: true }` and the frontend falls back to asking the user to sign and broadcast `receiveMessage` themselves. This is always available as the terminal fallback; the production relayer is a convenience, not a dependency.

---

## 10. Pluggable Provider Model

CCTP V2 is one provider. The architecture must not treat it as special.

### 10.1 ProviderAdapter Interface

```typescript
interface BridgeProviderAdapter {
  readonly providerId: string;
  readonly version: string;

  /** Can this provider route from source to destination? */
  canRoute(
    sourceChainId: number,
    destinationChainId: number,
    tokenId: string
  ): boolean;

  /** Return a route quote, or null if the pair is unsupported. */
  quoteRoute(params: RouteQuoteParams): Promise<RouteOption | null>;

  /**
   * Run pre-execution checks.
   * Returns classified results — HARD_BLOCK items abort; WARNING items require user ack.
   */
  preflight(routeOption: RouteOption): Promise<PreflightResult[]>;

  /**
   * Execute the route.
   * Returns a ResumePayload that can be stored in ActivityReceipt.
   * The adapter may itself prompt for one or more user signatures via the
   * passed `signer` callback — it never holds keys.
   */
  execute(
    routeOption: RouteOption,
    signer: TransactionSigner,
    onProgress: (trace: ActivityTrace) => void
  ): Promise<ExecutionResult>;

  /**
   * Resume a partially completed flow.
   * Called when ActivityReceipt has a valid ResumePayload for this provider.
   */
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
  message: string;       // user-facing
  detail?: string;       // developer/support detail
}
```

### 10.2 Future Providers

The following providers are anticipated. None are in scope for the current implementation phase but the interface must accommodate them:

| Provider | Mechanism | Notes |
|----------|-----------|-------|
| `circle-gateway` | Circle Gateway burn/mint | Fast (~500ms), mainnet |
| `across-protocol` | UMA optimistic bridge | Fast, wide chain coverage |
| `stargate-v3` | LayerZero messaging | USDC + multi-token |
| `relay-protocol` | Intent-based | Low latency, solver model |
| `uniswap-x-crosschain` | UniswapX intent | Future |

Each new provider is added as a new `BridgeProviderAdapter` implementation. `RouteEngine`, `TransactionPolicy`, and `ActivityReceipt` are provider-agnostic and require no changes.

---

## 11. Transaction Confirmation UX

### 11.1 Confirmation Sheet

The `TransactionReviewSheet` renders a single canonical confirmation UI for all surfaces and all providers. It displays:

1. **Action summary** — "Send 10 USDC to @alice on Base"
2. **Route details** — provider name, estimated time, fee breakdown (from `RouteOption.fees`)
3. **Preflight results** — all `WARNING` items listed with acknowledge checkboxes; `INFO` items collapsed by default
4. **Identity display** — recipient handle + avatar (display only), verified wallet address
5. **Amount display** — `amountIn` with source token, estimated `amountOut` with destination token (if different)
6. **Edit / Back button** — always available before final confirm

The confirm button is disabled until:
- All `WARNING` preflight items are acknowledged
- The route option has not expired (live countdown shown)

### 11.2 Confirmation States

After the user confirms and signs the source-chain transaction:

```
BROADCAST → SOURCE_CONFIRMED → ATTESTATION_PENDING → RECEIVE_PENDING → CONFIRMED
```

Each state has a corresponding UI:
- **BROADCAST**: spinner, "Transaction submitted"
- **SOURCE_CONFIRMED**: progress bar, estimated time remaining
- **ATTESTATION_PENDING**: "Waiting for Circle attestation" with estimated wait
- **RECEIVE_PENDING**: "Claiming on [destination chain]" (either relayer or user action)
- **CONFIRMED**: success animation, amount received, explorer links

The user may navigate away at any state. The Activity page shows the live state for all in-progress receipts.

### 11.3 Failure Recovery UI

A receipt in `RECEIVE_FAILED_RETRYABLE` shows:
- What failed (step name, error message)
- A "Retry receive" button (never "Retry send")
- Explanation that funds are not lost — they are held by the source-chain messenger pending attestation

A receipt in `FAILED` (terminal) shows:
- Error summary
- "Contact support" link with the `receiptId` pre-filled
- For CCTP: "Your funds may still be claimable. See recovery guide." with link

---

## 12. DEV vs Production Separation

### 12.1 DEV-Only Surface

`CctpE2EPage` and any future raw-calldata, multi-step dev tooling is:

- Compiled only when `import.meta.env.VITE_DEV_TOOLS === 'true'`
- Routed only under `/dev/*` paths, guarded by `DevOnlyRoute` wrapper
- Not imported from any non-dev component
- Not included in the production bundle (tree-shaken via the env guard)

The production Bridge UX is a simple 3-step flow:
1. Select token and amount
2. Review route (TransactionReviewSheet)
3. Confirm

The 7-step CCTP lifecycle detail (approve → burn → attest → receive → verify → promote → enable) is internal. Users never see lifecycle stage names, provider IDs, or CCTP domain numbers.

### 12.2 Feature Flags

All in-progress providers and experimental UX are gated by `VITE_FEATURE_*` flags set in `.env.development` and `.env.production`. The production `.env` never enables a feature that has not passed the full lifecycle gate.

### 12.3 Environment Assertion

`src/lib/env.ts` already enforces the mainnet anti-testnet guard. For production:
- Any `VITE_*` address that resolves to a testnet contract address causes an immediate startup error.
- `ENV_ASSERT_PRODUCTION=true` in `.env.production` enables strict assertion mode.

---

## 13. Open Questions for Review

The following questions require a decision before implementation begins:

1. **Identity storage backend**: Is the BFF allowed to persist IdentityRecords to a DB in this phase, or is localStorage + BFF-in-memory the constraint? This affects the sync model and revocation reliability.
2. **EIP-712 vs personal_sign for wallet proof**: EIP-712 is better but requires the app to define a domain and type hash. Confirm which is required for mainnet.
3. **Relayer gas funding model**: Who funds the relayer wallet? Is there an ops process for topping it up? What is the initial budget?
4. **@handle resolution scope**: Is X (Twitter) the only handle system for mainnet, or do ENS / Farcaster FIDs also need to be supported?
5. **ActivityReceipt BFF persistence schema**: Postgres? SQLite? Needs a data design before the DB phase.
6. **RouteEngine quote caching**: Quotes expire. What is the re-quote threshold (amount delta, time elapsed) that forces a new quote fetch?
7. **Multi-hop routes**: USDC on Chain A → USDC on Chain B → Token X on Chain B is a multi-hop. Is this in scope?
8. **Cross-chain token swaps**: Scope for mainnet v1?

---

## 14. What Is Not Changing

The following are fixed architecture decisions, not open for re-discussion:

- Phase A engines (policy, risk, intent, receipt types) are authoritative. All new code adapts to them.
- LLM never signs, never holds financial data, never calls chain RPCs.
- Provider lifecycle `DISCOVERED → VERIFIED → IMPLEMENTED → TESTED → ENABLED` is mandatory for all providers.
- `RELAY_PRIVATE_KEY` is dev-only and must not appear in production `.env`.
- Pre-burn HARD BLOCK preflight failures unconditionally prevent execution.
- No duplicate abstractions: no second `PolicyResult`, `RiskResult`, or `ActionType` type.
- Testnet default. Mainnet requires explicit confirmation and a separate gated release process.

---

*End of architecture plan. No code is to be written until this document is reviewed and approved.*
