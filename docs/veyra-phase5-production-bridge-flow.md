# Veyra Phase 5 — Production Bridge Flow

Status: implementation complete pending the final live production-UI CCTP E2E
acceptance run.

Phase 5 moves the already-proven CCTP testnet route out of the DEV validation
surface and into the production routing, receipt, recovery, and Activity
architecture.

## Production flow

The production bridge path is now:

```text
Input
→ RouteEngine
→ lifecycle/registry eligibility
→ provider quote
→ provider preflight
→ deterministic policy/risk evaluation
→ Review
→ route freshness refresh
→ authenticated ActivityReceipt creation
→ ProviderAdapter.execute()
→ canonical CCTP execution runtime
→ chain verification
→ ActivityReceipt completion
```

The reviewed route receives a deterministic `routeId` derived from:

- server-issued/client intent UUID
- sender
- recipient snapshot/direct recipient key
- amount
- source token + chain
- destination token + chain
- provider
- provider version

The route ID becomes the `BridgeAction.actionId`. Refreshing an otherwise
identical short-lived CCTP quote therefore does not create a second replay
identity.

## RouteEngine

`src/core/router/routeEngine.ts`:

- considers only lifecycle `ENABLED` providers
- reuses the canonical Provider Registry eligibility check
- filters exact source/destination/token capability coverage
- enforces provider quote timeout
- rejects expired/future/structurally invalid route data
- rejects unsupported multi-hop routes
- enforces a generic minimum-output safety ratio
- ranks output, time, then confidence
- returns a bounded number of route choices

CCTP V2 supplies the first production `BridgeProviderAdapter`.

## CCTP provider capability adapter

`src/providers/cctp/cctpBridgeProvider.ts` owns:

- CCTP provider identity/version
- supported direct testnet routes
- static standard-transfer route quote
- provider capability matrix
- destination CCTP contract-code preflight
- attestation-service health preflight
- direct-only execution gate
- ProviderAdapter `execute()` / `resume()` boundary

Browser wallet/RPC mechanics remain in the canonical bridge execution runtime.
The provider adapter validates route/runtime binding before delegating to that
environment-specific runtime. Product pages no longer invoke the provider
execution runtime directly.

## Route freshness at signing

Static routes use a short fallback TTL. A user may spend longer than that
reading Review.

Immediately before execution Veyra therefore re-quotes and requires:

- same deterministic routeId
- same provider
- same amount
- same destination
- successful fresh provider HARD BLOCK preflight
- successful deterministic policy/risk evaluation

Only freshness metadata may change. If reviewed money-moving terms change,
execution stops and a new Review is required.

## PostgreSQL ActivityReceipt

Migration:

`server/db/migrations/0007_phase5_activity_receipt_lifecycle.sql`

adds production lifecycle/audit metadata including:

- provider version
- surface/action
- route option snapshot
- policy result
- preflight results
- resume payload
- resumable flag
- last writer / last write time
- confirmed / cancelled timestamps
- route/status and resumable indexes

Direct-address bridge recipients are supported without fabricating an identity
snapshot foreign key.

CI now starts PostgreSQL, so migration-from-zero tests are no longer silently
skipped in the canonical GitHub gate.

## Receipt lifecycle

Canonical direct CCTP lifecycle:

```text
INTENT_CAPTURED
→ PREFLIGHT_PASSED
→ SIGNED
→ BROADCAST
→ SOURCE_CONFIRMED
→ ATTESTATION_PENDING
→ RECEIVE_PENDING
→ CONFIRMED
→ COMPLETE
```

Destination retry may transition:

```text
RECEIVE_PENDING
↔ RECEIVE_FAILED_RETRYABLE
```

Terminal statuses never reopen.

The repository enforces transitions under a row lock and writes every status
change to append-only `execution_events` in the same transaction.

Browser reconciliation is revision-aware. A stale browser never overwrites a
newer server record and immutable money-moving receipt fields are not accepted
from receipt sync requests.


Receipt revisions are strictly contiguous: browser sync may advance only from
revision `N` to `N + 1`. Source/destination transaction hashes, chain IDs and
block numbers become immutable once recorded.

For CCTP, lifecycle evidence is also stage-bound:

- `BROADCAST` and later require the reviewed source burn hash/chain
- `SOURCE_CONFIRMED` and later require an authoritative source block
- `RECEIVE_PENDING` and later require the destination transaction/chain
- `CONFIRMED` and `COMPLETE` require the authoritative destination block
- resume payloads must bind to the exact receipt route ID
- terminal receipts cannot remain resumable

