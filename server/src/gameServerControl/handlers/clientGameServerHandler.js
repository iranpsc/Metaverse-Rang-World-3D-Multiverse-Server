// File => src/gameServerControl/handlers/clientGameServerHandler.js

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

const CURRENT_FILE_PATH = fileURLToPath(import.meta.url);
const CURRENT_DIR_PATH = path.dirname(CURRENT_FILE_PATH);
const DEFAULT_PROJECT_ROOT = path.resolve(CURRENT_DIR_PATH, "../../..");
const DEFAULT_LAUNCHER_SCRIPT_PATH = path.resolve(CURRENT_DIR_PATH, "../tools/launchDedicatedRoomServer.js");

const DEFAULT_AUTO_LAUNCH_ENABLED = true;
const DEFAULT_AUTO_LAUNCH_START_PORT = 7777;
const DEFAULT_AUTO_LAUNCH_MAX_PORT_SCAN = 120;
const DEFAULT_AUTO_LAUNCH_WAIT_MS = 9000;
const DEFAULT_AUTO_LAUNCH_MAX_BUFFER = 1024 * 1024;

const DEFAULT_AUTO_LAUNCH_MAX_ACTIVE_SERVERS = 7;
const DEFAULT_AUTO_LAUNCH_MAX_PENDING_LAUNCHES = 2;
const DEFAULT_AUTO_LAUNCH_ROOM_COOLDOWN_MS = 15000;

const DEFAULT_TICKET_RATE_LIMIT_ENABLED = true;
const DEFAULT_TICKET_RATE_LIMIT_WINDOW_MS = 10000;
const DEFAULT_TICKET_RATE_LIMIT_MAX = 4;

const DEFAULT_AUTO_LAUNCH_RATE_LIMIT_ENABLED = true;
const DEFAULT_AUTO_LAUNCH_RATE_LIMIT_WINDOW_MS = 60000;
const DEFAULT_AUTO_LAUNCH_RATE_LIMIT_MAX = 7;

const DEFAULT_RATE_LIMIT_MAX_BUCKETS = 5000;
const DEFAULT_WEBGL_PUBLIC_PORT = 443;
const DEFAULT_WEBGL_PATH_PREFIX = "/game-server";
const DEFAULT_AUTO_LAUNCH_MIN_SERVER_MAX_PLAYERS = 200;
const MAX_ROOM_MAX_PLAYERS = 1024;


//* این تابع زمان فعلی را به میلی ثانیه برمی گرداند.
function nowMs() {
    return Date.now();
}

//* این تابع بررسی می کند مقدار رشته ای معتبر است یا نه.
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

//* این تابع مقدار بولین را از اِنوی می خواند.
function readBooleanEnv(name, fallbackValue) {
    const rawValue = process.env[name];

    if (rawValue === undefined || rawValue === null || rawValue === "") return fallbackValue;

    const normalizedValue = String(rawValue).trim().toLowerCase();

    if (normalizedValue === "true") return true;
    if (normalizedValue === "1") return true;
    if (normalizedValue === "yes") return true;
    if (normalizedValue === "on") return true;

    if (normalizedValue === "false") return false;
    if (normalizedValue === "0") return false;
    if (normalizedValue === "no") return false;
    if (normalizedValue === "off") return false;

    return fallbackValue;
}

//* این تابع مقدار عدد صحیح را از اِنوی می خواند.
function readIntegerEnv(name, fallbackValue, minValue, maxValue) {
    const rawValue = process.env[name];

    if (rawValue === undefined || rawValue === null || rawValue === "") return fallbackValue;

    return clampInteger(rawValue, fallbackValue, minValue, maxValue);
}

//* این تابع مقدار عدد صحیح را در بازه امن نگه می دارد.
function clampInteger(value, fallbackValue, minValue, maxValue) {
    const parsedValue = Number.parseInt(value, 10);

    if (!Number.isFinite(parsedValue)) return fallbackValue;
    if (parsedValue < minValue) return minValue;
    if (parsedValue > maxValue) return maxValue;

    return parsedValue;
}

//* این تابع مقدار رشته ای را تمیز می کند و اگر خالی بود مقدار پیش فرض می دهد.
function cleanString(value, fallbackValue = "") {
    if (!isNonEmptyString(value)) return fallbackValue;
    return value.trim();
}

//* این تابع ظرفیت رزرو شده روم را از درخواست تیکت می خواند.
function normalizeRoomCapacity(request = {}, metadata = {}) {
    const candidates = [
        { source: "request.roomMaxPlayers", value: request.roomMaxPlayers },
        { source: "request.maxPlayers", value: request.maxPlayers },
        { source: "metadata.roomMaxPlayers", value: metadata.roomMaxPlayers },
        { source: "metadata.maxPlayers", value: metadata.maxPlayers },
        { source: "metadata.roomCapacity", value: metadata.roomCapacity }
    ];

    for (const candidate of candidates) {
        if (candidate.value === undefined || candidate.value === null || candidate.value === "") continue;

        const parsedValue = Number.parseInt(candidate.value, 10);

        return {
            roomMaxPlayersProvided: true,
            roomMaxPlayers: Number.isFinite(parsedValue) ? parsedValue : 0,
            roomCapacitySource: candidate.source
        };
    }

    return {
        roomMaxPlayersProvided: false,
        roomMaxPlayers: 0,
        roomCapacitySource: ""
    };
}

//* این تابع مسیر وب سوکت را برای پاسخ تیکت استاندارد می کند.
function normalizeConnectionPath(value, fallbackValue = "") {
    const safeValue = cleanString(value, fallbackValue);

    if (!safeValue) return "";

    const withPrefix = safeValue.startsWith("/") ? safeValue : `/${safeValue}`;
    return withPrefix.replace(/\/+$/g, "");
}

