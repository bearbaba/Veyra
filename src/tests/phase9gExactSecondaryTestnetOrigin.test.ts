import {describe,expect,it} from 'vitest';
import {readServerRuntimeConfig,validateServerRuntimeConfig} from '../../server/config/runtimeConfig';

const env:NodeJS.ProcessEnv={
  VEYRA_ENV:'testnet',NODE_ENV:'production',VEYRA_HOSTED_BACKEND:'1',
  VEYRA_DATABASE_PRIVATE_NETWORK:'1',DATABASE_URL:'postgresql://app:pw@db.internal/veyra',
  VEYRA_SESSION_SECRET:'abcdefghijklmnopqrstuvwxyz012345',
  VEYRA_APP_ORIGIN:'https://veyra-identity.example',
};

describe('secondary Veyra website only in guarded testnet runtime',()=>{
  it('allows one exact named testnet integration origin and leaves primary intact',()=>{
    const withSecondary={...env,VEYRA_TESTNET_ADDITIONAL_ORIGIN:'https://veyra-full-testnet.example'};
    expect(validateServerRuntimeConfig(withSecondary).ok).toBe(true);
    const cfg=readServerRuntimeConfig(withSecondary);
    expect(cfg.appOrigin).toBe(env.VEYRA_APP_ORIGIN);
    expect(cfg.testnetSecondaryAppOrigin).toBe('https://veyra-full-testnet.example');
  });
  it('rejects malformed URLs, wildcard, duplicate origin and comma lists',()=>{
    for(const value of [
      '*','http://veyra-full-testnet.example','https://veyra-full-testnet.example/',
      'https://veyra-full-testnet.example/path',
      'https://veyra-full-testnet.example?x=1',
      'https://veyra-identity.example',
      'https://veyra-one.example,https://veyra-two.example',
      'https://user:password@veyra-full-testnet.example',
    ]){
      const result=validateServerRuntimeConfig({...env,VEYRA_TESTNET_ADDITIONAL_ORIGIN:value});
      expect(result.ok, value).toBe(false);
    }
  });
  it('never extends mainnet CORS trust through testnet-only configuration',()=>{
    const result=validateServerRuntimeConfig({
      ...env,VEYRA_ENV:'mainnet',VEYRA_TESTNET_ADDITIONAL_ORIGIN:'https://veyra-full-testnet.example',
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Mainnet must not allow VEYRA_TESTNET_ADDITIONAL_ORIGIN.');
  });
});
