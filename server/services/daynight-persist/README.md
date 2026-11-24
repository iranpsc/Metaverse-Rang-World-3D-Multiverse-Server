# Environment day/night — HTTP persist service

Live port for the Unity client: **8789** (`Meta_DayNightCycle` → `EnvironmentDayNightHttpStore`).

## Routes (Unity client contract)

| Method | Path |
|---|---|
| GET | `/health` |
| GET | `/environments/{environmentId}/daynight.json` |
| PUT | `/environments/{environmentId}/daynight.json` (body = daynight schema) |

PUT body (camelCase, as sent by `EnvironmentDayNumberHttpStore`):
```json
{
  "version": 1,
  "environmentId": "lobby_1",
  "time01": 0.12,
  "cycleRunning": true,
  "rotationSpeed": 2,
  "baseRotation": { "x": 0, "y": 0.5, "z": 0, "w": 0.87 },
  "updatedAt": "2026-11-24T12:00:00.000Z",
  "updatedBy": ""
}
```
Notes:
- `version` is required (integer ≥ 1); anything else is a 400.
- The URL `environmentId` always wins over the body field.
- `time01` is clamped to `[0, 1]`.
- The client sends header `X-Is-Environment-Owner: true` on writes; this service is a simple file store and accepts writes without auth (see "Auth" below).

Behavior:
- `GET /health` → `{ "ok": true, "dataRoot": "..." }`
- `GET` of a missing document → `404` `{ "error": "not_found" }` (the client treats this as an empty-state miss)
- `PUT` writes atomically (temp file + rename) under `DATA_ROOT/environments/{environmentId}/daynight.json`
- Path segments are sanitized (no `..`, non-empty, ≤128 chars) — same rule as `EnvironmentDayNightPath.Sanitize`

## Run locally

```sh
# minimal build: the service has no external dependencies
node src/index.js                 # or: npm start
```

Environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8789` | Port to listen on |
| `HOST` | `0.0.0.0` | Bind address (Unity clients target `http://HOST:8789`) |
| `DATA_ROOT` | `./data` | Directory for the JSON files (files land in `DATA_ROOT/environments/...`) |

Example:
```sh
PORT=8789 DATA_ROOT=./data node src/index.js
# smoke test:
curl -s http://127.0.0.1:8789/health
curl -s -X PUT http://127.0.0.1:8789/environments/lobby_1/daynight.json -H 'Content-Type: application/json' --data '{"version":1,"environmentId":"lobby_1","time01":0.12,"cycleRunning":true,"rotationSpeed":2}'
curl -s http://127.0.0.1:8789/environments/lobby_1/daynight.json
```

## Auth

None by default: the Unity client `EnvironmentDayNumberHttpStore` performs unauthenticated
GET/PUT, so the file service accepts them too. Deployments behind the monorepo edge can add
auth in front; there is no auth code in this service.
