# Veyra product coherence review — 25 October 2026

Reviewed core baseline: `e307698` (includes PRs #65–#72). The older, unfinished local Pay/Activity patch was not applied over this baseline.

## Product organization

- Home: balance, inline identity access, Pay, Agent, Activity. Network/asset metadata is collapsed by default.
- Friends: contacts and verified notifications, using the same signed identity as Home and Settings.
- Bridge: a visible secondary tool for supported test networks, retaining all provider and transaction gates.
- Currency conversion: explicitly USDC/EURC; not advertised as token Swap.
- Activity: existing wallet/session-scoped receipts and conservative recovery remain intact.
- Mainnet: this change neither enables providers nor promotes a release.

## Changes

Home reuses the existing inline identity entry instead of sending unsigned users to another page. Explicitly choosing sign-in now overrides an earlier registration suggestion. Balance fetch failures no longer appear Active, refresh has a visible busy state, and small/large balances retain exact token precision.

Primary navigation labels Social as Friends. Mobile navigation remains inside the viewport with safe-area padding. Search has an explicit close button, a labelled dialog, focus restoration and keyboard focus containment. The Arc Studio attribution sits above the mobile navigation and below modal overlays.

## Remaining release boundaries

The dedicated Testnet staging branch and backend allowed origin still need independent deployment verification. A green code check does not prove wallet sign-in, X OAuth consent, signed Pay-by-ID, Bridge settlement, token Swap or Mainnet readiness. No funds were moved during this review.

Backend-dependent sign-in can remain unavailable when the current host is not authorized. Mainnet acceptance, provider availability, cross-device recovery and real-wallet execution evidence must be assessed separately from this layout refinement.

## Validation

Exact balance formatting has numeric regression coverage. The CI browser job additionally builds the full core app and checks desktop/mobile Home identity entry, catalog expansion, Bridge navigation, Search closing and horizontal overflow without a live wallet. Existing financial safety and preview checks remain required.