## Server-bound receipt creation

Before the wallet execution boundary, the authenticated BFF:

- verifies the sender belongs to the signed-in Veyra user
- verifies the optional recipient identity snapshot
- validates exact Arc Testnet USDC / supported destination scope
- reconstructs and checks the deterministic routeId
- reconstructs route/action metadata server-side
- runs deterministic server policy/risk/preflight evaluation
- creates the durable receipt
- advances it to `PREFLIGHT_PASSED`

Repeated creation of the same reviewed route is idempotent and returns the
existing receipt rather than creating a duplicate.

Client-reported policy/preflight fields are not used as authoritative receipt
truth.

## Bridge execution receipt sync

The production execution runtime advances the server receipt only at real
execution boundaries:

- source submission boundary
- source broadcast hash
- verified source CCTP receipt
- attestation wait
- destination receive broadcast
- verified destination receipt/state
- confirmed/completed


The BFF does not trust browser claims for the authoritative confirmation stages.
Before accepting `SOURCE_CONFIRMED`, it independently reads the Arc receipt and
requires the exact reviewed CCTP `DepositForBurn` plus canonical
`MessageSent` evidence. Before accepting `CONFIRMED`, it independently reads
the destination receipt and transaction, requires the exact canonical USDC mint
to the reviewed recipient, decodes the transaction as
`receiveMessage(bytes,bytes)` to the canonical MessageTransmitterV2, and binds
that calldata to Circle's authoritative attestation for the persisted source
burn. It also independently re-reads the source receipt, checks the recorded
source block and reviewed `DepositForBurn`, and requires the *exact attested
message bytes* to appear in the source MessageTransmitterV2 `MessageSent`
event. A transaction-hash lookup alone cannot prove the correct message when
one source transaction emitted multiple messages.

A successful source transaction whose exact CCTP evidence cannot yet be proven
is kept fail-closed and resumable/reconcilable. It is never converted into a
fresh source execution.

**Ambiguous CCTP message guard:** Veyra currently supports exactly one strictly
ABI-decoded `MessageSent(bytes)` event per source transaction and exactly one
Circle `/v2/messages/{domain}?transactionHash=...` response message. A batched
source transfer (or malformed/multiple Circle messages) is rejected rather than
choosing `messages[0]`. Server destination relay additionally requires the
sole Circle message bytes to match the sole canonical source `MessageSent`.
This deliberately limits batch support until per-message log index and
source burn association can be verified independently.

**Terminal safety and unresolved failure:** once the source wallet may have
submitted a transaction (`SIGNED` or later), an unverified browser-side
`FAILED`, `CANCELLED`, or `INVALIDATED` claim cannot terminalize a CCTP
receipt. This includes reverted-source cases: the UI can report the revert,
but the durable receipt and replay lock remain open for authoritative
reconciliation. **Source-revert resolution implemented:** the authenticated
`POST /api/receipts/cctp/resolve-source-revert` accepts only a receipt ID
and never a browser-supplied failure status. The BFF verifies the exact
`depositForBurn` transaction sender, contract, calldata, canonical source
receipt/block hash, and at least **12 source-chain confirmations**. Only an
unreconciled `BROADCAST` receipt without destination execution can be
atomically transitioned to `FAILED` under a PostgreSQL row lock. The
verification decision and source block proof are appended to execution events.
The original source action replay lock is not reopened. Recovery can request
this server resolution when a source revert is observed. Authenticated
terminal receipts are excluded from candidate recovery cards.

**Server destination relay exactly-once gate (migration 0008):** a
`bridge_destination_submission_claims` row is committed under the owned
checkpoint row lock *before* the relay wallet may broadcast
`receiveMessage`. Concurrent relay requests cannot both win. Two append-only
`bridge_destination_attempt_events` records track initial
`SUBMISSION_STARTED` and eventual `BROADCAST_RECORDED`. PostgreSQL rejects
event UPDATE/DELETE, and the first destination tx hash is immutable. Hash,
recovery checkpoint and the broadcast event are committed atomically. If
the process or RPC crashes before the hash can be persisted, the claim stays
`UNCERTAIN`; repeat relay requests return a conflict and must reconcile
rather than sign a second receive. The BFF also now checks exact
`DepositForBurn` source evidence before relay, not only the presence of
`MessageSent`.

