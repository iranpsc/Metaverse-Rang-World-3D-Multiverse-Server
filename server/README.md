# Metaverse gRPC Server (Stage 1)

Stage 1 RPCs:
- Register(emailOrUsername, password)
- Login(emailOrUsername, password)
- GetUserData()  (requires Authorization: Bearer <token>)

## Ports
- Node gRPC: localhost:50051 (insecure - behind Envoy)
- Envoy gRPC-Web + TLS: https://localhost:8443

## Dev TLS with mkcert
Run (PowerShell) in `server/`: