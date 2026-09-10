# Repository Contract

## Locked repository model

This project uses one production monorepo.

### `server/`
Contains the Node.js server application that is deployed to:

`/home/world3d/apps/metaverse-server`

### `game-server/LinuxGameServer/`
Contains the complete generated Unity Linux Dedicated Server build.

The current audited production build came from:

`/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer`

Unity project source is intentionally not stored here.

When a programmer produces a new Dedicated Server build, the complete build directory is replaced, reviewed in Git, committed, and pushed. Git LFS is used for this directory.

### `infrastructure/nginx/`
Tracks the project-owned Nginx configuration. The audited runtime targets include:

- `/etc/nginx/nginx.conf`
- `/etc/nginx/sites-available/metaverse-server`

Repository changes do not automatically modify these live paths. Deployment applies them after validation.

### `infrastructure/envoy/`
Tracks the project's Envoy configuration.

The audited production systemd service executes:

`/usr/bin/envoy -c /home/world3d/apps/metaverse-server/envoy/envoy.vps.yaml --log-level info`

Deployment must therefore place the production Envoy config at the runtime path expected by that service before restarting/reloading Envoy.

### `infrastructure/pm2/`
Tracks the PM2 process declaration for:

- `metaverse-server`
- `metaverse-warm-pool`

### `infrastructure/systemd/`
Tracks the project-owned systemd units:

- `pm2-world3d.service`
- `envoy-metaverse.service`

### `deploy/`
Deployment is intentionally separate from Git commit/merge.

The deployment layer is responsible for mapping repository paths to runtime paths, validating candidate configuration, applying changes, and reloading/restarting only the affected component.

## Files that must never be committed

- real `.env` files
- passwords, access tokens and refresh tokens
- JWT private keys
- SSL private keys
- MongoDB runtime data
- Voice recordings
- PM2 logs/state
- `node_modules`
- transient PID/log/manifest files
- server backup archives

## Git LFS

The complete `game-server/LinuxGameServer/` directory is governed by `.gitattributes` and should be added only after Git LFS is installed for the repository.

## GitHub Releases

The build can exist in the repository working tree through Git LFS and also be published as an official GitHub Release asset.

The release should record at minimum:

- Game Server version
- Git commit
- build author/uploader
- build date
- SHA256 of the release archive
- production deployment date when deployed
