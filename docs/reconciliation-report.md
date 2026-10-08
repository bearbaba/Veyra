# Veyra Phase C Integration Reconciliation Report

**Date:** 2026-10-07  
**Result: CLEAN — 216/216 tests passing, 0 TypeScript errors, 0 lint errors, production build succeeds.**

---

## Principle applied

Phase A/B engines were treated as authoritative throughout.
No authoritative engine was modified.
All changes are confined to Phase C adapters, hooks, pages, and tests.

---

## Files changed

### 1. `src/core/intent/intentSchema.ts`
**Mismatch:** `IntentCandidate.recipientRaw` was typed `UntrustedString | undefined` but the sanitizer could produce `null` (when the LLM explicitly sent `recipient: null`).  
**Fix:** Extended the type to `UntrustedString | null | undefined` with explicit documentation that `null` means "LLM said no recipient" vs `undefined` meaning "absent". No behaviour change to the engine — the distinction was already in the sanitizer; only the type annotation was wrong.

### 2. `src/core/pipeline/bridgePipeline.ts`
**Mismatch:** `MANIFEST_CONSTANTS` is `as const` so its values are literal types (`5042002`, `84532 | 11155111`). `new Set([...])` inferred a `Set<literal>` and `Set.has(number)` rejected `number` args.  
**Fix:** Widened to `new Set<number>([...])`. No logic change.

### 3. `src/providers/cctp/cctpV2Adapter.ts`
**Mismatch 1:** `const destinationCaller = \`0x${'00'.repeat(32)}\`` inferred as `string`, not `` `0x${string}` ``.  
**Fix:** Cast as `` `0x${string}` `` using the string concatenation form.

**Mismatch 2:** `encodeAbiParameters` / `parseAbiParameters` were imported and called in `addressToBytes32` but the result `encoded` was unused — the function returned the manual string directly.  
**Fix:** Removed the dead computation and the two unused imports. The function now just returns the padded literal directly.

### 4. `src/providers/stablefx/stableFxAdapter.ts`
**Mismatch:** `buildConvertActionFromQuote` accepted `walletAddress: Address` but `ConvertAction` has no `from` field, so the parameter was never used in the function body.  
**Fix:** Renamed to `_walletAddress` with a comment explaining why it's kept for caller ergonomics. No behaviour change.

### 5. `src/hooks/useConvertExecution.ts`
**Mismatch 1:** `action.from` was referenced at line 71 but `ConvertAction` has no `from` field.  
**Fix:** Removed state-based workaround. Changed `executeConvert` signature to accept an explicit `walletAddress: Address` parameter (matching normal hook patterns). The `walletAddress` field on the state interface is retained for the `fetchQuote` path but no longer read inside `executeConvert`.

**Mismatch 2:** `react-hooks/exhaustive-deps` — `state.walletAddress` was read inside `useCallback` without being in the dep array.  
**Fix:** Eliminated the dep entirely by accepting `walletAddress` as an explicit argument.

### 6. `src/components/pages/ConvertPage.tsx`
**Mismatch 1:** `policyResult.status` — field does not exist on `PolicyEvaluationResult`. Correct field is `decision`.  
**Fix:** `policyResult.status` → `policyResult.decision` (x2).

**Mismatch 2:** `riskResult.classification` — field does not exist on `RiskScoringResult`. Correct field is `level`.  
**Fix:** `riskResult.classification` → `riskResult.level` (x2).

**Mismatch 3:** `executeConvert` call site needed the new `walletAddress` param.  
**Fix:** Added `address` guard and passed it as the third argument.

### 7. `src/components/pages/BridgePage.tsx`
**Mismatch 1:** `useState(MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID)` inferred state type as the literal `11155111`, causing `setDestChainId(Number(...))` to fail.  
**Fix:** Explicit `useState<number>(...)`.

**Mismatch 2:** Same `policyResult.status` → `policyResult.decision` and `riskResult.classification` → `riskResult.level` drift as ConvertPage.  
**Fix:** Corrected both.

