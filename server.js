const express = require("express");
const path = require("path");
const { PORT, STOPS_SOURCE, VEHICLE_POS_SOURCE, GTFS_STATIC_SOURCE } = require("./src/config");
const { getBoundary } = require("./src/services/boundary");
const { getStops } = require("./src/services/stops");
const { getLines } = require("./src/services/lines");
const { fetchVehicles } = require("./src/services/vehicles");

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
      source: VEHICLE_POS_SOURCE,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
