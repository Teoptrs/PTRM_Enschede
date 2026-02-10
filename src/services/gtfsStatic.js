const fs = require("fs");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const unzipper = require("unzipper");
const { GTFS_CACHE, GTFS_STATIC_SOURCE } = require("../config");
const { ensureCacheDir, isFresh } = require("../utils/cache");

async function ensureGtfsZip() {
  ensureCacheDir();
  if (isFresh(GTFS_CACHE)) return GTFS_CACHE;
  const res = await fetch(GTFS_STATIC_SOURCE);
  if (!res.ok) {
    throw new Error(`Failed to download GTFS static: ${res.status}`);
  }
  const writable = fs.createWriteStream(GTFS_CACHE);
  await pipeline(Readable.fromWeb(res.body), writable);
  return GTFS_CACHE;
}

async function openGtfsZip() {
  const zipPath = await ensureGtfsZip();
  return unzipper.Open.file(zipPath);
}

function getZipEntry(zip, name) {
  return zip.files.find((entry) => entry.path === name);
}

module.exports = {
  openGtfsZip,
  getZipEntry,
};