//* این تابع پلتفرم کلاینت را از متادیتا می خواند.
function readClientPlatform(metadata = {}) {
    return cleanString(
        metadata.platform ??
        metadata.Platform ??
        metadata.clientPlatform ??
        metadata.ClientPlatform,
        ""
    );
}

//* این تابع تشخیص می دهد تیکت برای وب جی ال صادر می شود یا نه.
function isWebGlTicketRequest(normalizedRequest = {}) {
    const platform = readClientPlatform(normalizedRequest.metadata).toLowerCase();
    return platform.includes("webgl");
}

//* این تابع مقدار امن برای نام فایل یا شناسه می سازد.
function safeFilePart(value) {
    return String(value || "")
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .replace(/_+/g, "_")
        .slice(0, 120);
}

//* این تابع شناسه یوزر را از کانتکست یا درخواست می خواند.
function readUserId(ctx = {}, request = {}) {
    return cleanString(
        ctx.userId ??
        ctx.user?.userId ??
        ctx.user?.id ??
        request.userId,
        ""
    );
}

//* این تابع درخواست کلاینت برای گرفتن گیم تیکت را استاندارد می کند.
function normalizeTicketRequest(ctx = {}, request = {}) {
    const metadata = request.metadata ?? {};
    const roomCapacity = normalizeRoomCapacity(request, metadata);

    return {
        userId: readUserId(ctx, request),
        roomId: cleanString(request.roomId, ""),
        roomName: cleanString(request.roomName ?? metadata.roomName, ""),
        roomMaxPlayers: roomCapacity.roomMaxPlayers,
        roomMaxPlayersProvided: roomCapacity.roomMaxPlayersProvided,
        roomCapacitySource: roomCapacity.roomCapacitySource,
        region: cleanString(request.region, ""),
        zone: cleanString(request.zone, ""),
        preferredServerId: cleanString(request.preferredServerId, ""),
        minFreeSlots: clampInteger(request.minFreeSlots, 1, 1, 1024),
        ticketTtlSeconds: clampInteger(request.ticketTtlSeconds, 60, 5, 3600),
        autoLaunchDedicatedServer: request.autoLaunchDedicatedServer !== false,
        metadata
    };
}

//* این تابع پاسخ موفق استاندارد برای هندلر کلاینت می سازد.
function createSuccess(reason, message, data = {}) {
    return {
        success: true,
        reason,
        message,
        data,
        ts: nowMs()
    };
}

//* این تابع پاسخ خطای استاندارد برای هندلر کلاینت می سازد.
function createFailure(reason, message, data = {}) {
    return {
        success: false,
        reason,
        message,
        data,
        ts: nowMs()
    };
}

//* این تابع خروجی جیسون لانچر را می خواند.
function parseLauncherOutput(stdout = "") {
    const cleanOutput = String(stdout || "").trim();

    if (!cleanOutput) {
        return {
            success: false,
            reason: "launcher_empty_output",
            message: "Dedicated server launcher returned empty output.",
            data: {}
        };
    }

    try {
        return JSON.parse(cleanOutput);
    } catch {
        return {
            success: false,
            reason: "launcher_invalid_json",
            message: "Dedicated server launcher returned invalid json.",
            data: {
                output: cleanOutput.slice(0, 2000)
            }
        };
    }
}

//* این تابع شناسه سرور ددیکیتد را برای یک روم می سازد.
function createAutoLaunchServerId(roomId) {
    const timePart = Date.now().toString(36);
    return `ds_auto_${safeFilePart(roomId)}_${timePart}`.slice(0, 160);
}

function createRateLimitKey(parts = []) {
    return parts
        .map((item) => safeFilePart(item || "none"))
        .join("|")
        .slice(0, 260);
}

function pruneRateLimitMap(rateMap, now, maxBuckets = DEFAULT_RATE_LIMIT_MAX_BUCKETS) {
    if (!rateMap || rateMap.size <= maxBuckets) return;

    for (const [key, entry] of rateMap.entries()) {
        if (!entry || entry.resetAt <= now) rateMap.delete(key);
    }

    while (rateMap.size > maxBuckets) {
        const firstKey = rateMap.keys().next().value;
        if (firstKey === undefined) break;
        rateMap.delete(firstKey);
    }
}

function checkFixedWindowRateLimit(rateMap, options = {}) {
    const now = options.now ?? nowMs();
    const key = cleanString(options.key, "global");
    const windowMs = clampInteger(options.windowMs, 10000, 1000, 86400000);
    const maxHits = clampInteger(options.maxHits, 1, 1, 100000);
    const maxBuckets = clampInteger(options.maxBuckets, DEFAULT_RATE_LIMIT_MAX_BUCKETS, 100, 1000000);

    pruneRateLimitMap(rateMap, now, maxBuckets);

    let entry = rateMap.get(key);

    if (!entry || now >= entry.resetAt) {
        entry = {
            count: 0,
            resetAt: now + windowMs
        };

        rateMap.set(key, entry);
    }

    if (entry.count >= maxHits) {
        return {
            success: false,
            retryAfterMs: Math.max(0, entry.resetAt - now),
            remaining: 0,
            limit: maxHits,
            windowMs,
            resetAt: entry.resetAt
        };
    }

    entry.count++;

    return {
        success: true,
        retryAfterMs: 0,
        remaining: Math.max(0, maxHits - entry.count),
        limit: maxHits,
        windowMs,
        resetAt: entry.resetAt
    };
}

function toSafeServerSummary(server = {}) {
    return {
        serverId: server.serverId ?? "",
        roomId: server.roomId ?? "",
        host: server.host ?? "",
        port: server.port ?? 0,
        status: server.status ?? "",
        currentPlayers: server.currentPlayers ?? 0,
        maxPlayers: server.maxPlayers ?? 0,
        region: server.region ?? "",
        zone: server.zone ?? ""
    };
}

