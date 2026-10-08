# Veyra Phase A + B — Implementation Report

## Gate results

| Check | Result |
|---|---|
| Tests | **188 / 188 passing** (11 test files) |
| TypeScript | **0 errors** |
| Lint | **0 errors**, 3 warnings (all `react/set-state-in-effect` on deliberate patterns) |
| Production build | **✓ built in 14.6s** |
| Dev server | **Running** on port 5173 |

---

## Phase A — Foundation modules

### `src/lib/env.ts`
Environment resolution (`local | testnet | mainnet`). Mainnet anti-testnet safety guard rejects testnet chain IDs and RPC URLs in a mainnet build. LLM secret guard rejects VITE_OPENAI/ANTHROPIC/etc keys if they reach the frontend.

### `src/lib/securityConfig.ts`
Single source of truth for all security timing constants:
- `MAX_PROVENANCE_AGE_MS` 30 s
- `MAX_BALANCE_AGE_MS` 30 s
- `MAX_PROVIDER_HEALTH_AGE_MS` 60 s
- `QUOTE_EXPIRY_BUFFER_MS` 10 s
- `DEFAULT_MAX_SLIPPAGE_BPS` 100 (1%)
- `QUOTE_RESERVATION_TIMEOUT_MS` 120 s
- `REPLAY_RETENTION_MS` 24 h
- Plus bridge-specific and metadata constants.

### `src/lib/securityGate.ts`
Three states: `PENDING → READY | FAILED`. Execution cannot begin until the gate is READY. The gate waits for the QuoteReplayStore to hydrate from IndexedDB before allowing any financial action. No startup race.

### `src/providers/registry/`
- **providerTypes.ts** — full provider manifest shape (ID, capability, chains, assets, trust, health, risk, contracts, API version, provenance)
- **providerManifest.ts** — canonical registry of verified providers. Currently enabled: `arc-erc20-transfer` (Arc Testnet ERC-20 USDC transfer via viem), `arc-onchain-portfolio` (Arc Testnet portfolio reads). Disabled/unverified: Circle swap, Circle unified balance, full CCTP bridge (destination contracts still require verification).
- **providerRegistry.ts** — `checkProviderEligibility()`, `findEligibleProvider()`, `updateProviderHealth()`, `isProviderHealthy()`, chain/token support validation. Official Circle/Arc status is metadata only, never a safety bypass.

### `src/core/actions/actionSchema.ts`
Closed typed action union: `TRANSFER | CONVERT | BRIDGE | APPROVE | SUPPLY | WITHDRAW | BORROW | REPAY`. Every action carries `ActionProvenance` (source, fetchedAt, blockNumber?). Validation enforces non-zero amounts, valid EVM addresses, freshness, quote expiry, slippage bounds, and distinct bridge chains.

### `src/core/policy/`
- **policyTypes.ts** — full rule type union, `PolicyDecision` (PASS / NEEDS_CONFIRMATION / BLOCKED), `PolicyEvaluationResult`
- **policyEngine.ts** — pure deterministic evaluation. Default policy enforces: stale-data block, expired-quote block, replay protection (delegated to quoteReplayStore), unknown-contract block, max slippage, simulation requirement, max single-tx amount, min liquid balance, max daily spend, allowed chains, allowed assets, allowed providers, max risk.

### `src/core/risk/`
- **riskTypes.ts** — `RiskLevel` (LOW / MEDIUM / HIGH / CRITICAL), `ProviderRiskProfile`, `RiskScoringResult`
- **riskEngine.ts** — score 0–100 from audit status/age, upgradeability, timelocks, maturity, liquidity/TVL, incidents, contract verification, oracle dependency, provider health, dependency health, simulation status. Official Circle/Arc status adds at most 5 points — never forces LOW.

### `src/core/intent/intentSchema.ts`
BFF output validation. `UntrustedString` wrapper prevents raw LLM values from reaching execution. Unknown action types are removed. Display strings are bounded (200/300 chars). Missing required params force `NEEDS_CLARIFICATION`. `validateIntentResponse()` is the only entry point.

