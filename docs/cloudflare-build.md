# Cloudflare Worker build

Mission Control production uses the immutable local release controller and
`npm run build`. The separate Git-connected Worker integrations run
`npm run cf-build`; that command sets `OPSCENTER_BUILD_TARGET=cloudflare` for
OpenNext and its child Next.js build. `deploy` and `preview` reuse that command.

The Worker build includes Next.js metadata and browser-log modules explicitly
in the output trace. OpenNext's server bundler needs these internal imports even
when Next's minimal trace omits them. Keep the traced paths under review when
updating Next.js or OpenNext.

Local Playwright automation uses installed Chrome, local browser profiles and
Mission Control facilities. Cloudflare's server build replaces the shared local-browser
entrypoint used by the application to an adapter that throws a clear runtime
error. This prevents unsupported local browser code and its optional BiDi
imports from entering the Worker bundle. It does not implement browser-backed
uploads or camera sessions in Workers. Those workflows continue to require
Mission Control; the normal local build retains the real Playwright modules.
No provider or remote browser service is added.

Validate with `node scripts/test-cloudflare-build-boundary.mjs` and
`npm run cf-build`. A successful local build is separate from publishing a Worker
version or changing production routing.
