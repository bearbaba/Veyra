# Veyra Phase 4E — App Kit Execution Safety

Status: implementation complete pending final local validation and review.

Phase 4E hardens Circle App Kit integration without enabling any new provider.
The product rule remains:

> App Kit can orchestrate execution, but Veyra owns the deterministic review,
> safety boundary, replay protection, verification, and receipt truth.

## Scope

Phase 4E covers the currently implemented App Kit money-moving surfaces:

- `circle-appkit-bridge`
- `circle-appkit-swap`
- `circle-appkit-earn`
- `circle-appkit-unified-balance`

All four remain lifecycle `IMPLEMENTED` and `enabled: false` until real testnet
E2E evidence satisfies the activation gate and is explicitly reviewed.

No mainnet provider is activated by this phase.

## 1. Canonical execution boundary

Every supported App Kit money-moving wrapper now binds the SDK review/request to
a closed Veyra action before any wallet signature or provider execution.

### Bridge

`executeReviewedAppKitBridge()` verifies:

- provider and provenance ID
- source and destination network
- exact source-chain USDC deployment
- amount
- sender and recipient
- reviewed recipient
- canonical `assertExecutionReady()`
- connected wallet account

### Swap

`executeReviewedAppKitSwap()` verifies:

- provider and provenance ID
- Arc Testnet scope
- exact USDC/EURC pair
- input amount
- reviewed slippage
- current Veyra fee policy and Treasury
- canonical `assertExecutionReady()`
- connected wallet account

The fee is re-derived immediately before execution. A stale/tampered reviewed
Treasury or fee policy cannot silently reach `customFee`.

### Earn

Deposit and withdrawal bind:

- provider and provenance ID
- Arc Testnet
- Arc Testnet USDC
- exact vault
- exact amount
- Earn explainability fields
- canonical `SUPPLY` / `WITHDRAW` action
- canonical `assertExecutionReady()`
- connected account

### Unified Balance

Forwarded Unified spend is bound to a deterministic `BridgeAction` and the
canonical execution boundary.

Raw `unifiedBalance.deposit()` remains intentionally fail-closed because Veyra
does not yet have a canonical action schema that can represent and verify the
provider-controlled Unified deposit destination without ambiguity.

## 2. Raw SDK isolation

The internal `AppKit` instance is not exported.

Product code must use Veyra wrappers rather than calling `bridge()`, `swap()`,
`earn.deposit()`, `earn.withdraw()`, or `unifiedBalance.spend()` directly.

Read-only discovery/balance/position helpers remain separate from money-moving
execution.

## 3. Recovery is not a new execution

`retryAppKitBridge()` uses a recovery-specific gate.

An already-submitted bridge must not fail recovery simply because the original
quote later expires. Recovery therefore does not reuse the new-execution quote
freshness gate.

Recovery still requires:

- security runtime READY
- immutable review/action binding
- registered and implemented provider
- matching environment/capability/chain/asset metadata
- valid source-submission evidence in the App Kit bridge result
- wallet account match
- explicit confirmation when provider health is DEGRADED or UNKNOWN

Provider health DOWN blocks retry.

The recovery gate does not reopen the original action for a fresh bridge burn.

## 4. Persistent action replay protection

Phase 4E adds `actionExecutionReplayStore` in IndexedDB.

State machine:

`RESERVED -> SUBMISSION_STARTED -> LOCKED`

Rules:

- one `actionId` can win the reservation
- only pre-submission `RESERVED` entries may be released
- once provider submission starts, the action remains locked across reload/crash
- a returned provider result advances the action to `LOCKED`
- stale reconciliation may release only old `RESERVED` entries
- `SUBMISSION_STARTED` and `LOCKED` are never automatically reopened

The action replay store hydrates before the global security gate becomes READY.

This complements quote replay protection. Quote replay protects provider quote
identifiers; action replay protects the deterministic Veyra action itself,
including flows where a provider does not expose a reusable quote ID.

## 5. Authoritative receipt verification

Provider SDK success is never sufficient for a Veyra `VERIFIED` receipt.

### Swap

A verified App Kit swap receipt requires:

- terminal SDK result
- exact reviewed Arc Testnet USDC/EURC scope
- provider input amount match
- valid tx hash
- successful authoritative chain receipt
- matching authoritative tx hash
- decoded authoritative output amount
- provider output amount matching decoded chain output
- authoritative output >= reviewed `minAmountOut`

### Bridge

A verified App Kit bridge receipt requires:

- reviewed source-chain USDC deployment
- valid sender/recipient
- terminal bridge success
- successful authoritative source receipt
- destination USDC deployment for the reviewed destination chain
- exact recipient destination balance delta
- destination receipt/hash binding when available

### Unified spend

Unified spend uses chain state as authority even if the SDK result shape changes.
The opaque result is only scanned, with bounded/cycle-safe traversal, to bind
authoritative transaction hashes.

Verification requires the exact reviewed recipient and destination USDC balance
delta.

### Earn

Earn deposit/withdrawal verification requires:

- successful authoritative transaction receipt
- transaction hash present in the SDK result
- exact Arc Testnet USDC
- exact reviewed vault
- exact reviewed account
- authoritative transfer direction:
  - deposit: account -> vault
  - withdrawal: vault -> account
- exact decoded transfer amount
- independent post-transaction position verification

Receipt builders do not invent a policy decision. `policyDecision` remains
`null` unless a separate execution context supplies authoritative policy data.
Bridge timestamps are also not fabricated from plan/verification wall-clock
times.

## 6. Activation evidence

Phase 4E tightens the Phase 4D evidence gate.

Every fund-moving capability now requires evidence that duplicate prevention was
verified. Bridge additionally requires recovery verification. Earn deposit and
withdrawal additionally require explainability verification.

The repository activation ledger now rejects records that merely contain the
right fields but claim any required verification as false.

The activation ledger remains intentionally empty until real executions produce
reviewable evidence references.

## 7. Provider state after Phase 4E

Phase 4E does not change lifecycle state for App Kit providers.

Expected state remains:

- `circle-appkit-bridge`: IMPLEMENTED, disabled
- `circle-appkit-swap`: IMPLEMENTED, disabled
- `circle-appkit-earn`: IMPLEMENTED, disabled
- `circle-appkit-unified-balance`: IMPLEMENTED, disabled

Existing `cctp-v2-bridge` remains the enabled testnet bridge route.

## 8. Required evidence before promotion

Before any App Kit provider can move from IMPLEMENTED to TESTED, real testnet
execution evidence must demonstrate, as applicable:

- real execution
- final state verification
- verified Veyra receipt
- signature budget verification
- duplicate-prevention verification
- bridge recovery verification
- Earn explainability verification
- evidence references
- exact adapter/package version match

Promotion remains explicit and human-reviewed. Evidence never mutates the
manifest automatically.

## 9. Known deliberate limitations

Phase 4E does not claim to solve or enable:

- raw Unified deposits
- App Kit mainnet activation
- Solana App Kit execution
- real App Kit E2E evidence
- automatic provider promotion
- automatic reopening of uncertain `SUBMISSION_STARTED` actions

An uncertain submission remains fail-closed and requires explicit reconciliation
or the dedicated recovery path.

## 10. Validation gate

Before merging Phase 4E, run:

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
git status
```

Required result:

- typecheck passes
- lint has zero errors
- all tests pass
- production build succeeds
- working tree is clean

The existing Vite large-chunk message is a non-blocking performance warning and
is outside the security scope of Phase 4E.
