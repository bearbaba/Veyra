import { describe, expect, it, vi } from 'vitest';
import {
  REQUIRED_DATABASE_MIGRATIONS,
  REQUIRED_PHASE5_RECEIPT_COLUMNS,
  REQUIRED_PRODUCTION_TABLES,
  assessDatabaseSnapshot,
} from '../../server/readiness/databaseReadiness.js';
import {
  REQUIRED_TESTNET_RPCS,
  evaluateTestnetReadiness,
  probeTestnetRpcEndpoints,
  type TestnetRpcCheck,
} from '../../server/readiness/testnetReadiness.js';

const env: NodeJS.ProcessEnv = {
  VEYRA_ENV: 'testnet',
  NODE_ENV: 'production',
  VEYRA_HOSTED_BACKEND: '1',
  DATABASE_URL: 'postgresql://u:example@db.example.com/veyra?sslmode=require',
  VEYRA_SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  VEYRA_APP_ORIGIN: 'https://app.example.com',
  ARC_TESTNET_RPC_URL: 'https://arc.example.com/rpc',
  ETH_SEPOLIA_RPC_URL: 'https://eth.example.com/key-sensitive-eth',
  BASE_SEPOLIA_RPC_URL: 'https://base.example.com/rpc',
};

function readyDb() {
  return assessDatabaseSnapshot({
    connected: true,
    tables: [...REQUIRED_PRODUCTION_TABLES],
    activityReceiptColumns: [...REQUIRED_PHASE5_RECEIPT_COLUMNS],
    drizzleMigrationCount: REQUIRED_DATABASE_MIGRATIONS,
  });
}
function readyRpc(): TestnetRpcCheck[] {
  return REQUIRED_TESTNET_RPCS.map(({ id, chainId }) => ({
    id, chainId, ok: true, detail: 'Pinned testnet RPC chain ID verified.',
  }));
}

