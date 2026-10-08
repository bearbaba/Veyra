import { PROVIDER_MANIFEST } from '../src/providers/registry/providerManifest.js';
import { evaluateMainnetReadiness } from '../server/readiness/mainnetReadiness.js';

const report = evaluateMainnetReadiness(process.env, PROVIDER_MANIFEST);
console.log(JSON.stringify(report, null, 2));
if (!report.ready) process.exitCode = 1;
