# MiniMap citizen settings — HTTP persist service

Live port for the Unity client: **8788** (`Meta_MiniMap` → `HttpMiniMapStore`).

## Routes (Unity client contract)

| Method | Path |
|---|---|
| GET | `/health` |
| GET | `/environments/{environmentId}/minimap/{citizenId}.json` |
| PUT | `/environments/{environmentId}/minimap/{citizenId}.json` (body = MiniMap settings JSON) |

Body (as produced by `HttpMiniMapStore.Save`, camelCase):
```json
{
  "version": 1,
  "citizenId": "qa_citizen_2",
  "radarEnabled": false,
  "zoomOrOrthoSize": 41.37,
  "offsetY": 60,
  "updatedAt": "2026-11-24T12:00:00.000Z"
}
```

Behavior:
- `GET /health` → `{ "ok": true, "dataRoot": "..." }`
- `GET` of a missing document → `404` `{ "error": "not_found" }` (the client treats this as an empty prefs miss)
- `PUT` writes atomically (temp file + rename) under `DATA_ROOT/environments/{environmentId}/minimap/{citizenId}.json`
- Path segments are sanitized (no `..`, non-empty, ≤128 chars) — same rule as `MiniMapCitizenPath.Sanitize`
- `PUT` with an invalid JSON body or missing/invalid `version` → `400` `{ "error": "invalid_json" }` / `{ "error": "missing_or_invalid_version" }`
- No auth (see the Unity client: writes are unauthenticated, last write wins)

## Run locally

```sh
# minimal build: the service has no external dependencies
node src/index.js                 # or: npm start
```

Environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8788` | Port to listen on |
| `HOST` | `0.0.0.0` | Bind address (Unit clients target `http://HOST:8788`) |
| `DATA_ROOT` | `./data` | Directory for the JSON files (files land in `DATA_ROOT/environments/...`) |

Example:
```sh
PORT=8788 DATA_ROOT=./data node src/index.js
# smoke test:
curl -s http://127.0.0.1:8788/health
curl -s -X PUT http://127.0.0.1:8788/environments/lobby_1/minimap/qa_citizen_2.json -H 'Content-Type: application/json' --data '{"version":1,"citizenId":"qa_citizen_2","radarEnabled":false,"zoomOrOrthoSize":41.37,"offsetY":60,"updatedAt":"2026-11-24T12:00:00.000Z"}'
curl -s http://127.0.0.1:8788/environments/lobby_1/minimap/qa_citizen_2.json
```
