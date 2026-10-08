import { PROVIDER_MANIFEST } from '../src/providers/registry/providerManifest.js';
import { getAllProviderHealthRecords } from '../src/providers/registry/providerRegistry.js';
import { probeDatabaseReadiness } from '../server/readiness/databaseReadiness.js';
import { evaluateMainnetReadiness } from '../server/readiness/mainnetReadiness.js';
import { probeSignerReadiness } from '../server/readiness/signerReadiness.js';
import { refreshMainnetProviderHealth } from '../server/services/providerHealthService.js';

const [database, signer] = await Promise.all([
  probeDatabaseReadiness(process.env.DATABASE_URL),
  probeSignerReadiness(process.env),
]);
await refreshMainnetProviderHealth(process.env).catch(() => undefined);
const report = evaluateMainnetReadiness(process.env, PROVIDER_MANIFEST, {
  database,
  signer,
  providerHealth: getAllProviderHealthRecords(),
});
console.log(JSON.stringify({ ...report, signer: signer.health }, null, 2));
if (!report.ready) process.exit(1);
