/** Safety boundary: a Mainnet container never silently becomes a Testnet BFF.
 * This file does not create DB resources or apply migrations.
 */
import {assertServerRuntimeConfig} from './config/runtimeConfig.js';
import {OFFICIAL_VEYRA_ORIGIN} from './services/mainnetIdentityCapability.js';
const config=assertServerRuntimeConfig();
if(config.environment!=='mainnet'||!config.hostedBackend||
   config.appOrigin!==OFFICIAL_VEYRA_ORIGIN||
   process.env.RELAY_PRIVATE_KEY||process.env.VEYRA_TESTNET_ADDITIONAL_ORIGIN)
 throw Error('Dedicated Mainnet BFF requires exact official Veyra origin and isolated hosted environment.');
await import('./bff.js');
