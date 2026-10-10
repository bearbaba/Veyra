/**
 * Tests: src/lib/securityConfig.ts
 */
import { describe, it, expect } from 'vitest';
import { SECURITY_CONFIG } from '../lib/securityConfig.js';

describe('SECURITY_CONFIG', () => {
  it('has a positive MAX_BALANCE_AGE_MS', () => {
    expect(SECURITY_CONFIG.MAX_BALANCE_AGE_MS).toBeGreaterThan(0);
  });

  it('has a positive MAX_PROVIDER_HEALTH_AGE_MS', () => {
    expect(SECURITY_CONFIG.MAX_PROVIDER_HEALTH_AGE_MS).toBeGreaterThan(0);
  });

  it('has a positive MAX_PROVENANCE_AGE_MS', () => {
    expect(SECURITY_CONFIG.MAX_PROVENANCE_AGE_MS).toBeGreaterThan(0);
  });

  it('has a positive QUOTE_EXPIRY_BUFFER_MS', () => {
    expect(SECURITY_CONFIG.QUOTE_EXPIRY_BUFFER_MS).toBeGreaterThan(0);
  });

  it('has a positive QUOTE_RESERVATION_TIMEOUT_MS', () => {
    expect(SECURITY_CONFIG.QUOTE_RESERVATION_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('has a positive QUOTE_REPLAY_RETENTION_MS', () => {
    expect(SECURITY_CONFIG.QUOTE_REPLAY_RETENTION_MS).toBeGreaterThan(0);
  });

  it('has a positive ACTION_EXECUTION_RESERVATION_TIMEOUT_MS', () => {
    expect(SECURITY_CONFIG.ACTION_EXECUTION_RESERVATION_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('DEFAULT_MAX_SLIPPAGE_BPS is within 0–500', () => {
    expect(SECURITY_CONFIG.DEFAULT_MAX_SLIPPAGE_BPS).toBeGreaterThan(0);
    expect(SECURITY_CONFIG.DEFAULT_MAX_SLIPPAGE_BPS).toBeLessThanOrEqual(500);
  });

  it('HARD_MAX_SLIPPAGE_BPS >= DEFAULT_MAX_SLIPPAGE_BPS', () => {
    expect(SECURITY_CONFIG.HARD_MAX_SLIPPAGE_BPS).toBeGreaterThanOrEqual(
      SECURITY_CONFIG.DEFAULT_MAX_SLIPPAGE_BPS,
    );
  });

  it('DEFAULT_MAX_RISK_SCORE is 0–100', () => {
    expect(SECURITY_CONFIG.DEFAULT_MAX_RISK_SCORE).toBeGreaterThanOrEqual(0);
    expect(SECURITY_CONFIG.DEFAULT_MAX_RISK_SCORE).toBeLessThanOrEqual(100);
  });

  it('RISK_CONFIRMATION_THRESHOLD < DEFAULT_MAX_RISK_SCORE', () => {
    expect(SECURITY_CONFIG.RISK_CONFIRMATION_THRESHOLD).toBeLessThan(
      SECURITY_CONFIG.DEFAULT_MAX_RISK_SCORE,
    );
  });

  it('has a positive DEFAULT_MAX_SINGLE_TX_USDC', () => {
    expect(SECURITY_CONFIG.DEFAULT_MAX_SINGLE_TX_USDC).toBeGreaterThan(0);
  });

  it('has a positive DEFAULT_MAX_DAILY_SPEND_USDC', () => {
    expect(SECURITY_CONFIG.DEFAULT_MAX_DAILY_SPEND_USDC).toBeGreaterThan(0);
  });

  it('DEFAULT_MAX_DAILY_SPEND_USDC >= DEFAULT_MAX_SINGLE_TX_USDC', () => {
    expect(SECURITY_CONFIG.DEFAULT_MAX_DAILY_SPEND_USDC).toBeGreaterThanOrEqual(
      SECURITY_CONFIG.DEFAULT_MAX_SINGLE_TX_USDC,
    );
  });

  it('has a positive SECURITY_GATE_TIMEOUT_MS', () => {
    expect(SECURITY_CONFIG.SECURITY_GATE_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('has SIMULATION_REQUIRED_BY_DEFAULT as boolean', () => {
    expect(typeof SECURITY_CONFIG.SIMULATION_REQUIRED_BY_DEFAULT).toBe('boolean');
  });

  it('has a positive BRIDGE_DESTINATION_TIMEOUT_MS', () => {
    expect(SECURITY_CONFIG.BRIDGE_DESTINATION_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('has a positive BRIDGE_POLL_INTERVAL_MS', () => {
    expect(SECURITY_CONFIG.BRIDGE_POLL_INTERVAL_MS).toBeGreaterThan(0);
  });

  it('BRIDGE_POLL_INTERVAL_MS < BRIDGE_DESTINATION_TIMEOUT_MS', () => {
    expect(SECURITY_CONFIG.BRIDGE_POLL_INTERVAL_MS).toBeLessThan(
      SECURITY_CONFIG.BRIDGE_DESTINATION_TIMEOUT_MS,
    );
  });
});
