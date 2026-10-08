# Veyra Phase 2C — X OAuth + Identity-safe payments

Phase 2C connects the Phase 2A/2B identity primitives to real payment preparation.

## Added

- X OAuth 2.0 Authorization Code + PKCE linking flow.
- Durable, single-use, 10-minute OAuth state records; raw OAuth state is never stored.
- Drizzle migration `0004_phase2c_x_oauth` + matching snapshot metadata.
- `/api/auth/x/start` and `/api/auth/x/callback`.
- X `/2/users/me` import into the existing immutable `xAccountId` binding path.
- Sender-aware recipient resolution that enforces block relationships before payments.
- `/api/identity/prepare-payment`: Veyra/X handle -> frozen identity snapshot -> verified wallet for the selected chain.
- `/api/identity/verify-payment`: revalidates the frozen identity immediately before wallet signature.
- Pay accepts Veyra handles, linked X handles, or direct EVM addresses.
- Agent TRANSFER proposals prefill Pay and then converge through the same recipient-resolution and transfer pipeline.

## Security invariants

- The Agent never signs or broadcasts transactions.
- LLM recipient strings remain untrusted until deterministic server-side resolution.
- Human-readable recipients never execute directly; they resolve to an immutable Veyra identity and frozen verified-wallet snapshot.
- Snapshot drift fails closed immediately before user signing.
- Direct wallet addresses remain direct-address transfers and do not pretend to have a Veyra identity snapshot.
- OAuth state is random, hashed at rest, short-lived, and consumed once.
- X access tokens are used only for the callback profile fetch and are not persisted by this phase.

## Required server environment

- `X_CLIENT_ID`
- `X_REDIRECT_URI`
- `X_CLIENT_SECRET` for confidential X clients (optional for public PKCE clients)
- `VEYRA_APP_ORIGIN` for post-link redirect
- existing `VEYRA_SESSION_SECRET`

Live X OAuth still requires an X Developer App with the callback URI configured in X Developer settings.
