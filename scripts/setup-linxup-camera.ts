import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const setupToken = randomBytes(24).toString("hex");
const setupPath = `/linxup-camera/${setupToken}`;
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect LinxUp to OpsCenter</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101820;color:#fff;font:16px system-ui;padding:24px;box-sizing:border-box}
main{width:min(460px,100%);background:#fff;color:#101820;padding:30px;border-radius:18px;box-shadow:0 24px 80px #0008}
h1{margin:0 0 8px;font-size:1.55rem}p{color:#52606b;line-height:1.5}label{display:grid;gap:7px;margin-top:18px;font-weight:650}
input{font:inherit;padding:12px;border:1px solid #aeb7bf;border-radius:9px}button{width:100%;margin-top:22px;padding:13px;border:0;border-radius:9px;background:#eb0028;color:#fff;font:700 16px system-ui;cursor:pointer}
small{display:block;margin-top:16px;color:#66737d;line-height:1.45}.brand{color:#eb0028;font-weight:800;letter-spacing:.08em;text-transform:uppercase;font-size:.75rem}
</style></head><body><main><div class="brand">Junk King OpsCenter</div><h1>Connect LinxUp live cameras</h1>
<p>Enter the same login used for the LinxUp portal. The credentials go directly to Mission Control Keychain and are never displayed in OpsCenter.</p>
<form method="post" action="${setupPath}" autocomplete="on"><label>Email<input name="username" type="email" required autocomplete="username" autofocus></label>
<label>Password<input name="password" type="password" required autocomplete="current-password"></label><button type="submit">Save securely and connect</button></form>
<small>This one-time page is available only from this Mac and closes after saving.</small></main></body></html>`;

function headers(response: ServerResponse, status: number, contentType = "text/html; charset=utf-8"): void {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
}

async function requestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new Error("Request is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
  if (requestUrl.pathname !== setupPath) {
    headers(response, 404, "text/plain; charset=utf-8");
    response.end("Not Found");
    return;
  }
  if (request.method === "GET") {
    headers(response, 200);
    response.end(html);
    return;
  }
  if (request.method !== "POST") {
    headers(response, 405, "text/plain; charset=utf-8");
    response.end("Method Not Allowed");
    return;
  }

  try {
    const form = new URLSearchParams(await requestBody(request));
    const username = String(form.get("username") || "").trim();
    const password = String(form.get("password") || "");
    if (!username || !password) throw new Error("Email and password are required.");

    execFileSync("/usr/bin/security", ["add-generic-password", "-U", "-a", "opscenter", "-s", "com.opscenter.linxup-portal-username", "-w", username], { stdio: "ignore" });
    execFileSync("/usr/bin/security", ["add-generic-password", "-U", "-a", "opscenter", "-s", "com.opscenter.linxup-portal-password", "-w", password], { stdio: "ignore" });

    headers(response, 200);
    response.end("<!doctype html><meta charset=utf-8><title>Connected</title><style>body{font:18px system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#101820;color:white;text-align:center}strong{color:#ff4968;font-size:1.4rem}</style><div><strong>LinxUp connected.</strong><p>You may close this tab and return to OpsCenter.</p></div>");
    console.log("LinxUp camera credentials saved securely in Mission Control Keychain.");
    setTimeout(() => server.close(), 250);
  } catch (error) {
    void error;
    headers(response, 400);
    response.end("<h1>Could not save credentials</h1><p>Mission Control Keychain did not accept the update. Please retry.</p>");
  }
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start local setup page.");
  console.log(`Open http://127.0.0.1:${address.port}${setupPath}`);
});

setTimeout(() => {
  console.error("LinxUp camera setup timed out without saving credentials.");
  server.close();
}, 10 * 60_000).unref();
