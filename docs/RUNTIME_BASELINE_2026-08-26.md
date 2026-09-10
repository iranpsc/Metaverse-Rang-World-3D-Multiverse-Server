# Runtime Baseline — 2026-08-26

This file records the runtime state observed directly from the production-host audits.

## Operating system and installed runtime

```text
=== OS ===
PRETTY_NAME="Ubuntu 22.04.5 LTS"
NAME="Ubuntu"
VERSION_ID="22.04"
VERSION="22.04.5 LTS (Jammy Jellyfish)"
VERSION_CODENAME=jammy
ID=ubuntu
ID_LIKE=debian
HOME_URL="https://www.ubuntu.com/"
SUPPORT_URL="https://help.ubuntu.com/"
BUG_REPORT_URL="https://bugs.launchpad.net/ubuntu/"
PRIVACY_POLICY_URL="https://www.ubuntu.com/legal/terms-and-policies/privacy-policy"
UBUNTU_CODENAME=jammy
=== KERNEL ===
Linux world3d 5.15.0-185-generic #195-Ubuntu SMP Fri Jun 19 17:11:50 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux
=== NODE ===
/usr/bin/node
v22.22.3
=== NPM ===
10.9.8
=== PM2 ===
7.0.1
=== NGINX ===
nginx version: nginx/1.18.0 (Ubuntu)
=== ENVOY ===

envoy  version: a0504e87c5a246cb097b37049b1e4dc7706c2a90/1.32.2/Clean/RELEASE/BoringSSL

=== MONGODB ===
db version v8.0.23
Build Info: {
    "version": "8.0.23",
    "gitVersion": "ccf0d81588377542f00eeecf1b1ffbc095b1eeff",
    "openSSLVersion": "OpenSSL 3.0.2 15 Mar 2022",
=== FFMPEG ===
/usr/bin/ffmpeg
ffmpeg version 4.4.2-0ubuntu0.22.04.1 Copyright (c) 2000-2021 the FFmpeg developers
=== OPENSSL ===
OpenSSL 3.0.2 15 Mar 2022 (Library: OpenSSL 3.0.2 15 Mar 2022)
=== CERTBOT ===
certbot 1.21.0
```

## PM2 processes

### metaverse-server
- Script: `/home/world3d/apps/metaverse-server/src/index.js`
- Working directory: `/home/world3d/apps/metaverse-server`
- Mode: `fork_mode`
- Watch: `False`
- Autorestart: `True`
- NODE_OPTIONS: `--import=file:///home/world3d/apps/metaverse-server/src/voice/directional/voiceDirectionalRoutingExtension.js`

### metaverse-warm-pool
- Script: `/home/world3d/apps/metaverse-server/src/gameServerControl/tools/warmPoolKeepAlive.js`
- Working directory: `/home/world3d/apps/metaverse-server`
- Mode: `fork_mode`
- Watch: `False`
- Autorestart: `True`

## systemd runtime

```text
ExecStart={ path=/usr/local/lib/node_modules/pm2/bin/pm2 ; argv[]=/usr/local/lib/node_modules/pm2/bin/pm2 resurrect ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }
WorkingDirectory=
User=world3d
Id=pm2-world3d.service
FragmentPath=/etc/systemd/system/pm2-world3d.service

ExecStart={ path=/usr/bin/envoy ; argv[]=/usr/bin/envoy -c /home/world3d/apps/metaverse-server/envoy/envoy.vps.yaml --log-level info ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }
WorkingDirectory=/home/world3d/apps/metaverse-server
User=world3d
Id=envoy-metaverse.service
FragmentPath=/etc/systemd/system/envoy-metaverse.service
```

## Effective Dedicated Server target

The running PM2 environment points to:

```text
GSC_GAME_SERVER_DIR=/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer
GSC_GAME_SERVER_BIN=LinuxGameServer.x86_64
GAME_SERVER_PROCESS_MANIFEST_FILE=/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer/DedicatedServer_process_manifest.jsonl
```

Older `phase25` and backup Dedicated Server directories were observed on disk, but they are not the effective path used by the audited warm-pool process.

## External runtime paths observed

