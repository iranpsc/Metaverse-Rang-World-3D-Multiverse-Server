# create-missing-skeleton.ps1
# ساخت فقط فایل‌های MISS (بدون overwrite) + خروجی قطعی

Write-Host "SCRIPT_STARTED"
Write-Host ("PWD=" + (Get-Location))
Write-Host "============================================================"

$root = Get-Location

function Ensure-Dir([string]$dir) {
    if (!(Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir | Out-Null
        Write-Host ("MKDIR : " + $dir)
    }
}

function Write-FileIfMissing([string]$relPath, [string]$content) {
    $full = Join-Path $root $relPath
    $parent = Split-Path $full -Parent
    Ensure-Dir $parent

    if (Test-Path -LiteralPath $full) {
        Write-Host ("SKIP  : " + $relPath + " (exists)")
        return
    }

    Set-Content -LiteralPath $full -Value $content -Encoding UTF8
    Write-Host ("CREATE: " + $relPath)
}

# --- protos ---
Write-FileIfMissing "protos\realtime\realtime.proto" @"
syntax = "proto3";
package metaverse.realtime;
option csharp_namespace = "Metaverse.Realtime";

message RealtimeEnvelope {
  string type = 1;
  string channel = 2;
  string id = 3;
  int64 ts = 4;
  string room = 5;
  bytes payload = 6;
}

service RealtimeService {
  rpc Ping(RealtimeEnvelope) returns (RealtimeEnvelope);
}
"@

# --- utils ---
Write-FileIfMissing "src\utils\ids.js" @"
const { randomUUID } = require('crypto');

function newCorrelationId() { return randomUUID(); }
function newMessageId() { return randomUUID(); }
function newSessionId() { return randomUUID(); }

module.exports = { newCorrelationId, newMessageId, newSessionId };
"@

Write-FileIfMissing "src\utils\metrics.js" @"
/**
 * اسکلت متریک‌ها (ساده)
 */
const counters = new Map();

function inc(name, value = 1) {
  const prev = counters.get(name) || 0;
  counters.set(name, prev + value);
}

function get(name) { return counters.get(name) || 0; }

function snapshot() {
  const obj = {};
  for (const [k, v] of counters.entries()) obj[k] = v;
  return obj;
}

module.exports = { inc, get, snapshot };
"@

# --- realtime (folders + files) ---
Write-FileIfMissing "src\realtime\protocol\channels.js" @"
const Channels = Object.freeze({
  presence: "presence",
  world: "world",
  npc: "npc",
  voice: "voice",
  system: "system"
});
module.exports = { Channels };
"@

Write-FileIfMissing "src\realtime\protocol\envelope.js" @"
function parseEnvelope(raw) {
  const txt = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
  const obj = JSON.parse(txt);

  if (!obj || typeof obj !== "object") throw new Error("Invalid envelope");
  if (!obj.t) throw new Error("Envelope missing t");
  if (!obj.ch) throw new Error("Envelope missing ch");
  if (!obj.id) throw new Error("Envelope missing id");

  return obj;
}

function makeEnvelope({ v = 1, ch, t, id, ts = Date.now(), room = "", payload = null }) {
  return { v, ch, t, id, ts, room, payload };
}

module.exports = { parseEnvelope, makeEnvelope };
"@

Write-FileIfMissing "src\realtime\clientsRegistry.js" @"
class ClientsRegistry {
  constructor() { this.byUserId = new Map(); }
  add(userId, ws) { this.byUserId.set(userId, ws); }
  remove(userId) { this.byUserId.delete(userId); }
  get(userId) { return this.byUserId.get(userId); }
  has(userId) { return this.byUserId.has(userId); }
}
module.exports = { ClientsRegistry };
"@

Write-FileIfMissing "src\realtime\roomManager.js" @"
class RoomManager {
  constructor() { this.rooms = new Map(); }

  join(roomId, ws) {
    if (!this.rooms.has(roomId)) this.rooms.set(roomId, new Set());
    this.rooms.get(roomId).add(ws);
  }

  leave(roomId, ws) {
    const set = this.rooms.get(roomId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.rooms.delete(roomId);
  }

  broadcast(roomId, data) {
    const set = this.rooms.get(roomId);
    if (!set) return;
    for (const ws of set) {
      if (ws.readyState === 1) ws.send(data);
    }
  }
}
module.exports = { RoomManager };
"@

Write-FileIfMissing "src\realtime\wsAuth.js" @"
async function wsAuth({ tokenService }, token) {
  if (!token) throw new Error("Missing token");
  const user = await tokenService.verifyAccessToken(token);
  if (!user) throw new Error("Invalid token");
  return user;
}
module.exports = { wsAuth };
"@

Write-FileIfMissing "src\realtime\router\presenceRoutes.js" @"
function presenceRoutes(ctx, env) { return; }
module.exports = { presenceRoutes };
"@
Write-FileIfMissing "src\realtime\router\worldRoutes.js" @"
function worldRoutes(ctx, env) { return; }
module.exports = { worldRoutes };
"@
Write-FileIfMissing "src\realtime\router\npcRoutes.js" @"
function npcRoutes(ctx, env) { return; }
module.exports = { npcRoutes };
"@
Write-FileIfMissing "src\realtime\router\systemRoutes.js" @"
function systemRoutes(ctx, env) { return; }
module.exports = { systemRoutes };
"@
Write-FileIfMissing "src\realtime\router\voiceSignalRoutes.js" @"
function voiceSignalRoutes(ctx, env) { return; }
module.exports = { voiceSignalRoutes };
"@

Write-FileIfMissing "src\realtime\router\realtimeRouter.js" @"
const { presenceRoutes } = require("./presenceRoutes");
const { worldRoutes } = require("./worldRoutes");
const { npcRoutes } = require("./npcRoutes");
const { systemRoutes } = require("./systemRoutes");
const { voiceSignalRoutes } = require("./voiceSignalRoutes");

function dispatch(ctx, env) {
  switch (env.ch) {
    case "presence": return presenceRoutes(ctx, env);
    case "world": return worldRoutes(ctx, env);
    case "npc": return npcRoutes(ctx, env);
    case "system": return systemRoutes(ctx, env);
    case "voice": return voiceSignalRoutes(ctx, env);
    default: return;
  }
}

module.exports = { dispatch };
"@

Write-FileIfMissing "src\realtime\stability\heartbeat.js" @"
function startHeartbeat(ws, { intervalMs = 15000, timeoutMs = 30000, onTimeout }) {
  let lastPong = Date.now();
  ws.on("pong", () => { lastPong = Date.now(); });

  const timer = setInterval(() => {
    if (ws.readyState !== 1) return;
    const now = Date.now();
    if (now - lastPong > timeoutMs) {
      try { onTimeout && onTimeout(); } catch {}
      try { ws.terminate(); } catch {}
      clearInterval(timer);
      return;
    }
    try { ws.ping(); } catch {}
  }, intervalMs);

  return () => clearInterval(timer);
}
module.exports = { startHeartbeat };
"@

Write-FileIfMissing "src\realtime\stability\disconnectCleanup.js" @"
function attachDisconnectCleanup(ws, { onClose }) {
  ws.on("close", () => { try { onClose && onClose(); } catch {} });
  ws.on("error", () => { try { onClose && onClose(); } catch {} });
}
module.exports = { attachDisconnectCleanup };
"@

Write-FileIfMissing "src\realtime\stability\floodProtection.js" @"
function makeFloodProtection({ maxPerWindow = 60, windowMs = 1000 }) {
  let count = 0;
  let windowStart = Date.now();

  function allow() {
    const now = Date.now();
    if (now - windowStart > windowMs) {
      windowStart = now;
      count = 0;
    }
    count++;
    return count <= maxPerWindow;
  }

  return { allow };
}
module.exports = { makeFloodProtection };
"@

Write-FileIfMissing "src\realtime\index.js" @"
const WebSocket = require("ws");
const { parseEnvelope } = require("./protocol/envelope");
const { dispatch } = require("./router/realtimeRouter");
const { ClientsRegistry } = require("./clientsRegistry");
const { RoomManager } = require("./roomManager");
const { startHeartbeat } = require("./stability/heartbeat");
const { attachDisconnectCleanup } = require("./stability/disconnectCleanup");
const { makeFloodProtection } = require("./stability/floodProtection");

function attachRealtime({ server, tokenService, logger }) {
  const wss = new WebSocket.Server({ server });
  const registry = new ClientsRegistry();
  const rooms = new RoomManager();

  wss.on("connection", (ws, req) => {
    const flood = makeFloodProtection({});
    const ctx = { ws, req, registry, rooms, logger, tokenService, user: null };

    const stopHb = startHeartbeat(ws, {
      onTimeout: () => logger && logger.warn && logger.warn("WS timeout")
    });

    attachDisconnectCleanup(ws, { onClose: () => { try { stopHb(); } catch {} } });

    ws.on("message", (raw) => {
      if (!flood.allow()) return;
      let env;
      try { env = parseEnvelope(raw); } catch { return; }
      try { dispatch(ctx, env); } catch {}
    });
  });

  return { wss, registry, rooms };
}

module.exports = { attachRealtime };
"@

# --- voice ---
Write-FileIfMissing "src\voice\docs\voice-architecture.md" @"
# Voice Architecture (Placeholder)
فاز ۱: signaling روی WebSocket
فاز ۲: STUN/TURN
فاز ۳: SFU
"@

Write-FileIfMissing "src\voice\webrtc\stunTurnConfig.js" @"
function getStunTurnConfig() {
  return { iceServers: [{ urls: [""stun:stun.l.google.com:19302""] }] };
}
module.exports = { getStunTurnConfig };
"@

Write-FileIfMissing "src\voice\webrtc\sfuAdapter.js" @"
class SfuAdapter {
  async connect() { return; }
}
module.exports = { SfuAdapter };
"@

# --- tests ---
Write-FileIfMissing "src\test\basic-test.js" @"
console.log(""basic-test placeholder"");
process.exit(0);
"@
Write-FileIfMissing "src\test\bench\presence-load.js" 'console.log("presence-load placeholder");'
Write-FileIfMissing "src\test\bench\world-broadcast.js" 'console.log("world-broadcast placeholder");'
Write-FileIfMissing "src\test\bench\npc-push.js" 'console.log("npc-push placeholder");'
Write-FileIfMissing "src\test\bench\voice-signal.js" 'console.log("voice-signal placeholder");'

# --- env example ---
Write-FileIfMissing ".env.example" @"
NODE_ENV=development
GRPC_HOST=0.0.0.0
GRPC_PORT=50051
PUBLIC_PORT=8443
TLS_CERT_PATH=certs/localhost.pem
TLS_KEY_PATH=certs/localhost-key.pem
JWT_ISSUER=metaverse
JWT_ACCESS_TTL_SEC=900
JWT_REFRESH_TTL_SEC=604800
"@

Write-Host "============================================================"
Write-Host "SCRIPT_ENDED"
