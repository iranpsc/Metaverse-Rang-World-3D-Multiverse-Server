0. Identity & Scope
Project Name: Metaverse Backend

Domain: Multiplayer Online / Realtime / Auth‑Centric

Primary Protocols: gRPC + WebSocket

Auth Model: JWT (Access + Refresh)

Security Perimeter: Envoy (TLS + future JWT filter)

1. Tech Stack (Exact)
Runtime
Node.js (CommonJS)
npm
Networking
@grpc/grpc-js
@grpc/proto-loader
ws (WebSocket)
Security
jsonwebtoken
bcryptjs
TLS via Envoy
JWT (HS256 currently)
Persistence
MongoDB
Mongoose
2. Directory Structure (Truth Map)
src/

│

├─ index.js # process entrypoint

│

├─ core/

│ └─ auth/

│ ├─ auth.instance.js # composition root (DI)

│ ├─ auth.service.js # application service

│ ├─ token.service.js # JWT logic (single source)

│ ├─ password.service.js

│ └─ dto/

│

├─ transport/

│ └─ grpc/

│ ├─ server.js

│ ├─ handlers/

│ │ └─ auth.handler.js

│ └─ interceptors/

│ └─ auth.interceptor.js

│

├─ realTime/

│ ├─ index.js

│ ├─ wsAuth.js

│ ├─ roomManager.js

│ ├─ router/

│ ├─ protocol/

│ └─ stability/

│

├─ infra/

│ └─ mongo/

│ ├─ models/

│ └─ repositories/

│

└─ utils/

3. Auth Composition Root
File
src/core/auth/auth.instance.js

Responsibility
Only place where real implementations are wired
No logic
No conditions
No fallbacks
Injected Dependencies
UserRepository (Mongo)
RefreshTokenRepository (Mongo)
TokenService
PasswordService
✅ Any future refactor must start here

4. AuthService (Application Layer)
File
src/core/auth/auth.service.js

Responsibilities
Register user
Login user
Issue Access + Refresh tokens
Refresh tokens
Logout (invalidate refresh token)
NEVER does:
HTTP / gRPC handling
JWT verification for requests
Mongo schema logic
5. TokenService (Critical Component)
File
src/core/auth/token.service.js

Single Source of Truth for:
JWT secrets
issuer
audience
expiration times
Used by:
AuthService (issue tokens)
gRPC interceptor (verify access token)
WebSocket auth (wsAuth)
⚠️ Any config mismatch here breaks the entire system

6. gRPC Transport Layer
Handler
src/transport/grpc/handlers/auth.handler.js

Role
Translate gRPC request → domain DTO
Call AuthService
Map domain errors → gRPC status codes
Interceptor
src/transport/grpc/interceptors/auth.interceptor.js

Runs before handler
Extracts JWT from metadata
Uses TokenService.verifyAccessToken
Skips Register/Login/Refresh
7. Proto Contracts
Root
protos/

├─ auth/

│ └─ auth.proto

└─ health.proto

Namespace:

metaverse.v1

HealthService is used to validate:

Server is alive
Envoy routing is correct
8. MongoDB Layer
Models
UserModel.js

RefreshTokenModel.js

Repositories
user.repository.mongo.js

refreshToken.repository.mongo.js

Rules:

Repositories return domain‑ready data
No gRPC / token logic here
No business decisions
⚠️ Duplicate index warning on RefreshToken.expiresAt is known

9. Realtime WebSocket Layer
Entry
src/realTime/index.js

Auth
wsAuth.js → tokenService.verifyAccessToken

Routing
realtimeRouter.js dispatches by channel
presence / world / npc / system / voiceSignal
Room Management
roomManager.js

Responsibilities:

room lifecycle
membership
broadcast
cleanup on disconnect
10. Startup Lifecycle
File
src/index.js

Sequence:

Load env + validateConfig
Connect Mongo
Start gRPC server
Start WebSocket server
Register graceful shutdown hooks
11. Envoy Integration
TLS termination
Client connects via https://localhost:8443
Envoy proxies to:
gRPC AuthService (50051)
WS realtime endpoint
JWT filter:

Not yet enforced
Planned for Phase 2
12. Deprecated / Forbidden
❌ AuthUseCases (legacy domain layer)

❌ Multiple TokenService configs

❌ Business logic in transport

❌ Direct Mongo access outside repositories

13. Known Risks / TODO
JWT alignment with Envoy
Interceptor TokenService DI cleanup
RefreshToken index cleanup
gRPC start() deprecation
WS + gRPC token TTL sync
14. Roadmap
✅ Mongo Repo wiring
⏳ JWT alignment (Envoy + Server + WS)
⏳ Remove legacy AuthUseCases
⏳ E2E auth tests
⏳ Voice signaling hardening
⏳ SFU integration