```text
=== NGINX ENABLED ===
/etc/nginx/sites-enabled/metaverse-server -> /etc/nginx/sites-available/metaverse-server
=== EXTERNAL PATHS ===
drwxr-x--- 89 world3d world3d  12288 Aug 25 23:03 /home/world3d/data/metaverse-voice-recordings
-rw-r--r--  1 root    root      2260 Jul 26 19:05 /var/www/html/completed-buildings.json
drwxrwxr-x  5 world3d www-data  4096 Jul 27 20:16 /var/www/metaverse-webgl
=== DEDICATED SERVER BINARIES ===
/home/world3d/apps/metaverse-linux-game-server-phase25/LinuxGameServer.x86_64 | 15160 bytes | 2026-06-30 08:18:28.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-phase25_backup_phase32_20260701_021155/LinuxGameServer.x86_64 | 15160 bytes | 2026-06-30 08:18:28.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-phase25_backup_phase31E_20260701_012348/LinuxGameServer.x86_64 | 15160 bytes | 2026-06-30 04:48:28.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-phase25_backup_phase31E_20260630_222006/LinuxGameServer.x86_64 | 15160 bytes | 2026-06-30 04:48:28.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-phase25_backup_phase31E_20260630_222034/LinuxGameServer.x86_64 | 15160 bytes | 2026-06-30 04:48:28.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260707_123112/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260804_064441/LinuxGameServer.x86_64 | 15160 bytes | 2026-08-04 06:44:12.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260813_132142/LinuxGameServer.x86_64 | 15160 bytes | 2026-08-06 09:36:48.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260709_154551/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260813_104509/LinuxGameServer.x86_64 | 15160 bytes | 2026-08-06 09:36:48.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260813_043955/LinuxGameServer.x86_64 | 15160 bytes | 2026-08-06 09:36:48.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260814_051807/LinuxGameServer.x86_64 | 15160 bytes | 2026-08-06 09:36:48.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260708_085751/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260813_074843/LinuxGameServer.x86_64 | 15160 bytes | 2026-08-06 09:36:48.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260807_185652/LinuxGameServer.x86_64 | 15160 bytes | 2026-08-06 09:36:48.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260814_040033/LinuxGameServer.x86_64 | 15160 bytes | 2026-08-06 09:36:48.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260813_104257/LinuxGameServer.x86_64 | 15160 bytes | 2026-08-06 09:36:48.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260811_034652/LinuxGameServer.x86_64 | 15160 bytes | 2026-08-06 09:36:48.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260806_235837/LinuxGameServer.x86_64 | 15160 bytes | 2026-08-06 09:36:48.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260711_112635/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260709_160115/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260817_150508/LinuxGameServer.x86_64 | 15160 bytes | 2026-08-06 09:36:48.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260708_093409/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260714_204319/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260804_031533/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260711_112508/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260711_091106/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer/LinuxGameServer.x86_64 | 15160 bytes | 2026-08-06 09:36:48.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260813_032213/LinuxGameServer.x86_64 | 15160 bytes | 2026-08-06 09:36:48.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260724_222725/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260813_063427/LinuxGameServer.x86_64 | 15160 bytes | 2026-08-06 09:36:48.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260706_162651/LinuxGameServer.x86_64 | 15160 bytes | 2026-06-30 08:18:28.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260808_045427/LinuxGameServer.x86_64 | 15160 bytes | 2026-08-06 09:36:48.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260711_085104/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260710_192621/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260813_031156/LinuxGameServer.x86_64 | 15160 bytes | 2026-08-06 09:36:48.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260813_060232/LinuxGameServer.x86_64 | 15160 bytes | 2026-08-06 09:36:48.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260806_234002/LinuxGameServer.x86_64 | 15160 bytes | 2026-08-06 09:36:48.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260710_210112/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260714_203549/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260711_100306/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260804_003118/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260710_215659/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260806_061047/LinuxGameServer.x86_64 | 15160 bytes | 2026-08-04 06:44:12.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260708_072540/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260707_101553/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
/home/world3d/apps/metaverse-linux-game-server-v0.33.8/LinuxGameServer.bak_20260708_091419/LinuxGameServer.x86_64 | 15160 bytes | 2026-07-06 19:53:02.000000000 +0000
```
