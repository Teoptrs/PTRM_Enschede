const GtfsRealtimeBindings = require("gtfs-realtime-bindings");
const { TRIP_UPDATES_SOURCE } = require("../config");

const CACHE_TTL_MS = Number(process.env.TRIP_UPDATES_TTL_MS || 20000);

let cache = null;
let cacheTime = 0;

async function fetchTripUpdates() {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL_MS) return cache;

  const res = await fetch(TRIP_UPDATES_SOURCE);
  if (!res.ok) {
    throw new Error(`Failed to download trip updates: ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);

  const byVehicleId = {};
  for (const entity of feed.entity) {
    if (!entity.trip_update || !entity.trip_update.trip) continue;
    const trip = entity.trip_update.trip;
    const vehicleId = entity.trip_update.vehicle?.id || null;
    if (!vehicleId) continue;
    byVehicleId[vehicleId] = {
      tripId: trip.trip_id || null,
      routeId: trip.route_id || null,
    };
  }

  cache = { byVehicleId, feedTimestamp: feed.header?.timestamp || null };
  cacheTime = now;
  return cache;
}

module.exports = {
  fetchTripUpdates,
};
