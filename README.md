# Metaverse Production Monorepo

This repository contains all production components maintained by the server team.

## Structure

- `server/` — Node.js metaverse server source, scripts, tests and package metadata.
- `game-server/LinuxGameServer/` — complete Unity Linux Dedicated Server build currently maintained by the team.
- `infrastructure/nginx/` — Nginx configuration tracked in Git.
- `infrastructure/envoy/` — Envoy configuration tracked in Git.
- `infrastructure/pm2/` — PM2 application declaration.
- `infrastructure/systemd/` — systemd units belonging to this project.
- `deploy/` — deployment contract and future controlled deployment tooling.
- `docs/` — repository, runtime and deployment documentation.

## Game Server policy

Unity source is not part of this repository. A programmer creates a complete Linux Dedicated Server build in Unity and replaces the entire `game-server/LinuxGameServer/` content with the new build.

The build directory is tracked with Git LFS so Git records who changed the build and which commit contains each version.

Official production builds should additionally be attached to GitHub Releases for deployment history and rollback.

## Important

A Git commit or merge is not a production deployment. Deployment remains a separate controlled step with validation and component-specific reload/restart.
