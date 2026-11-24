// server/services/daynight-persist/src/index.js
//
// HTTP persist service for the environment day/night state.
// Contract (Unity client Meta_DayNightCycle -> EnvironmentDayNumberHttpStore):
//   GET  /health
//   GET  /environments/{environmentId}/daynight.json
//   PUT  /environments/{environmentId}/daynight.json   (body = daynight schema)
//
// Storage: atomic writes (temp file + rename) under DATA_ROOT/environments/{environmentId}/daynight.json
// Path segments are sanitized the same way as EnvironmentDayNightPath.Sanitize in the Unity client.
//
// PUT body (camelCase, as sent by the client; the URL id always wins over body fields):
//   {
//     "version": 1,
//     "environmentId": "lobby_1",
//     "time01": 0.12,                 // 0..1
//     "cycleRunning": true,
//     "rotationSpeed": 2,             // optional passthrough
//     "baseRotation": { "x": 0, "y": 0, "z": 0, "w": 1 },  // optional passthrough
//     "updatedAt": "2026-11-24T12:00:00.000Z",
//     "updatedBy": ""
//   }

"use strict";

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8789);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_ROOT = process.env.DATA_ROOT || path.resolve(__dirname, "..", "data");
const MAX_ID_LENGTH = 128;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TIME01 = 1; // clamp, same as the Unity client's Mathf.Repeat/Clamp01

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

function daynightFilePath(environmentId) {
  const env = sanitizeId(environmentId) || "default";
  return path.join(DATA_ROOT, "environments", env, "daynight.json");
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
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  });
  res.end(body);
};

const server = http.createServer((req, res) => {
  const onError = (status, code, message) => sendJson(res, status, { error: code, message });

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
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

    // GET|PUT /environments/:environmentId/daynight.json
    if (segments.length === 3 && segments[0] === "environments" && segments[2] === "daynight.json") {
      const environmentId = sanitizeId(segments[1]);
      if (!environmentId) return onError(400, "invalid_id", "Invalid environmentId.");
      const filePath = daynightFilePath(environmentId);

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
          // Store the received schema; normalize the clamped time01 like the Unity client does.
          const doc = { ...body };
          doc.environmentId = environmentId; // URL id wins over the body field
          if (typeof body.time01 === "number") {
            doc.time01 = Math.min(MAX_TIME01, Math.max(0, body.time01));
          }
          try {
            writeJsonAtomic(filePath, doc);
            return sendJson(res, 200, doc);
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
  console.log(`meta-daynight-persist listening on http://${HOST}:${PORT}`);
  console.log(`DATA_ROOT = ${DATA_ROOT}`);
});
