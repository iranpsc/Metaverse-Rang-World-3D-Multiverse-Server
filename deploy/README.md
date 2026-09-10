# Deployment Contract

Deployment scripts are intentionally not generated in this package because the final automated deployment procedure has not yet been executed and validated on production.

The currently verified mapping is:

| Repository source | Runtime destination |
| --- | --- |
| `server/` | `/home/world3d/apps/metaverse-server/` |
| `infrastructure/nginx/nginx.conf` | `/etc/nginx/nginx.conf` |
| `infrastructure/nginx/sites-available/metaverse-server` | `/etc/nginx/sites-available/metaverse-server` |
| `infrastructure/envoy/envoy.vps.yaml` | `/home/world3d/apps/metaverse-server/envoy/envoy.vps.yaml` |
| `infrastructure/pm2/ecosystem.config.cjs` | `/home/world3d/apps/metaverse-server/ecosystem.config.cjs` |
| `infrastructure/systemd/pm2-world3d.service` | `/etc/systemd/system/pm2-world3d.service` |
| `infrastructure/systemd/envoy-metaverse.service` | `/etc/systemd/system/envoy-metaverse.service` |

The currently audited Game Server runtime path is:

`/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer`

Future Game Server deployment must use the explicitly selected target/version and must not assume that `v0.33.8` remains current.

## Required validation rules

- Node changes: validate dependency/config state before PM2 restart.
- Nginx changes: validate with `nginx -t` before reload.
- Envoy changes: validate the candidate config before service restart/reload.
- systemd changes: validate units and run `systemctl daemon-reload` only when unit files change.
- Game Server changes: verify the complete uploaded build and its checksum before switching/deploying it.

Commit/merge and deployment are separate operations.
