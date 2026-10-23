# Veyra — social/notifications and Arc Studio release scope (23 Oct 2026)

## Product decision
The public app will have **Social** in its own tab: one canonical `@name.veyra`, friends, individual direct-message threads, report/block, and payment actions through the existing guarded Pay flow. A global bell will aggregate request/accept notifications, new encrypted messages, verified incoming USDC, transfer status and security/operational notices. Badge unread counts must be owner-scoped and persistent across reloads/devices.

No separate X identity: official X OAuth links an external account to the existing immutable `usr_...` Veyra user, with `@name.veyra` as the sole public account name.

## Phase 9A — what this PR actually implements
- New PostgreSQL notification store and Drizzle schema (migration 0014).
- DB-triggered friend-request and friend-accepted events **transactionally** inserted from append-only social connection changes.
- Owner-authenticated, paginated `GET /api/notifications`; idempotent `POST /api/notifications/read`, both with server-side signed session and bounded rate limits. Client cannot insert or impersonate events.
- Data: `kind`, immutable event reference, optional actor ID, creation/read timestamps. No balance, address, message body, token or secret in notification payloads.
- This PR adds **backend only**. It does NOT deploy or activate notifications on the public app yet and does NOT create a functional chat or payment watcher.

### Remaining Social acceptance gates
1. Consolidate wallet-login + X OAuth into main Veyra app; no separate ID/secret-bearing browser storage. Test with two actual wallets and reload.
2. Separate Social tab built on PostgreSQL-backed friends, using `@name.veyra`; no fake placeholder friends.
3. Direct messages: vetted client-side encryption/key enrollment/recovery, replay safety, secure transport, authentic sender/recipient binding, block/report and strict access, rate limiting and retention/deletion policy. **Never claim end-to-end encryption until independently verified**.
4. Notification feed and bell: per-user unread count, mark read, secure event linking, multiple devices, pagination, keyboard/mobile acceptance; poll conservatively or subscribe only with authenticated transport.
5. Payment notifications: emit only from independently validated chain receipts (network, tx hash, log index, asset/address/amount, finality, owner binding); unique event key prevents duplicate credit alerts; pending/failed/confirmed are distinct.
6. Abuse cases: spoofed recipients, blocked users, forged payments, deleted friends, session expiration, X OAuth account switching, cross-account leakage, XSS in message previews, multi-device races.

## Mainnet separation
Mainnet on Arc (chain ID 5042) exists but Veyra's current runtime **still blocks** financial execution until external gates pass. Follow `docs/veyra-mainnet-release-gates.md`: production BFF/DB with backups, KMS/HSM, provider health, independent chain/token unit verification (native gas 18 decimals vs USDC ERC20 6), reviewed UI, recovery/idempotency, real low-value canary, independently verified tx and rollback.

Use a **separately controlled, minimal Arc-native experimental transaction lane** for the microgrant demonstration. Never imply that the full Veyra Pay/Swap/CCTP product is Mainnet-ready due to a small demo.

## Arc Microgrants 2 / Arc Studio
- Event: https://dorahacks.io/hackathon/arc-microgrants-2/detail
- Published deadline: **1 November 2026**; 8 awards × 500 USDC.
- Requires Arc Studio use for contract code/tests and app, live contract and app on Arc Mainnet, one **real user-authorized USDC-moving transaction through the contract**, verified explorer hash, repo, Studio project URL and demo showing Arc Studio build and mainnet transfer.
- Submission must disclose Veyra's experimental scope and any unimplemented capabilities.
- Suggested minimal build: **Veyra PayLink**. Sender uses the Arc Studio-built contract to direct a strictly user-approved USDC amount to an exact recipient. No escrow, no autonomous signatures, no relayer custody, no agent spending. Contract must prevent phantom success and preserve exact recipient/amount; independent receipt shows real USDC token transfer. Reuse branding/identity as UX only after ownership and payment destination review.
- **Do not deploy or spend real funds without explicit transaction authorization** from the connected wallet owner.

### Evidence packet
Studio project URL; Arc mainnet contract address/verified source; exact transaction hash on explorer.arc.io; GitHub commit; canonical deployment link; 2–3 min screen recording; notes on USDC gas and approved amount; failed/wrong-recipient tests. No secrets, keys or session tokens.
