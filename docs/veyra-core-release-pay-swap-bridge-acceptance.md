# Veyra Testnet release gate — Pay, Swap, Bridge (2026-10-29)

**Non-negotiable scope:** Unified Balance, Agent, Veyra ID/X, Pay, Swap, Bridge. A feature is not removed because a provider is not yet usable. No fake prices, swaps, tx hashes, or balance deltas. No Mainnet operations.

## Sequence and single task ownership
1. Finish **Pay** review / wallet authorization / broadcast / confirmation / owner-bound receipt / reload recovery in the Agent *Active task*; preserve Veyra ID payee snapshots and reject stale wallet or chain.
2. Implement **Swap** using the same Agent task and Activity identity, not a separate Convert route. Choose a single Arc Testnet pair USDC ↔ EURC *only after* executable provider and test wallet are verified.
3. Extend **Bridge** from the same task state machine, preserving the known-good Arc → Sepolia/Base CCTP V2 path, then add reverse only after source/burn/attestation/mint and recovery E2E.
4. Validate X OAuth with a signed Veyra wallet session and exact approved origin. X is an additional link to the existing ID; never another wallet or identity.

## Code audit, not a completed Swap
- `src/components/pages/PayPage.tsx` and `useTransferExecution.ts` have real Arc USDC transfer execution, network simulation, signed receipt, replay and wallet-scoped ownership; **browser E2E must still be re-run**.
- `src/providers/stablefx/stableFxAdapter.ts`, `src/hooks/useConvertExecution.ts`, `src/core/pipeline/convertPipeline.ts` and BFF `/api/stablefx/quote`, `/api/stablefx/trade`, `/api/stablefx/trade/:id` exist, but StableFX is IMPLEMENTED/disabled. **Missing** funding presign → explicit wallet signature → fund step, server-side quote-to-wallet binding, exact ERC20 spender and token allowance validation, on-chain settlement evidence, durable user-bound trade resume.
- Circle's current taker guide uses `https://api.circle.com`, with environment selected by TEST/LIVE API key. Veyra currently pins `https://api-sandbox.circle.com`: verify the intended Testnet key/environment and change only under a pinned TEST-key guard; never silently send a LIVE key.
- Circle's official sample response has `rate` and `fee: {currency,amount}`, while Veyra adapter still declares `exchangeRate` and `fee: string`. Normalize and validate real provider data before making any financial action; no invented fees or exchange rates.
- `src/providers/appkit/appKitAdapter.ts` already calls `estimateSwap` and `swap` but the provider remains disabled; Circle's App Kit FAQ (2026-07-07) documents Swap as server-side only. Confirm actual wallet adapter compatibility and access rather than assuming MetaMask can execute this server-only flow.
- The existing hook previously promoted provider `complete` to a `VERIFIED` receipt with the API-reported output. This change **fails closed** to SETTLEMENT_PENDING, with an owner-bound local PENDING receipt until independent on-chain confirmation.
- No provider key or signed Testnet transaction was supplied/accessible in this work; **there is no completed Swap E2E evidence**.

## Provider decision gates, in order
1. Confirm provider access and intended TEST environment without exposing secrets. Do not mark usable until API returns a validated *tradable* quote for the connected wallet and exact pair.
2. Validate chain ID 5042002, token contracts (read code and decimals), USDC/EURC liquidity, spender code, token allowance, balance and gas. Reject infinite approvals by default. Review chain, input amount, expected output, quote fee, expiry and minimum output; reject stale/mismatched wallet or changed quote.
3. Verify funding API and signer scheme. Quote signed ≠ trade funded; approve successful ≠ Swap complete. Lock stable idempotency key for submitted trade, and recover across reload without re-submitting.
4. Require provider completion **and** independent destination ERC20 transfer event/receipt matching owner, token and output, or verified owner-bound before/after balance delta; store exact chain hash(es) and trade ID and display explorer.
5. Browser smoke: success, insufficient balance, rejected allowance, rejected signature, expired quote, wrong chain, wallet switch, refresh pending, provider failure, API timeout without auto-retry. Only then advance provider to ENABLED.

## Vercel budget
Preview auto-deploys were disabled on the existing Vercel project to preserve slots. Use one CI batch, a single confirmed READY candidate and manual approval before promoting alias. **No new preview or production deploy in this commit.**

Sources:
- https://developers.circle.com/stablefx/quickstarts/fx-trade-taker
- https://developers.circle.com/stablefx/tutorials/test-stablefx-integration-taker
- https://community.arc.io/public/blogs/app-kit-faqs-2026-07-07
