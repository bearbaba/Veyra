# Phase 22 — Agent Quick Actions / Community Discovery

## Product intent
Make the product discoverable on first visit. Four short entrypoints — **Send, Swap, Bridge, Unified** — communicate what Veyra does without generic long prompts. A small guided composer prepares a human-readable request, not a transaction.

## Included
- **Send**: amount in USDC; choose destination network; choose **Wallet** with manual address or explicit **Paste**, or **Friends** from currently signed Veyra ID session when the route is direct Arc Testnet. Backend still resolves and reviews the recipient before signature.
- **Bridge**: Arc Testnet source, Ethereum Sepolia or Base Sepolia via lifecycle-enabled CCTP V2. Only an exact EVM destination wallet is accepted; no cross-chain friend wallet guessing.
- **Swap**: visible product card and a link to existing Convert view. Explicitly marked Preview: StableFX execution remains disabled.
- **Unified**: visible product card with entry to Arc USDC balance and eligible route discovery. No fictional multi-chain aggregation or universal spend.
- **Safety**: Quick Start drafts are validated (amount precision/positive, exact address or signed connected friend, exact network). A user must submit the proposed natural language request, then independently approve a real Pay/Bridge review before the wallet can sign.
- **Privacy**: history keyed by address + connector + verified Veyra user, matching Social session binding; network switching does not discard an active identity.
- **Accessibility**: short labels, clear route availability, keyboard-accessible tabs, focus labels, mobile two-column cards, clipboard permission failure help.

## Acceptance
Desktop/mobile: first visit, select each action, open Friends signed/unsigned, select real friend, invalid address, paste success/denial, supported/unsupported destination, zero/precision errors, edited natural language draft, wallet switching, F5, Bridge vs direct Pay, Convert unavailable. Do not promote Production on CI alone.
