> **ARCHIVED ALTERNATIVE — not selected (23 October 2026).** A standalone PayLink is NOT part of Veyra's current plan. Finish the original Veyra financial app and its Identity/Social integration before using Arc Studio to test/implement an approved Veyra Arc Mainnet payment. This historical prompt does not authorize a second product, Mainnet signing, or real spending. See [single-product release contract](veyra-single-product-release-contract.md).

# Arc Studio build prompt — Veyra PayLink (Arc Microgrants 2)

**Purpose:** copy the prompt below into Arc Studio (https://studio.arc.io if available via Arc's official site; verify the official launch link before authenticating). This document is a build specification, **not evidence that Arc Studio has built, tested or deployed anything**.

## Arc Studio prompt (English)

Build **Veyra PayLink**, a minimal Arc-native, non-custodial payment demo from scratch, including a Solidity contract, tests and a polished, responsive English-language web application. This is an independent, carefully gated hackathon canary; do not change or activate the existing production Veyra financial app.

### User journey
- Connect MetaMask or a standards-based EVM wallet; support EIP-6963 wallet discovery. Never auto-select an ambiguous provider.
- Clearly display current network, connected wallet, and available USDC balance. **Arc Mainnet chain ID 5042** is the only live transaction target. Provide an explicit manual network-change instruction, not an involuntary switch.
- Enter an exact recipient address and amount (USDC, **six decimal places**). Optionally display a friendly `@handle.veyra` only if resolved from a verified Veyra service. If there is no authenticated Veyra service, use an explicit wallet address without inventing an identity.
- Review exact recipient, amount, chain, fee/gas estimate, spender contract and contract address, then separately request a wallet approval and payment transaction. Approval must be for the **exact amount**, never unlimited. Ask for two confirmations, one for approval and one for payment, if the token flow requires both.
- Use one contract function `pay(address recipient,uint256 amount)` that pulls exactly `amount` tokens from `msg.sender` and sends them directly to `recipient` with OpenZeppelin SafeERC20; no custody, no fees, no upgradeable admin, no agent signing, no escrow.
- Emit a typed `PaymentCompleted(sender,recipient,amount)` event only after the token transfer succeeded. Reject recipient zero, zero amount, missing allowance, wrong chain, broken token behavior, and replayed UI submissions.
- Display a success receipt only after authoritative Arc RPC success and verified USDC Transfer log to the approved recipient with the exact amount. Show block, transaction hash, contract address, recipient, amount and explorer link. A pending, rejected or unknown transaction must **never** show success.

### Arc primitives / security
- Read Arc's official current documentation before coding. Mainnet chain ID = **5042**. The canonical unified Arc USDC ERC-20 interface is `0x3600000000000000000000000000000000000000`, six decimals. Native gas accounting is **18 decimals**; never double-count native gas and ERC-20 USDC balances. Verify chain and contract interface live at execution time.
- Do not hardcode a private key, seed phrase, owner wallet, API secret or a live funded address. Deployment/transaction signatures must be explicitly approved in the user's own wallet; no automated real-money execution.
- Use a publicly inspectable, non-upgradeable immutable USDC contract reference if appropriate; justify any administrative controls.
- Use Solidity 0.8.x, OpenZeppelin SafeERC20; do not use `tx.origin` or arbitrary `delegatecall`. Protect state/transaction UX against duplicate submissions.
- Tests: successful exact small amount; zero/invalid recipient; zero amount; missing allowance; bad token/noncompliant transfer; insufficient balance; no fees/custody; rejection/pending cases; wrong chain; transaction/log spoofing; duplicate UI click; incorrect decimals.
- Have Arc Studio generate and run contract unit tests AND application tests; show actual output, not fabricated PASS. Verify the compiled deployment has no ability to move funds without explicit user allowance and signed transaction.

### UX and delivery
- Clean, restrained, premium UI consistent with Veyra: dark navy, controlled lime highlights, large readable review form, one primary CTA. English default, mobile-friendly.
- Include a security-first transaction history view of verified results, with clear explorer links. **No chat, X integration, or main Veyra friend identity unless it is verifiably connected**.
- Export complete code to a public GitHub repository or clearly separated Veyra branch. Do not overwrite existing Mainnet/testnet Veyra infrastructure.
- Supply **Arc Studio project URL**, deployed **Arc Mainnet contract address**, verified source, public app URL, full GitHub repo URL, one **real small-value user-authorized USDC movement** and its exact explorer transaction hash. Supply a 2–3 minute video narrative showing **Arc Studio coding/tests and the real transaction**.
- If anything cannot be completed securely, explicitly mark it as BLOCKED. A testnet result, simulated receipt or mocked payment does not qualify as a Mainnet transaction.

**Success criteria:** a reviewer can open the public URL, inspect the code and Arc Studio build, independently verify the contract and real Mainnet USDC transfer, and understand exactly what was (and was not) built.

## Before submission
1. Re-read current official hackathon rules: https://dorahacks.io/hackathon/arc-microgrants-2/detail .
2. Verify actual Arc Studio project and completed tests — cannot substitute ordinary IDE work.
3. Obtain a user-approved tiny-value Arc Mainnet canary with no extra spend beyond explicitly reviewed gas/USDC costs.
4. Capture contract, TX explorer, Studio URL, app, repo and honest demo.
5. Keep Veyra's general Mainnet Pay/Bridge/Swap disabled until their separate production gates pass.
