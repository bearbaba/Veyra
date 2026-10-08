# Veyra Phase 3C — Production Infrastructure Activation

Phase 3C turns the Phase 3A/3B safety gates into deployable production infrastructure hooks without enabling mainnet money movement.

## Added

- Production database activation command that refuses unsafe mainnet runtime config, runs Drizzle migrations, then verifies schema/migration history.
- Remote KMS/HSM signer gateway boundary. The Veyra BFF never receives or stores the production private key.
- Signer health probe that verifies backend type, signer address shape, and configured key identity.
- Mainnet readiness now requires a healthy signer gateway in addition to database/provider/runtime gates.
- Production preflight command combining database, provider, signer, and runtime checks.
- Provider health records must be fresh; stale records fail closed.

## Signer gateway contract

`VEYRA_SIGNER_URL` points to an HTTPS service deployed inside the production trust boundary and backed by KMS/HSM.

- `GET /health` -> `{ ok: true, backend: "kms" | "hsm", signerAddress, keyReference }`
- `POST /sign` with bearer auth and `{ chainId, payloadHash, purpose }` -> `{ signerAddress, signature, keyReference }`

The gateway must keep key material non-exportable. Veyra only sends a payload hash for signing.

## New commands

```bash
bun run signer:health
bun run db:activate:mainnet
bun run production:preflight
```

## Still intentionally blocked

Mainnet provider candidates remain `VERIFIED` and disabled. Promotion to `TESTED`/`ENABLED` still requires low-value real mainnet E2E execution, receipt/balance reconciliation, canary controls, security review, and explicit sign-off.
