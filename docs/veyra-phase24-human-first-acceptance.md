# Phase 24 — Human-first Veyra acceptance pass (2026-10-27)

## Verified state before modification
- User-supplied URL `veyra-unified-testnet-v2-j0qv6t7vw-khaiptk1998-8088s-projects.vercel.app` is a READY Preview for commit `5cbd935` (Phase 22). PR #82 newer branch HEAD was `8c69491` (Phase 23). They are **not** the same build.
- Render `veyra-testnet-acceptance-bff` tracks `phase5-production-bridge-flow`, auto-deploy is off. It has not received all migrations and code of PR #82. Its strict `browserOriginPolicy.ts` allows only `appOrigin` and a single `secondaryOrigin`. This is the confirmed source of the Preview origin block in the browser-origin probe when Render returns `403 ORIGIN_NOT_ALLOWED`. Do not bypass the origin guard or auto-allow each ephemeral Vercel Preview.
- Home duplicated wallet/ID status in Home network card, repeated actions and registry, and used internal copy. Pay rendered only a Connect Wallet gate when disconnected, making drafting impossible. Agent exposed Fallback/Planner/Execution internal statuses. Activity did not present the requested disconnected state. Transfer Review previously omitted RPC fee and total debit estimate.
- This environment cannot clone public GitHub over network for a local Bun run. Source was read via authenticated GitHub connector; use GitHub Actions CI to run repository's pinned typecheck/lint/build/tests. Browser-provider and on-chain E2E are never implied by CI.

## Implementation
1. **Home:** concise Send-first entry, single Identity/profile card (no duplicate Home auto-auth), exact Arc Testnet USDC on-chain balance with its prior verified read-state handling, real Receive address + Copy, up to 3 real recent receipts. Existing network/asset registry retained under collapsed advanced details, explicitly informational only.
2. **Pay:** render recipient and amount fields for disconnected users; keep both on wallet connection. Explicit Wallet/Friends tabs; manual paste with permission-error fallback; connected Friends from signed Social session only. Reject invalid EVM addresses and Veyra IDs before Review. Preserve malformed `2,5` rather than silently converting it to `25`. Server-prepared identity snapshot, revalidation, wallet review and existing transfer executor untouched. Bound recipient lookup to 12 s, preserve draft and allow safe retry.
3. **Review fee:** estimate exact Arc Testnet ERC-20 transfer gas via live `estimateContractGas` + `getGasPrice` and the wallet's native `getBalance`; calculate indicated fee in Arc-native **18-decimal USDC** and total debit `amountUSDC6 * 10^12 + gas*price`. Never add native and ERC-20 balances: they are two views of the same USDC. Refresh estimate each 25s; 12s deadline and explicit retry. No mock fee. Failed estimate / insufficient funds blocks signing. Display full recipient/sender wallet, source/destination network, estimated network fee and total debit. Actual charged fee is only known from a transaction receipt.
4. **Agent:** keep Send/Swap/Bridge/Unified quick actions; label request action Create draft, not payment. Remove public internal Fallback/Local planner/Review locked pills; reveal technical intent graph only on user expansion. Maintain same-language replies and never auto-sign.
5. **Activity and availability:** clear Connect your wallet state; no unauthenticated remote receipts. Preview banner uses actionable sign-in unavailable wording and a less aggressive health timeout, while preserving exact hosted Origin enforcement. No OAuth, signature, session or Mainnet gates changed.

## Exclusions and release gate
- No universal payment routing, unsupported swap activation, Mainnet execution, artificial balances, fees or receipts.
- No Render deployment, no database migration, no Vercel new project and no Production promotion. Preview update occurs via the existing PR branch Git integration.
- Origin unblock requires a **stable reviewed Vercel hostname**, explicit Render allowlist entry, matching backend migrations/OAuth callback origin, and manual testing of signed sessions. Never use a wildcard or allow arbitrary preview hashes.
- Run genuine 2-wallet Testnet acceptance for wallet↔Veyra ID, Friends, no re-sign on refresh, X OAuth exact owner confirmation, direct Arc Pay, Bridge source burn→attestation→destination mint/recovery before promoting.

## Manual acceptance (5 minutes for UI; longer for real transactions)
1. Guest Home → Send, type receiver + amount → Connect Wallet: draft remains.
2. Wallet tab: paste exact `0x` address; Friends tab: choose signed connected friend; Veyra ID resolve never guesses network.
3. Enter `2,5` → explicit invalid amount, not `25`. Enter valid 2 USDC → Review with both wallets, Arc, on-chain fee and total; RPC failure → clear Retry with no signature.
4. F5 → Veyra ID remains linked to correct wallet without unnecessary signature; switch wallet → private data isolated; Copy ID and wallet, Disconnect.
5. Receive → copy actual connected address; Activity guest/empty/pending/verified/failed; open matching explorer.
6. Agent Send/Swap/Bridge/Unified statuses; only enabled Arc Pay and Arc→Sepolia CCTP; blocked-origin Preview cannot sign or burn; CCTP receipt remains pending until verified destination.
