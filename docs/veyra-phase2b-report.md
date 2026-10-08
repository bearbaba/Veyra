# Veyra Phase 2B — Session Boundary + ProfileService

## Scope

Phase 2B completes the non-provider-specific identity/profile layer that can be built before live X OAuth credentials are wired.

- Production identity routes now accept a signed Veyra Bearer session (`VEYRA_SESSION_SECRET`, HMAC-SHA256).
- `X-Veyra-User-Id` remains a development-only fallback and is rejected in production.
- Added `ProfileService` for profile read/update, per-field Veyra/X source selection, server-internal X import, and X revocation.
- Added authenticated `GET/PATCH /api/profile/me`.
- Added authenticated `POST /api/identity/resolve` for Veyra handle, linked X handle, or raw wallet resolution.
- Added `PROFILE_UPDATED` identity revision auditing.
- Linked identity INSERT now increments `identity_revision`.
- Profile changes that appear in an identity review snapshot increment `identity_revision`, invalidating stale snapshots before broadcast.

## X OAuth boundary

`linkXIdentityFromOAuth()` is deliberately server-internal. No public endpoint accepts an `xAccountId` as proof of X ownership. Live X OAuth token exchange and `/2/users/me` import remain a later provider integration step; the immutable numeric `xAccountId` returned by X must be passed to this service only after OAuth succeeds.

## Security invariants

- Session tokens are signed, expire, and reject tampering.
- Production never trusts `X-Veyra-User-Id`.
- X handles are mutable display aliases; `xAccountId` is the immutable external binding.
- Linking a different X account requires explicit revocation of the current active link.
- An active X account cannot be linked to two active Veyra identities.
- Veyra-customized profile fields are not overwritten by X refreshes.
- Revoking X clears fields still sourced from X and returns them to Veyra ownership.

## Not included

- Live X OAuth authorization/token exchange.
- SocialGraph block/follow/friend enforcement (Phase 4).
- SendSuggestionEngine / recipient preferences routing.
- UI for profile editing or X linking.