//* این کلاس درخواست های سمت کلاینت برای ورود به ددیکیتد سرور را مدیریت می کند.
class ClientGameServerHandler {
    constructor(options = {}) {
        this.allocator = options.allocator ?? null;
        this.ticketService = options.ticketService ?? null;
        this.sessionRegistry = options.sessionRegistry ?? null;
        this.registry = options.registry ?? null;
        this.healthStore = options.healthStore ?? null;
        this.logger = options.logger ?? console;

        this.autoLaunchEnabled = options.autoLaunchEnabled ??
            readBooleanEnv("GAME_SERVER_AUTO_LAUNCH_ENABLED", DEFAULT_AUTO_LAUNCH_ENABLED);

        this.autoLaunchProjectRoot = options.autoLaunchProjectRoot ??
            process.env.GAME_SERVER_AUTO_LAUNCH_PROJECT_ROOT ??
            DEFAULT_PROJECT_ROOT;

        this.autoLaunchScriptPath = options.autoLaunchScriptPath ??
            process.env.GAME_SERVER_AUTO_LAUNCH_SCRIPT_PATH ??
            DEFAULT_LAUNCHER_SCRIPT_PATH;

        this.autoLaunchStartPort = options.autoLaunchStartPort ??
            readIntegerEnv("GAME_SERVER_AUTO_LAUNCH_START_PORT", DEFAULT_AUTO_LAUNCH_START_PORT, 1, 65535);

        this.autoLaunchMaxPortScan = options.autoLaunchMaxPortScan ??
            readIntegerEnv("GAME_SERVER_AUTO_LAUNCH_MAX_PORT_SCAN", DEFAULT_AUTO_LAUNCH_MAX_PORT_SCAN, 1, 1000);

        this.autoLaunchWaitMs = options.autoLaunchWaitMs ??
            readIntegerEnv("GAME_SERVER_AUTO_LAUNCH_WAIT_MS", DEFAULT_AUTO_LAUNCH_WAIT_MS, 1000, 60000);

        this.autoLaunchMaxActiveServers = options.autoLaunchMaxActiveServers ??
            readIntegerEnv("GAME_SERVER_AUTO_LAUNCH_MAX_ACTIVE_SERVERS", DEFAULT_AUTO_LAUNCH_MAX_ACTIVE_SERVERS, 1, 1000);

        this.autoLaunchMaxPendingLaunches = options.autoLaunchMaxPendingLaunches ??
            readIntegerEnv("GAME_SERVER_AUTO_LAUNCH_MAX_PENDING_LAUNCHES", DEFAULT_AUTO_LAUNCH_MAX_PENDING_LAUNCHES, 1, 1000);

        this.autoLaunchRoomCooldownMs = options.autoLaunchRoomCooldownMs ??
            readIntegerEnv("GAME_SERVER_AUTO_LAUNCH_ROOM_COOLDOWN_MS", DEFAULT_AUTO_LAUNCH_ROOM_COOLDOWN_MS, 0, 86400000);

        this.autoLaunchMinServerMaxPlayers = options.autoLaunchMinServerMaxPlayers ??
            readIntegerEnv("GAME_SERVER_AUTO_LAUNCH_MIN_SERVER_MAX_PLAYERS", DEFAULT_AUTO_LAUNCH_MIN_SERVER_MAX_PLAYERS, 1, 1024);

        this.ticketRateLimitEnabled = options.ticketRateLimitEnabled ??
            readBooleanEnv("GAME_SERVER_TICKET_RATE_LIMIT_ENABLED", DEFAULT_TICKET_RATE_LIMIT_ENABLED);

        this.ticketRateLimitWindowMs = options.ticketRateLimitWindowMs ??
            readIntegerEnv("GAME_SERVER_TICKET_RATE_LIMIT_WINDOW_MS", DEFAULT_TICKET_RATE_LIMIT_WINDOW_MS, 1000, 86400000);

        this.ticketRateLimitMax = options.ticketRateLimitMax ??
            readIntegerEnv("GAME_SERVER_TICKET_RATE_LIMIT_MAX", DEFAULT_TICKET_RATE_LIMIT_MAX, 1, 100000);

        this.autoLaunchRateLimitEnabled = options.autoLaunchRateLimitEnabled ??
            readBooleanEnv("GAME_SERVER_AUTO_LAUNCH_RATE_LIMIT_ENABLED", DEFAULT_AUTO_LAUNCH_RATE_LIMIT_ENABLED);

        this.autoLaunchRateLimitWindowMs = options.autoLaunchRateLimitWindowMs ??
            readIntegerEnv("GAME_SERVER_AUTO_LAUNCH_RATE_LIMIT_WINDOW_MS", DEFAULT_AUTO_LAUNCH_RATE_LIMIT_WINDOW_MS, 1000, 86400000);

        this.autoLaunchRateLimitMax = options.autoLaunchRateLimitMax ??
            readIntegerEnv("GAME_SERVER_AUTO_LAUNCH_RATE_LIMIT_MAX", DEFAULT_AUTO_LAUNCH_RATE_LIMIT_MAX, 1, 100000);

        this.webglPublicHost = options.webglPublicHost ??
            cleanString(process.env.GAME_SERVER_WEBGL_PUBLIC_HOST, "");

        this.webglPublicPort = options.webglPublicPort ??
            readIntegerEnv("GAME_SERVER_WEBGL_PUBLIC_PORT", DEFAULT_WEBGL_PUBLIC_PORT, 1, 65535);

        this.webglPathPrefix = normalizeConnectionPath(
            options.webglPathPrefix ?? process.env.GAME_SERVER_WEBGL_PATH_PREFIX,
            DEFAULT_WEBGL_PATH_PREFIX
        );

        this.pendingAutoLaunchesByRoomId = new Map();
        this.lastAutoLaunchAtByRoomId = new Map();
        this.ticketRateLimitBucketsByKey = new Map();
        this.autoLaunchRateLimitBucketsByKey = new Map();
    }

