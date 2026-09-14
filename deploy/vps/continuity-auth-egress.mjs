/** The recovery app may contact only its existing Cloudflare Access issuer. */
import http from 'node:http';
import net from 'node:net';
import {pathToFileURL} from 'node:url';
export function allowedAuthority(authority, host) {
  return /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(host || '') && authority === `${host}:443`;
}
export function createAuthEgress(host) {
  if (!allowedAuthority(`${host}:443`, host)) throw new Error('A single Cloudflare Access team hostname is required');
  const server = http.createServer((_req,res) => {res.writeHead(403);res.end('Only the configured authentication TLS tunnel is permitted.');});
  let active=0;
  server.on('connect', (request, socket, head) => {
    if (!allowedAuthority(request.url,host) || active>=64) {socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
    active++;
    const remote=net.connect(443,host);
    remote.setTimeout(15000,()=>remote.destroy());socket.setTimeout(15000,()=>socket.destroy());
    remote.on('connect',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);remote.pipe(socket);socket.pipe(remote);});
    remote.on('error',()=>socket.destroy());socket.on('error',()=>remote.destroy());
    remote.on('close',()=>{active--;socket.destroy();});socket.on('close',()=>remote.destroy());
  });
  return server;
}
function createAppIngress() {
  return net.createServer(socket => {
    const upstream=net.connect(3000,'app');
    socket.setTimeout(90000,()=>socket.destroy());upstream.setTimeout(90000,()=>upstream.destroy());
    socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());
    socket.on('close',()=>upstream.destroy());upstream.on('close',()=>socket.destroy());
    socket.pipe(upstream);upstream.pipe(socket);
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(process.argv.includes('--ingress')) createAppIngress().listen(3000,'0.0.0.0');
  else createAuthEgress(process.env.CONTINUITY_AUTH_HOST).listen(3128,'0.0.0.0');
}