**Shared server/self-relay gate:** wallet-signed self-relay now uses the
same owner-scoped PostgreSQL claim as the server relayer. Before requesting
the destination wallet signature, Veyra independently reads the canonical Arc
source receipt and transaction, verifies the source `depositForBurn` calldata
against the reviewed amount, recipient, token and destination, and revalidates
the unique source `MessageSent` against Circle's unique complete attestation.
Only after those checks does the authenticated
`POST /api/bridge/claim-self-receive` commit the destination claim and grant
permission to open the wallet signature. RPC/Circle errors fail closed before
the signing boundary. A second browser/device or server relay cannot bypass
that claim. The wallet hash is persisted in local recovery
immediately, then submitted to
`POST /api/bridge/record-self-receive`. This endpoint independently reads
the destination-chain transaction and verifies the sender is the reviewed
recipient wallet, the call target is canonical MessageTransmitterV2, and
the exact `receiveMessage` calldata contains the original persisted message
and Circle attestation. Only then may PostgreSQL commit that hash to the
immutable submission ledger. The repository also reconciles the exact
hash when an asynchronous client checkpoint mirror advanced to
`DESTINATION_BROADCAST` before the chain RPC indexed the transaction.
Recovery retries verification of the *same* tx hash; it never signs again
based on RPC timeouts. Any claim with an unknown hash remains locked.

**Browser checkpoint trust boundary:** `POST /api/bridge/persist` accepts only
pre-destination recovery states. A browser cannot write
`DESTINATION_BROADCAST`, `VERIFIED`, or a destination transaction hash through
the checkpoint mirror; those are exclusively server-verified boundaries. Older
server recovery checkpoints are also filtered out of the Bridge recovery UI
when a matching authenticated ActivityReceipt is already `COMPLETE` or
contains an independently verified reverted-source terminal `FAILED`
resolution. Any other failed or uncertain bridge remains available for
reconciliation.

**Canonical first destination revert resolution (migration 0009):** the
authenticated `POST /api/bridge/resolve-destination-revert` accepts only
`planId`, fetches the original receive transaction and receipt from the
destination chain independently, verifies the transaction targeted
MessageTransmitterV2 with the exact stored `receiveMessage` message and
attestation, and requires a `reverted` receipt in a canonical block with at
least **12 confirmations**. Under the owned checkpoint row lock, its proof
must exactly match the immutable first destination claim hash and chain.
The proof is inserted into `bridge_destination_attempt_resolutions`
as an append-only first-attempt record; PostgreSQL prohibits its UPDATE/DELETE.
A second proof with identical transaction/block evidence is idempotent;
conflicting evidence fails closed. Recovery can request this proof after it
observes a reverted receive but NEVER automatically signs or broadcasts a
second receive. An unavailable RPC or incomplete finality leaves the first
destination submission locked. This creates trustworthy input for a future
multi-attempt retry design without touching original ActivityReceipt,
checkpoint hash or source burn history.

**Second-attempt persistence foundation (migration 0010):** Veyra now has a
separate `bridge_destination_retry_attempts` table and strictly append-only
`bridge_destination_retry_events` audit history for attempt #2. The original
attempt #1 claim, recovery checkpoint hash and ActivityReceipt hash are **never
replaced**. `claimSecondDestinationAttempt()` acquires the owned checkpoint
row lock and requires a matching first submission with an immutable,
chain-verified `REVERTED` resolution and 12+ destination confirmations.
Concurrent callers cannot both reserve attempt #2. A claim with no recorded
hash stays `UNCERTAIN` without any timeout-based recycling; the distinct
second hash, if ever verified/submitted by a trusted server caller, can be
recorded exactly once and not overwritten. PostgreSQL triggers forbid
mutating or deleting claims/attempt events. `GET
/api/bridge/destination-attempts?planId=...` is an authenticated, read-only
cross-device history view of both attempts and first revert evidence;
`retryAuthorized:false` is explicit.

**Authoritative second receive verification (migration 0011):** a separate
`bridge_destination_retry_verifications` table stores immutable evidence
that the second recorded receive transaction succeeded in a canonical
Sepolia/Base Sepolia block with **12 or more confirmations**, called the
canonical Circle MessageTransmitterV2 with the original attested
`receiveMessage(bytes,bytes)`, and emitted exactly one reviewed recipient
USDC mint of exactly the original amount. Server-side
`POST /api/bridge/verify-second-destination` accepts only `planId`, checks
the authenticated owner and recorded attempt #2 transaction hash, re-reads
the original Arc source burn and authoritative Circle attestation, verifies
the canonical destination receipt, call, mint and finality, then commits
evidence under the owned checkpoint row lock. Both the old ActivityReceipt
receive hash and the original recovery checkpoint remain immutable.
Concurrent or repeated proofs for the same chain transaction are idempotent;
contradictory mint/block evidence fails closed. PostgreSQL forbids
UPDATE/DELETE on verified second mint rows. The owner-only destination
attempt history API exposes `second.verifiedMint`, finality and mint block
hash. A successful proof deliberately returns
`activityReceiptCompleted:false` and `retryAuthorized:false`: proving a
mint does not yet implement a safe terminal ActivityReceipt transition,
cross-device recovery completion or approval for another transaction.

