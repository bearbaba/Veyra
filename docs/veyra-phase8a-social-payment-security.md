# Phase 8A — Veyra ID / Friends / Pay-by-ID safety acceptance

**Scope:** authenticated Express BFF + PostgreSQL source; no new UI buttons,
no hosted database deployment, no paid resources, no actual wallet signing,
no Mainnet execution. Veyra ID remains Testnet-first.

## Why this change matters

A human recipient can change their mind. A sender may prepare
`@alice.veyra`, inspect a valid, server-signed 30-second recipient review
and then be **blocked** by Alice before confirming.

Previously, an unchanged identity snapshot and its HMAC token could still
pass recipient verification after a social block, because a block does not
change the wallet identity revision. **A new block must override the
earlier review immediately.**

The friendship event log also previously permitted duplicate requests,
including requests made after a pair was already CONNECTED. A new PENDING
event could then appear newer than the accepted friendship. Finally,
unblocking a user should not automatically restore the old friendship.

## Implementation

1. `verifyPaymentRecipient` confirms exact sender-bound HMAC, verified
   snapshot, full selected wallet/address/chain and **then** re-reads the
   latest bidirectional block status before returning `ok:true`.
   The endpoint responds with HTTP 409 and `RECIPIENT_BLOCKED` if either
   user has blocked the other. The review token never authorizes signing.
2. New friend requests fail if a pair is already CONNECTED or PENDING, or
   if either side has blocked the other.
3. Blocking is a **transactional PostgreSQL event**: an active PENDING or
   CONNECTED relation gets an append-only `DISCONNECTED` event in the
   same transaction as the `BLOCKED` event. Unblocking later does not
   resurrect the old friendship. A new request and acceptance are needed.
4. An authenticated BFF supports:
   - `GET /api/social/friend/status?veyraUserId=usr_...` — own friendship
     status for that pair only, **no** private wallet/address/balance data;
   - `POST /api/social/block` — body `{"veyraUserId":"usr_..."}`;
   - `POST /api/social/unblock` — same body; this does not re-friend.
   All use existing `IDENTITY_RATE`, authenticated wallet-owned session,
   target ID checks, and the host's exact HTTPS origin rules.
5. CI boots the actual Express container and refuses unauthenticated HTTP
   on all three new endpoints. PostgreSQL migration-from-zero acceptance
   inserts two disposable identities and one fabricated **Testnet-only**
   wallet row (no private key), then exercises friend request/accept,
   duplicate/wrong-initiator rejection, a real DB-backed signed recipient
   review, post-review block and unblock/re-request.

## Safety caveats and remaining gates

- This tests actual PostgreSQL **service logic** and unauthenticated real
  HTTP gates. It does **not** prove fully authenticated hosted API traffic
  with live sessions, two browser wallet signatures or real USDC transfers.
- Race conditions during concurrently changing social state and transaction
  signing must be addressed with a final authoritative backend/wallet review
  and separately accepted idempotency. The app does not autonomously submit
  or repeat signed payments. These server APIs only return identity review
  and social state, **never** permission to spend.
- Hosted BFF/Postgres are **not deployed** by this PR; the static Preview
  does not expose an operational Friends or Pay-by-ID feature.
- Avoid showing identifying wallet links, balances, hidden profiles or
  social graph records in anonymous public responses.
- Retain Mainnet provider `enabled:false` and all current Vercel financial
  execution gates. Testnet direct Pay remains capped at 1 USDC and does
  **not** automatically become Pay-by-ID.
- Continue with signed EIP-712 Testnet registration, authenticated
  HTTP+Postgres session tests and two disposable-wallet browser acceptance
  **before** marking Friends/Pay-by-ID as usable.

Reference design: `docs/veyra-id-friends-pay-foundation.md`
and `docs/veyra-phase7e-payment-review-binding.md`.