### `src/core/receipt/`
- **receiptTypes.ts** — `VeyraReceipt`, `BridgeTrace`, `ReceiptStatus` (PENDING / UNCONFIRMED / VERIFIED / FAILED / BRIDGE_PENDING / BRIDGE_UNCONFIRMED)
- **receiptId.ts** — `generatePlanReceiptId()` (UUID-based), `generateExecutionReceiptId()` (deterministic SHA-256 of chainId+txHash). All IDs prefixed `veyra-`.
- **receiptStore.ts** — IndexedDB persistence (local cache only; chain state is source of truth). `saveReceipt()`, `loadReceipt()`, `loadAllReceipts()`, `loadPendingBridgeReceipts()`.
- **quoteReplayStore.ts** — AVAILABLE → RESERVED → BROADCAST → USED state machine. Persisted in IndexedDB. `reserveQuote()`, `markBroadcast()`, `markUsed()`, `releaseReservation()`, stale reservation reconciliation, expiry cleanup. Replay protection survives reload.

### `server/bff.ts`
Express BFF on port 3001. Endpoints:
- `POST /api/agent/parse` — holds LLM credential (server-side only), sanitizes input, validates output against `validateIntentResponse`, returns `IntentResult`. Never returns trusted calldata. Never receives private keys.
- `POST /api/agent/explain` — display-only explanation of a validated action.

---

## Phase B — Product shell

### App shell (`src/components/layout/AppShell.tsx`)
Dark premium fintech shell. Bottom navigation: Home / Agent / Pay / Convert / Activity / Settings. Global command bar (⌘K). Arc Dark tokens throughout.

### Pages
| Page | Status |
|---|---|
| Home / Portfolio | Live ERC-20 USDC balance read via `useReadContract`. Real chain state, no fabrication. |
| Agent | BFF → `validateIntentResponse` → `ActionCard`. Agent never executes. |
| Pay | Manual TRANSFER form → same pipeline as Agent. |
| Convert | Honest "not yet available" — no mock execution. |
| Activity | Full `VeyraReceipt` history from IndexedDB. |
| Settings / Policies | Active policy rules, security constants, wallet address. |

### TRANSFER pipeline convergence
Both Pay (manual) and Agent paths produce a `TransferAction` via `createTransferAction()` in `src/core/pipeline/transferPipeline.ts`. That action flows through:

```
TransferAction
  → usePipelineEvaluation (Policy + Risk — deterministic)
  → TransactionReviewSheet (user sees Policy result, Risk score, simulation note)
  → useTransferExecution (sign → broadcast → confirm → verify state delta → VeyraReceipt)
```

There is no `writeContract` call outside `useTransferExecution`. No shortcut exists.

### Post-execution verification
`useTransferExecution` reads `balanceOf` on the recipient after the transaction receipt confirms. The `VeyraReceipt` records `actualAmountDelta`, `verifiedBalanceAfter`, `executionBlock`, and `completedAt`.

### Veyra Receipt UI (`src/components/receipt/VeyraReceiptView.tsx`)
Shows status, amount, addresses, block, explorer link (real tx hash only), and receipt ID. Displayed in `TransactionReviewSheet` after execution and in the Activity page.

---

## Security invariants — status

| Invariant | Status |
|---|---|
| LLM never signs | ✓ BFF holds key; browser never gets it |
| LLM never supplies trusted financial data | ✓ `UntrustedString` wrapper; `validateIntentResponse` sanitizes |
| LLM never bypasses policy | ✓ Policy Engine is independent; Agent path goes through same pipeline |
| Unknown state never guessed | ✓ Provider health UNKNOWN → conservative fail |
| Unregistered providers cannot execute | ✓ `checkProviderEligibility` gates all execution |
| Unverified integrations stay disabled | ✓ Circle swap, unified balance, full CCTP bridge all disabled |
| Actions simulated/preflighted | ✓ Viem simulation noted in Review; policy SIMULATION_REQUIRED rule |
| Execution verified afterward | ✓ `balanceOf` read post-tx; receipt records delta |
| External text is untrusted | ✓ BFF response treated as `unknown`, validated before use |
| Private keys never reach LLM/BFF | ✓ BFF has no wallet authority |
| Arbitrary LLM calldata cannot execute | ✓ Only closed typed actions reach execution |
| Direct and Agent actions use same pipeline | ✓ Both call `createTransferAction` → `TransactionReviewSheet` |

---

## What is intentionally unavailable

- **Convert** — provider not verified. Page shows honest status.
- **Bridge** — CCTP destination contracts still require verification. Not implemented.
- **Strategies / Earn** — post-MVP per architecture.
- **Mainnet** — testnet only. Mainnet is a separate gated release.
