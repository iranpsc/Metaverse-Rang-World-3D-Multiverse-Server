# Contributing to Metaverse Production Server

Thank you for contributing to the **Metaverse Production Server**.

This repository contains production infrastructure for the MetaRang / Metaverse backend platform. It is a production monorepo rather than a conventional application repository and includes application code, realtime services, authentication, Dedicated Game Server management, voice infrastructure, reverse-proxy configuration, process management, deployment contracts, and the complete Linux Dedicated Game Server build.

Because changes in this repository can affect live authentication, realtime communication, game sessions, voice services, infrastructure, and production deployments, contributions must be deliberate, scoped, testable, and reviewable.

---

## Table of Contents

* [Repository Scope](#repository-scope)
* [Architecture Overview](#architecture-overview)
* [Before You Start](#before-you-start)
* [Repository Structure](#repository-structure)
* [Development Environment](#development-environment)
* [Git LFS and Game Server Builds](#git-lfs-and-game-server-builds)
* [Making a Change](#making-a-change)
* [Branching Strategy](#branching-strategy)
* [Commit Guidelines](#commit-guidelines)
* [Pull Requests](#pull-requests)
* [Testing Requirements](#testing-requirements)
* [Realtime Changes](#realtime-changes)
* [Authentication and Security Changes](#authentication-and-security-changes)
* [Game Server Changes](#game-server-changes)
* [Voice Changes](#voice-changes)
* [Infrastructure Changes](#infrastructure-changes)
* [Configuration and Environment Variables](#configuration-and-environment-variables)
* [API and Protocol Compatibility](#api-and-protocol-compatibility)
* [Performance and Resource Considerations](#performance-and-resource-considerations)
* [Documentation Requirements](#documentation-requirements)
* [Deployment](#deployment)
* [Rollback](#rollback)
* [Security](#security)
* [Code Review Principles](#code-review-principles)
* [Maintainer Rules](#maintainer-rules)
* [Checklist](#contribution-checklist)

---

## Repository Scope

The repository is the version-controlled source of truth for the production components maintained by the server team.

The repository currently contains:

```text
server/
game-server/
infrastructure/
deploy/
docs/
```

The main responsibilities are:

| Directory         | Responsibility                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `server/`         | Node.js application, authentication, realtime, Game Server Control, voice and business logic |
| `game-server/`    | Complete Linux Dedicated Game Server build                                                   |
| `infrastructure/` | Nginx, Envoy, PM2 and systemd configuration                                                  |
| `deploy/`         | Repository-to-runtime deployment contract and deployment documentation                       |
| `docs/`           | Architecture, runtime baseline, repository rules and operational documentation               |

The repository intentionally separates source-controlled configuration from runtime state.

Do **not** commit:

* production secrets;
* private JWT signing keys;
* TLS private keys;
* runtime voice recordings;
* runtime databases;
* generated runtime state;
* machine-specific credentials;
* unapproved production data;
* temporary deployment artifacts.

Production values must remain outside Git.

---

## Architecture Overview

The production platform consists of multiple coordinated components.

At a high level:

```text
Unity / WebGL / Windows Client
              |
              v
        Nginx / TLS
          /       \
         v         v
      Envoy      WebSocket
         |         |
         v         v
       gRPC     Node.js
         \         /
          \       /
           v     v
          Shared Runtime
          /    |     \
         /     |      \
        v      v       v
     MongoDB   GSC    Voice
                |
                v
        Dedicated Game Servers
```

The Node.js application provides the main application runtime and coordinates:

* authentication;
* JWT access and refresh tokens;
* external account integration;
* native gRPC;
* gRPC-Web compatibility;
* WebSocket realtime;
* bidirectional gRPC realtime;
* rooms and lobby management;
* Dedicated Game Server allocation;
* Game Server Control;
* voice runtime;
* voice recording;
* NPC voice;
* operational health and metrics.

Multiple client transports are intentionally connected to shared application state. WebGL uses WebSocket realtime while native-capable clients can use bidirectional gRPC streaming. Contributions must preserve this shared-runtime model rather than creating duplicate business logic for individual transports.

---

## Before You Start

Before making a change:

1. Read the root `README.md`.
2. Read the relevant documentation under `docs/`.
3. Check `docs/REPOSITORY_CONTRACT.md`.
4. Check `docs/REPOSITORY_SCOPE.md`.
5. For deployment-related work, read `deploy/README.md`.
6. For runtime-sensitive work, check `docs/RUNTIME_BASELINE_2026-08-26.md`.
7. For voice changes, read the relevant documentation under:

   ```text
   server/src/voice/docs/
   ```
8. Check existing tests in the affected subsystem.
9. Check open Issues and Pull Requests before creating duplicate work.

The repository's production baseline was audited on **2026-08-26**. Runtime paths, ports, versions and deployment details documented from that audit are not assumptions about every future environment.

---

## Repository Structure

### `server/`

The main Node.js application uses ES modules.

The production entry point is:

```text
server/src/index.js
```

The application integrates:

* MongoDB through Mongoose;
* native gRPC;
* gRPC-Web through Envoy;
* WebSocket realtime;
* authentication;
* external account microservices;
* Game Server Control;
* voice services.

Application startup is intentionally centralized and has an established dependency order.

Do not move startup responsibilities between modules without understanding their initialization and shutdown dependencies.

---

### `server/src/realTime/`

Realtime functionality is implemented here.

Important areas include:

```text
server/src/realTime/
server/src/realTime/protocol/
server/src/realTime/lobby/
server/src/realTime/test/
```

The realtime layer contains:

* connection registry;
* room management;
* presence;
* world/game/lobby/chat/NPC routes;
* ACK tracking;
* heartbeat;
* flood protection;
* disconnect cleanup;
* room membership;
* persistent room directory.

Realtime changes must preserve consistency between WebSocket and native gRPC transports.

---

### `server/src/gameServerControl/`

This subsystem manages Dedicated Game Servers.

It includes:

```text
allocation/
auth/
handlers/
http/
registry/
routes/
security/
sessions/
tickets/
tools/
```

Responsibilities include:

* Dedicated Server registration;
* health and heartbeat tracking;
* allocation;
* client tickets;
* service tokens;
* session lifecycle;
* auto-launch;
* warm capacity;
* process management;
* resource policies.

The allocator considers room, region, zone, capacity and health when selecting a server.

---

### `server/src/voice/`

The voice system is a production subsystem with its own architecture and tests.

Major areas include:

```text
adapters/
auth/
bootstrap/
capacity/
config/
core/
dedicated/
directional/
docs/
mute/
npc/
observability/
protocol/
reconnect/
recording/
routing/
security/
session/
tests/
transport/
```

Voice changes must be treated as protocol/runtime changes rather than ordinary isolated feature changes.

---

### `game-server/LinuxGameServer/`

This directory contains the complete generated Linux Dedicated Game Server build.

It is tracked using Git LFS.

A Game Server update must be treated as a **complete build replacement**, not as an arbitrary collection of manually edited runtime files.

Do not mix files from different Unity builds unless a separate, documented and tested process explicitly permits it.

---

### `infrastructure/`

Infrastructure configuration is divided into:

```text
infrastructure/
├── nginx/
├── envoy/
├── pm2/
└── systemd/
```

These files represent desired production configuration and are mapped to runtime locations during deployment.

Changing infrastructure configuration can affect the entire production platform and therefore requires additional validation.

---

## Development Environment

The audited production baseline currently documents:

```text
Ubuntu       22.04.5 LTS
Node.js      v22.22.3
npm          10.9.8
PM2          7.0.1
Nginx        1.18.0
Envoy        1.32.2
MongoDB      8.0.23
FFmpeg       4.4.2
OpenSSL      3.0.2
Certbot      1.21.0
```

These versions describe the audited production environment and should not automatically be interpreted as a requirement for every development machine.

Before changing runtime requirements, verify compatibility with the production baseline and document intentional version changes.

### Install dependencies

From the `server/` directory:

```bash
npm ci
```

Use `npm ci` when reproducing the repository's locked dependency tree.

Do not modify `package-lock.json` manually.

If dependencies change:

```bash
npm install <package>
```

and include the resulting lockfile changes in the same pull request.

---

## Git LFS and Game Server Builds

Git LFS is required for the Dedicated Game Server tree.

Before working with the complete repository:

```bash
git lfs install
```

Verify:

```bash
git lfs version
```

After cloning:

```bash
git lfs pull
```

The repository tracks:

```text
game-server/LinuxGameServer/**
```

through Git LFS.

Do not bypass Git LFS by committing large binary files directly to ordinary Git objects.

### Game Server update requirements

A new Game Server build should follow this process:

```text
Create complete Unity Linux Dedicated Server build
        ↓
Replace game-server/LinuxGameServer/
        ↓
Verify Git LFS tracking
        ↓
Review changed files
        ↓
Calculate / verify SHA256
        ↓
Run required validation
        ↓
Commit
        ↓
Pull Request review
        ↓
Merge
        ↓
Optional GitHub Release
        ↓
Explicit deployment
```

Official production builds should also be published as GitHub Releases when appropriate.

A release should record at minimum:

* Game Server version;
* Git commit;
* build author/uploader;
* build date;
* SHA256;
* production deployment date.

---

## Making a Change

Keep every change narrowly scoped.

Before modifying code:

```bash
git status
git diff
git branch --show-current
```

Create a dedicated branch from the current target branch.

A good change should answer:

* What problem does this solve?
* Which subsystem owns the change?
* Which interfaces are affected?
* What existing behavior must remain unchanged?
* What tests validate the change?
* Does deployment configuration need to change?
* Does documentation need to change?
* Is rollback possible?

### Avoid unrelated changes

Do not combine unrelated modifications.

For example:

```text
Good:
Voice routing fix
+ related voice tests
+ required voice documentation

Bad:
Voice routing fix
+ unrelated Nginx cleanup
+ dependency upgrade
+ Game Server binary update
```

Scoped changes make review, debugging and rollback safer.

---

## Branching Strategy

Use short-lived feature or fix branches.

Recommended naming:

```text
feature/<short-description>
fix/<short-description>
refactor/<short-description>
docs/<short-description>
test/<short-description>
infra/<short-description>
security/<short-description>
```

Examples:

```text
feature/realtime-room-reconnect
fix/game-server-ticket-expiry
fix/voice-recording-download-auth
infra/envoy-jwt-routing
docs/deployment-validation
test/realtime-websocket-smoke
```

Do not use vague branch names such as:

```text
changes
update
test
new
fixes
```

---

## Commit Guidelines

Commits should describe one logical change.

Recommended format:

```text
<type>: <short imperative description>
```

Examples:

```text
feat: add dedicated server ticket renewal
fix: reject expired game server service tokens
fix: clean stale realtime room membership
refactor: isolate voice session authority
test: add realtime websocket smoke coverage
docs: update production deployment validation
infra: validate Envoy gRPC-Web routing
security: harden service token validation
```

Keep commits:

* focused;
* reviewable;
* reversible;
* free from unrelated formatting changes.

Avoid commits such as:

```text
update stuff
fix many things
changes
final
test
```

---

## Pull Requests

Every production change must go through review.

A Pull Request should contain:

### 1. Summary

Explain what changed and why.

### 2. Scope

Identify the affected subsystem:

```text
server
realtime
authentication
game-server-control
voice
infrastructure
deployment
documentation
game-server-build
```

### 3. Technical details

Explain important implementation decisions.

### 4. Compatibility

Document whether the change affects:

* public routes;
* gRPC RPCs;
* protobuf messages;
* WebSocket messages;
* environment variables;
* authentication;
* tokens;
* Game Server Control;
* voice contracts;
* deployment paths.

### 5. Testing

List the commands and validation performed.

Example:

```text
npm test
node server/src/realTime/test/realtimeWebSocketSmoke.js
node <relevant voice test>
```

### 6. Deployment impact

Explicitly state:

```text
Deployment required: Yes / No
Restart required: Yes / No
Nginx reload required: Yes / No
Envoy reload required: Yes / No
systemd reload required: Yes / No
Game Server replacement required: Yes / No
```

### 7. Rollback

Explain how the change can be reverted if necessary.

---

## Pull Request Title

Use a concise title describing the change.

Examples:

```text
Fix realtime disconnect cleanup
Add Dedicated Server ticket renewal
Harden voice recording authorization
Update Envoy gRPC-Web routing
Add Game Server allocation tests
```

Avoid titles that describe only the implementation detail without the purpose.

---

## Testing Requirements

Tests should be added or updated whenever behavior changes.

The repository already contains subsystem-specific testing utilities.

### Game Server Control

Tests cover areas including:

* module attachment;
* HTTP API;
* raw HTTP adapter;
* route registration;
* startup probes;
* client ticket authentication;
* access-token based tickets;
* capacity allocation.

Relevant tests should be executed when changing Game Server Control behavior.

---

### Realtime

Realtime testing utilities include:

```text
server/src/realTime/test/realtimeLoginConnectHold.js
server/src/realTime/test/realtimeLoginConnectHold_AutoRegister.js
server/src/realTime/test/realtimeWebSocketSmoke.js
```

Documentation:

```text
server/src/realTime/test/README_REALTIME_SMOKE.md
```

Realtime changes should validate at minimum the affected:

* authentication;
* connection lifecycle;
* room membership;
* heartbeat;
* ACK behavior;
* disconnect cleanup;
* message routing.

---

### Voice

Voice has dedicated test coverage under:

```text
server/src/voice/tests/
```

The test suite covers areas such as:

* architecture contracts;
* authentication;
* connection identity;
* connection registry;
* transport;
* WebSocket;
* gRPC;
* session authority;
* Dedicated Server session deltas;
* routing;
* reconnect;
* recording;
* directional policy;
* recording consent;
* operational metrics;
* NPC voice;
* production composition.

When modifying voice behavior, run the narrowest relevant tests first, followed by the broader voice suite when required.

---

## Realtime Changes

Realtime is shared infrastructure.

Do not implement separate business logic merely because two transports are different.

The intended architecture is:

```text
                 Shared Runtime
                /              \
        WebSocket              gRPC
          WebGL             Native Client
```

Changes must preserve consistent:

* room state;
* presence;
* authentication;
* message routing;
* disconnect handling;
* heartbeat behavior;
* ACK handling.

The current stability system includes heartbeat, ACK tracking, flood protection and disconnect cleanup.

Do not remove or bypass these mechanisms without a documented architectural reason.

---

## Authentication and Security Changes

Authentication is separated into:

```text
domain
core
persistence
transport
external integration
```

Do not move all authentication responsibilities into transport handlers.

The authentication system supports:

* user identity;
* password hashing;
* access tokens;
* refresh tokens;
* refresh-token rotation;
* revocation;
* logout;
* logout across devices;
* external account integration.

The production JWT configuration uses asymmetric signing with RS256.

The public JWKS endpoint is:

```text
/.well-known/jwks.json
```

Private JWT keys must never be committed.

Never commit:

```text
JWT private keys
MICROSERVICE_CLIENT_SECRET
MICROSERVICE_TOKEN_ENCRYPTION_SECRET
GAME_SERVER_SERVICE_SECRET
TLS private keys
```

or equivalent secrets.

If a secret is accidentally committed, removing it from the latest commit is not sufficient. Treat it as compromised and follow the repository security process.

---

## API and Protocol Compatibility

This repository contains several externally meaningful interfaces.

Do not casually rename, remove or change:

* public HTTP routes;
* protobuf RPCs;
* protobuf message contracts;
* environment keys;
* Game Server Control endpoints;
* realtime protocol messages;
* voice contracts;
* runtime entry points;
* PM2 process names;
* systemd service names.

Breaking changes require:

1. explicit identification of the affected interface;
2. compatibility analysis;
3. migration plan;
4. test coverage;
5. documentation;
6. reviewer approval.

If backward compatibility is intentionally removed, the Pull Request must explain why and how clients and production services will migrate.

---

## Game Server Changes

The Dedicated Game Server is a generated Unity build and should be treated differently from ordinary source code.

A build update must not be performed by manually editing individual runtime files.

Required validation should include:

```text
build checksum
executable presence
warm-pool launch
Dedicated Server registration
heartbeat
client ticket creation
ticket verification
client connection
```

Keep the previous verified Game Server version available for rollback.

Do not delete the previous runtime version merely because a new build has been deployed.

---

## Voice Changes

Voice is a production subsystem with authentication, routing, sessions, recording and security boundaries.

Voice changes should consider:

```text
connection identity
session authority
transport
routing
mute
reconnect
recording
directional policy
NPC voice
metrics
security audit
```

Voice recordings are runtime data and must not be committed.

The production recording root is outside the repository.

Recording download must continue to resolve authorization using the authenticated user and session rather than exposing the raw recording directory.

Do not convert protected operational metrics or recordings into public endpoints without an explicit security review.

---

## Infrastructure Changes

Infrastructure changes include:

```text
Nginx
Envoy
PM2
systemd
TLS
gRPC
gRPC-Web
WebSocket routing
Dedicated Server proxying
```

Infrastructure changes require extra validation.

### Nginx

Before reload:

```bash
nginx -t
```

Verify:

* HTTPS;
* WebSocket upgrade;
* gRPC-Web;
* native gRPC;
* health endpoint;
* Dedicated Server routing;
* voice routes.

### Envoy

Before restart/reload:

* validate configuration syntax;
* verify JWKS configuration;
* verify gRPC backend;
* verify listener configuration;
* verify gRPC-Web routing.

After activation:

* confirm Envoy is running;
* verify gRPC-Web reaches the native backend;
* verify JWT/JWKS validation.

### systemd

When changing a tracked systemd unit:

```bash
sudo systemctl daemon-reload
```

Then restart or reload only the affected service.

Verify:

```bash
systemctl status <service>
journalctl -u <service>
```

Do not restart unrelated production services without a reason.

---

## Configuration and Environment Variables

Environment variables are part of the application's operational contract.

Examples include configuration for:

* MongoDB;
* JWT;
* microservice integration;
* Game Server Control;
* ticket rate limits;
* service tokens;
* warm pool;
* process resource limits;
* voice;
* FFmpeg;
* recording storage.

Do not silently rename or remove environment variables.

If a configuration key must change:

```text
old key
    ↓
migration / compatibility period
    ↓
new key
    ↓
documentation update
```

Never commit production values.

Use `.env.example` for non-secret configuration documentation.

---

## Performance and Resource Considerations

This repository controls realtime and Dedicated Game Server workloads where resource usage can directly affect production capacity.

When changing performance-sensitive code, consider:

* CPU usage;
* memory growth;
* socket count;
* MongoDB query load;
* process spawning;
* Dedicated Server capacity;
* voice recording I/O;
* FFmpeg processing;
* message frequency;
* allocation latency;
* connection cleanup;
* timers;
* retry behavior.

Avoid:

* unbounded queues;
* unbounded Maps/Sets;
* infinite retries;
* unnecessary polling;
* duplicated network requests;
* synchronous expensive operations in request handlers;
* loading large files into memory without justification;
* logging sensitive or high-volume payloads.

Before increasing a polling interval, timeout, retry count or resource limit, understand its production impact.

---

## Logging and Sensitive Data

Logs must not expose secrets or sensitive user data.

Do not log:

* passwords;
* JWT private keys;
* client secrets;
* service secrets;
* raw refresh tokens;
* private TLS material;
* complete voice recordings;
* unnecessary authentication credentials.

Prefer structured diagnostic information such as:

```text
request ID
session ID
room ID
server ID
operation
error code
duration
```

where appropriate and safe.

---

## Documentation Requirements

Documentation must be updated when behavior or operational requirements change.

Update the relevant document when changing:

* deployment mappings;
* runtime paths;
* ports;
* environment variables;
* protocol contracts;
* authentication behavior;
* Game Server versions;
* infrastructure behavior;
* voice architecture;
* operational procedures.

Important repository documentation includes:

```text
README.md
docs/REPOSITORY_CONTRACT.md
docs/REPOSITORY_SCOPE.md
docs/RUNTIME_BASELINE_2026-08-26.md
docs/FIRST_GITHUB_IMPORT.md
docs/REMOVED_FROM_REPOSITORY_PACKAGE.txt
deploy/README.md
server/src/voice/docs/
```

Documentation should describe verified behavior rather than assumptions.

---

## Deployment

A Git commit is **not** a production deployment.

The intended production lifecycle is:

```text
Developer change
      ↓
Git commit
      ↓
Pull Request
      ↓
Review
      ↓
Merge
      ↓
Explicit deployment
      ↓
Component validation
      ↓
Targeted reload/restart
      ↓
Runtime health verification
      ↓
Deployment accepted
```

Deployment should be performed according to the verified deployment contract in:

```text
deploy/README.md
```

Before deployment, perform all available non-destructive checks.

Examples:

```text
git diff
configuration validation
file existence
runtime path verification
port inspection
service status
environment verification
checksum comparison
```

Only after those checks should disruptive operations be performed.

---

## Deployment Validation

A successful copy, restart or reload does not by itself prove a successful deployment.

### Node.js

Verify:

* process is running;
* startup logs are clean;
* MongoDB connection is healthy;
* gRPC is active;
* HTTP is active;
* WebSocket is active;
* Game Server Control is attached;
* required voice runtime is attached.

### Nginx

Verify:

* configuration test passes;
* reload succeeds;
* HTTPS responds;
* WebSocket upgrade works;
* gRPC paths remain reachable.

### Envoy

Verify:

* service is active;
* listener is active;
* gRPC-Web reaches the native backend;
* JWT/JWKS validation works.

### Dedicated Game Server

Verify:

* checksum;
* executable;
* warm-pool launch;
* registration;
* heartbeat;
* ticket creation;
* ticket verification;
* client connection.

Do not declare a deployment complete without component-specific validation.

---

## Rollback

Every risky production change must have a rollback path.

### Application

Return to the previously approved Git commit and redeploy the affected application component.

### Infrastructure

Restore the previously validated Nginx, Envoy or systemd configuration.

Revalidate before activation.

### Game Server

Use the previously verified versioned Game Server directory or GitHub Release.

Do not rebuild an old Game Server from memory when a verified previous build is available.

### Database

Database migrations require an explicit rollback or forward-recovery strategy before deployment.

Never assume that application rollback automatically rolls back database state.

---

## Security

Security issues should **not** be reported through ordinary Pull Requests or public Issues.

Follow the repository's:

```text
SECURITY.md
```

for vulnerability reporting.

Do not disclose:

* credentials;
* private keys;
* exploitable production endpoints;
* authentication bypasses;
* token material;
* private production data

in public issues or Pull Requests.

---

## Code Review Principles

Reviewers should prioritize:

### Correctness

Does the change behave correctly under normal and failure conditions?

### Compatibility

Does it preserve existing public interfaces?

### Security

Could it expose credentials, tokens, recordings, internal services or unauthorized data?

### Reliability

What happens during:

* disconnects;
* restarts;
* timeouts;
* duplicate requests;
* stale sessions;
* unavailable dependencies;
* process crashes?

### Performance

Could this increase:

* CPU;
* memory;
* network traffic;
* database load;
* process count;
* disk I/O?

### Observability

Can operators identify and diagnose failures without exposing sensitive information?

### Deployment Safety

Can the change be deployed incrementally and rolled back safely?

### Scope

Does the Pull Request contain only the changes necessary to solve the stated problem?

---

## Maintainer Rules

The following rules are especially important for this repository.

### Preserve existing interfaces unless the change requires it

Do not rename or remove existing:

```text
public routes
protobuf RPCs
environment keys
runtime entry points
PM2 process names
systemd service names
Game Server Control endpoints
voice contracts
```

without an explicitly reviewed migration plan.

### Do not mix unrelated changes

Examples:

```text
Voice routing fix
≠
Nginx refactor
```

```text
Game Server build update
≠
unrelated Node.js refactor
```

```text
Infrastructure change
≠
feature removal without evidence
```

### Validate before expensive operations

Before:

```text
build
deploy
restart
reload
reimport
complete Game Server replacement
```

perform all available non-destructive validation first.

---

## Contribution Checklist

Before opening a Pull Request:

### Scope

* [ ] The change has a clearly defined purpose.
* [ ] The change is limited to the required subsystem.
* [ ] Unrelated files were not modified.

### Code

* [ ] Existing architecture and boundaries are preserved.
* [ ] Existing public interfaces are preserved unless intentionally migrated.
* [ ] Error handling is appropriate.
* [ ] Resource usage has been considered.
* [ ] Sensitive information is not logged.

### Tests

* [ ] Relevant existing tests were executed.
* [ ] New behavior has appropriate test coverage.
* [ ] Realtime changes include realtime validation where applicable.
* [ ] Voice changes include relevant voice tests.
* [ ] Game Server changes include build/runtime validation.

### Security

* [ ] No secrets were added.
* [ ] No private keys were added.
* [ ] Authentication/authorization behavior was reviewed where relevant.
* [ ] Recording and token access remains protected.
* [ ] Security-sensitive changes are documented.

### Infrastructure

* [ ] Nginx configuration was validated when changed.
* [ ] Envoy configuration was validated when changed.
* [ ] systemd configuration was validated when changed.
* [ ] PM2 configuration was validated when changed.
* [ ] Deployment impact is documented.

### Game Server

* [ ] Git LFS is configured.
* [ ] Complete build integrity was verified.
* [ ] SHA256 was checked where applicable.
* [ ] Previous production version remains available for rollback.

### Documentation

* [ ] Relevant documentation was updated.
* [ ] Runtime/deployment changes are documented.
* [ ] New configuration keys are documented.
* [ ] Protocol changes are documented.

### Pull Request

* [ ] PR title clearly describes the change.
* [ ] PR description explains the reason for the change.
* [ ] Testing performed is documented.
* [ ] Deployment impact is documented.
* [ ] Rollback procedure is documented.
* [ ] Reviewers can reproduce or validate the change.

---

## Final Principle

The goal of contribution is not simply to make the code work locally.

Every change should remain:

```text
understandable
      +
testable
      +
reviewable
      +
secure
      +
observable
      +
deployable
      +
rollbackable
```

The Metaverse Production Server is a coordinated production system. Changes to one component can affect authentication, realtime communication, Dedicated Game Servers, voice services, infrastructure, or client connectivity.

Keep changes small, preserve established contracts, validate before deployment, document operational impact, and prefer evidence over assumptions.

Thank you for helping keep the Metaverse server platform reliable and maintainable.
