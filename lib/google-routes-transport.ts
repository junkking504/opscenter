import { request, type RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';

type SendRequest = (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;

// The server key is restricted to our approved IPv4 egress. Scope this to
// Google Routes instead of disabling IPv6 globally or weakening key security.
export function requestGoogleRouteMatrix(apiKey: string, body: string, send: SendRequest = request): Promise<unknown[] | null> {
  return new Promise(resolve => {
    const req = send({
      hostname: 'routes.googleapis.com',
      path: '/distanceMatrix/v2:computeRouteMatrix',
      method: 'POST',
      family: 4,
      signal: AbortSignal.timeout(25_000),
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,status,condition,distanceMeters,duration',
      },
    }, response => {
      response.on('error', () => resolve(null));
      response.on('aborted', () => resolve(null));
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        resolve(null);
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 1_048_576) {
          resolve(null);
          response.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(Array.isArray(payload) ? payload : null);
        } catch { resolve(null); }
      });
    });
    // Never log the request, raw errors, or headers: they contain the API key.
    req.on('error', () => resolve(null));
    req.end(body);
  });
}
