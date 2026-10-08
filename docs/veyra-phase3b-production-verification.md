# Veyra Phase 3B — Production Verification & Mainnet Provider Onboarding

Phase 3B turns the Phase 3A fail-closed foundation into observable production gates without prematurely enabling financial execution.

## Scope

- Production Postgres readiness probe checks connectivity, the 20 required Veyra tables, and Drizzle migration history through migrations 0000-0005.
- Circle-verified mainnet catalog for Ethereum, Avalanche, OP Mainnet, Arbitrum, Base, and Polygon PoS.
- Circle-issued USDC addresses, CCTP V2 domains, TokenMessengerV2, MessageTransmitterV2, TokenMinterV2, and MessageV2 are recorded with official provenance.
- Mainnet provider candidates are registered at lifecycle `VERIFIED`, health `UNKNOWN`, and `enabled: false`.
- Runtime RPC health probes verify `eth_chainId` against the expected chain before recording provider health.
- Health/readiness endpoints expose database and provider probe state without exposing credentials.

## Important safety state

Phase 3B does **not** enable mainnet execution. Provider candidates remain disabled until:

1. production RPCs are configured and healthy,
2. adapter/preflight behavior is verified,
3. low-value mainnet E2E succeeds,
4. resulting balance/receipt state is reconciled,
5. KMS/HSM signing is wired where relaying is required,
6. explicit launch sign-off promotes the provider to `TESTED` and then `ENABLED`.

## Operator commands

```bash
bun run db:verify
bun run providers:health
bun run readiness:mainnet
```

A failing readiness command is expected until all production dependencies are configured and verified.