**Second-attempt ActivityReceipt settlement (migration 0012):** one
CCTP ActivityReceipt can now represent both the *first reverted destination
transaction* and the *second successful settlement transaction* without
overwriting earlier immutable evidence. Dedicated nullable
`settlement_receive_tx_hash`, `settlement_receive_block_number`, and
`settlement_attempt_number` fields identify the actual verified mint
separately from the original `receive_tx_hash`. PostgreSQL forbids changing
those settlement fields after first write. The authenticated
`POST /api/bridge/finalize-second-settlement` accepts only `planId`,
independently revalidates the Arc source burn/Circle attestation and the
canonical second destination mint/finality, records the verified mint proof,
then row-locks the original checkpoint and ActivityReceipt. It requires
the original source burn, first reverted destination hash, exact reviewed
recipient/amount/chain/token, persisted second hash, >=12 destination
confirmations, and a single matching CCTP ActivityReceipt in
`RECEIVE_PENDING` or `RECEIVE_FAILED_RETRYABLE`. It atomically transitions
the receipt to `COMPLETE`, sets the separate settlement fields, clears
resumability, and appends a detailed immutable `STATUS_TRANSITION` audit
event. Repeating the exact finalized settlement is idempotent; conflicting
or ambiguous receipts fail closed. The Activity page labels the reverted
first destination hash separately from the final settlement hash.
No source burn or destination signature is initiated by the finalizer.

**Crash-safe reconciliation of a known self-relay transaction hash:** An
authenticated user who previously claimed the first destination submission
and signed its `receiveMessage`, but lost the wallet/RPC response, can now
paste **the original transaction hash** into the Activity recovery card
while the persisted checkpoint is at `ATTESTATION_READY`. This invokes the
pre-existing `POST /api/bridge/record-self-receive` endpoint, **not** any
wallet signing or relay path. The server requires an existing durable
first-attempt submission claim, fetches the actual transaction from the
destination RPC, now checks the **independently returned RPC chain ID** and
**indexed transaction's own hash** match the requested destination chain and
hash, then verifies the source-attested CCTP `receiveMessage` calldata,
canonical MessageTransmitter and the reviewed recipient wallet sender.
Only then is the original submission hash and checkpoint transition
recorded atomically and idempotently; failed, missing, unindexed or
contradictory evidence leaves the claim `UNCERTAIN` and locked. No new
CCTP burn/receive transaction is sent, and a new first claim cannot be
created through this recovery operation. The Activity list is refreshed
after successful reconciliation. This can recover a **known hash** but
cannot invent or recover a hash that the wallet and provider never exposed.

**Read-only second attempt lost-hash recovery (without signing):** The
authenticated `POST /api/bridge/reconcile-second-receive` accepts only a
plan ID and a hash for a transaction the user or relayer already broadcast.
It **cannot create a second submission reservation**, sign a wallet request
or send a receive transaction. The server loads the owner-scoped original
checkpoint and immutable attempt history, requires a stored canonical
first destination revert, and requires the second attempt to have been
previously reserved as `UNCERTAIN` (or already recorded with the *same*
hash). It independently revalidates the canonical first reverted
transaction/block hash and source Arc/Circle attestation; obtains the
destination RPC's real chain ID and independently indexed second tx hash;
requires a different hash from attempt #1, the exact canonical CCTP
transmitter, valid sender, `destinationCaller=0` in the attested V2
message and exactly matching `receiveMessage(message,attestation)`
calldata. Only then does the repository record the **existing** second
hash under the owner checkpoint lock and append an audit event. This
does **not** mean a mint succeeded: the separate 12-confirmation mint
verifier and ActivityReceipt settlement gates remain mandatory.

