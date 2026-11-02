import type {ServerRuntimeConfig} from '../config/runtimeConfig.js';
/** Only user-facing wallet origin. Internal Preview deployments never authorize ID. */
export const OFFICIAL_VEYRA_ORIGIN='https://veyra-seven-beta.vercel.app';
export type MainnetIdentityAuthority={
 ok:true;environment:'mainnet';origin:typeof OFFICIAL_VEYRA_ORIGIN;
 chainId:5042;walletLogin:true;recipientSnapshots:true;cookieRestore:true;
};
export function evaluateMainnetIdentityAuthority(
 config:Pick<ServerRuntimeConfig,'environment'|'nodeEnv'|'hostedBackend'|'appOrigin'|'sessionSecretConfigured'|'databaseUrl'|'testnetSecondaryAppOrigin'>,
 origin:string|undefined,
):MainnetIdentityAuthority|null{
 if(config.environment!=='mainnet'||config.nodeEnv!=='production'||!config.hostedBackend||
  config.appOrigin!==OFFICIAL_VEYRA_ORIGIN||origin!==OFFICIAL_VEYRA_ORIGIN||
  config.testnetSecondaryAppOrigin||!config.sessionSecretConfigured||!config.databaseUrl)return null;
 return {ok:true,environment:'mainnet',origin:OFFICIAL_VEYRA_ORIGIN,
  chainId:5042,walletLogin:true,recipientSnapshots:true,cookieRestore:true};
}
