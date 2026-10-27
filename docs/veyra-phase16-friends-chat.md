# Veyra Phase 16: Friends Chat (Testnet candidate)

## Delivered
- Authenticated, mutual-accepted Friends can exchange plaintext-visible text
  messages. Messages are **AES-256-GCM encrypted at rest by the Render BFF**,
  authenticated with sender/recipient and server-generated message ID.
- Only a signed Veyra session can access own two-person message history;
  friendship and either-direction block state are rechecked by the server on
  every request. A user cannot read or send to arbitrary Veyra IDs.
- PostgreSQL persists encrypted messages and idempotent client request IDs.
  Notifications of type MESSAGE are written in the same DB transaction.
  A client retry does not duplicate the record or notification.
- Compact Chat in Friends. No wallet signature per message. Only confirmed
  backend responses are shown as sent.
- Optional Chat capability is disabled until the matching backend version
  is deployed and VEYRA_CHAT_ENCRYPTION_KEY is configured in Render.
- At most 1000 visible characters / 3000 UTF-8 bytes per message; bounded
  rate, history pagination, and no payment signer in the Chat service.

## Critical security disclosure
**Not end-to-end encrypted.** The BFF possesses the encryption key and can
decrypt, as is true for server-managed messaging. Users should not send seed
phrases, wallet keys, recovery codes or highly sensitive data. No promise of
key recovery or multi-device E2EE is made. Future E2EE requires a separate
threat model, independent device keys, authenticated distribution, backups,
key changes, and reviewed recovery UX.

## Release gate
1. Run migration 0016 against a disposable PostgreSQL and full CI.
2. Provision VEYRA_CHAT_ENCRYPTION_KEY in Render **only**, 64-character
   cryptographically random hex encoding 32 bytes; store securely with backups
   and a rotation plan. Never commit a real key or expose a VITE_ copy.
3. Deploy backend only after review (additive SQL migration). Verify
   /api/social/chat/capability returns true on the allowlisted domain with
   a signed Veyra session, and false on old backend or missing key.
4. Deploy UI alias only when backend capability is enabled and matched.
5. Two-wallet acceptance: A sends invite, B accepts, A sends, B receives and
   sees MESSAGE notification, B replies, both refresh and see exact history.
   Disconnect/reconnect and switch wallet must never show other owner data.
   Blocking must prevent history and new sends; unblocking must not silently
   restore friendship. Retrying the same client request ID must not duplicate.
6. Review potential rate-limit bypasses under horizontally scaled Render BFF
   and ensure abusive senders can be blocked.
7. X OAuth remains gated by its own separate provider readiness; Mainnet money
   execution, notification payment verification, Swap and Bridge not changed.

## Rollback
Keep stable V2 alias unchanged while testing; new schema is additive.
If key is missing, endpoints fail closed and existing Pay/Friends continue.
Do not change encryption key casually: old messages become unreadable without
a defined key version / re-encryption migration.
