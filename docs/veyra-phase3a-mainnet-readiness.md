# Veyra Phase 3A — Mainnet Readiness Foundation

Phase 3A does **not** enable mainnet money movement. It creates the safety boundary required before mainnet can ever be enabled.

## Added gates

- Server `VEYRA_ENV=mainnet` fails startup unless production configuration is present.
- Raw `RELAY_PRIVATE_KEY` is forbidden on mainnet; signer backend must be `kms` with `VEYRA_KMS_KEY_ID`.
- Production DB cannot point at localhost.
- Session secret must be at least 32 characters.
- App/X callback origins must be HTTPS.
- Environment scanning rejects obvious testnet RPC leakage in mainnet.
- Deployment registry fails closed on mainnet when no explicit verified registry is supplied.
- Mainnet deployment registry rejects known testnet chain IDs.
- Provider eligibility now enforces provider environment.
- Mainnet provider execution requires a fresh runtime health record; manifest `OK` alone is insufficient.
- BFF has global + route-specific configurable rate limits.
- Every HTTP response gets a request ID and emits structured request telemetry.
- `/api/health/readiness` exposes non-secret readiness checks.
- `bun run readiness:mainnet` is a CLI release gate and exits non-zero while blockers remain.

## Intentionally still blocked

The current provider manifest contains testnet integrations only. Therefore the Mainnet Readiness Gate intentionally reports **not ready**. A provider may be added as mainnet-enabled only after its current official addresses/assets are verified, adapter tests pass, mainnet-safe health monitoring exists, and controlled real-value E2E verification is signed off.

## Remaining release gates

1. Run all Postgres migrations against a real production-like database.
2. Provision KMS/HSM signer implementation and funded per-chain gas wallet.
3. Populate verified mainnet chain/token registry from current official sources.
4. Add and verify mainnet provider adapters one by one.
5. Configure provider health checks and alerting.
6. Configure production rate-limit store (distributed, not in-process) before horizontal scaling.
7. Add error/latency metrics and alerting backend.
8. Execute small-value mainnet canary transactions before public rollout.
9. Security review and staged rollout.
