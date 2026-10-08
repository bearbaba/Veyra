import { probeSignerReadiness } from '../server/readiness/signerReadiness.js';

const report = await probeSignerReadiness(process.env);
console.log(JSON.stringify(report, null, 2));
if (!report.ready) process.exit(1);
