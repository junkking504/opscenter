import {runOperationalAgents} from '../lib/operational-agents';
if(process.env.OPSCENTER_AGENT_LOCK_HELD!=='1')throw new Error('Run through run-operational-agents.py to acquire the ownership lock.');
const result=runOperationalAgents(process.argv[2]);
console.log(JSON.stringify({date:result.date,updatedAt:result.updatedAt,agents:Object.fromEntries(Object.entries(result.agents).map(([name,state])=>[name,{status:state.status,lastSuccessAt:state.lastSuccessAt,error:state.error}]))}));
