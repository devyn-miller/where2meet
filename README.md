# where2meet

A when2meet-style app for finding a fair meeting point. Share a link, everyone drops a pin at the precision they choose, and the center updates live for the whole group.

- **No accounts.** Creating an event gives you a share link and a private organizer link.
- **Privacy first.** Coordinates are rounded in the browser before they are sent, rounded again by the API, and rounded a third time by a database trigger. A check constraint rejects anything finer. Typed addresses and geocoder labels are never stored.
- **Two modes.** Straight-line distance (always on) and drive time (unlocks once a meeting time is set).
- **Fairness controls.** The organizer sets per-person weights (0.5, 1, 1.5, 2, 3) and picks *least total* (minimize the sum of weight × cost) or *even out* (minimize the largest weight × cost).

Stack: Next.js 15 (App Router) + TypeScript, Supabase (Postgres + Realtime), MapLibre GL JS with OpenFreeMap tiles, openrouteservice (ORS) for matrix, snapping, geocoding and places.

## Quick start (no services needed)

```bash
npm install
npm run dev        # http://localhost:3000
```

With no environment variables set, the app uses an in-memory store and polls for updates every 2 seconds. Drive-time mode, address search and place suggestions show as unavailable, and the center uses straight-line distance. This mode is for development only: data is lost on restart, and it works only with a single server process.

## Full setup

### 1. Environment variables

Copy `.env.example` to `.env.local` and fill it in:

| Variable | Where it's used | Notes |
| --- | --- | --- |
| `ORS_API_KEY` | server only | Free key from <https://openrouteservice.org/dev/#/signup>. Never sent to the browser. |
| `SUPABASE_URL` | server only | Project URL, for example `https://xyz.supabase.co`. |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Used by the API routes, which do their own token checks. |
| `NEXT_PUBLIC_SUPABASE_URL` | browser | Same project URL. Used only to subscribe to realtime "changed" pings. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser | The anon key. Under RLS it can read an event only when the event id is given in the `x-event-id` header, and it can write nothing. |
| `NEXT_PUBLIC_MAP_STYLE_LIGHT` / `_DARK` | browser | Optional. Override the OpenFreeMap style URLs. |

### 2. Supabase schema

The schema lives in `supabase/migrations/20261029000000_init.sql`. Apply it with either:

```bash
# Supabase CLI
supabase link --project-ref <ref>
supabase db push
```

or by pasting the file into the SQL editor in the Supabase dashboard.

It creates:

- `events`, `participants`: the public data. `lat`/`lng` are `numeric(7,4)`/`numeric(8,4)`, rounded by a trigger to the participant's precision, with a check constraint that rejects anything finer.
- `event_secrets`, `participant_secrets`: SHA-256 hashes of the organizer token and each participant's edit token.
- `ors_matrix_cache`: matrix cells keyed by `rounded origin | rounded candidate | hour-of-week`.
- `ors_usage`: daily ORS call counters, plus the `increment_ors_usage` RPC.
- Triggers that bump `events.version` on every relevant change. A computed result is saved only if the version hasn't moved, so a slow drive-time computation can never overwrite a newer one.
- Row-level security on every table:
  - anon can read `events` and `participants` only for the event id named in the `x-event-id` request header.
  - anon cannot insert, update or delete anything.
  - The secrets, cache and usage tables are closed to anon.

You don't need to change any Realtime settings. The server sends a payload-free `changed` message on the public broadcast channel `event:<id>` through the Realtime REST API, and browsers refetch through the API when they get one. If you turn on "private channels only" in Realtime, this stops working and clients fall back to polling every 20 seconds.

### 3. openrouteservice

Sign up, create a free token, and set `ORS_API_KEY`. The free tier allows roughly 2,000 directions, 500 matrix and 1,000 geocoding requests per day. The app assumes 2,000 snap and 500 POI requests too; check your ORS dashboard and adjust `ORS_DAILY_LIMITS` in `src/lib/server/ors.ts` if yours differ. The app:

- counts every call in `ors_usage` and stops at 95% of each daily limit;
- treats an ORS `403` as "quota gone for today" and an ORS `429` as a 60-second back-off;
- falls back to straight-line mode with the notice "Drive times unavailable right now" whenever matrix calls fail or the budget is spent;
- caches matrix cells (see above) and place results (1 hour, keyed by the center rounded to 3 decimals).

### 4. Run

```bash
npm run build && npm start
```

## How the center is computed

The server recomputes the center after every change. That keeps the ORS key and quota on the server, and everyone sees the same answer.

**Distance mode.** A 9×9 grid over the participants' bounding box (padded 10%) is scored with haversine distance. Then come 7 refinement rounds of a 7×7 grid, each shrinking the window to 35% around the best point so far. Scores are `Σ wᵢ·dᵢ` (least total) or `max wᵢ·dᵢ` (even out). A tiny tie-break term toward the weighted RMS keeps flat optima unique, so two equally weighted people get exactly the midpoint.

**Drive-time mode.**

