Veyra Phase 3C overlay
Baseline: Phase 3B develop @ 96e6fc8

Apply from Git Bash while inside ~/Downloads/Veyra-recover:
  unzip -o ../Veyra-phase3c-files.zip -d .

Then validate:
  bun run typecheck
  bun run test
  bun run check
  bun run contracts:build

Production gates (expected to fail until real production infrastructure is configured):
  bun run signer:health
  bun run db:verify
  bun run providers:health
  bun run production:preflight
  bun run readiness:mainnet
