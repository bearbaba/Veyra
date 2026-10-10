# Veyra Phase 3D — Web Preview Stabilization

This checkpoint intentionally separates **web-product testing** from **mainnet execution activation**.

## Goals

- Make the current Veyra product easy to navigate and evaluate in a browser.
- Make backend availability visible without making the UI unusable when the BFF is offline.
- Preserve every production safety gate introduced in Phase 3A–3C.
- Add a production Vite build/preview path before real-fund execution work continues.

## Changes

- Global Web Preview banner for `local` and `testnet` environments.
- Non-blocking `/api/health` probe with UI-only fallback.
- Runtime readiness card in Settings backed by `/api/health/readiness`.
- Reliable `Ctrl/Cmd + K` command palette shortcut.
- Bridge entry in the command palette and Home quick actions.
- Home quick actions now expose the major user journeys: Pay, Agent, Bridge, Activity, Convert.
- Added `build`, `preview`, and `web:smoke` scripts.

## Safety invariants

This checkpoint does **not**:

- enable a mainnet provider;
- bypass the signer/KMS boundary;
- bypass identity snapshot verification;
- bypass policy/risk/simulation review;
- make readiness checks permissive;
- enable real-fund canary execution.

The next Phase 3D execution checkpoint can build on this browser-tested UI once the web flows are accepted.
