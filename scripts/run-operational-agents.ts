if(process.env.OPSCENTER_AGENT_LOCK_HELD!=='1')throw new Error('Run through run-operational-agents.py to acquire the ownership lock.');
async function main() {
  const date=process.argv[2],stage=process.argv[3];
  if(stage==='shared') {
    const {runOperationalAgents}=await import('../lib/operational-agents');
    const result=runOperationalAgents(date);
    console.log(JSON.stringify({stage,date:result.date,updatedAt:result.updatedAt,statuses:Object.fromEntries(Object.entries(result.agents).map(([id,a])=>[id,a.status]))}));
  }else if(stage==='trucks') {
    const {runTruckAgents}=await import('../lib/truck-agents');
    const result=runTruckAgents(date);
    console.log(JSON.stringify({stage,heartbeatAt:result.heartbeatAt,agents:result.agents.length}));
  }else if(stage==='hierarchy') {
    const {runHierarchy}=await import('../lib/agent-hierarchy-inputs');
    const result=await runHierarchy(date);
    console.log(JSON.stringify({stage,checkedAt:result.checkedAt,agents:result.agents.length,issues:result.issues.length}));
  }else throw new Error('Choose shared, trucks or hierarchy stage.');
}
main().catch(()=>{console.error('Local agent assessment failed; prior state retained.');process.exitCode=1;});
