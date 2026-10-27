# Arc Testnet verified inbound USDC notifications — Phase 17

This scope is **ERC-20 USDC on Arc Testnet (chain 5042002)** only.

- Signed session resolves server-stored ACTIVE owner + ACTIVE wallet binding.
- Backend's pinned Arc RPC must return chain ID 5042002.
- Backend queries only the known Arc USDC contract Transfer logs where the
  recipient is the bound wallet. The browser never submits a transfer claim.
- For each log: verify contract address, Transfer topic and recipient, positive
  six-decimal base-unit amount, successful transaction receipt containing the
  identical log, matching canonical block hash, and a 24-block confirmation
  safety margin. This is a heuristic depth, not a finality guarantee.
- PostgreSQL transaction inserts chain evidence and PAYMENT_RECEIVED event
  with unique chain/tx/log identity; the cursor advances only when the entire
  bounded scan range validates. Retrying is idempotent.
- Cursor persists per wallet and resumes in 96-block batches. First sync only
  inspects the most recent 96 eligible blocks; earlier deposits can be missed.
  An external always-on indexer/backfill is required before promising 24/7 alerts.
- Endpoint: POST /api/notifications/sync-incoming, authenticated and rate
  limited to two requests per minute/IP. It accepts no wallet, amount, tx hash
  or event payload; the frontend cannot fabricate a payment notice.
- No mainnet routes, no ERC-20 addresses supplied by users, no swap/bridge
  execution, no automatic wallet signing.

Release gates: CI with RPC fixture and PostgreSQL; provider reliability check;
owner-specific receipt after live Testnet deposit; disconnect/session switching;
long-offline backfill limitations disclosed. Do not deploy to the existing V2
without acceptance and rollback planning.
