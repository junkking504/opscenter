// Browser automation requires the Mission Control runtime and local profiles.
// Only the Cloudflare build replaces the local-browser module to this fail-closed adapter.
function unavailable() {
  throw new Error("Browser automation requires Mission Control; it is unavailable in Cloudflare Workers.");
}
exports.chromium = {
  launch: unavailable,
  launchPersistentContext: unavailable,
  executablePath: unavailable,
};
