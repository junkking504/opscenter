# Installable OpsCenter App

OpsCenter is delivered as an installable Progressive Web App (PWA). It uses the
same authenticated production URL and backend as the browser application, but
launches from the device home screen or dock in its own app window.

## Install

Open `https://ops.junk-king.app` and sign in before installing.

- iPhone or iPad: tap **Menu**, choose **Install App**, then use Safari's
  **Share > Add to Home Screen** action.
- Mac Safari: open the sidebar, choose **Install App**, then use
  **File > Add to Dock**.
- Chrome or Edge: choose **Install App** in the OpsCenter sidebar. If the native
  prompt is unavailable, use **⋮ > Cast, save, and share > Install page as app**.

The installed app keeps the normal OpsCenter authentication boundary. If a
session expires, the app returns to the standard login screen.

## Live-data safety

The service worker does not cache OpsCenter pages, APIs, schedule data, GPS,
payroll, financial values, or customer records. Navigations always use the
network. If the network is unavailable, the app displays a static connection
screen and explicitly says that no operational data is available offline.

Only the offline screen and non-sensitive app icons are cached. This preserves
OpsCenter's rule that stale operational data must never look current.
If the device loses connectivity while OpsCenter is open, the app displays a
prominent offline banner and stops describing the device as online.

## Verify a release

Run the focused check and the normal application build:

```sh
npm run verify:pwa
npm run build
```

After deployment, verify all of these separately:

1. `https://ops.junk-king.app/manifest.webmanifest` returns the current manifest.
2. `https://ops.junk-king.app/sw.js` returns JavaScript with a revalidation cache header.
3. The browser offers **Install App** or the documented platform-specific action.
4. The installed app opens in standalone mode and reaches the authenticated OpsCenter.
5. With networking disabled, a new navigation shows the connection-required screen and no prior operational page.

## App Store path

This PWA is the shared app foundation. A later iOS or Android store package can
wrap the same production web app, but store distribution should be a separate
release because it adds Apple/Google developer accounts, signing, review,
device permissions, and update obligations.
