# Veyra Phase 2D — Social Graph, Contacts, Receive Preferences, Send Suggestions

Phase 2D turns identity-aware payments into relationship-aware payments without granting social relationships any financial authority.

## Added
- ContactGraph v1 backed by `contacts`, with owner-scoped aliases, favorites, soft removal, and block enforcement.
- Contact aliases resolve before global Veyra/X handles for the authenticated sender.
- Social API surface for follow/unfollow and friend request/respond; existing append-only SocialGraph remains authoritative.
- ReceivePreference API with verified-wallet ownership and chain binding checks.
- First receive-preference INSERT now increments `identity_revision`, so existing review snapshots cannot survive a resolution-changing preference creation.
- Pure deterministic `SendSuggestionEngine` producing Recommended / Same-chain / Fastest candidates from recipient wallets, preferences, route fee/ETA, and health inputs.

## Safety invariants
- Block overrides follow, friend, contact, and payment resolution.
- Follow/friend/contact never grants signing or spending permission.
- Suggestions are advisory only; execution still requires IdentitySnapshot verification plus the existing policy/risk/simulation/review pipeline.
- Unhealthy routes are excluded. No client-supplied suggestion can bypass provider eligibility or execution preflight.
- Mainnet readiness remains config/provider driven; no mainnet provider is enabled by this phase.
- Direct `/api/identity/snapshot` access is now self-only; recipient snapshots must be created through the payment preparation path, reducing preference leakage.
- Accept/reject friend actions now require a real pending request from the other user and re-check block state.
