const fs = require("fs");
const { CACHE_DIR, CACHE_TTL_MS } = require("../config");

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function isFresh(filePath, ttlMs = CACHE_TTL_MS) {
  if (!fs.existsSync(filePath)) return false;
  const ageMs = Date.now() - fs.statSync(filePath).mtimeMs;
  return ageMs < ttlMs;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data));
}

module.exports = {
  ensureCacheDir,
  isFresh,
  loadJson,
  saveJson,
};
