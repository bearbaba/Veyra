# Veyra Phase 4F — Crash-safe CCTP recovery

Status: implementation in progress; repository CI is the validation authority.

Phase 4F closes the remaining crash window in the already-enabled CCTP V2
testnet bridge and hardens recovery inputs and receipt evidence.

The central invariant is:

> Once an irreversible CCTP source burn may have been submitted, Veyra never
> offers a fresh source burn for that deterministic action.

## 1. Broadcast hash before confirmation

The previous adapter returned `burnTxHash` only after
`waitForTransactionReceipt()`. A browser failure after wallet broadcast but
before that await completed could therefore lose the only local reference to an
in-flight burn.

Phase 4F splits broadcast from confirmation:

- `broadcastDepositForBurn()` returns the source tx hash directly from
  `walletClient.writeContract()`
- Veyra persists `SOURCE_BROADCAST` immediately
- only then does it wait for the source receipt

Destination receive follows the same pattern:

- `broadcastReceiveMessage()` returns the tx hash immediately
- `DESTINATION_BROADCAST` is persisted before receipt waiting
- reload recovery verifies that exact destination transaction instead of
  submitting `receiveMessage` again

Compatibility helpers that broadcast and then wait remain available, but the
production bridge hook uses the crash-safe split boundary.

## 2. Deterministic action replay lock

The CCTP production flow now uses the same persistent action replay store
introduced for App Kit.

Before the irreversible source wallet request:

```text
RESERVED → SUBMISSION_STARTED
```

After the broadcast hash has been durably checkpointed:

```text
SUBMISSION_STARTED → LOCKED
```

Only failures before source submission may release the reservation.

A `SUBMISSION_STARTED` or `LOCKED` action is not automatically reopened.
Recovery/reconciliation is required.

## 3. Recovery checkpoint validation

Bridge checkpoints are treated as untrusted runtime input even when they came
from IndexedDB or the authenticated Postgres mirror.

`parseBridgeRecoveryCheckpoint()` validates:

- known recovery stage
- plan/action identifier
- 32-byte source tx hash
- distinct positive source/destination chain IDs
- valid EVM wallet, recipient, and token addresses
- positive amount and unsigned pre-bridge balance
- monotonic timestamps
- hex attestation fields
- valid destination tx hash
- stage-dependent attestation and destination hash requirements

Malformed rows are rejected on save/read and dropped during local/remote
reconciliation.

Remote state may advance an identical execution, but conflicting immutable
source execution never replaces local state.

## 4. Source receipt evidence

A successful EVM status alone is not enough to mark the source CCTP step
confirmed.

The source receipt must contain the canonical CCTP V2 `MessageSent(bytes)`
event emitted by Veyra's configured MessageTransmitterV2 contract.

Recovery applies the same verification before trusting a restored source burn.

## 5. Destination receipt evidence

The destination transaction must:

- succeed
- contain an ERC-20 `Transfer` from the zero address
- be emitted by the exact destination-chain USDC contract
- mint to the reviewed recipient
- mint exactly the reviewed amount

Veyra additionally checks the recipient's destination USDC balance delta and
requires an exact match to the reviewed amount.

This deliberately rejects a balance snapshot contaminated by an unrelated
concurrent transfer.

## 6. Wallet/action binding

Fresh CCTP execution requires the connected wallet and the wallet address passed
to the hook to match the deterministic `BridgeAction.from`.

The bridge recovery `planId` is the original deterministic `actionId`; Veyra
does not create a second unrelated plan identifier after execution begins.

## 7. CCTP BFF hardening

The CCTP attestation proxy now accepts only:

- Arc Testnet's configured CCTP source domain
- a valid 32-byte EVM transaction hash

The optional relay endpoint now:

- requires Veyra authentication
- is rate-limited
- restricts destination chains to the supported Sepolia targets
- selects the actual requested destination chain instead of always constructing
  an Ethereum Sepolia client
- remains incompatible with a raw production private key because mainnet runtime
  validation forbids `RELAY_PRIVATE_KEY`

Production KMS/HSM relay signing remains a separate deployment/readiness gate.

## 8. Receipt metadata

Phase 4F removes metadata that could not be proven by the execution context:

- no invented `policyDecision: PASS`
- no fabricated bridge source/destination timestamps

Only authoritative transaction/block/state evidence is written as execution
truth.

## 9. DEV isolation and CI

Phase 4F also closes architecture amendment A10.

The production `App.tsx` no longer statically imports the CCTP E2E developer
page.

Developer tooling uses a separate `dev.html` / `src/dev.tsx` entry and
requires `VITE_DEV_TOOLS=true`.

GitHub CI verifies:

- TypeScript
- production-source DEV import isolation
- lint
- unit/integration test suite
- production build
- production bundle contains no known DEV tooling markers

## 10. What Phase 4F does not claim

This phase does not fabricate or claim:

- a live PostgreSQL test when CI has no database
- App Kit or StableFX real E2E evidence
- production KMS signer deployment
- production relay readiness
- mainnet provider activation
- mainnet CCTP execution evidence

Those remain explicit external/deployment evidence gates.

## Validation

The branch is merge-ready only after the latest GitHub Actions run on its exact
head commit passes the complete CI workflow.
