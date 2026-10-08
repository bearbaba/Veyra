import { PROVIDER_MANIFEST } from '../src/providers/registry/providerManifest.js';
import { getAllProviderHealthRecords } from '../src/providers/registry/providerRegistry.js';
import { probeDatabaseReadiness } from '../server/readiness/databaseReadiness.js';
import { evaluateMainnetReadiness } from '../server/readiness/mainnetReadiness.js';
import { refreshMainnetProviderHealth } from '../server/services/providerHealthService.js';

const database = await probeDatabaseReadiness(process.env.DATABASE_URL);
await refreshMainnetProviderHealth(process.env).catch(() => undefined);
const report = evaluateMainnetReadiness(process.env, PROVIDER_MANIFEST, {
  database,
  providerHealth: getAllProviderHealthRecords(),
});
console.log(JSON.stringify(report, null, 2));
if (!report.ready) process.exit(1);
