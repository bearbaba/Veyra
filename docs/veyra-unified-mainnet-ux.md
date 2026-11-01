# Veyra — Unified Mainnet UX and Transaction System

**Implementation baseline:** Arc Mainnet app in branch \`arc-studio/settlement-mainnet-preview\`. The original Testnet routes remain in their existing environment. This document is a product acceptance contract, not a claim that every backend provider is Mainnet READY.

## Product principle

One wallet identity, one network context, one balance definition per source, and one receipt lifecycle. No conflicting statuses in Home, Agent, route forms, and Activity. Direct Wallet Pay, VeyraSettlement, Circle Swap, and CCTP Bridge are distinct onchain workflows, not interchangeable labels.

## Decisions from owner review

| Proposal | Decision | Implementation / next action |
|---|---|---|
| One Mainnet network context in all pages | **Adopt — P0** | Route catalogue \`src/mainnet/mainnetProduct.ts\` used by Home/Agent; no embedded Testnet/Sepolia form on Mainnet |
| Wallet balance always visible | **Adopt — P0** | Existing global wallet balance continues on every tab; Home emphasizes the same Arc Mainnet token |
| Home money/actions first | **Adopt — P0** | Compact Mainnet Home: wallet & separate Gateway, actions, attention, activity, account, collapsible Receive |
| One review/sign/verify lifecycle | **Adopt — P0** | Shared presentation and per-provider receipt verification are the goal; no launch of an unverified financial path |
| Automatic receipt verification + recovery | **Adopt — P0** | Pay already auto-reconciles; Circle Swap/Bridge now polls original known source/destination hashes. Unknown transaction remains locked |
| One Activity timeline | **Adopt — phased** | Wallet-scoped browser operation pointers for Pay/Settlement/Swap/Bridge now indexed; history explicitly NOT a blockchain truth source. Expand to server/provider-backed history later |
| Mainnet Swap and Bridge from Agent | **Adopt — P0** | Agent opens canonical route for a fresh user review; no duplicate signing forms |
| Keep Unified separate from wallet | **Adopt — P0** | Gateway remains unavailable until real provider auth and spendable ledger are connected; never sum wallet and Gateway |
| Veyra ID and X as one identity | **Adopt — P1 backend** | Require wallet signature, durable session, X OAuth with state and recipient binding. Browser contacts are not verified Friends |
| Full source/destination Bridge finality | **Adopt — P0 safety** | Source burn alone is not destination complete. Never send another burn on an unknown outcome |
| Mint visual style and fewer boxes | **Adopt — phased visual system** | Use clear contrast and one accent; avoid decorative gradients and large empty cards. Never use success colors for pending |
| QR for Receive | **Adopt — later** | Existing address/copy panel first. Add a locally generated QR only with validated, exact chain/address and tests; never a fabricated code |

## Financial state contract

\`DRAFT → REVIEW → AWAITING_WALLET → SUBMITTED → VERIFYING → VERIFIED\`

Alternative terminal/non-terminal outcomes: \`REJECTED\`, \`REVERTED\`, \`UNKNOWN\`, \`REQUIRES_ACTION\`.

- **DRAFT:** no wallet request.
- **REVIEW:** immutable owner, chain, token, destination, amount, fee and minimum out.
- **AWAITING_WALLET:** approve is only an allowance transaction, never a completed payment.
- **SUBMITTED:** save original hash immediately before any new signature request; no blind retries.
- **VERIFYING:** read public chain / official provider. Changing tabs or reload must not destroy recovery.
- **VERIFIED:** only when independent provider-specific source-of-truth conditions hold.
- **UNKNOWN:** preserve original hash and lock future sends; provide read-only recheck.
- **REVERTED:** a confirmed onchain failure; do not infer funds were received.

Route checks:
- Direct Pay — chain 5042, sender/recipient, canonical USDC Transfer, exact amount.
- VeyraSettlement — correct contract, transaction, PaymentSettled and both USDC transfers.
- Swap — input USDC debit, router approval/identity, correct EURC receipt, exact destination, minimum received.
- Bridge — source burn, CCTP identity and attestation, destination mint / Transfer to exact recipient.
- Gateway — provider available/pending ledger, server-side auth and spendability; no spend until credited.

## UI acceptance

**Desktop:** Home has no oversized Gateway blank panel; Pay/Swap/Bridge/Settlement share a comfortable form width; Agent left conversation/right active task; Activity shows clear filters and owner-scoped pointers.

**Mobile:** Balance remains visible, forms fit width, primary actions are reachable without sideways scroll, receipts and transaction hashes wrap safely.

**Proof:** A status stored in localStorage is only a pointer. UI may show “Locally recorded · reverify onchain”; it MUST NOT treat that value as VERIFIED or change spending permissions.

**Risk controls:** wrong chain, malformed amount, expired quote, insufficient allowance, rejected signature, pending receipt, unavailable RPC, app reload while pending, and forged transaction logs each have an explicit safe state.

## Release gates

1. Reproducible TypeScript check, lint and relevant tests.
2. Mainnet Vite compiled environment verified independently from Vercel READY.
3. Production branch deploy only after build success.
4. Smoke test on actual production domain, including new wallet with no prior local storage.
5. No Testnet execution or automatic wallet signatures from Agent.
6. Do not call Gateway, Veyra ID/X, full swap input verification or Bridge finality fully accepted without independent E2E receipts.

## Next engineering tranche

- Use a shared \`TransactionTask\` domain model and shared receipt components across Pay/Settlement/Swap/Bridge. Do not rewrite provider signing logic in the same change as UI styling.
- Automatically import provider transaction histories where authorized, with account-specific sync and migration. Current browser pointer index is not complete history.
- Implement authenticated Mainnet Veyra ID/X and Circle Gateway only after backend contracts, secrets and callback origin readiness pass.
- Run end-to-end wallet, navigation, reload, no-gas, quote-expiry and failure-recovery acceptance, desktop and mobile.
