const csv = require("csv-parser");
const { ROUTES_CACHE, TRIPS_CACHE } = require("../config");
const { ensureCacheDir, isFresh, loadJson, saveJson } = require("../utils/cache");
const { openGtfsZip, getZipEntry } = require("./gtfs");

async function buildRouteMap() {
  const zip = await openGtfsZip();
  const routesEntry = getZipEntry(zip, "routes.txt");

  if (!routesEntry) {
    throw new Error("Missing required GTFS file (routes.txt).");
  }

  const routes = {};
  await new Promise((resolve, reject) => {
    routesEntry
      .stream()
      .pipe(csv())
      .on("data", (row) => {
        const routeId = row.route_id;
        if (!routeId) return;

        const routeType = Number(row.route_type);
        const isBus =
          routeType === 3 || (routeType >= 700 && routeType < 800);
        if (!isBus) return;

        routes[routeId] = {
          shortName: row.route_short_name || "",
          longName: row.route_long_name || "",
        };
      })
      .on("end", resolve)
      .on("error", reject);
  });

  return routes;
}

async function buildTripMap(routeMap) {
  const zip = await openGtfsZip();
  const tripsEntry = getZipEntry(zip, "trips.txt");

  if (!tripsEntry) {
    throw new Error("Missing required GTFS file (trips.txt).");
  }

  const trips = {};
  await new Promise((resolve, reject) => {
    tripsEntry
      .stream()
      .pipe(csv())
      .on("data", (row) => {
        const tripId = row.trip_id;
        const routeId = row.route_id;
        if (!tripId || !routeId) return;

        const routeInfo = routeMap[routeId];
        if (!routeInfo) return;

        trips[tripId] = {
          routeId,
          shortName: routeInfo.shortName || "",
          longName: routeInfo.longName || "",
        };
      })
      .on("end", resolve)
      .on("error", reject);
  });

  return trips;
}

async function getRouteMap() {
  ensureCacheDir();
  if (isFresh(ROUTES_CACHE)) {
    return loadJson(ROUTES_CACHE);
  }
  const routes = await buildRouteMap();
  saveJson(ROUTES_CACHE, routes);
  return routes;
}

async function getTripMap() {
  ensureCacheDir();
  if (isFresh(TRIPS_CACHE)) {
    return loadJson(TRIPS_CACHE);
  }
  const routeMap = await getRouteMap();
  const trips = await buildTripMap(routeMap);
  saveJson(TRIPS_CACHE, trips);
  return trips;
}

module.exports = {
  getRouteMap,
  getTripMap,
};
