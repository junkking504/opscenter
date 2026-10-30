/** Additional sources required by Apple's full-map library; absent when disabled.
 * Apple's documented CSP: developer.apple.com/documentation/mapkitjs/loading-the-latest-version-of-mapkit-js
 */
export function appleMapsCsp(enabled: boolean) {
  const maps = enabled ? 'https://*.apple-mapkit.com' : '';
  return {
    script: enabled ? 'https://cdn.apple-mapkit.com' : '',
    image: maps,
    connect: maps,
    // Keep the existing default-src/script-src fallback unchanged when off.
    directives: enabled ? [`worker-src 'self' blob: ${maps}`, `frame-src 'self' ${maps}`] : [],
  };
}