describe('Phase 5 real hosted testnet readiness is NOT mainnet readiness', () => {
  it('fails closed on a database with only historical migrations or missing retry tables', () => {
    expect(REQUIRED_DATABASE_MIGRATIONS).toBe(13);
    expect(REQUIRED_PRODUCTION_TABLES).toContain('bridge_destination_retry_verifications');
    expect(REQUIRED_PRODUCTION_TABLES).toContain('bridge_destination_attempt_resolutions');

    for (const count of [0, 5, 6, 12]) {
      const report = assessDatabaseSnapshot({
        connected: true,
        tables: [...REQUIRED_PRODUCTION_TABLES],
        activityReceiptColumns: [...REQUIRED_PHASE5_RECEIPT_COLUMNS],
        drizzleMigrationCount: count,
      });
      expect(report.ready).toBe(false);
      expect(report.checks.find((check) => check.id === 'drizzle-migrations')?.ok).toBe(false);
    }
    const incomplete = assessDatabaseSnapshot({
      connected: true,
      tables: REQUIRED_PRODUCTION_TABLES.filter((name) => name !== 'bridge_destination_retry_verifications'),
      activityReceiptColumns: [...REQUIRED_PHASE5_RECEIPT_COLUMNS],
      drizzleMigrationCount: 13,
    });
    expect(incomplete.ready).toBe(false);
    expect(incomplete.checks.find((c) => c.id === 'database-schema')?.ok).toBe(false);
  });

  it('refuses an old activity receipt schema even with 13 migration records', () => {
    const report = assessDatabaseSnapshot({
      connected: true,
      tables: [...REQUIRED_PRODUCTION_TABLES],
      activityReceiptColumns: ['settlement_receive_tx_hash'],
      drizzleMigrationCount: 13,
    });
    expect(report.ready).toBe(false);
    expect(report.checks.find((c) => c.id === 'phase5-settlement-columns')?.ok).toBe(false);
    expect(report.checks.find((c) => c.id === 'phase5-settlement-columns')?.detail)
      .toContain('settlement_attempt_number');
  });

  it('reports infrastructure-only success without claiming any signed financial E2E', () => {
    const report = evaluateTestnetReadiness(env, readyDb(), readyRpc());
    expect(report.ready).toBe(true);
    expect(report.environment).toBe('testnet');
    expect(report.scope).toBe('infrastructure-only');
    expect(report.financialAcceptanceReady).toBe(false);
    expect(report.capabilities.convert).toBe('disabled-pending-e2e');
    expect(report.capabilities.cctpBridge).toBe('requires-signed-e2e');
    expect(report.checks.filter((check) => check.id.startsWith('testnet-rpc-'))).toHaveLength(3);
    expect(REQUIRED_TESTNET_RPCS.map((r) => r.chainId)).toEqual([5042002, 11155111, 84532]);
  });

  it('rejects missing DB, missing/wrong/duplicated RPC probes and absent hosted credentials', () => {
    expect(evaluateTestnetReadiness(env, readyDb(), readyRpc().slice(0, 2)).ready).toBe(false);
    const bad = readyRpc().map((check, index) => (
      index === 1 ? { ...check, chainId: 1 } : check
    ));
    expect(evaluateTestnetReadiness(env, readyDb(), bad).ready).toBe(false);
    expect(evaluateTestnetReadiness(env, readyDb(), [...readyRpc(), readyRpc()[0]]).ready).toBe(false);
    expect(evaluateTestnetReadiness(env, assessDatabaseSnapshot({
      connected: false, tables: [], error: 'unavailable',
    }), readyRpc()).ready).toBe(false);
    expect(evaluateTestnetReadiness({
      ...env, VEYRA_SESSION_SECRET: '',
    }, readyDb(), readyRpc()).ready).toBe(false);
    expect(evaluateTestnetReadiness({
      ...env, VEYRA_ENV: 'mainnet',
    }, readyDb(), readyRpc()).ready).toBe(false);
  });

  it('checks exact RPC eth_chainId on Arc, Ethereum Sepolia and Base Sepolia', async () => {
    const called: string[] = [];
    const mock = vi.fn((url: unknown, init: unknown) => {
      const rpcUrl = String(url);
      const request = JSON.parse((init as { body: string }).body) as { method: string };
      expect(request.method).toBe('eth_chainId');
      called.push(rpcUrl);
      const answer = rpcUrl.includes('arc.') ? 5042002
        : rpcUrl.includes('eth.') ? 11155111 : 84532;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: `0x${answer.toString(16)}` }),
      });
    });
    const probes = await probeTestnetRpcEndpoints(env, mock as unknown as typeof fetch);
    expect(probes.map((r) => r.ok)).toEqual([true, true, true]);
    expect(called).toHaveLength(3);
    expect(called.some((url) => url.includes('eth.'))).toBe(true);
    expect(evaluateTestnetReadiness(env, readyDb(), probes).ready).toBe(true);
  });

  it('blocks wrong Arc chain, insecure RPC endpoints and never leaks URL secrets', async () => {
    const wrong = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ result: '0x1' }),
    }));
    const result = await probeTestnetRpcEndpoints(env, wrong as unknown as typeof fetch);
    expect(result[0].ok).toBe(false);
    expect(result[0].detail).toContain('does not match');
    const maliciousEnv = {
      ...env, ARC_TESTNET_RPC_URL: 'http://arc.example.com/secret-path',
      ETH_SEPOLIA_RPC_URL: 'https://user:password@eth.example.com',
    };
    const bad = await probeTestnetRpcEndpoints(maliciousEnv, wrong as unknown as typeof fetch);
    expect(bad[0].ok).toBe(false);
    expect(bad[1].ok).toBe(false);
    expect(bad[0].detail).not.toContain('secret-path');
    expect(bad[1].detail).not.toContain('password');
    const rejected = vi.fn(() => Promise.reject(new Error('RPC sensitive-key=12345')));
    const failed = await probeTestnetRpcEndpoints(env, rejected as unknown as typeof fetch);
    expect(failed.map((x) => x.ok)).toEqual([false, false, false]);
    expect(JSON.stringify(failed)).not.toContain('sensitive-key');
    expect(JSON.stringify(failed)).not.toContain('key-sensitive-eth');
  });

  it('allows a loopback RPC only for developer mode and not public production hosting', async () => {
    const local = {
      ...env, NODE_ENV: 'development',
      ARC_TESTNET_RPC_URL: 'http://127.0.0.1:8545',
    };
    const mock = vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ result: '0x4cef52' }),
    }));
    const checks = await probeTestnetRpcEndpoints(local, mock as unknown as typeof fetch);
    expect(checks[0].detail).not.toContain('must be a secure HTTPS');
    const hosted = await probeTestnetRpcEndpoints({ ...local, NODE_ENV: 'production' },
      mock as unknown as typeof fetch);
    expect(hosted[0].ok).toBe(false);
  });
});
