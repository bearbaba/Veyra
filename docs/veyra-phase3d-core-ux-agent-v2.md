# Veyra Phase 3D — Core UX + Agent V2

## Product decision

Veyra is a human-first payment layer, not a bridge dashboard and not an AI bot
with financial tools attached. The core path is:

`Identity -> Intent -> Route -> Safety -> Sign -> Receipt`

Veyra ID and Universal Pay are the product core. RouteEngine hides chain and
provider complexity. Agent is a natural-language interface to the same core.

## UX simplification

Primary navigation is reduced to **Home / Pay / Agent / Activity**. Convert and
Bridge remain available as advanced routes and can be reached by Agent or the
command palette. Settings is secondary.

Home now gives identity setup first-class placement:

- Create Veyra ID
- Connect X
- verified wallet state
- active balance/network
- quick Pay / Agent / Activity
- product registry networks and assets with recognizable branding

Pay asks **"Who are you paying?"**. The current executable preview remains
Arc Testnet USDC; broader registry visibility never implies execution support.

## Agent V2

### Independent availability layers

1. **Conversation** — can explain Veyra and talk naturally.
2. **Planning** — can interpret TRANSFER / CONVERT / BRIDGE intent.
3. **Execution** — remains deterministic and runtime-authoritative.

An LLM/BFF/provider failure must not collapse the conversation UI. Both server
and browser have a bounded deterministic fallback. Execution stays locked in
fallback mode.

### Language behavior

English is the product default. When a server-side model is configured, the
Agent is explicitly instructed to reply in the language of the user's latest
message, including mixed-language input. The local fallback recognizes a set of
common scripts/languages and preserves action planning when possible.

No language layer may alter addresses, transaction hashes, token symbols,
contract addresses, numeric amounts, Veyra IDs, or X handles.

### Multi-turn fallback

When the model is offline, a short fragment such as `@alice` can complete a
recent user request such as `Send 20 USDC`. Only recent **user** messages are
folded into deterministic fallback parsing; previous Agent text never becomes
financial input.

### Action cards

Agent output is a proposal. TRANSFER / CONVERT / BRIDGE candidates are rendered
as review cards. A card may navigate to a deterministic product flow, but it
cannot sign or broadcast. Resolver, route, policy, balance, amount, and onchain
state are re-verified later.

Model output cannot mark execution `AVAILABLE`; that capability comes from the
trusted runtime boundary.

## Veyra ID creation

A new registration path supports first-time onboarding without weakening the
identity model:

1. User chooses a normalized handle and connects a wallet.
2. BFF checks handle + wallet availability.
3. BFF issues a short-lived HMAC-bound claim carrying a random nonce.
4. Wallet signs an EIP-712 `IdentityClaim`.
5. BFF verifies the claim/signature and checks availability again.
6. A database transaction creates the canonical user, verified wallet binding,
   revision audit, and session.

`VEYRA_IDENTITY_CLAIM_SECRET` may be used as a dedicated server secret; otherwise
registration uses `VEYRA_SESSION_SECRET`. Either must remain server-side and be
at least 32 characters.

Local-only preview IDs are explicitly non-production and do not reserve handles.

## Registry vs execution

`productRegistry.ts` is presentation/capability metadata only. It does not
replace Provider Registry, RouteEngine, health checks, policy, or readiness.

Statuses:

- `ACTIVE` — execution enabled in the current product environment.
- `VERIFIED` — product metadata is registered but execution is disabled.
- `RECOGNIZED` — understood/displayable but not promised as an executable route.

The current Phase 3D executable preview remains **Arc Testnet + USDC**.

## Safety invariants preserved

- User wallet is the final signing authority.
- Agent never signs or broadcasts.
- Identity snapshots are re-verified before financial signing.
- Model output remains untrusted.
- Provider/runtime health gates remain fail-closed.
- Mainnet provider activation is not enabled by this phase.
- Production signer/KMS and Postgres readiness from Phase 3C stay mandatory.

## Validation

Run on the repository with dependencies installed:

```bash
bun run typecheck
bun run test
bun run check
bun run contracts:build
bun run build
```

Then test full Web + BFF:

```bash
bun run server
bun run dev
```

If no server-side AI provider is configured, Agent should show fallback mode but
remain conversational/action-aware instead of displaying a fatal BFF error.
