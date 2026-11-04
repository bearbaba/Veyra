# Veyra Settlement — Mainnet contract receipt acceptance

**Status: source integration / CI only, not a claim of Mainnet financial E2E.**
Scope: Arc Mainnet 5042, pinned VeyraSettlement.pay(), authentic USDC 0x360… .
Pay remains a compatibility alias in navigation; contract Settlement is the primary user-facing
sending flow. Existing direct USDC/Pay receipts are preserved in a separate ledger.

## Immutable evidence path

1. Sender signs into the **same Veyra ID and connected wallet**. People prepares and verifies
   the receiving wallet; Settlement freezes the ID binding, contract, fee and gross/net values.
2. Before either an approve or pay() wallet request, the browser checks the original recovery
   journal. Web Locks serialize Pay/Exchange/Settlement signing within one origin. On a wallet
   error after signing was requested, journal status remains UNKNOWN until chain reconciliation.
3. For an original contract pay() transaction, the backend independently checks:
   - Arc Mainnet chain ID 5042, pinned deployment address and transaction sender
   - exact pay(recipient, grossAmount, paymentRef) calldata, zero native value
   - transaction hash, receipt block hash and canonical block identity, >=2 confirmations
   - one **authentic PaymentSettled event** emitted by the pinned contract, matching payer,
     recipient, gross, protocol fee and paymentRef
   - one authentic Arc USDC Transfer from payer to the contract (gross)
   - one authentic Arc USDC Transfer from the contract to receiver (net = gross − protocol fee)
   - nonzero receiver payout and a bounded protocol fee
4. The indexer obtains both Veyra user IDs from **historical Arc-5042 wallet bindings valid at the canonical block timestamp** (issued and verified before payment; revoked only after payment, if applicable), never from current ownership or form fields. Re-linking a wallet after payment must not transfer its old receipts to a different Veyra ID. Overlapping or ambiguous historical bindings fail closed. A signed sender or receiver can index a matching original hash; unauthorized users cannot. The same original transaction can be persisted only once.
5. Two-sided GET returns one proof under sender and recipient accounts. Sender sees gross spent
   and can view their own private note. Recipient sees net received and **never receives the
   sender-only private note**. Server verified at and paid at are distinct timestamps.
6. Home and Activity merge contract and legacy direct receipts by original hash, preserving
   old local journals as fallback. A saved browser row is not an authenticated server receipt.

## New server endpoints (signed Veyra session only)

- `POST /api/mainnet/settlement/receipt/verify`: body `{hash,note?,snapshotId?}`.
  `hash` is the original Arc transaction. The server re-fetches chain proof. The note and ID
  snapshot metadata can be submitted **only by the original sender account**; invalid/expired
  metadata cannot change the canonical blockchain proof.
- `GET /api/mainnet/settlement/receipts`: returns at most 50 owner-scoped verified contract
  receipts with the appropriate `sent` or `received` perspective.

Direct USDC transfer receipt routes remain unchanged:
`/api/mainnet/pay/receipt/verify` and `/api/mainnet/pay/receipts`.
The contract index does **not** assume these legacy APIs also verify contract pay().

## Database and controlled deployment

The additive migration `0021_mainnet_settlement_receipts.sql` adds one independent
indexed table; it does not rewrite or delete direct-Pay history. **It has not been applied
to Render Mainnet by source commits or CI.**

Before applying:

1. Confirm correct isolated Render PostgreSQL database `veyra_mainnet_v1_db`, current
   schema migration journal, connectivity and a verified restorable database backup.
2. Use the existing explicit Mainnet migration gate in
   `server/db/mainnetPilotMigrationGate.ts`. Do not bypass `VEYRA_MAINNET_MIGRATE_CONFIRM`;
   never run this on Testnet or a historical production database.
3. Deploy backend and frontend from the **same accepted git release**. Verify both endpoints
   return 401 for anonymous callers and never return a sender-only note to receiver B.
4. Smoke-test original proof from an already verified transaction before enabling any new
   financial writes. No migration, deployment or read-only smoke test authorizes a new
   Mainnet signing path.
5. Preserve rollback: previous frontend/backend release and database backup; additive table
   may remain unused after a rollback. Do not delete it to hide an incident.

## E2E release proof — not yet performed

- Controlled signed wallet A and signed wallet B, separate Veyra ID accounts.
- A selects B from People, reviews correct contract, fees, signatures and exact receiver.
- **Only with explicit operator approval:** an authorized small onchain payment, original
  tx hash, 2+ confirmations, gross/net and event/Transfer evidence recorded. Contract
  financial signing is otherwise disabled by the current release gate.
- Backend indices original contract payment; A sees Sent, B sees Received, both on the
  official canonical website after sign-out/reload and a second device.
- B cannot see A's note. Wrong wallet, rotated Veyra ID, forged event, reverted tx, wrong
  amount, broken RPC, duplicate click and pending timeout cannot show Completed or retry.
- Confirm exact frontend/backend deployment SHA, migration version, automated tests,
  operational rollback and monitoring.

**No general-public financial signing until this evidence exists.**
Uniswap/LI.FI commercial integration remains out of scope without a permitted, negotiated
referral/integrator-fee/revenue-sharing arrangement.
