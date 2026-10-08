import { probeDatabaseReadiness } from '../server/readiness/databaseReadiness.js';

const report = await probeDatabaseReadiness(process.env.DATABASE_URL);
console.log(JSON.stringify(report, null, 2));
if (!report.ready) process.exit(1);