    //* این تابع وابستگی های هندلر را بعد از ساخت کلاس تنظیم می کند.
    configure(options = {}) {
        if (options.allocator) this.allocator = options.allocator;
        if (options.ticketService) this.ticketService = options.ticketService;
        if (options.sessionRegistry) this.sessionRegistry = options.sessionRegistry;
        if (options.registry) this.registry = options.registry;
        if (options.healthStore) this.healthStore = options.healthStore;
        if (options.logger) this.logger = options.logger;

        if (options.autoLaunchEnabled !== undefined) this.autoLaunchEnabled = options.autoLaunchEnabled === true;
        if (options.autoLaunchProjectRoot) this.autoLaunchProjectRoot = options.autoLaunchProjectRoot;
        if (options.autoLaunchScriptPath) this.autoLaunchScriptPath = options.autoLaunchScriptPath;
        if (options.autoLaunchStartPort) this.autoLaunchStartPort = clampInteger(options.autoLaunchStartPort, this.autoLaunchStartPort, 1, 65535);
        if (options.autoLaunchMaxPortScan) this.autoLaunchMaxPortScan = clampInteger(options.autoLaunchMaxPortScan, this.autoLaunchMaxPortScan, 1, 1000);
        if (options.autoLaunchWaitMs) this.autoLaunchWaitMs = clampInteger(options.autoLaunchWaitMs, this.autoLaunchWaitMs, 1000, 60000);

        if (options.autoLaunchMaxActiveServers !== undefined) this.autoLaunchMaxActiveServers = clampInteger(options.autoLaunchMaxActiveServers, this.autoLaunchMaxActiveServers, 1, 1000);
        if (options.autoLaunchMaxPendingLaunches !== undefined) this.autoLaunchMaxPendingLaunches = clampInteger(options.autoLaunchMaxPendingLaunches, this.autoLaunchMaxPendingLaunches, 1, 1000);
        if (options.autoLaunchRoomCooldownMs !== undefined) this.autoLaunchRoomCooldownMs = clampInteger(options.autoLaunchRoomCooldownMs, this.autoLaunchRoomCooldownMs, 0, 86400000);

        if (options.ticketRateLimitEnabled !== undefined) this.ticketRateLimitEnabled = options.ticketRateLimitEnabled === true;
        if (options.ticketRateLimitWindowMs !== undefined) this.ticketRateLimitWindowMs = clampInteger(options.ticketRateLimitWindowMs, this.ticketRateLimitWindowMs, 1000, 86400000);
        if (options.ticketRateLimitMax !== undefined) this.ticketRateLimitMax = clampInteger(options.ticketRateLimitMax, this.ticketRateLimitMax, 1, 100000);

        if (options.webglPublicHost !== undefined) this.webglPublicHost = cleanString(options.webglPublicHost, "");
        if (options.webglPublicPort !== undefined) this.webglPublicPort = clampInteger(options.webglPublicPort, this.webglPublicPort, 1, 65535);
        if (options.webglPathPrefix !== undefined) this.webglPathPrefix = normalizeConnectionPath(options.webglPathPrefix, DEFAULT_WEBGL_PATH_PREFIX);

        return this;
    }

