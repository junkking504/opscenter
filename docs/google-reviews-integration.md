# Google Reviews integration

OpsCenter tracks the public Google rating, total rating count, and the latest
reviews returned by the Google Places API (New). It does not scrape Google
Search or rely on a signed-in browser.

Each collection writes a current snapshot plus one daily historical snapshot.
The Marketing Reviews tab compares the current snapshot with the preceding
snapshot for the same Google place. A count change means the public total
changed between collections; it does not claim every new review is present in
Google's limited latest-review response.

## Setup

Enable the **Places API (New)** for the Google Cloud project that owns the
protected Maps API key. Configure these only in the protected OpsCenter
environment. Configure every Google Business Profile you want to track:

```text
GOOGLE_REVIEWS_LOCATIONS='[{"key":"new-orleans","label":"New Orleans","placeId":"ChIJ..."},{"key":"northshore","label":"Northshore","placeId":"ChIJ..."}]'
GOOGLE_MAPS_API_KEY=...
```

`GOOGLE_REVIEWS_PLACE_ID` remains accepted only for an existing single-location
setup. `GOOGLE_REVIEWS_LOCATIONS` is the production configuration for multiple
profiles. Each `key` is a stable lowercase slug, and each profile keeps a
separate rating, count, recent-review list, and daily history.

`GOOGLE_MAPS_ROUTES_API_KEY` is accepted as a fallback when it is authorized
for Places API (New). Keep the key server-side and restrict it to the Places
API and the appropriate production IPs or application identity.

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
