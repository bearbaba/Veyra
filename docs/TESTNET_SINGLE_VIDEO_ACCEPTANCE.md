# Veyra — One complete Testnet acceptance, one recorded walkthrough

Date: 2026-10-29. Applies to the isolated Testnet candidate only. Status: **NOT YET ACCEPTED**.

## Product contract (do not reinterpret)
A simple professional Web3 application with **Unified Balance, Agent, Veyra ID + X, Pay, Swap, Bridge**, and a shared review/sign/track/receipt workflow. English UI by default with multilingual chat. No redundant tabs, modal blockers, misleading success, fake quote, fake transaction, hidden Mainnet fallback, or automatic retry. A signed wallet and Veyra ID remain a single coherent identity. Never delete Swap because it is incomplete.

**Review → explicit wallet authorization → broadcast → pending → independent verification → owner-scoped receipt** is the one money-action lifecycle. Balance reads must never create a trade. Only one active task; completed and pending actions remain visible in wallet-scoped Activity after page refresh. No accidental wallet switching or double signing.

## Six feature gates, all required before user video
| Feature | Acceptance evidence |
| --- | --- |
| Unified Balance | Correct USDC on Arc Testnet, Ethereum Sepolia and Base Sepolia from real wallet; sum equals verified reads; failed RPC displays unknown, not zero; no transfer action from balances |
| Agent | EN/VN pay, bridge, swap, balance requests; correct chain and token; clarification when ambiguous; compact Active task; back/reload/new action; no route away merely to review |
| Veyra ID/X | Wallet signature registration/sign-in; reconnect, connected friend, Pay by ID; X OAuth start, approved redirect, same ID on return and reload; cross-wallet impersonation denied |
| Pay | Two wallets + real Arc Testnet USDC transfer; independently verified recipient, exact amount and chain; failed/rejected signing, wrong chain, insufficient balance, refresh pending, no duplicate; explorer transaction and wallet-scoped Activity |
| Swap | Genuine provider tradable quote for a confirmed supported token pair/network (USDC ↔ EURC on Arc Testnet preferred), price, fee, expiry, minimum output, exact wallet/chain/token/spender and capped approval; signed trade, separate signed funding if StableFX, settlement, real destination ERC20 balance delta or transaction event and explorer proof; reject stale quote, wallet/chain switch, approve/sign rejection and provider failure; never conflate API COMPLETE with verified on-chain receipt |
| Bridge | Real Arc → Ethereum/Base Sepolia CCTP burn and exact destination mint receipt; independently confirmed reverse testnet route before enabling; pending/reload/resume; wrong chain, missing allowance, signature rejection and duplicate burn denied; existing stable V2 route must not regress |

## Current hard blockers (not permission to remove scope)
1. Circle StableFX uses *two* explicit Permit2 signatures (trade and funding) and separate API presign/fund/status calls. Veyra currently only exposes quote/trade/status. TEST API replies may include mock data. An API 'complete' status is not verified settlement. Circle App Kit Swap is server-side only as of July 2026; cannot claim MetaMask client support without a vetted adapter.
2. A provider-signed quote must bind `witness.consideration` (quote ID, token pair, input/output amounts), not just the top-level `from`/`to` fields and spender. Validate actual provider response against exact wallet, chain and EIP-712 payload before enabling authorization.
3. Connect X requires the actual Vercel return origin and signed identity context to match the Render BFF configuration and the X Developer Portal callback. Endpoint presence alone is insufficient.
4. Reverse CCTP cannot sign until real Testnet source allowance/burn/attestation/mint evidence and recovery have been verified.
5. PR #85 has CI evidence but **no wallet-signed video acceptance for this new Agent UI**. Don't promote to the stable V2 alias yet.

## One-shot video protocol (only after all gates are green)
- Use a single named Testnet candidate and one connected owner wallet, plus a second wallet for recipient/negative tests. Before starting, record deployed commit SHA, connected wallet, network IDs and exact explorer URLs.
- In one uninterrupted primary walkthrough: connect → show Unified totals → sign in Veyra ID → connect X → select friend and Pay by ID → ask Agent to Pay → Swap USDC↔EURC using real quote, approve (bounded) and funding signatures → confirm token delta → Bridge forward and reverse → show wallet-scoped Activity and receipts.
- Record negative tests separately only if they would disrupt the primary video; include summary links and test matrix. Collect wallet rejection/expiry/insufficient balance/chain switch/reload after pending as adversarial evidence. No edited simulated tx can count as successful acceptance.
- Report observations as **one consolidated issue log**, categorized P0 money safety / P1 broken flow / P2 UX and prioritize a single regression-tested correction batch.

## Release / Vercel policy
- Preserve working stable V2 at `https://veyra-unified-testnet-v2.vercel.app/`. Testnet preview autodeploy is disabled to protect deployment slots.
- Batch local/CI changes; one exact-head GitHub Actions green candidate, one manual Vercel Preview, real-wallet acceptance. Promote to stable V2 only after user accepts; freeze that SHA for the recorded walkthrough. No implicit Mainnet transition.
- Keep server, frontend, provider flags and feature entitlement tied to the same Testnet release candidate. Never let a frontend expose a signing path that the deployed BFF cannot execute or verify.
- Mainnet requires independent gates: audited spender/token provenance, private-key custody boundary, keys and monitoring, rate limits, database backups, idempotent recovery, incident runbook, external review and explicit owner approval.

Official references:
- https://developers.circle.com/stablefx/quickstarts/fx-trade-taker
- https://developers.circle.com/stablefx/tutorials/test-stablefx-integration-taker
- https://community.arc.io/public/blogs/app-kit-faqs-2026-07-07
