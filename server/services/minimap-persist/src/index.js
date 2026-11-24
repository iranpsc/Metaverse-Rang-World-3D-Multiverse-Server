// server/services/minimap-persist/src/index.js
//
// HTTP persist service for MiniMap citizen settings.
// Contract (Unity client Meta_MiniMap -> HttpMiniMapStore):
//   GET  /health
//   GET  /environments/{environmentId}/minimap/{citizenId}.json
//   PUT  /environments/{environmentId}/minimap/{citizenId}.json   (body = MiniMap settings JSON)
//
// Storage: atomic writes (temp file + rename) under DATA_ROOT/environments/{environmentId}/minimap/{citizenId}.json
// Path segments are sanitized the same way as MiniMapCitizenPath.Sanitize in the Unity client.

"use strict";

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_ROOT = process.env.DATA_ROOT || path.resolve(__dirname, "..", "data");
const MAX_ID_LENGTH = 128;
const MAX_BODY_BYTES = 64 * 1024;

// ---------------------------------------------------------------- ids

/** Allow only [A-Za-z0-9._-]; everything else becomes '_' (same rule as the Unity client). */
function sanitizeId(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const s = raw.replace(/[^A-Za-z0-9._-]/g, "_");
  if (s.length === 0 || s.length > MAX_ID_LENGTH) return null;
  if (s === "." || s === "..") return null;
  if (s.includes("..")) return null;
  if (s[0] === ".") return null;
  return s;
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------- file helpers

function minimapFilePath(environmentId, citizenId) {
  const env = sanitizeId(environmentId) || "default";
  const cit = sanitizeId(citizenId);
  if (!cit) return null;
  return path.join(DATA_ROOT, "environments", env, "minimap", `${cit}.json`);
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    const e = new Error("not_found");
    e.status = 404;
    throw e;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

// ---------------------------------------------------------------- http

const sendJson = (res, status, value) => {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    // Allow Unity Editor + WebGL origins for GET/PUT.
    "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  });
  res.end(body);
};

const server = http.createServer((req, res) => {
  const onError = (status, code, message) => sendJson(res, status, { error: code, message });

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
    });
    return res.end();
  }

  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const segments = url.pathname.split("/").filter(Boolean);

    if (segments[0] === undefined) return onError(404, "not_found", "Not found.");

    // GET /health
    if (segments.length === 1 && segments[0] === "health" && req.method === "GET") {
      return sendJson(res, 200, { ok: true, dataRoot: DATA_ROOT, port: PORT });
    }

    // GET|PUT /environments/:environmentId/minimap/:citizenId(.json)
    if (
      segments.length === 4 &&
      segments[0] === "environments" &&
      segments[2] === "minimap"
    ) {
      const environmentId = sanitizeId(segments[1]);
      const file = segments[3].endsWith(".json") ? segments[3].slice(0, -5) : segments[3];
      const citizenId = sanitizeId(file);
      if (!environmentId || !citizenId) {
        return onError(400, "invalid_id", "Invalid environmentId or citizenId.");
      }

      const filePath = minimapFilePath(environmentId, citizenId);

      if (req.method === "GET") {
        let value;
        try {
          value = readJsonFile(filePath);
        } catch {
          return onError(404, "not_found", "No stored document at that path.");
        }
        return sendJson(res, 200, value);
      }

      if (req.method === "PUT") {
        const chunks = [];
        let size = 0;
        req.on("data", (c) => {
          size += c.length;
          if (size > MAX_BODY_BYTES) {
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        req.on("end", () => {
          let body;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            return onError(400, "invalid_json", "Body is not valid JSON.");
          }
          if (!isPlainObject(body) || typeof body.version !== "number" || !Number.isInteger(body.version) || body.version < 1) {
            return onError(400, "missing_or_invalid_version", "Field \"version\" must be a positive integer.");
          }
          try {
            writeJsonAtomic(filePath, body);
            return sendJson(res, 200, body);
          } catch (err) {
            return onError(500, "internal_error", "Failed to write document.");
          }
        });
        return;
      }

      return onError(405, "method_not_allowed", "Use GET or PUT.");
    }

    return onError(404, "not_found", "Not found.");
  } catch (err) {
    return onError(500, "internal_error", "Internal error.");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`meta-minimap-persist listening on http://${HOST}:${PORT}`);
  console.log(`DATA_ROOT = ${DATA_ROOT}`);
});
