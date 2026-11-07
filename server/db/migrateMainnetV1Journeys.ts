import {runApprovedV1Migration} from './mainnetV1JourneysUpgrade.js';
runApprovedV1Migration().catch(e=>{
 console.error('[v1-0023] blocked:',e instanceof Error?e.message:'unknown');
 process.exitCode=1;
});
