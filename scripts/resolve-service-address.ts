// The separately owned GPS/visit collector uses the same full-field verifier
// as Schedule and routing. Input stays on stdin, out of process arguments.
import { verifyDesktopAddress } from '../lib/desktop-address-verification';
async function main() {
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if(input.length>16_000) throw new Error('Address input too large.'); }
  const body = JSON.parse(input);
  if (typeof body.address !== 'string' || body.address.length > 4000) throw new Error('Invalid address.');
  process.stdout.write(JSON.stringify(await verifyDesktopAddress(body.address)));
}
main().catch(()=>{process.stderr.write('Address verification unavailable.\n');process.exitCode=1;});
