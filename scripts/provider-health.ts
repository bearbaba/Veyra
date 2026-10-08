import { refreshMainnetProviderHealth } from '../server/services/providerHealthService.js';

const report = await refreshMainnetProviderHealth(process.env);
console.log(JSON.stringify(report, null, 2));
if (report.providerRecords.length === 0 || report.providerRecords.some((record) => record.status !== 'OK')) process.exit(1);
