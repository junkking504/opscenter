# Google Reviews integration

OpsCenter tracks Google ratings and reviews without scraping Google Search. Its
authoritative newest-first feed uses the Google Business Profile API after a
one-time owner authorization. Until that connection is available, the Places
API (New) remains only a limited public sample; it must not be treated as the
complete newest review feed.

Each collection writes a current snapshot plus one daily historical snapshot.
The Marketing Reviews tab compares the current snapshot with the preceding
snapshot for the same Google place. A count change means the public total
changed between collections; it does not claim every new review is present in
Google's limited latest-review response.

The Reviews tab is a daily operational view: it shows the current collection
for each territory, newest to oldest. The Business Profile collector requests
Google's `updateTime desc` order and stores the first 50 reviews, which covers
the daily working feed; older snapshots remain private for change tracking and
are not rendered on that page.

## Setup

Configure every Google Business Profile in the protected OpsCenter environment:

```text
GOOGLE_REVIEWS_LOCATIONS='[{"key":"new-orleans","label":"New Orleans","placeId":"ChIJ..."},{"key":"northshore","label":"Northshore","placeId":"ChIJ..."}]'
GOOGLE_MAPS_API_KEY=...
```

`GOOGLE_REVIEWS_PLACE_ID` remains accepted only for an existing single-location
setup. `GOOGLE_REVIEWS_LOCATIONS` is the production configuration for multiple
profiles. Each `key` is a stable lowercase slug, and each profile keeps a
separate rating, count, recent-review list, and daily history.

### Correct newest-first source: Business Profile API

Google must allowlist the Cloud project before its Business Profile APIs appear
in the API library. Signed in as a verified owner or manager, submit
**Application for Basic API Access** through Google's GBP API support form,
using the project that contains the Maps key. Google requires a verified active
Business Profile, a matching business website, and an owner/manager account.

After Google approves access, enable **Google My Business API**, **My Business
Account Management API**, and **My Business Business Information API**. Create
a web OAuth client with this exact redirect URI:

```text
https://ops.junk-king.app/api/integrations/google-business/callback
```

Then store only the following values in
`/Users/missioncontrol/Library/Application Support/OpsCenter/production.env`:

```text
GOOGLE_BUSINESS_PROFILE_CLIENT_ID=...
GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET=...
GOOGLE_BUSINESS_PROFILE_TOKEN_ENCRYPTION_KEY=... # 32 random bytes, base64 or hex
```

Do not put OAuth credentials, tokens, or the Maps API key in Git. The
authorization endpoint is `/api/integrations/google-business/connect`; it
requests Google's `business.manage` scope and stores the resulting refresh
token encrypted at rest under `Library/Application Support/OpsCenter`.

The collector automatically prefers this connection once it is configured and
authorized. It discovers the four Business Profile locations by their known
Place IDs, then requests reviews from Google in `updateTime desc` order.

### Limited public fallback

`GOOGLE_MAPS_ROUTES_API_KEY` is accepted as a fallback when it is authorized
for Places API (New). Keep the key server-side and restrict it to the Places
API and the appropriate production IPs or application identity. This fallback
cannot guarantee newest-first Google reviews because Google returns only a
small relevance-selected sample.

Use the Google Place ID (for example, `ChIJ...`), not a human-readable business
name. A `places/...` resource name is also accepted and normalized. Obtain and
verify the ID in Google Maps Platform before the first collection.

Run a first collection without exposing the key:

```sh
npm run collect:google-reviews -- --data-dir /Users/missioncontrol/.openclaw/workspace/opsbot/data
npm run verify:google-reviews
```

## Files and operational boundary

- `data/google-reviews/<location-key>/current.json` — newest verified public snapshot per location
- `data/history/google-reviews/<location-key>/google-reviews_YYYY-MM-DD.json` — daily history per location

The collector is deliberately not installed as a new LaunchAgent by this code
change. Add a scheduled invocation only after its cadence, Google API billing,
and key restrictions are reviewed. A failed collection preserves the last
verified snapshot.
