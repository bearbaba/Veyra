import { describe, expect, it } from 'vitest';
import { estimateSignatureBudget } from '../core/router/signatureBudget';

describe('Phase 4B signature budget', () => {
  it('never adds a Veyra-only wallet signature', () => {
    const budget = estimateSignatureBudget({
      capability: 'BRIDGE',
      providerId: 'circle-appkit-bridge',
      allowance: 'SUFFICIENT',
      destinationRelayAvailable: true,
      sourceSwitchAutomated: true,
    });
    expect(budget.veyraAddedSignatures).toBe(0);
  });

  it('budgets a forwarded bridge without destination signing', () => {
    const budget = estimateSignatureBudget({
      capability: 'BRIDGE',
      providerId: 'circle-appkit-bridge',
      allowance: 'SUFFICIENT',
      destinationRelayAvailable: true,
      sourceSwitchAutomated: true,
    });
    expect(budget.sourceSignatures).toBe(1);
    expect(budget.destinationSignatures).toBe(0);
    expect(budget.manualNetworkSwitches).toBe(0);
  });

  it('conservatively counts approval when allowance is unknown', () => {
    const budget = estimateSignatureBudget({
      capability: 'BRIDGE',
      providerId: 'cctp-v2-bridge',
      allowance: 'UNKNOWN',
      destinationRelayAvailable: true,
      sourceSwitchAutomated: true,
    });
    expect(budget.protocolSignatures).toBe(2);
  });

  it('budgets unified forwarded spend as one source signature', () => {
    const budget = estimateSignatureBudget({
      capability: 'UNIFIED',
      operation: 'UNIFIED_SPEND',
      providerId: 'circle-appkit-unified-balance',
      destinationRelayAvailable: true,
      sourceSwitchAutomated: true,
    });
    expect(budget.protocolSignatures).toBe(1);
    expect(budget.destinationSignatures).toBe(0);
  });

  it('keeps read-only Earn discovery signature free', () => {
    const budget = estimateSignatureBudget({
      capability: 'EARN',
      operation: 'EARN_DISCOVER',
      providerId: 'circle-appkit-earn',
    });
    expect(budget.protocolSignatures).toBe(0);
    expect(budget.manualNetworkSwitches).toBe(0);
  });
});
