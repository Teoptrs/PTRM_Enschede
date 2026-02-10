const GtfsRealtimeBindings = require("gtfs-realtime-bindings");
const { VEHICLE_POS_SOURCE } = require("../config");
const {
  computeBBox,
  bboxContains,
  pointInGeometry,
  computeBBoxFromCoords,
  distancePointToPolylineMeters,
} = require("../utils/geo");
const { getRouteMap, getTripMap } = require("./routes");
const { fetchTripUpdates } = require("./tripUpdates");
const { getLines } = require("./lines");

const LINE_INDEX_TTL_MS = Number(process.env.LINE_INDEX_TTL_MS || 300000);
const LINE_MATCH_THRESHOLD_M = Number(
  process.env.LINE_MATCH_THRESHOLD_M || 140
);

let lineIndexCache = null;
let lineIndexTime = 0;

async function getLineIndex(boundaryGeometry) {
  const now = Date.now();
  if (lineIndexCache && now - lineIndexTime < LINE_INDEX_TTL_MS) {
    return lineIndexCache;
  }

  const result = await getLines(boundaryGeometry);
  const lines = Array.isArray(result) ? result : result.lines || [];
  const index = lines
    .map((line) => {
      const coords = Array.isArray(line.coords) ? line.coords : [];
      if (coords.length < 2) return null;
      return {
        line,
        bbox: computeBBoxFromCoords(coords),
      };
    })
    .filter(Boolean);

  lineIndexCache = index;
  lineIndexTime = now;
  return index;
}

function inferLineForVehicle(vehicle, lineIndex) {
  if (!lineIndex || lineIndex.length === 0) return null;
  const lat = vehicle.lat;
  const lon = vehicle.lon;

  const metersPerDegree = 111320;
  const rad = Math.PI / 180;
  const deltaLat = LINE_MATCH_THRESHOLD_M / metersPerDegree;
  const deltaLon =
    LINE_MATCH_THRESHOLD_M / (metersPerDegree * Math.cos(lat * rad));

  let best = null;
  let bestDist = Infinity;

  for (const entry of lineIndex) {
    const bbox = entry.bbox;
    if (
      lat < bbox.minLat - deltaLat ||
      lat > bbox.maxLat + deltaLat ||
      lon < bbox.minLon - deltaLon ||
      lon > bbox.maxLon + deltaLon
    ) {
      continue;
    }
    const coords = entry.line.coords;
    const dist = distancePointToPolylineMeters(lat, lon, coords);
    if (dist < bestDist) {
      bestDist = dist;
      best = entry.line;
    }
  }

  if (!best || bestDist > LINE_MATCH_THRESHOLD_M) return null;
  return best;
}

async function fetchVehicles(boundaryGeometry) {
  const bbox = computeBBox(boundaryGeometry);
  const routeMap = await getRouteMap();
  const tripMap = await getTripMap();
  let tripUpdates = null;
  try {
    tripUpdates = await fetchTripUpdates();
  } catch (err) {
    console.warn(`Trip updates unavailable (${err.message}).`);
  }
  const res = await fetch(VEHICLE_POS_SOURCE);
  if (!res.ok) {
    throw new Error(`Failed to download vehicle positions: ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);

  const vehicles = [];
  for (const entity of feed.entity) {
    if (!entity.vehicle || !entity.vehicle.position) continue;
    const lat = entity.vehicle.position.latitude;
    const lon = entity.vehicle.position.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const point = [lon, lat];
    if (!bboxContains(bbox, point)) continue;
    if (!pointInGeometry(point, boundaryGeometry)) continue;

    const vehicleId = entity.vehicle.vehicle?.id || entity.id || null;
    const rtMatch = vehicleId ? tripUpdates?.byVehicleId?.[vehicleId] : null;
    const tripId = entity.vehicle.trip?.trip_id || rtMatch?.tripId || null;
    const routeId = entity.vehicle.trip?.route_id || rtMatch?.routeId || null;
    const routeInfo = routeId ? routeMap[routeId] : null;
    const tripInfo = tripId ? tripMap[tripId] : null;

    vehicles.push({
      id: vehicleId,
      label:
        entity.vehicle.vehicle?.label ||
        entity.vehicle.trip?.route_id ||
        null,
      lineNumber: routeInfo?.shortName || tripInfo?.shortName || null,
      lineName: routeInfo?.longName || tripInfo?.longName || null,
      tripId,
      routeId,
      lat,
      lon,
      bearing: entity.vehicle.position.bearing ?? null,
      timestamp: entity.vehicle.timestamp
        ? Number(entity.vehicle.timestamp)
        : null,
    });
  }

  const needsInference = vehicles.some((v) => !v.lineNumber);
  if (needsInference) {
    try {
      const lineIndex = await getLineIndex(boundaryGeometry);
      for (const vehicle of vehicles) {
        if (vehicle.lineNumber) continue;
        const match = inferLineForVehicle(vehicle, lineIndex);
        if (!match) continue;
        vehicle.lineNumber =
          match.shortName || match.longName || match.routeId || null;
        vehicle.lineName = match.longName || match.shortName || null;
        vehicle.routeId = vehicle.routeId || match.routeId || null;
        vehicle.lineSource = "inferred";
      }
    } catch (err) {
      console.warn(`Line inference failed (${err.message}).`);
    }
  }

  return {
    feedTimestamp: feed.header?.timestamp
      ? Number(feed.header.timestamp)
      : null,
    vehicles,
  };
}

module.exports = {
  fetchVehicles,
};
