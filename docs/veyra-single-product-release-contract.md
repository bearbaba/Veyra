# Veyra — one-product scope and release acceptance

**Decision: 23 October 2026. Release: NOT MAINNET READY.**

## Preserve the original mission
**Veyra — The Intelligent Money Layer on Arc.**

One wallet experience, one website and one Veyra identity. The business core is:
1. **Send/Pay** — real wallet-owned USDC payments with reviewed recipient, chain, amount, gas, signature and independently verified receipt.
2. **Unified Balance/Portfolio** — accurate verified wallet-held USDC across chains, with freshness/partial failures; Circle Gateway pooled USDC is different and must never be double-counted.
3. **Bridge** — CCTP or approved provider, burn/attestation/mint evidence, crash-safe resume, idempotency and correct completion semantics.
4. **Swap** — verified routing, token/chain authenticity, exact amount, quote TTL, slippage, allowance and onchain receipt. Do not mislabel Convert/StableFX as general Swap.
5. **AI Agent** — helps users express intent; it cannot authorize payments, sign, choose trusted amounts, override provider gates or claim settlement.

The invariant remains **Identity → Intent → Route → Safety → Sign → Receipt**.

## Supporting experiences within the very same Veyra app
- **Veyra ID:** `@name.veyra` is the only public identifier; immutable `usr_...` is internal. Wallet and X OAuth attach to the same account; no duplicated identity.
- **Social tab:** authenticated Friends, private one-to-one messages and contact-level Pay actions that open the existing transaction review flow. No messaging instruction may sign or pay.
- **Global Notifications:** persistent owner-only bell for friend requests, genuine messages, payment status, verified incoming transactions and security information. Unread count, mark-read and deep links. A received-money alert needs exact chain, token, recipient, amount and transaction/log/finality verification; do not trust client text.
- **Activity:** real reload-safe and cross-device owner-owned receipts, never simulated as final.
- Design language: single professional English-first UI, mobile-first, fewer choices, no fake activation buttons or unrelated duplicate dashboards.

## Execution order and evidence (finish before Arc Studio)

| Gate | Done when | Present truth |
| --- | --- | --- |
| A. Core baseline | CI green, separate Testnet/Mainnet flags, financial Preview/main website isolation | Architecture and tests exist; Production not unified |
| B. Identity integration | Existing-wallet sign-in default, EIP-712, one session on main app, verified X link, Friends preserved through reload/two real wallets | Isolated Beta partially accepted; main app not integrated |
| C. Pay + Unified | Two-wallet signed Arc Testnet Pay-by-ID with short-lived recipient snapshot, exact review, independently verified receipt; per-chain accurate Arc/Base USDC with honest partial states | Foundations exist, complete ID payment E2E missing |
| D. Bridge + Swap | Providers individually validated for quotes, authorization, rejection, retries, finality, recovery and adversarial cases; explicit provider promotion | Not public accepted |
| E. Social + Notifications | Owner-only Friends, robust messaging privacy/keys, block/report, shared notification inbox, fresh messages and verified payment events, real mobile/two-user tests | Friends Beta accepted; Notification DB/API merged; messaging and unified UI missing |
| F. Single website release | One canonical URL, CORS/BFF/DB, backup/recovery, wallet-browser E2E, safe preview isolation, rollback, domain and security review | NOT ACCEPTED |
| G. Arc Mainnet | Production readiness pass, RPC+USDC decimals/gas proofs, healthy providers, signing infrastructure if needed, explicit small-money canary authorization, authoritative final receipt, independent security review | BLOCKED |
| H. Arc Studio / hackathon | Only after applicable Veyra gates: develop/test/document approved Veyra onchain flow in Arc Studio; record Studio project, contracts, Git commit, genuine user-authorized Arc Mainnet USDC tx hash and demo | NOT STARTED |

**Do not turn a hackathon one-off into a separate PayLink.** Arc Studio is the final testing/implementation and proof step for the existing Veyra, not permission to bypass Mainnet safety. If event rules require a certain Studio artifact/transaction, verify them before submission, and disclose incomplete integrations honestly.

## Prioritize real user outcomes over demo appearance
The next engineering increment is signed-session integration from Identity Beta to the main app/backend, then connected Pay-by-ID/Activity, truthful Unified, owner-scoped Social/Notifications, secure messaging, Bridge/Swap gated integration, full acceptance, Mainnet operator gates and only then Arc Studio.

Shipping rules: reviewed PR; green tests; live owner-session, wallet/account switching, reload, mobile and wrong-network tests; fail closed on uncertain settlement, never auto-retry money movement; do not launch messaging with unverified E2EE claims. Earn/Borrow/Onramp and unrelated feature branches stay deferred.

Reference contracts: [Core Four](veyra-core-four-circle-kits.md), [Mainnet release gates](veyra-mainnet-release-gates.md), [Social notification boundary](veyra-phase9-social-notifications-and-mainnet.md).
