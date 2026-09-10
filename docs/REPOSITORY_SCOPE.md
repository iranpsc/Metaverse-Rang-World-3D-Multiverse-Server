# Repository Scope

This repository package contains the application source and the active infrastructure configuration captured from the server audit.

## Included
- Node.js application source
- package.json and package-lock.json
- Proto contracts
- Realtime, gRPC, Game Server Control and Voice source/tests/docs
- Production Envoy configuration used by `envoy-metaverse.service`
- Active Nginx main/site configuration
- Active project systemd units
- PM2 ecosystem declaration reconstructed from the observed running processes
- Sanitized `.env.example`
- Runtime-version baseline

## Intentionally not committed
- `.env` and real secrets
- JWT private keys and environment-specific certificates
- Let's Encrypt private material
- MongoDB data
- Voice recordings
- PM2 logs/dump state
- `node_modules`
- Linux Dedicated Server generated build
- WebGL generated build
- Runtime logs, token-response dumps and backup copies

## External files requiring separate deployment management
The active Nginx configuration references `/var/www/metaverse-webgl` and `/var/www/html/completed-buildings.json`.
The audit confirmed both paths exist, but their contents were not part of the supplied repository audit ZIP, so they are not copied into this package.

The active Node/PM2 configuration references `/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer`.
That generated Unity Dedicated Server build is intentionally kept outside the source repository.

The active Voice runtime stores recordings under `/home/world3d/data/metaverse-voice-recordings`; this is runtime data and must remain outside Git.

## Nginx routes with no matching listener observed during the audit
The active Nginx configuration contains routes to local ports `8082` and `50053`.
The listening-port snapshot taken during the audit did not show a process listening on those ports.
Those routes are retained exactly because they are present in the active Nginx configuration; no assumption was made about whether they are obsolete.