    //* این تابع برای کلاینت یک سرور مناسب پیدا می کند و گیم تیکت صادر می کند.
    async requestGameServerTicket(ctx = {}, request = {}) {
        const normalizedRequest = normalizeTicketRequest(ctx, request);
        const validation = this.validateTicketRequest(normalizedRequest);

        if (!validation.success) return validation;

        const ticketRateLimit = this.checkTicketRateLimit(normalizedRequest);
        if (!ticketRateLimit.success) return ticketRateLimit;

        if (!this.allocator) {
            return createFailure("allocator_missing", "Game server allocator is not configured.");
        }

        if (!this.ticketService) {
            return createFailure("ticket_service_missing", "Game ticket service is not configured.");
        }

        if (!this.sessionRegistry) {
            return createFailure("session_registry_missing", "Game session registry is not configured.");
        }

        let allocationResult = this.allocateServerForTicket(normalizedRequest);
        let autoLaunchResult = null;
        let warmClaimResult = null;

        if (!allocationResult.success && this.shouldTryWarmClaim(normalizedRequest, allocationResult)) {
            warmClaimResult = this.claimWarmServerForTicket(normalizedRequest, allocationResult);

            if (warmClaimResult.success) {
                allocationResult = warmClaimResult;
            }
        }

        if (!allocationResult.success && this.shouldTryAutoLaunch(normalizedRequest, allocationResult)) {
            autoLaunchResult = await this.ensureDedicatedServerForRoom(normalizedRequest);

            if (!autoLaunchResult.success) {
                return createFailure("dedicated_auto_launch_failed", "Dedicated server auto launch failed.", {
                    allocation: allocationResult,
                    warmClaim: warmClaimResult,
                    autoLaunch: autoLaunchResult
                });
            }

            allocationResult = this.allocateServerForTicket(normalizedRequest);
        }

        if (!allocationResult.success) {
            return createFailure(allocationResult.reason, allocationResult.message, {
                allocation: allocationResult,
                autoLaunch: autoLaunchResult
            });
        }

        let server = allocationResult.server;
        const roomReservationResult = this.reserveRoomCapacityForTicket(server, normalizedRequest, allocationResult);

        if (!roomReservationResult.success) {
            return createFailure(roomReservationResult.reason, roomReservationResult.message, {
                allocation: allocationResult,
                roomReservation: roomReservationResult,
                autoLaunch: autoLaunchResult
            });
        }

        server = roomReservationResult.server ?? server;
        allocationResult.server = server;

        const session = this.sessionRegistry.getOrCreateSession({
            roomId: normalizedRequest.roomId || server.roomId,
            serverId: server.serverId,
            region: server.region,
            zone: server.zone,
            maxPlayers: normalizedRequest.roomMaxPlayers,
            metadata: {
                createdBy: "client_game_server_handler",
                roomName: normalizedRequest.roomName,
                roomMaxPlayers: normalizedRequest.roomMaxPlayers,
                roomCapacitySource: normalizedRequest.roomCapacitySource,
                reservedPlayers: server.reservedPlayers ?? 0,
                availableReservedSlots: server.availableReservedSlots ?? 0,
                allocationReason: allocationResult.reason,
                roomReservationReason: roomReservationResult.reason,
                warmClaimReason: warmClaimResult?.reason ?? "",
                autoLaunchReason: autoLaunchResult?.reason ?? ""
            }
        });

        const connection = this.createConnectionForTicket(server, session, normalizedRequest);

        const ticket = this.ticketService.issueTicket({
            userId: normalizedRequest.userId,
            roomId: session.roomId,
            serverId: server.serverId,
            ttlSeconds: normalizedRequest.ticketTtlSeconds,
            metadata: {
                ...normalizedRequest.metadata,
                roomName: normalizedRequest.roomName,
                roomMaxPlayers: normalizedRequest.roomMaxPlayers,
                roomCapacitySource: normalizedRequest.roomCapacitySource,
                sessionId: session.sessionId,
                host: connection.host,
                port: connection.port,
                secure: connection.secure,
                path: connection.path,
                scheme: connection.scheme,
                directHost: server.host,
                directPort: server.port,
                region: server.region,
                zone: server.zone,
                reservedPlayers: server.reservedPlayers ?? 0,
                availableReservedSlots: server.availableReservedSlots ?? 0
            }
        });

        return createSuccess("game_ticket_issued", "Game server ticket issued.", {
            userId: normalizedRequest.userId,
            ticket,
            connection,
            roomCapacity: {
                roomId: normalizedRequest.roomId,
                roomName: normalizedRequest.roomName,
                roomMaxPlayers: normalizedRequest.roomMaxPlayers,
                source: normalizedRequest.roomCapacitySource,
                reservedPlayers: server.reservedPlayers ?? 0,
                availableReservedSlots: server.availableReservedSlots ?? 0
            },
            roomReservation: {
                success: roomReservationResult.success,
                reason: roomReservationResult.reason,
                reservedPlayers: server.reservedPlayers ?? 0,
                availableReservedSlots: server.availableReservedSlots ?? 0,
                assignedRooms: server.assignedRooms ?? {}
            },
            allocation: {
                reason: allocationResult.reason,
                score: allocationResult.score
            },
            warmClaim: warmClaimResult ? {
                success: warmClaimResult.success,
                reason: warmClaimResult.reason,
                server: warmClaimResult.server ?? null
            } : null,
            autoLaunch: autoLaunchResult ? {
                success: autoLaunchResult.success,
                reason: autoLaunchResult.reason,
                server: autoLaunchResult.data?.server ?? null,
                launched: autoLaunchResult.data?.launched ?? null
            } : null,
            session
        });
    }

    //* این تابع آدرس قابل اتصال کلاینت را از مسیر امن اِن‌جین‌اِکس می‌سازد.
    createConnectionForTicket(server = {}, session = {}, normalizedRequest = {}) {
        const directHost = cleanString(server.host, "");
        const directPort = clampInteger(server.port, 0, 1, 65535);
        const pathPrefix = normalizeConnectionPath(this.webglPathPrefix, DEFAULT_WEBGL_PATH_PREFIX);
        const path = `${pathPrefix}/${directPort}`;

        return {
            serverId: server.serverId,
            host: this.webglPublicHost || directHost,
            port: this.webglPublicPort,
            secure: true,
            path,
            scheme: "wss",
            directHost,
            directPort,
            roomId: session.roomId,
            roomName: normalizedRequest.roomName,
            roomMaxPlayers: normalizedRequest.roomMaxPlayers,
            sessionId: session.sessionId,
            region: server.region,
            zone: server.zone,
            reservedPlayers: server.reservedPlayers ?? 0,
            availableReservedSlots: server.availableReservedSlots ?? 0,
            assignedRooms: server.assignedRooms ?? {}
        };
    }

    //* این تابع تخصیص سرور را برای تیکت انجام می دهد.
    allocateServerForTicket(normalizedRequest) {
        return this.allocator.allocateServer({
            userId: normalizedRequest.userId,
            roomId: normalizedRequest.roomId,
            region: normalizedRequest.region || null,
            zone: normalizedRequest.zone || null,
            preferredServerId: normalizedRequest.preferredServerId || null,
            minFreeSlots: normalizedRequest.minFreeSlots,
            roomMaxPlayers: normalizedRequest.roomMaxPlayers,
            requireHealthy: true,
            allowReserved: true,
            allowClaimed: true
        });
    }

    //* این تابع ظرفیت روم را روی سرور انتخاب شده رزرو یا تایید می کند.
    reserveRoomCapacityForTicket(server = {}, normalizedRequest = {}, allocationResult = null) {
        if (!this.registry || typeof this.registry.assignRoomToServer !== "function") {
            return {
                success: true,
                reason: "room_capacity_assignment_not_supported",
                message: "Registry does not support explicit room capacity assignment yet.",
                server
            };
        }

        const result = this.registry.assignRoomToServer({
            serverId: server.serverId,
            roomId: normalizedRequest.roomId || server.roomId,
            roomName: normalizedRequest.roomName,
            roomMaxPlayers: normalizedRequest.roomMaxPlayers,
            reason: allocationResult?.reason === "warm_server_claimed_for_ticket"
                ? "room_capacity_confirmed_after_warm_claim"
                : "room_capacity_reserved_for_ticket"
        });

        if (!result.success) return result;

        this.logger?.log?.("[ClientGameServerHandler] Room capacity reserved | roomId=" +
            normalizedRequest.roomId + " | roomMaxPlayers=" + normalizedRequest.roomMaxPlayers +
            " | serverId=" + result.server.serverId + " | reservedPlayers=" +
            (result.server.reservedPlayers ?? 0) + " | availableReservedSlots=" +
            (result.server.availableReservedSlots ?? 0));

        return result;
    }

