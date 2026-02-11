const express = require("express");
const path = require("path");
const {
  PORT,
  STOPS_SOURCE,
  GTFS_STATIC_SOURCE,
  VEHICLE_SOURCE,
} = require("./src/config");
const { getBoundary } = require("./src/services/boundary");
const { getStops } = require("./src/services/stops");
const { getLines } = require("./src/services/lines");
const { fetchVehicles } = require("./src/services/vehicles");
const { resolveStopArea } = require("./src/services/stopAreas");
const { fetchStopAreaDepartures } = require("./src/services/departures");

const app = express();

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, timestamp: Date.now() });
});

app.get("/api/boundary", async (_req, res) => {
  try {
    const boundary = await getBoundary();
    res.json(boundary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/stops", async (_req, res) => {
  try {
    const boundary = await getBoundary();
    const stops = await getStops(boundary.geometry);
    res.json({
      count: stops.length,
      stops,
      source: STOPS_SOURCE,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/stops/:stopId/departures", async (req, res) => {
  try {
    const stopId = String(req.params.stopId || "").trim();
    if (!stopId) {
      res.status(400).json({ error: "Missing stop ID." });
      return;
    }
    const boundary = await getBoundary();
    const stops = await getStops(boundary.geometry);
    const stop = stops.find((entry) => String(entry.id) === stopId);
    if (!stop) {
      res.status(404).json({ error: "Stop not found.", stopId });
      return;
    }
    const stopArea = await resolveStopArea(
      stopId,
      stop.lat,
      stop.lon,
      boundary.geometry
    );
    if (!stopArea || !stopArea.code) {
      res.status(404).json({ error: "Stop area code not found.", stopId });
      return;
    }
    const result = await fetchStopAreaDepartures(stopArea.code);
    res.set("Cache-Control", "no-store");
    res.json({
      stopId,
      stopAreaCode: stopArea.code,
      approximate: Boolean(stopArea.approximate),
      distanceM: Number.isFinite(stopArea.distanceM)
        ? stopArea.distanceM
        : null,
      departures: result.departures || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/lines", async (_req, res) => {
  try {
    const boundary = await getBoundary();
    const result = await getLines(boundary.geometry);
    const lines = result.lines || [];
    res.json({
      count: lines.length,
      lines,
      source: result.source || GTFS_STATIC_SOURCE,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/vehicles", async (_req, res) => {
  try {
    const boundary = await getBoundary();
    const vehicles = await fetchVehicles(boundary.geometry);
    res.set("Cache-Control", "no-store");
    res.json({
      ...vehicles,
      source: VEHICLE_SOURCE,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
