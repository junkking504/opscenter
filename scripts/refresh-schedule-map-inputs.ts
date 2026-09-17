// Compatibility entrypoint; both schedulers share the address agent's lock.
import {execFileSync} from 'node:child_process';
import {runAddressVerificationAgent} from '../lib/address-verification-agent';
async function main(){
  if(process.env.OPSCENTER_ADDRESS_AGENT_LOCK_HELD!=='1') {
    process.stdout.write(execFileSync('python3',['scripts/run-address-verification-agent.py',...process.argv.slice(2)],{encoding:'utf8',timeout:100_000}));
    return;
  }
  const state=await runAddressVerificationAgent(process.argv[2]);
  console.log(JSON.stringify({agent:state.agentId,status:state.status,checked:state.checked,verified:state.verified,pending:Object.values(state.items).filter(i=>i.status==='pending').length}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Address verification failed');process.exitCode=1;});