    //* این تابع تشخیص می دهد آیا باید قبل از لانچ جدید، سرور گرم آماده برای روم رزرو شود یا نه.
    shouldTryWarmClaim(normalizedRequest, allocationResult) {
        if (!this.registry) return false;
        if (!this.allocator) return false;
        if (!isNonEmptyString(normalizedRequest.roomId)) return false;

        return allocationResult?.reason === "no_available_server";
    }

    //* این تابع یک سرور گرم آماده را برای روم درخواست شده رزرو می کند.
    claimWarmServerForTicket(normalizedRequest, previousAllocationResult = null) {
        if (!this.registry) {
            return createFailure("registry_missing", "Game server registry is not configured.");
        }

        if (!this.allocator) {
            return createFailure("allocator_missing", "Game server allocator is not configured.");
        }

        if (typeof this.registry.claimWarmServerForRoom !== "function") {
            return createFailure("warm_claim_not_supported", "Game server registry does not support warm server claim.");
        }

        const warmAllocation = this.allocator.allocateServer({
            userId: normalizedRequest.userId,
            roomId: normalizedRequest.roomId,
            region: normalizedRequest.region || null,
            zone: normalizedRequest.zone || null,
            preferredServerId: null,
            minFreeSlots: normalizedRequest.minFreeSlots,
            roomMaxPlayers: normalizedRequest.roomMaxPlayers,
            requireHealthy: true,
            allowWarm: true,
            allowReserved: false,
            allowClaimed: false
        });

        if (!warmAllocation.success) {
            return createFailure("warm_server_not_available", "No healthy warm dedicated server is available for this ticket.", {
                allocation: previousAllocationResult,
                warmAllocation
            });
        }

        const claimResult = this.registry.claimWarmServerForRoom({
            serverId: warmAllocation.server.serverId,
            roomId: normalizedRequest.roomId,
            roomName: normalizedRequest.roomName,
            roomMaxPlayers: normalizedRequest.roomMaxPlayers,
            region: normalizedRequest.region || warmAllocation.server.region,
            zone: normalizedRequest.zone || warmAllocation.server.zone,
            reason: "warm_server_claimed_for_ticket"
        });

        if (!claimResult.success) {
            return createFailure(claimResult.reason, claimResult.message, {
                allocation: previousAllocationResult,
                warmAllocation,
                claim: claimResult
            });
        }

        const claimedServer = claimResult.server;

        this.logger?.log?.("[ClientGameServerHandler] Warm server claimed for ticket | roomId=" +
            normalizedRequest.roomId + " | roomMaxPlayers=" + normalizedRequest.roomMaxPlayers +
            " | serverId=" + claimedServer.serverId + " | port=" + claimedServer.port);

        return {
            success: true,
            reason: "warm_server_claimed_for_ticket",
            message: "Warm dedicated server claimed for game ticket.",
            server: claimedServer,
            score: warmAllocation.score,
            health: warmAllocation.health,
            connection: {
                serverId: claimedServer.serverId,
                host: claimedServer.host,
                port: claimedServer.port,
                roomId: claimedServer.roomId,
                region: claimedServer.region,
                zone: claimedServer.zone
            }
        };
    }

    //* این تابع تشخیص می دهد بعد از نبودن سرور باید لانچ خودکار انجام شود یا نه.
    shouldTryAutoLaunch(normalizedRequest, allocationResult) {
        if (!this.autoLaunchEnabled) return false;
        if (normalizedRequest.autoLaunchDedicatedServer === false) return false;
        // Phase 28D.1: preferredServerId نباید جلوی لانچ خودکار روم جدید را بگیرد.
        if (!isNonEmptyString(normalizedRequest.roomId)) return false;

        return allocationResult?.reason === "no_available_server";
    }

    //* این تابع برای یک روم فقط یک لانچ همزمان اجازه می دهد.
    async ensureDedicatedServerForRoom(normalizedRequest) {
        const roomId = normalizedRequest.roomId;

        if (this.pendingAutoLaunchesByRoomId.has(roomId)) {
            return await this.pendingAutoLaunchesByRoomId.get(roomId);
        }

        const safety = this.checkAutoLaunchSafetyBeforeLaunch(normalizedRequest);

        if (!safety.success) {
            return safety;
        }

        const promise = this.launchDedicatedServerForRoom(normalizedRequest, safety);
        this.pendingAutoLaunchesByRoomId.set(roomId, promise);

        try {
            return await promise;
        } finally {
            this.pendingAutoLaunchesByRoomId.delete(roomId);
        }
    }

