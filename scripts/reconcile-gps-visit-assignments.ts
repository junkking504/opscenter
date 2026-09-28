import {reconcileVisitedAssignments} from '../lib/gps-visit-assignment';
const date=process.argv[2];
if(process.env.OPSCENTER_GPS_ASSIGNMENT_LOCK_HELD!=='1') throw new Error('Use the GPS assignment worker launcher.');
reconcileVisitedAssignments(date).then(results=>console.log(JSON.stringify({date,results}))).catch(()=>{
  console.error('GPS assignment reconciliation needs review; pending source changes will not be replayed.');
  process.exitCode=1;
});
