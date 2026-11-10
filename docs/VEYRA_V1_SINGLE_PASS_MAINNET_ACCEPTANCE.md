# Veyra v1 — Single-Pass Mainnet Acceptance

**Target:** verify the existing v1 product once, with one controlled screen recording, not a sequence of partial signoff videos. This is a user-run acceptance protocol, not proof that any live-money transaction has already succeeded.

## Preflight — before any signing

- Official URL: **https://veyra-seven-beta.vercel.app/**. Confirm the deployed `veyra-build.json` reports `env: mainnet`, `vercelEnv: production` and the exact GitHub release SHA.
- Sign in with the intended wallet and Veyra ID. Confirm address and wallet network at every Review.
- Confirm wallet USDC and **Unified Gateway balance are two separate balances**. Distinguish available versus pending. Never add them together as spendable funds.
- Start with no unresolved operation in Activity. If an operation is UNKNOWN, PENDING, PARTIAL, or awaiting fresh verification, **do not send a second one**.
- Check provider fees, gas, expiry and minimum received before approving/signing. If the minimum received or fee breakdown is unavailable, do not perform a funded test.
- Use a tiny amount approved by the wallet owner; stop if network fees outweigh the test's value. No assistant or automated test must request a financial signature.

## One-recording acceptance matrix

| Sequence | Screen / operation | Pass condition | Evidence to capture |
|---|---|---|---|
| 1 | Open Home and connect/sign in | Wallet, Veyra ID and distinct wallet/Unified balances are legible | Wallet address and Home, no sensitive credentials |
| 2 | Navigate desktop/mobile | Home, Friends, Pay, Swap, Bridge; Activity in History/More; no Soon on Activity | Desktop and 390/320px responsive views |
| 3 | Pay direct to a verified recipient | Recipient and network reverified at Review; one explicit wallet confirmation; receipt matches recipient and actual amount | Source hash, recipient, chain receipt, Activity |
| 4 | Swap Arc USDC → EURC | Horizontal From/To, Max/Refresh, fresh quote, fee, minimum, expiry; execution if economically reasonable; received EURC confirmed on Arc | Source tx, destination token/Transfer logs, received amount |
| 5 | Swap Arc EURC → USDC | Reverse works without UI duplication, fees/minimum update; successful receipt only after chain read if actually signed | Source tx and verified USDC Transfer logs |
| 6 | Bridge Arc → Base | Reviewed CCTP max fee and minimum, source burn plus Iris signed-message link plus destination mint/USDC receipt | Burn hash, Iris nonce/status, destination mint hash, Base receipt |
| 7 | Bridge Base → Arc | Same end-to-end checks in the reverse direction | Base source, Arc mint, exact recipient and amount |
| 8 | Unified Gateway add / send to wallet | Gateway is separate; reviewed source allocation, fees, pending, availability and final result reconcile | Ledger before/after, wallet result, Activity |
| 9 | Reload while original Swap/Bridge is PENDING or has cached VERIFIED status | UI shows unresolved/checking until fresh receipt verification; no duplicate-sign action; automatic check bounded with manual recheck | Before/after state and original hashes |
| 10 | Navigate to Activity and receipts | One chronological operation, original+destination links, no fabricated 'Verified'; privacy maintained when changing wallet | Activity and external block explorer verification |
| 11 | Disconnect or switch wallet, then return | No other wallet's history, identity or verification result leaks; stale verification cannot update new wallet | Screen states for both wallets |

**Three visible UI stages**: Review → Confirm → Track. Internally the full lifecycle and safety locks must remain. Track may show Processing, Verifying, Verified, Unresolved or Needs attention; only independent receipt checks justify success.

**Never do an extra spend just to satisfy a checkbox.** When liquidity, fees, gas, Circle Iris or wallet access makes a funded operation unavailable, record **NOT TESTED** with the reason, not PASS. Any test involving money requires the owner's actual wallet review and signature.

## Negative/Recovery evidence (no financial signatures)

- Local cached VERIFIED without hash, with forged hash, or with a valid-looking hash must not immediately show a trusted completion after reload.
- A cached REVERTED flag must not by itself unlock new signing.
- A failed receipt, wrong token, wrong network, wrong recipient, missing CCTP mint, under-minimum output or unavailable RPC remains unresolved or appropriately identified using original chain evidence, **never inferred as successful**.
- A wallet change while checking the destination cannot write the old result into the new wallet's screen.
- A duplicate click or page reload must not submit a second approval, swap, payment or CCTP burn for the same UNKNOWN/PENDING operation.

## Final acceptance report (complete only after the recording)

| Gate | Status | Evidence |
|---|---|---|
| GitHub/Production exact SHA | NOT TESTED | SHA / bundle JSON |
| Desktop/mobile navigation | NOT TESTED | Recording timestamp |
| Identity/Friends | NOT TESTED | Wallet-scoped signed-in session |
| Pay Mainnet receipt | NOT TESTED | TX hash / destination |
| Swap USDC → EURC | NOT TESTED | TX hash / ERC20 Transfer |
| Swap EURC → USDC | NOT TESTED | TX hash / ERC20 Transfer |
| Bridge Arc → Base | NOT TESTED | Burn / Iris / mint |
| Bridge Base → Arc | NOT TESTED | Burn / Iris / mint |
| Unified deposit/spend | NOT TESTED | Gateway ledger evidence |
| Activity/receipt + reload | NOT TESTED | Source/destination recheck |
| Wallet switching / pending lock | NOT TESTED | Recording timestamp |

Once evidence is collected, mark each item PASS/FAIL/NOT TESTED. Do **not** call the product accepted while a financial path remains NOT TESTED.

## Studio / GitHub consistency after the acceptance

Arc Studio may still have **unpushed local** changes on `arc-studio/nav-and-fresh-verification`. Before pulling a new GitHub release into Studio, first inspect and preserve its working tree and commit/stash it in Studio's existing branch. Compare/reconcile the source changes against the current `feature/mainnet-identity-authority` branch, resolve conflicts deliberately, rerun all regressions, then push verified changes. Never hard-reset Studio's uncommitted work to match Production.
