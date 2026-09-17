import {runOperationalAgents} from '../lib/operational-agents';
import {runTruckAgents} from '../lib/truck-agents';
if(process.env.OPSCENTER_AGENT_LOCK_HELD!=='1')throw new Error('Run through run-operational-agents.py to acquire the ownership lock.');
const date=process.argv[2];
try {
  const result=runOperationalAgents(date);
  console.log(JSON.stringify({date:result.date,updatedAt:result.updatedAt,agents:Object.fromEntries(Object.entries(result.agents).map(([name,state])=>[name,{status:state.status,lastSuccessAt:state.lastSuccessAt,error:state.error}]))}));
} catch {console.error('Visit/cost assessment failed; prior state retained.');process.exitCode=1;}
try {
  const result=runTruckAgents(date);
  console.log(JSON.stringify({truckAgents:result.agents.map(a=>({id:a.id,status:a.status,recommendations:a.recommendations.length})),heartbeatAt:result.heartbeatAt}));
} catch {console.error('Truck agent assessment failed; prior truck state retained.');process.exitCode=1;}
