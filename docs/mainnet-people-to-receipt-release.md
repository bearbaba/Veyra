# Veyra Mainnet V1 — People → Pay → verified two-sided receipt

**One wallet website:** https://veyra-seven-beta.vercel.app/ . Never ask anyone to connect a wallet to a Vercel Preview or another website. Source-level Preview builds are internal.

## Working in code, not yet Production
- Mainnet browser accepts Veyra ID only when the origin-specific Mainnet BFF reports its real 5042 identity authority. The capability endpoint checks actual PostgreSQL reachability and essential identity/receipt schema. Testnet readiness **cannot** grant Mainnet access.
- Signed, consumed-once EIP-712 login; exact Arc Mainnet wallet binding; HttpOnly restore cookie is chain+origin+wallet scoped. No signing while a non-authorized browser origin is reported.
- People looks up an authenticated 5042 recipient snapshot and the Pay review re-verifies the exact receiving wallet before any wallet transfer.
- After the original transfer is verified by the browser, the signed-in sender sends the **same hash** to the BFF. The BFF independently re-fetches canonical RPC transaction, receipt, block and ERC-20 USDC Transfer event; it never signs or retransmits.
- The additive `mainnet_direct_pay_receipts` table has one key per transaction hash on Arc 5042. A caller must be sender or recipient via an active wallet binding. Both users can read the receipt. Only the sender may set or see their private note. A lost/expired ID snapshot suppresses the unverified `@handle` label, **not** the proven transfer.
- Activity reads the owner's backend receipts, de-duplicates local Pay pointers by hash, and keeps other browser-only/provider receipts separate.
- Typecheck, lint, release-profile build and automated CI run on the code. **CI is NOT a substitute for two-wallet Mainnet acceptance.**

## Operational blocks before release — do NOT bypass

1. **Dedicated, audited Mainnet BFF**: do not route the Mainnet ID, signed sessions or receipt APIs to `veyra-testnet-acceptance-bff.onrender.com`. Provide a selected authorized Render workspace or other approved backend environment. Dedicated database and cryptographic secrets must not be recycled from Testnet; no wallet seed/private key belongs in the frontend.
2. Backend runtime must pass existing `assertServerRuntimeConfig`, run as hosted production `VEYRA_ENV=mainnet`, and allow exactly `VEYRA_APP_ORIGIN=https://veyra-seven-beta.vercel.app`. Configure verified `ARC_MAINNET_RPC_URL` (HTTPS, no Testnet) and required KMS/HSM infrastructure. Never store server secrets in `VITE_*` variables.
3. Back up approved Mainnet PostgreSQL, review/apply additive migration `0020_mainnet_direct_pay_receipts.sql` using the registered Drizzle journal, and confirm BFF can read `wallet_bindings`, `veyra_users`, `identity_snapshots` and `mainnet_direct_pay_receipts`. Do not modify or delete Testnet data.
4. Configure the necessary **exact API routes** on the single official Vercel project to the approved Mainnet BFF: `POST /api/identity/mainnet-capability`, wallet-auth + identity prepare/verify routes, `POST /api/mainnet/pay/receipt/verify`, `GET /api/mainnet/pay/receipts` and relevant profile/social routes. Current `vercel.json` proxies many paths to the historical Testnet BFF: **do not flip an identity flag or point Mainnet receipts at that server**.
5. Identity migration/claim policy must preserve one verified person across X, existing Testnet identity and Mainnet where appropriate; never automatically treat a reused handle or unrelated X account as wallet ownership.
6. Two user-owned wallets A/B, both 5042-bound identities. A signs in, B sets a primary receiver, A looks up verified B, reviews exact address and amount, signs only on the official domain, waits for canonical onchain proof, receives one backend receipt; B sees a **received** receipt after signing into their own account. Logout/reload/different browser still finds the receipt. B must not see A's private note; a stranger must receive 403 or 401. Wallet rotation/revocation and expired snapshots must not misattribute a name.
7. Fault-injection tests: invalid hash/amount/recipient, 1-confirmation pending, RPC timeout, missing receipt, reverted tx, concurrent duplicate indexing, recipient-first indexing, storage failure and ID snapshot expiration. An absent RPC log is **not proof of a failed transfer**, and cannot authorize another send.
8. Compatibility with P0 rollback from PR #87. Old Production `0d3b04f` cannot be used as a signing rollback for unresolved new journals. Keep Bridge writes gated independently. Only promote to Production after genuine wallet E2E with compatible rollback.

**Production currently remains at the previous commit. Video recording is not a development gate.** Do not claim completed Mainnet identity, receipt indexing or two-party payment until the target backend, route mapping, database migration and real transaction evidence have been verified.
