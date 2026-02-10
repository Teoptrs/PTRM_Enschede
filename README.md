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
- Vehicle positions: OpenOV GTFS-RT feed (`vehiclePositions.pb`)
- Enschede boundary: PDOK/CBS municipality boundaries OGC API (`gemeente_gegeneraliseerd`)
- GTFS static: OpenOV GTFS zip (`gtfs-openov-nl.zip`)
- Bus lines (default): OpenStreetMap via Overpass API
- Line numbers for vehicles: inferred from nearest line shape when RT feed lacks trip/route IDs

## Notes

- The server caches the boundary and filtered stops in `data/` for 7 days.
- If you need to override sources, set:
  - `STOPS_SOURCE`
  - `VEHICLE_POS_SOURCE`
  - `BOUNDARY_SOURCE`
  - `GTFS_STATIC_SOURCE`
  - `OVERPASS_URL`
  - `LINES_SOURCE` (`overpass` or `gtfs`)
  - `LINE_MATCH_THRESHOLD_M` (default 140)
  - `LINE_INDEX_TTL_MS` (default 300000)