The Activity recovery card now fetches the authenticated read-only
`GET /api/bridge/destination-attempts?planId=…` history. It displays
the first reverted hash, the second attempt's `UNCLAIMED`, `UNCERTAIN`
or `RECORDED` state and canonical mint proof if any. The
`Reconcile second hash (no signing)` form appears **only** when the
server reports a previously reserved `UNCERTAIN` attempt #2. Unknown
hashes and absent reservations remain locked. This also supports
cross-device examination of the immutable attempt history, while still
requiring an authenticated BFF.

**Canonical Circle V2 nonce observation (read-only):** `POST
/api/bridge/inspect-destination-nonce` accepts only a `planId` from an
authenticated owner. It refuses plans without an immutable first receive tx,
stored canonical 12+-confirmed revert, or any previously reserved attempt #2,
including the `UNCERTAIN` state. It independently revalidates the first
reverted CCTP receive and original Arc/Circle source attestation, parses
`version/sourceDomain/destinationDomain/bytes32 nonce` from the exact
**MessageV2** attested bytes (nonce at byte offset 12), and reads destination
`MessageTransmitterV2.usedNonces(bytes32)` at a pinned block. The canonical
block hash is fetched on both sides of the nonce read. `0` is reported as
`UNUSED_AT_OBSERVED_BLOCK`; `1` is reported as `ALREADY_CONSUMED`.
Unsupported message versions, source/destination domains, destination caller,
nonce 0, truncated message, reorg, RPC timeout and other unexpected values
fail closed. **Both responses explicitly include `retryAuthorized:false`.**
An unused nonce is only a time-bounded observation, never proof that another
relay will not consume the message before a signature/broadcast. This API is
not a retry submission route. Source: Circle's official
`MessageTransmitterV2.sol` / `BaseMessageTransmitter.sol` and
`MessageV2.sol`.

**Important:** migrations 0010–0012 are *recovery and settlement
infrastructure*, not a live second-relay signing feature. The authoritative
server can verify and close an existing successful second attempt if its hash
has been recorded through a trusted boundary, but **no new attempt-#2 wallet
signature or broadcast endpoint is enabled**. Before allowing a second
submission, the system must prove the first revert is still canonical,
recheck destination Circle nonce/readiness, establish a trusted authenticated
signing/broadcast boundary, reconcile unknown submissions and validate
reload/cross-device recovery with real testnet transactions.

**Remaining destination retry gate:** this durable claim deliberately permits
only the FIRST submission from either actor. Subsequent distinct receive
transactions after a provably reverted destination transaction need a
separate chain-verified attempt-resolution gate and append-only attempt history;
they cannot overwrite the existing ActivityReceipt or checkpoint receive hash.
The UI must not automatically retry a previously broadcast receive or assume
that a missing hash means no transaction was sent. Automatic retry of such
failures is NOT yet approved.

Once the source may have been submitted, a temporary Activity API failure does
not cause a second burn. The persistent action replay lock and bridge recovery
checkpoint remain the safety authority; receipt reconciliation catches up later.

Recovery also reconciles matching ActivityReceipts from the authenticated
server mirror.

## Activity

Activity now shows both:

- local VeyraReceipt cache
- authenticated durable ActivityReceipt lifecycle

In-flight server receipts expose provider, revision, route, source/destination
transaction hashes and resumability.

A `SIGNED` receipt with no source transaction hash is shown as an uncertain
submission and is never replayed automatically.

Bridge recovery cards still use the persisted checkpoint state and now invoke
the provider adapter `resume()` boundary.

## Production / DEV separation

Production bridge execution imports no DEV E2E page or DEV component.

GitHub CI checks:

- TypeScript
- DEV source isolation
- lint
- tests
- PostgreSQL migration-from-zero
- production build
- production bundle DEV isolation

## Acceptance status

Implemented and CI-testable:

- production RouteEngine
- CCTP CapabilityMatrix / ProviderAdapter
- lifecycle gates
- short-TTL re-quote at execution boundary
- provider HARD BLOCK preflight
- authenticated system-of-record receipt creation
- full ActivityReceipt transition model
- revision conflict protection
- immutable execution-evidence enforcement
- server-authoritative CCTP source/destination confirmation
- source-attestation-to-destination-calldata binding
- production Activity states
- reload/recovery reconciliation
- ProviderAdapter execute/resume boundaries
- production DEV exclusion

External acceptance still required:

- one real Arc Testnet → Sepolia/Base CCTP V2 execution initiated from the
  production Bridge page with an authenticated Veyra identity and wallet

That test must produce reviewable source burn, Circle attestation, destination
receive/mint, exact final-state verification, ActivityReceipt completion, and
must survive/recover from a reload test.

No live execution result is fabricated by this phase.
