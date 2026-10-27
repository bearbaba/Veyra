import { afterEach, describe, expect, it } from 'vitest';
import { getAuthenticatedVeyraUserId } from '../../server/auth/session';

const previous = {
  NODE_ENV: process.env.NODE_ENV,
  VEYRA_ENV: process.env.VEYRA_ENV,
  VEYRA_HOSTED_BACKEND: process.env.VEYRA_HOSTED_BACKEND,
};
afterEach(() => {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
const request = { header: (name: string) => name === 'x-veyra-user-id' ? 'usr_123456789AB' : undefined };

describe('simulated identity header isolation', () => {
  it('allows the local development identity fixture', () => {
    process.env.NODE_ENV = 'test';
    process.env.VEYRA_ENV = 'local';
    delete process.env.VEYRA_HOSTED_BACKEND;
    expect(getAuthenticatedVeyraUserId(request)).toBe('usr_123456789AB');
  });
  it.each([
    { node: 'development', environment: 'testnet', hosted: undefined },
    { node: 'development', environment: 'local', hosted: '1' },
    { node: 'development', environment: 'mainnet', hosted: undefined },
    { node: 'production', environment: 'local', hosted: undefined },
  ])('rejects unverified identity for $node / $environment / hosted=$hosted', ({ node, environment, hosted }) => {
    process.env.NODE_ENV = node;
    process.env.VEYRA_ENV = environment;
    if (hosted === undefined) delete process.env.VEYRA_HOSTED_BACKEND;
    else process.env.VEYRA_HOSTED_BACKEND = hosted;
    expect(getAuthenticatedVeyraUserId(request)).toBeNull();
  });
  it('never falls back from a supplied invalid bearer token', () => {
    process.env.NODE_ENV = 'test';
    process.env.VEYRA_ENV = 'local';
    delete process.env.VEYRA_HOSTED_BACKEND;
    const withBearer = { header: (name: string) => name === 'authorization' ? 'Bearer invalid.token' : request.header(name) };
    expect(getAuthenticatedVeyraUserId(withBearer)).toBeNull();
  });
});
