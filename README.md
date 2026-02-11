# Enschede Bus Live Map

This is a small web app that renders:
- all stops within Enschede (including the university area)
- live bus positions refreshed every ~20 seconds
- bus line shapes (distinct colors per line)

## Run

1. Install dependencies
2. Start the server

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Data sources

- Stops: OpenOV haltes dataset (`stops.csv.gz`)
- Vehicle positions: OVapi (KV78Turbo) line actuals (positions are timing point passes, not GPS)
- Stop departures: OVapi stoparea departures
- Enschede boundary: PDOK/CBS municipality boundaries OGC API (`gemeente_gegeneraliseerd`)
- GTFS static: OpenOV GTFS zip (`gtfs-openov-nl.zip`)
- Bus lines (default): OpenStreetMap via Overpass API

## Notes

- The server caches the boundary and filtered stops in `data/` for 7 days.
- Some stops are not timing points in OVapi; departures will fall back to the nearest timing point and the UI will mark this as approximate.
- If you need to override sources, set:
  - `STOPS_SOURCE`
  - `VEHICLE_PROVIDER` (`ovapi` or `gtfs-rt`)
  - `VEHICLE_POS_SOURCE` (used when `VEHICLE_PROVIDER=gtfs-rt`)
  - `TRIP_UPDATES_SOURCE` (used when `VEHICLE_PROVIDER=gtfs-rt`)
  - `OVAPI_BASE_URL`
  - `OVAPI_USER_AGENT`
  - `OVAPI_LINE_LIST_TTL_MS`
  - `OVAPI_ACTUALS_TTL_MS`
  - `OVAPI_DEPARTURES_TTL_MS`
  - `OVAPI_STOPAREAS_TTL_MS`
  - `STOPAREA_MATCH_RADIUS_M`
  - `OVAPI_BATCH_SIZE`
  - `BOUNDARY_SOURCE`
  - `GTFS_STATIC_SOURCE`
  - `OVERPASS_URL`
  - `LINES_SOURCE` (`overpass` or `gtfs`)