    //* این تابع ابزار لانچر ددیکیتد سرور را برای روم اجرا می کند.
    async launchDedicatedServerForRoom(normalizedRequest, safety = null) {
        const roomId = normalizedRequest.roomId;
        const roomName = normalizedRequest.roomName || roomId;
        const serverId = createAutoLaunchServerId(roomId);
        const launchMaxPlayers = Math.max(
            this.autoLaunchMinServerMaxPlayers,
            normalizedRequest.roomMaxPlayers,
            normalizedRequest.minFreeSlots
        );


        const args = [
            this.autoLaunchScriptPath,
            `--roomId=${roomId}`,
            `--roomName=${roomName}`,
            `--serverId=${serverId}`,
            `--region=${normalizedRequest.region || "eu-central"}`,
            `--zone=${normalizedRequest.zone || "de-1"}`,
            `--roomMaxPlayers=${normalizedRequest.roomMaxPlayers}`,
            `--maxPlayers=${launchMaxPlayers}`,
            `--startPort=${this.autoLaunchStartPort}`,
            `--maxPortScan=${this.autoLaunchMaxPortScan}`,
            `--waitMs=${this.autoLaunchWaitMs}`
        ];

        const processManifestFile = cleanString(
            process.env.GAME_SERVER_PROCESS_MANIFEST_FILE ?? process.env.GSC_PROCESS_MANIFEST_FILE,
            ""
        );

        if (processManifestFile) {
            args.push(`--processManifestFile=${processManifestFile}`);
        }

        this.lastAutoLaunchAtByRoomId.set(roomId, nowMs());
        this.logger?.log?.(`[ClientGameServerHandler] Auto launching dedicated server | roomId=${roomId} | serverId=${serverId}`);

        try {
            const result = await execFileAsync(process.execPath, args, {
                cwd: this.autoLaunchProjectRoot,
                encoding: "utf8",
                maxBuffer: DEFAULT_AUTO_LAUNCH_MAX_BUFFER
            });

            const parsed = parseLauncherOutput(result.stdout);

            if (!parsed.success) {
                return {
                    ...parsed,
                    data: {
                        ...(parsed.data ?? {}),
                        stderr: String(result.stderr || "").slice(0, 2000),
                        safety
                    }
                };
            }

            return {
                ...parsed,
                data: {
                    ...(parsed.data ?? {}),
                    safety
                }
            };
        } catch (error) {
            return {
                success: false,
                reason: "dedicated_auto_launch_exec_failed",
                message: error.message,
                data: {
                    errorName: error.name,
                    stdout: String(error.stdout || "").slice(0, 2000),
                    stderr: String(error.stderr || "").slice(0, 2000),
                    scriptPath: this.autoLaunchScriptPath,
                    projectRoot: this.autoLaunchProjectRoot,
                    safety
                }
            };
        }
    }

    //* این تابع لیست سرورهای قابل اتصال را برای کلاینت آماده می کند.
    async listAvailableGameServers(ctx = {}, request = {}) {
        if (!this.registry) {
            return createFailure("registry_missing", "Game server registry is not configured.");
        }

        const filters = {
            roomId: cleanString(request.roomId, ""),
            region: cleanString(request.region, ""),
            zone: cleanString(request.zone, ""),
            minFreeSlots: clampInteger(request.minFreeSlots, 1, 1, 1024),
            roomMaxPlayers: clampInteger(request.roomMaxPlayers, 1, 1, 1024)
        };

        const servers = this.registry.listAvailableServers(filters);

        return createSuccess("available_servers_listed", "Available game servers listed.", {
            servers,
            count: servers.length
        });
    }

    //* این تابع سشن فعال یک روم را برای کلاینت برمی گرداند.
    async getGameSession(ctx = {}, request = {}) {
        if (!this.sessionRegistry) {
            return createFailure("session_registry_missing", "Game session registry is not configured.");
        }

        const roomId = cleanString(request.roomId, "");

        if (!roomId) {
            return createFailure("room_id_required", "roomId is required.");
        }

        const session = this.sessionRegistry.findSessionByRoom(roomId);

        if (!session) {
            return createFailure("session_not_found", "Game session was not found.", {
                roomId
            });
        }

        return createSuccess("session_found", "Game session found.", {
            session
        });
    }

    //* این تابع وضعیت کلی ماژول را برای کلاینت یا دیباگ آماده می کند.
    async getClientGameServerStatus(ctx = {}, request = {}) {
        const registryStats = this.registry ? this.registry.getStats() : null;
        const healthStats = this.healthStore ? this.healthStore.getStats() : null;
        const sessionStats = this.sessionRegistry ? this.sessionRegistry.getStats() : null;
        const ticketStats = this.ticketService ? this.ticketService.getStats() : null;

        return createSuccess("game_server_status", "Game server status loaded.", {
            registry: registryStats,
            health: healthStats,
            sessions: sessionStats,
            tickets: ticketStats,
            autoLaunch: {
                enabled: this.autoLaunchEnabled,
                projectRoot: this.autoLaunchProjectRoot,
                scriptPath: this.autoLaunchScriptPath,
                startPort: this.autoLaunchStartPort,
                maxPortScan: this.autoLaunchMaxPortScan,
                waitMs: this.autoLaunchWaitMs,
                pending: this.pendingAutoLaunchesByRoomId.size,
                capacity: this.getAutoLaunchCapacitySnapshot(),
                limits: {
                    maxActiveServers: this.autoLaunchMaxActiveServers,
                    maxPendingLaunches: this.autoLaunchMaxPendingLaunches,
                    roomCooldownMs: this.autoLaunchRoomCooldownMs,
                    minServerMaxPlayers: this.autoLaunchMinServerMaxPlayers
                },
                rateLimit: {
                    enabled: this.autoLaunchRateLimitEnabled,
                    windowMs: this.autoLaunchRateLimitWindowMs,
                    max: this.autoLaunchRateLimitMax,
                    buckets: this.autoLaunchRateLimitBucketsByKey.size
                },
                webglConnection: {
                    publicHost: this.webglPublicHost,
                    publicPort: this.webglPublicPort,
                    pathPrefix: this.webglPathPrefix
                }
            },
            ticketRateLimit: {
                enabled: this.ticketRateLimitEnabled,
                windowMs: this.ticketRateLimitWindowMs,
                max: this.ticketRateLimitMax,
                buckets: this.ticketRateLimitBucketsByKey.size
            }
        });
    }