1. **Coarse pass:** a 7×7 grid. One ORS matrix call covers all participants × all 49 candidates.
2. **Calibrate:** for each person, the median minutes-per-km ratio from that coarse matrix.
3. **Refine:** 6 rounds on that calibrated straight-line estimate only, with no ORS calls.
4. **Verify:** one matrix call scores the coarse winner and the top refined candidates on real drive times.
5. **Snap and re-check:** snap the winner to the nearest drivable road (ORS snap, 500 m radius) and re-check every trip with a one-column matrix call.
6. The distance-mode center is always computed too, and the UI shows how far apart the two centers are.

That is at most 3 matrix requests per recompute, and fewer when cells are cached. Changing only weights or priority reuses the cached coarse matrix.

**Places.** After the center is known, the app asks for 5 named OpenStreetMap places near it through the ORS POI API: 1 km first, then 2 km if fewer than 5 turn up. The filters are coffee, meal, outdoors and anything. Opening hours are shown as mapped in OSM. Unnamed results are dropped, and nothing is generated.

## Privacy details

- **Precision:** Exact (4 decimals, about 10 m), Block (3, about 100 m), Neighborhood (2, about 1 km), Town (1, about 10 km).
- **Rounding:** the browser rounds before sending. The API rounds again (`src/lib/server/validate.ts`), and so does the database trigger. Your own exact point stays only in page memory, so you can change precision without re-picking. It is never written to localStorage.
- **Map:** your rounded cell is drawn as a shaded square, which is exactly the region the group can see. Everyone's pin, including yours after you drop it, sits at the rounded point.
- **Address search:** a POST through `/api/geocode`, so the text never appears in URLs or access logs. The query and its results are neither stored nor logged. Only a 1-decimal focus hint goes with it.
- **Requests to ORS:** they only ever contain rounded participant points.
- **Tokens:** the organizer token travels in the URL fragment (`#org=…`), which browsers never send to servers. On first load it moves into localStorage and is removed from the address bar. Participant edit tokens live in localStorage. Only hashes are stored server-side.

## Permissions

| Action | Who |
| --- | --- |
| Read the event, pins and center | anyone with the event id |
| Join (add a row) | anyone with the event id (rate limited) |
| Move, re-precision, rename or delete your pin | you (edit token) |
| Change weights, meeting time, mode or priority | organizer token |
| Remove someone | organizer token |

Per-IP and per-event rate limits apply to every API route (`src/lib/server/rate-limit.ts`).

## Tests

```bash
npm test            # unit + integration (Vitest)
npm run e2e         # end-to-end (Playwright, builds and starts the app on :3210)
```

- `tests/unit/geo.test.ts`: rounding at each precision, half-away-from-zero, cell bounds.
- `tests/unit/cost.test.ts`: weighted cost for both priorities.
- `tests/unit/grid.test.ts`: refinement. Symmetric cases land on the midpoint, a heavy weight pulls toward that person, and the search refines well below the coarse spacing.
- `tests/unit/rate-limit.test.ts`: request limiter, ORS daily budget, 403/429 handling, and drive mode falling back to straight-line with the notice.
- `tests/integration/api.test.ts`: the real route handlers against a mocked ORS. It covers server-side rounding, the drive solver's call count and caching, the permission matrix, drive-mode locking, the geocode and places proxies, and per-IP rate limits.
- `e2e/meet.spec.ts`: two browsers join and the center appears for both. The organizer changes a weight, and the center moves toward that person for everyone. External network is blocked, so the map runs on its fallback style.

## Known limits

- **No traffic or departure time.** ORS doesn't support departure time for the matrix API, so drive-time mode uses typical, traffic-free drive times. The meeting time still unlocks the mode and keys the cache by hour-of-week, so a traffic-aware provider could slot in later.
- **Free-tier ORS quotas are small.** 500 matrix requests a day covers roughly 170 drive-mode recomputes on a cold cache. Busy events fall back to straight-line mode until the next UTC day.
- **ORS matrix size.** Events are capped at 50 people, which keeps the coarse request at or below 50 × 49 = 2,450 routes, within ORS's per-request matrix limit for driving.
- **Rate limits are per server process.** On a multi-instance deployment each instance enforces its own limits. Use a shared store such as Redis if that matters.
- **The in-memory store is for development only.** It is single-process and lost on restart.
- **Rounding cells are in degrees.** Away from the equator a cell is narrower east–west than north–south. The shaded square on the map shows the real shape.
- **The center is shown at 4 decimals and is not private.** It is the group's answer, not anyone's location.
- **Geocoder coverage is Pelias/OSM.** Some addresses won't be found. Tapping the map always works.
- **Opening hours are raw OSM `opening_hours` strings,** shown as mapped and not parsed against the meeting time.
- **The Supabase store, Realtime broadcast and live ORS calls were not run against the real services during development.** The build environment couldn't reach them. The SQL migration was applied and checked on Postgres 16 (rounding trigger, version triggers, header-scoped RLS, write denial). The API was tested end to end against the in-memory store, and ORS against a mock that follows its documented request and response shapes.
- **Directions API is unused.** Routes link out to Google Maps instead of drawing road geometry. The lines on the map are straight dashed lines labeled with miles or minutes.
- **Map tiles:** © OpenFreeMap, © OpenMapTiles, data © OpenStreetMap contributors. Attribution comes from the tile source and appears in the map corner.
