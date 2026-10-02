import path from "node:path";
import { fileURLToPath } from "node:url";

const cloudflareBuild = process.env.OPSCENTER_BUILD_TARGET === "cloudflare";
const projectDirectory = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { webpackMemoryOptimizations: true, webpackBuildWorker: true },
  outputFileTracingExcludes: { "*": ["./data/**/*", "./logs/**/*"] },
  // OpenNext bundles imports that Next's minimal server trace omits.
  ...(cloudflareBuild ? {
    outputFileTracingIncludes: {
      "/*": [
        "./node_modules/next/dist/lib/metadata/**/*.js",
        "./node_modules/next/dist/server/dev/browser-logs/**/*.js",
      ],
    },
  } : {}),
  webpack(config, { dev, isServer, nextRuntime, webpack }) {
    if (cloudflareBuild && isServer) {
      const unavailableBrowser = path.join(projectDirectory, "lib/cloudflare-browser-unavailable.cjs");
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(
        /^@\/lib\/local-browser$/,
        unavailableBrowser,
      ));
    }
    if (!dev && isServer && nextRuntime !== "edge") {
      // Runtime data is linked by the deployment controller, never bundled.
      // Next 16 applies outputFileTracingExcludes after its entrypoint scan.
      const tracer = config.plugins.find(plugin => plugin?.constructor?.name === "TraceEntryPointsPlugin");
      if (!tracer || !Array.isArray(tracer.traceIgnores)) {
        throw new Error("Review runtime-data tracing exclusions for this Next.js version.");
      }
      tracer.traceIgnores.push("**/data/**", "**/logs/**");
    }
    return config;
  },
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async headers() {
    return [{ source: '/desktop-assets/assets/:asset', headers: [
      { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
    ] }];
  }
};

export default nextConfig;