### 8. `src/tests/adversarialAgent.test.ts` (full rewrite of test file)
**Mismatches:**
- `findProvider` (not exported) → corrected to `getProvider`
- `result.intentType` (field does not exist on `IntentResult`) → corrected to `result.status`
- `IntentStatus` uses `'UNRECOGNISED'` not `'UNKNOWN'`
- `displaySummary` cap is `MAX_DISPLAY_SUMMARY_LENGTH = 200`, not 120 — test assertions corrected
- `checkProviderEligibility` arg order was `(providerId, chainId, asset, capability)` — corrected to `(providerId, capability, chainId, assetAddress?)`
- `as Record<string, unknown>` cast on a non-overlapping type — corrected to `as unknown as Record<string, unknown>`
- Implicit `any` in `.map` callbacks — added explicit `IntentCandidate` type
- `recipientRaw === null` assertion retained correctly (now valid because type allows `null`)

### 9. `src/tests/providerManifest.test.ts`
**Mismatch:** Tests expected `circle-swap` and `cctp-bridge` providers (Phase A placeholder IDs). Phase C replaced these with `circle-stablefx` (verified, enabled) and `cctp-v2-bridge` (verified, enabled).  
**Fix:** Replaced stale disabled-provider tests with tests that assert `circle-stablefx` is enabled with CONVERT capability and `cctp-v2-bridge` is enabled with BRIDGE capability. The `circle-unified-balance` disabled test was retained and strengthened.

### 10. `src/tests/providerRegistry.test.ts`
**Mismatch 1:** Test at line 82 checked `circle-swap` for `UNVERIFIED` status — `circle-swap` does not exist; replaced with `circle-unified-balance`.  
**Mismatch 2:** `findEligibleProvider('CONVERT')` test expected `found: false` — but `circle-stablefx` is now enabled, making it `found: true`. Test updated to assert the correct post-Phase-C result.

### 11. `.oxlintrc.json`
**Issue:** The second `oxlint --fix .` pass scanned `veyra-repo/` (the cloned repository in the workspace root), producing duplicate warnings.  
**Fix:** Added `"veyra-repo/**"` to `ignorePatterns`. No code change.

---

## APIs reconciled

| Drift site | Wrong (Phase C) | Correct (Phase A/B authority) |
|---|---|---|
| PolicyEvaluationResult field | `.status` | `.decision` |
| RiskScoringResult field | `.classification` | `.level` |
| ConvertAction field | `.from` | (field does not exist) |
| IntentResult field | `.intentType` | `.status` |
| IntentStatus value | `'UNKNOWN'` | `'UNRECOGNISED'` |
| `checkProviderEligibility` arg order | `(id, chainId, asset, cap)` | `(id, cap, chainId, asset?)` |
| Registry lookup export | `findProvider` | `getProvider` |
| `displaySummary` max length | 120 | 200 |
| Provider ID | `circle-swap` | `circle-stablefx` |
| Provider ID | `cctp-bridge` | `cctp-v2-bridge` |
| `Set<literal>.has(number)` | unwidened | `Set<number>` |
| Template literal type | `string` | `` `0x${string}` `` |

---

## Core architecture changes

None. The authoritative Phase A/B engines (`policyEngine`, `riskEngine`, `actionSchema`, `receiptTypes`, `providerRegistry`) were not modified.

---

## Test totals

| Suite | Tests |
|---|---|
| env | 3 |
| securityConfig | 18 |
| securityGate | 14 |
| providerManifest | 16 |
| providerRegistry | 18 |
| actionSchema | 20 |
| policyEngine | 19 |
| riskEngine | 24 |
| intentSchema | 24 |
| receiptId | 15 |
| quoteReplayStore | 18 |
| adversarialAgent | 27 |
| **Total** | **216 / 216** |

---

## Final results

| Check | Result |
|---|---|
| TypeScript | **0 errors** |
| Lint (oxlint) | **0 errors, 9 warnings (all pre-existing set-state-in-effect)** |
| Tests | **216 / 216 passing** |
| Production build | **Clean (`✓ built in 13.63s`)** |
| Dev server | **Running (PID 2054)** |
