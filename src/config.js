const path = require("path");

const PORT = process.env.PORT || 3000;

const CACHE_DIR = path.join(__dirname, "..", "data");
const STOPS_CACHE = path.join(CACHE_DIR, "stops_enschede.json");
const BOUNDARY_CACHE = path.join(CACHE_DIR, "boundary_enschede.geojson");
const GTFS_CACHE = path.join(CACHE_DIR, "gtfs-static.zip");
const ROUTES_CACHE = path.join(CACHE_DIR, "routes_map.json");
const TRIPS_CACHE = path.join(CACHE_DIR, "trips_map.json");

const STOPS_SOURCE =
  process.env.STOPS_SOURCE || "https://data.openov.nl/haltes/stops.csv.gz";
const VEHICLE_POS_SOURCE =
  process.env.VEHICLE_POS_SOURCE ||
  "https://gtfs.openov.nl/gtfs-rt/vehiclePositions.pb";
const TRIP_UPDATES_SOURCE =
  process.env.TRIP_UPDATES_SOURCE ||
  "https://gtfs.openov.nl/gtfs-rt/tripUpdates.pb";
const GTFS_STATIC_SOURCE =
  process.env.GTFS_STATIC_SOURCE ||
  "https://gtfs.openov.nl/gtfs-rt/gtfs-openov-nl.zip";
const BOUNDARY_SOURCE =
  process.env.BOUNDARY_SOURCE ||
  "https://api.pdok.nl/cbs/gebiedsindelingen/ogc/v1/collections/gemeente_gegeneraliseerd/items";
const OVERPASS_URL =
  process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const LINES_SOURCE = process.env.LINES_SOURCE || "overpass";

const LINES_CACHE = path.join(CACHE_DIR, `lines_enschede_${LINES_SOURCE}.json`);

const BOUNDARY_NAME = process.env.BOUNDARY_NAME || "enschede";
const BOUNDARY_STATCODE = process.env.BOUNDARY_STATCODE || "";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

module.exports = {
  PORT,
  CACHE_DIR,
  STOPS_CACHE,
  BOUNDARY_CACHE,
  LINES_CACHE,
  GTFS_CACHE,
  ROUTES_CACHE,
  TRIPS_CACHE,
  STOPS_SOURCE,
  VEHICLE_POS_SOURCE,
  TRIP_UPDATES_SOURCE,
  GTFS_STATIC_SOURCE,
  BOUNDARY_SOURCE,
  OVERPASS_URL,
  LINES_SOURCE,
  BOUNDARY_NAME,
  BOUNDARY_STATCODE,
  CACHE_TTL_MS,
};