    //* این تابع درخواست گرفتن گیم تیکت را اعتبارسنجی می کند.
    validateTicketRequest(request) {
        if (!request || typeof request !== "object") {
            return createFailure("request_required", "Game ticket request object is required.");
        }

        if (!isNonEmptyString(request.userId)) {
            return createFailure("user_id_required", "Authenticated userId is required.");
        }

        if (!isNonEmptyString(request.roomId)) {
            return createFailure("room_id_required", "roomId is required.");
        }

        if (request.roomMaxPlayersProvided !== true) {
            return createFailure("room_max_players_required", "roomMaxPlayers is required for room capacity reservation.", {
                roomId: request.roomId
            });
        }

        if (!Number.isInteger(request.roomMaxPlayers) || request.roomMaxPlayers < 1) {
            return createFailure("room_max_players_invalid", "roomMaxPlayers must be a positive integer.", {
                roomId: request.roomId,
                roomMaxPlayers: request.roomMaxPlayers,
                source: request.roomCapacitySource
            });
        }

        if (request.roomMaxPlayers > MAX_ROOM_MAX_PLAYERS) {
            return createFailure("room_max_players_too_large", "roomMaxPlayers is larger than the allowed maximum.", {
                roomId: request.roomId,
                roomMaxPlayers: request.roomMaxPlayers,
                maxAllowed: MAX_ROOM_MAX_PLAYERS,
                source: request.roomCapacitySource
            });
        }

        return { success: true };
    }

    checkTicketRateLimit(normalizedRequest) {
        if (!this.ticketRateLimitEnabled) return { success: true };

        const key = createRateLimitKey([
            "ticket",
            normalizedRequest.userId,
            normalizedRequest.roomId
        ]);

        const result = checkFixedWindowRateLimit(this.ticketRateLimitBucketsByKey, {
            key,
            now: nowMs(),
            windowMs: this.ticketRateLimitWindowMs,
            maxHits: this.ticketRateLimitMax
        });

        if (result.success) return result;

        return createFailure("game_ticket_rate_limited", "Too many game ticket requests.", {
            roomId: normalizedRequest.roomId,
            retryAfterMs: result.retryAfterMs,
            limit: result.limit,
            windowMs: result.windowMs,
            resetAt: result.resetAt
        });
    }

    checkAutoLaunchRateLimit(normalizedRequest) {
        if (!this.autoLaunchRateLimitEnabled) return { success: true };

        const key = createRateLimitKey([
            "auto_launch",
            normalizedRequest.region || "default_region",
            normalizedRequest.zone || "default_zone"
        ]);

        const result = checkFixedWindowRateLimit(this.autoLaunchRateLimitBucketsByKey, {
            key,
            now: nowMs(),
            windowMs: this.autoLaunchRateLimitWindowMs,
            maxHits: this.autoLaunchRateLimitMax
        });

        if (result.success) return result;

        return createFailure("dedicated_auto_launch_rate_limited", "Too many dedicated server auto launch requests.", {
            roomId: normalizedRequest.roomId,
            region: normalizedRequest.region,
            zone: normalizedRequest.zone,
            retryAfterMs: result.retryAfterMs,
            limit: result.limit,
            windowMs: result.windowMs,
            resetAt: result.resetAt
        });
    }

    checkAutoLaunchSafetyBeforeLaunch(normalizedRequest) {
        const roomId = normalizedRequest.roomId;
        const existingRoomServers = this.getRegisteredServersForRoom(roomId);

        if (existingRoomServers.length > 0) {
            return createFailure("dedicated_room_server_already_registered", "A dedicated server is already registered for this room.", {
                roomId,
                servers: existingRoomServers.map(toSafeServerSummary)
            });
        }

        const capacity = this.getAutoLaunchCapacitySnapshot();

        if (capacity.activeServers + capacity.pendingLaunches >= this.autoLaunchMaxActiveServers) {
            return createFailure("dedicated_auto_launch_capacity_reached", "Dedicated server capacity limit reached.", {
                roomId,
                capacity
            });
        }

        if (capacity.pendingLaunches >= this.autoLaunchMaxPendingLaunches) {
            return createFailure("dedicated_auto_launch_pending_limit_reached", "Dedicated server pending launch limit reached.", {
                roomId,
                capacity
            });
        }

        const now = nowMs();
        const lastLaunchAt = this.lastAutoLaunchAtByRoomId.get(roomId) ?? 0;
        const elapsedMs = now - lastLaunchAt;

        if (this.autoLaunchRoomCooldownMs > 0 && lastLaunchAt > 0 && elapsedMs < this.autoLaunchRoomCooldownMs) {
            return createFailure("dedicated_auto_launch_room_cooldown", "Dedicated server auto launch for this room is cooling down.", {
                roomId,
                retryAfterMs: this.autoLaunchRoomCooldownMs - elapsedMs,
                cooldownMs: this.autoLaunchRoomCooldownMs
            });
        }

        const rateLimit = this.checkAutoLaunchRateLimit(normalizedRequest);

        if (!rateLimit.success) return rateLimit;

        return {
            success: true,
            capacity,
            rateLimit
        };
    }

    getRegisteredServersForRoom(roomId) {
        if (!this.registry || typeof this.registry.listServers !== "function") return [];

        return this.registry
            .listServers()
            .filter((server) => server?.roomId === roomId);
    }

    getActiveRegisteredServerCount() {
        if (!this.registry || typeof this.registry.listServers !== "function") return 0;
        return this.registry.listServers().length;
    }

    getAutoLaunchCapacitySnapshot() {
        const activeServers = this.getActiveRegisteredServerCount();
        const pendingLaunches = this.pendingAutoLaunchesByRoomId.size;

        return {
            activeServers,
            pendingLaunches,
            maxActiveServers: this.autoLaunchMaxActiveServers,
            maxPendingLaunches: this.autoLaunchMaxPendingLaunches,
            availableLaunchSlots: Math.max(0, this.autoLaunchMaxActiveServers - activeServers - pendingLaunches)
        };
    }
}

//* این تابع یک نمونه جدید از هندلر کلاینت گیم سرور می سازد.
function createClientGameServerHandler(options = {}) {
    return new ClientGameServerHandler(options);
}

export {
    ClientGameServerHandler,
    createClientGameServerHandler
};

//2 این فایل هندلر درخواست های سمت کلاینت برای گیم سرور را می سازد و در نبودن سرور آماده می تواند ددیکیتد سرور همان روم را با لانچر داخلی اجرا کند.
