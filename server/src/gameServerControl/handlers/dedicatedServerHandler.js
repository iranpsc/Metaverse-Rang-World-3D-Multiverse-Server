// File => src/gameServerControl/handlers/dedicatedServerHandler.js

//* این تابع زمان فعلی را به میلی ثانیه برمی گرداند.
function nowMs() {
    return Date.now();
}

//* این تابع بررسی می کند مقدار رشته ای معتبر است یا نه.
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

//* این تابع مقدار عدد صحیح را در بازه امن نگه می دارد.
function clampInteger(value, fallbackValue, minValue, maxValue) {
    const parsedValue = Number.parseInt(value, 10);

    if (!Number.isFinite(parsedValue)) return fallbackValue;
    if (parsedValue < minValue) return minValue;
    if (parsedValue > maxValue) return maxValue;

    return parsedValue;
}

//* این تابع مقدار عددی را در بازه امن نگه می دارد.
function clampNumber(value, fallbackValue, minValue, maxValue) {
    const parsedValue = Number(value);

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

//* این تابع توکن سرویس را از کانتکست یا درخواست می خواند.
function readServiceToken(ctx = {}, request = {}) {
    if (isNonEmptyString(request.serviceToken)) return request.serviceToken.trim();
    if (isNonEmptyString(ctx.serviceToken)) return ctx.serviceToken.trim();

    const headers = request.headers ?? ctx.headers ?? ctx.req?.headers ?? {};
    const authorization = headers.authorization ?? headers.Authorization;

    if (isNonEmptyString(authorization)) {
        const normalizedAuthorization = authorization.trim();

        if (normalizedAuthorization.toLowerCase().startsWith("bearer ")) {
            return normalizedAuthorization.slice(7).trim();
        }
    }

    return headers["x-metaverse-game-server-token"] ??
        headers["X-Metaverse-Game-Server-Token"] ??
        headers["x-game-server-service-token"] ??
        headers["X-Game-Server-Service-Token"] ??
        "";
}

//* این تابع درخواست ثبت ددیکیتد سرور را استاندارد می کند.
function normalizeRegisterRequest(request = {}) {
    return {
        serverId: cleanString(request.serverId, ""),
        host: cleanString(request.host, "127.0.0.1"),
        port: clampInteger(request.port, 7777, 1, 65535),
        roomId: cleanString(request.roomId, ""),
        region: cleanString(request.region, "default"),
        zone: cleanString(request.zone, "default"),
        maxPlayers: clampInteger(request.maxPlayers, 20, 1, 1024),
        currentPlayers: clampInteger(request.currentPlayers, 0, 0, 1024),
        status: cleanString(request.status, "online"),
        tickRate: clampInteger(request.tickRate, 20, 1, 240),
        buildVersion: cleanString(request.buildVersion, ""),
        startedAt: Number.isFinite(request.startedAt) ? request.startedAt : nowMs(),
        metadata: request.metadata ?? {}
    };
}


//* این تابع لیست روم های ارسال شده در هارت بیت را استاندارد می کند.
function normalizeHeartbeatRooms(rooms = []) {
    if (!Array.isArray(rooms)) return [];

    const result = [];

    for (const room of rooms) {
        if (!room || typeof room !== "object") continue;

        const roomId = cleanString(room.roomId, "");
        if (!roomId) continue;

        result.push({
            roomId,
            roomName: cleanString(room.roomName, ""),
            currentPlayers: clampInteger(room.currentPlayers, 0, 0, 100000),
            isPrimary: room.isPrimary === true
        });
    }

    return result;
}

//* این تابع جمع پلیرهای روم های هارت بیت را محاسبه می کند.
function calculateHeartbeatRoomPlayers(rooms = []) {
    if (!Array.isArray(rooms)) return 0;
    return rooms.reduce((sum, room) => sum + clampInteger(room.currentPlayers, 0, 0, 100000), 0);
}

//* این تابع داده هارت بیت را استاندارد می کند.
function normalizeHeartbeatRequest(request = {}) {
    const heartbeatRooms = normalizeHeartbeatRooms(request.rooms ?? request.metadata?.rooms ?? []);
    const rawMetadata = request.metadata && typeof request.metadata === "object" ? request.metadata : {};

    return {
        serverId: cleanString(request.serverId, ""),
        roomId: cleanString(request.roomId, ""),
        region: cleanString(request.region, ""),
        zone: cleanString(request.zone, ""),
        status: cleanString(request.status, "online"),
        fps: clampNumber(request.fps, 0, 0, 1000),
        tickRate: clampInteger(request.tickRate, 20, 1, 240),
        currentPlayers: clampInteger(request.currentPlayers, 0, 0, 100000),
        maxPlayers: clampInteger(request.maxPlayers, 20, 1, 100000),
        memoryMb: clampNumber(request.memoryMb, 0, 0, 1048576),
        cpuPercent: clampNumber(request.cpuPercent, 0, 0, 100),
        pingMs: clampNumber(request.pingMs, 0, 0, 600000),
        uptimeSeconds: clampNumber(request.uptimeSeconds, 0, 0, Number.MAX_SAFE_INTEGER),
        rooms: heartbeatRooms,
        metadata: {
            ...rawMetadata,
            activeRoomCount: heartbeatRooms.length,
            totalRoomPlayers: calculateHeartbeatRoomPlayers(heartbeatRooms),
            rooms: heartbeatRooms
        }
    };
}


//* این تابع درخواست بررسی گیم تیکت توسط ددیکیتد سرور را استاندارد می کند.
function normalizeVerifyTicketRequest(request = {}) {
    const ticket = request.ticket ?? {};

    return {
        serverId: cleanString(request.serverId, ticket.serverId ?? ""),
        roomId: cleanString(request.roomId, ticket.roomId ?? ""),
        userId: cleanString(request.userId, ticket.userId ?? ""),
        ticketId: cleanString(request.ticketId, ticket.ticketId ?? ""),
        signature: cleanString(request.signature, ticket.signature ?? ""),
        sessionId: cleanString(request.sessionId, ticket.metadata?.sessionId ?? ""),
        connectionId: cleanString(request.connectionId, ""),
        playerId: cleanString(request.playerId, request.userId ?? ticket.userId ?? ""),
        userName: cleanString(request.userName, ""),
        metadata: request.metadata ?? {}
    };
}

//* این تابع پاسخ موفق استاندارد می سازد.
function createSuccess(reason, message, data = {}) {
    return {
        success: true,
        reason,
        message,
        data,
        ts: nowMs()
    };
}

//* این تابع پاسخ خطای استاندارد می سازد.
function createFailure(reason, message, data = {}) {
    return {
        success: false,
        reason,
        message,
        data,
        ts: nowMs()
    };
}

//* این تابع پِیلود توکن سرویس را برای پاسخ خطا امن و کوتاه می کند.
function sanitizeServiceTokenPayload(payload = null) {
    if (!payload || typeof payload !== "object") return null;

    const issuedAt = Number.isFinite(payload.issuedAt) ? payload.issuedAt : 0;
    const expiresAt = Number.isFinite(payload.expiresAt) ? payload.expiresAt : 0;

    return {
        serverId: cleanString(payload.serverId, ""),
        purpose: cleanString(payload.purpose, ""),
        issuedAt,
        expiresAt,
        ttlSeconds: issuedAt > 0 && expiresAt > issuedAt ? Math.ceil((expiresAt - issuedAt) / 1000) : 0,
        metadataKeys: payload.metadata && typeof payload.metadata === "object"
            ? Object.keys(payload.metadata).slice(0, 20)
            : []
    };
}

//* این کلاس درخواست های سمت ددیکیتد سرور را مدیریت می کند.
class DedicatedServerHandler {
    constructor(options = {}) {
        this.registry = options.registry ?? null;
        this.healthStore = options.healthStore ?? null;
        this.ticketService = options.ticketService ?? null;
        this.sessionRegistry = options.sessionRegistry ?? null;
        this.serviceTokenService = options.serviceTokenService ?? null;
        this.logger = options.logger ?? console;
    }

    //* این تابع وابستگی های هندلر را بعد از ساخت کلاس تنظیم می کند.
    configure(options = {}) {
        if (options.registry) this.registry = options.registry;
        if (options.healthStore) this.healthStore = options.healthStore;
        if (options.ticketService) this.ticketService = options.ticketService;
        if (options.sessionRegistry) this.sessionRegistry = options.sessionRegistry;
        if (options.serviceTokenService) this.serviceTokenService = options.serviceTokenService;
        if (options.logger) this.logger = options.logger;

        return this;
    }

    //* این تابع ددیکیتد سرور را در رجیستری ثبت می کند.
    async registerDedicatedServer(ctx = {}, request = {}) {
        const normalizedRequest = normalizeRegisterRequest(request);
        const validation = this.validateRegisterRequest(normalizedRequest);

        if (!validation.success) return validation;

        const authResult = this.verifyDedicatedServerToken(ctx, request, {
            serverId: normalizedRequest.serverId
        });

        if (!authResult.success) return authResult;

        if (!this.registry) {
            return createFailure("registry_missing", "Game server registry is not configured.");
        }

        const server = this.registry.registerServer(normalizedRequest);

        let health = null;

        if (this.healthStore) {
            health = this.healthStore.recordHeartbeat(server.serverId, {
                roomId: server.roomId,
                region: server.region,
                zone: server.zone,
                status: server.status,
                tickRate: server.tickRate,
                currentPlayers: server.currentPlayers,
                maxPlayers: server.maxPlayers,
                metadata: {
                    source: "register_dedicated_server"
                }
            });
        }

        return createSuccess("dedicated_server_registered", "Dedicated server registered.", {
            server,
            health
        });
    }

    //* این تابع هارت بیت ددیکیتد سرور را ثبت می کند.
    async heartbeatDedicatedServer(ctx = {}, request = {}) {
        const heartbeat = normalizeHeartbeatRequest(request);

        if (!heartbeat.serverId) {
            return createFailure("server_id_required", "serverId is required.");
        }

        const authResult = this.verifyDedicatedServerToken(ctx, request, {
            serverId: heartbeat.serverId
        });

        if (!authResult.success) return authResult;

        if (!this.registry) {
            return createFailure("registry_missing", "Game server registry is not configured.");
        }

        if (!this.registry.hasServer(heartbeat.serverId)) {
            return createFailure("server_not_registered", "Dedicated server is not registered.", {
                serverId: heartbeat.serverId
            });
        }

        const server = this.registry.updateHeartbeat(heartbeat.serverId, heartbeat);
        const health = this.healthStore
            ? this.healthStore.recordHeartbeat(heartbeat.serverId, heartbeat)
            : null;
        const sessionSync = this.syncSessionsFromHeartbeat(heartbeat);

        return createSuccess("dedicated_server_heartbeat_recorded", "Dedicated server heartbeat recorded.", {
            server,
            health,
            sessionSync
        });
    }


    //* این تابع هارت بیت ددیکیتد سرور را با سشن های نود همگام می کند.
    syncSessionsFromHeartbeat(heartbeat) {
        if (!this.sessionRegistry) return null;
        if (!heartbeat || heartbeat.currentPlayers !== 0) return null;

        if (typeof this.sessionRegistry.syncEmptyServerSessions !== "function") {
            return null;
        }

        return this.sessionRegistry.syncEmptyServerSessions({
            serverId: heartbeat.serverId,
            roomId: heartbeat.roomId,
            reason: "heartbeat_current_players_zero"
        });
    }

    //* این تابع تیکت کاربر را از سمت ددیکیتد سرور بررسی و مصرف می کند.
    async verifyGameTicket(ctx = {}, request = {}) {
        const normalizedRequest = normalizeVerifyTicketRequest(request);
        const validation = this.validateVerifyTicketRequest(normalizedRequest);

        if (!validation.success) return validation;

        const authResult = this.verifyDedicatedServerToken(ctx, request, {
            serverId: normalizedRequest.serverId
        });

        if (!authResult.success) return authResult;

        if (!this.ticketService) {
            return createFailure("ticket_service_missing", "Game ticket service is not configured.");
        }

        if (!this.sessionRegistry) {
            return createFailure("session_registry_missing", "Game session registry is not configured.");
        }

        const verifyResult = this.ticketService.verifyAndConsumeTicket({
            ticketId: normalizedRequest.ticketId,
            signature: normalizedRequest.signature,
            userId: normalizedRequest.userId,
            roomId: normalizedRequest.roomId,
            serverId: normalizedRequest.serverId
        });

        if (!verifyResult.success) {
            return createFailure(verifyResult.reason, verifyResult.message, {
                ticket: verifyResult.ticket
            });
        }

        const session = this.resolveSessionForVerifiedTicket(normalizedRequest, verifyResult.ticket);

        if (!session) {
            return createFailure("session_not_found", "Game session was not found for verified ticket.", {
                ticket: verifyResult.ticket
            });
        }

        const addPlayerResult = this.sessionRegistry.addPlayer(session.sessionId, {
            userId: normalizedRequest.userId,
            connectionId: normalizedRequest.connectionId,
            playerId: normalizedRequest.playerId,
            userName: normalizedRequest.userName,
            isReady: true,
            metadata: {
                ...normalizedRequest.metadata,
                ticketId: normalizedRequest.ticketId,
                verifiedAt: nowMs()
            }
        });

        if (!addPlayerResult.success) {
            return createFailure(addPlayerResult.reason, addPlayerResult.message, {
                ticket: verifyResult.ticket,
                session: addPlayerResult.session
            });
        }

        if (this.registry) {
            this.registry.updatePlayerCount(normalizedRequest.serverId, addPlayerResult.session.currentPlayers);
        }

        return createSuccess("game_ticket_verified", "Game ticket verified and player joined session.", {
            ticket: verifyResult.ticket,
            session: addPlayerResult.session,
            player: {
                userId: normalizedRequest.userId,
                playerId: normalizedRequest.playerId,
                connectionId: normalizedRequest.connectionId
            }
        });
    }

    //* این تابع خروج پلیر از سشن را از سمت ددیکیتد سرور ثبت می کند.
    async reportPlayerLeft(ctx = {}, request = {}) {
        const serverId = cleanString(request.serverId, "");
        const sessionId = cleanString(request.sessionId, "");
        const roomId = cleanString(request.roomId, "");
        const userId = cleanString(request.userId, "");
        const connectionId = cleanString(request.connectionId, "");
        const reason = cleanString(request.reason, "");
        const parsedCurrentPlayers = Number(request.currentPlayers);
        const currentPlayers = Number.isFinite(parsedCurrentPlayers) ? parsedCurrentPlayers : null;
        const isDuplicateUserReplaced = reason === "duplicate_user_replaced";

        if (!serverId) return createFailure("server_id_required", "serverId is required.");
        if (!userId) return createFailure("user_id_required", "userId is required.");

        const authResult = this.verifyDedicatedServerToken(ctx, request, { serverId });
        if (!authResult.success) return authResult;

        if (!this.sessionRegistry) {
            return createFailure("session_registry_missing", "Game session registry is not configured.");
        }

        this.logger?.info?.("[DedicatedPlayerLeftDiagnostic] request received", {
            serverId,
            roomId,
            sessionId,
            userId,
            connectionId,
            reason,
            currentPlayers
        });

        let removeResult = null;

        if (typeof this.sessionRegistry.removePlayerFromServer === "function") {
            removeResult = this.sessionRegistry.removePlayerFromServer({
                serverId,
                roomId,
                userId,
                sessionId,
                connectionId,
                reason,
                currentPlayers
            });
        }

        if (
            (!removeResult || !removeResult.success) &&
            sessionId &&
            typeof this.sessionRegistry.removePlayer === "function" &&
            !(isDuplicateUserReplaced && !connectionId)
        ) {
            removeResult = this.sessionRegistry.removePlayer(sessionId, userId, connectionId);
        }

        this.logger?.info?.("[DedicatedPlayerLeftDiagnostic] remove result", {
            serverId,
            roomId,
            sessionId,
            userId,
            connectionId,
            reason,
            success: removeResult?.success ?? false,
            removeReason: removeResult?.reason ?? "",
            serverCurrentPlayers: removeResult?.serverCurrentPlayers ?? 0,
            removeResults: removeResult?.removeResults ?? []
        });

        if (!removeResult) {
            return createFailure("player_left_handler_missing", "Player left handler is not configured.", {
                serverId,
                roomId,
                sessionId,
                userId,
                connectionId,
                reason,
                currentPlayers
            });
        }

        if (removeResult.success && this.registry) {
            const nextPlayerCount = Number.isFinite(removeResult.serverCurrentPlayers)
                ? removeResult.serverCurrentPlayers
                : removeResult.session?.currentPlayers ?? 0;

            this.registry.updatePlayerCount(serverId, nextPlayerCount);
        }

        return removeResult.success
            ? createSuccess("player_left_reported", "Player left session reported.", {
                session: removeResult.session,
                sessions: removeResult.sessions ?? [],
                serverCurrentPlayers: removeResult.serverCurrentPlayers ?? removeResult.session?.currentPlayers ?? 0,
                removeResults: removeResult.removeResults ?? [],
                playerLeftReason: removeResult.reason ?? "",
                reportedConnectionId: connectionId,
                reportedCurrentPlayers: currentPlayers
            })
            : createFailure(removeResult.reason, removeResult.message, {
                session: removeResult.session,
                sessions: removeResult.sessions ?? [],
                serverCurrentPlayers: removeResult.serverCurrentPlayers ?? 0,
                removeResults: removeResult.removeResults ?? [],
                playerLeftReason: reason,
                reportedConnectionId: connectionId,
                reportedCurrentPlayers: currentPlayers
            });
    }

    //* این تابع نتیجه یا پایان سشن را از سمت ددیکیتد سرور ثبت می کند.
    async reportSessionResult(ctx = {}, request = {}) {
        const serverId = cleanString(request.serverId, "");
        const sessionId = cleanString(request.sessionId, "");
        const resultStatus = cleanString(request.resultStatus, "closed");
        const reason = cleanString(request.reason, "reported_by_dedicated_server");

        if (!serverId) return createFailure("server_id_required", "serverId is required.");
        if (!sessionId) return createFailure("session_id_required", "sessionId is required.");

        const authResult = this.verifyDedicatedServerToken(ctx, request, { serverId });
        if (!authResult.success) return authResult;

        if (!this.sessionRegistry) {
            return createFailure("session_registry_missing", "Game session registry is not configured.");
        }

        const result = resultStatus === "failed"
            ? this.sessionRegistry.failSession(sessionId, reason)
            : this.sessionRegistry.closeSession(sessionId, reason);

        return result.success
            ? createSuccess("session_result_reported", "Session result reported.", { session: result.session })
            : createFailure(result.reason, result.message, { session: result.session });
    }

    //* این تابع وضعیت یک ددیکیتد سرور را برمی گرداند.
    async getDedicatedServerStatus(ctx = {}, request = {}) {
        const serverId = cleanString(request.serverId, "");

        if (!serverId) return createFailure("server_id_required", "serverId is required.");

        const authResult = this.verifyDedicatedServerToken(ctx, request, { serverId });
        if (!authResult.success) return authResult;

        const server = this.registry ? this.registry.getServer(serverId) : null;
        const health = this.healthStore ? this.healthStore.getHealth(serverId) : null;
        const sessions = this.sessionRegistry ? this.sessionRegistry.listSessionsByServer(serverId) : [];

        return createSuccess("dedicated_server_status", "Dedicated server status loaded.", {
            server,
            health,
            sessions
        });
    }

    //* این تابع سرویس توکن ددیکیتد سرور را قبل از انقضا تمدید می کند.
    async renewDedicatedServerToken(ctx = {}, request = {}) {
        const makeFailure = (reason, message, data = {}) => ({
            success: false,
            reason,
            message,
            data,
            ts: Date.now()
        });

        const makeSuccess = (reason, message, data = {}) => ({
            success: true,
            reason,
            message,
            data,
            ts: Date.now()
        });

        const clean = (value, fallback = "") => {
            const text = value === undefined || value === null ? "" : String(value).trim();
            return text || fallback;
        };

        const toInt = (value, fallback) => {
            const parsed = Number.parseInt(value, 10);
            return Number.isFinite(parsed) ? parsed : fallback;
        };

        const serverId = clean(request.serverId);
        const roomId = clean(request.roomId);
        const renewalEnabled = String(process.env.GAME_SERVER_SERVICE_TOKEN_RENEWAL_ENABLED ?? "true").toLowerCase() !== "false";

        if (!renewalEnabled) {
            return makeFailure("service_token_renewal_disabled", "Dedicated server service token renewal is disabled.");
        }

        if (!serverId) {
            return makeFailure("server_id_required", "serverId is required.");
        }

        if (!this.serviceTokenService) {
            return makeFailure("service_token_missing", "Game server service token service is not configured.");
        }

        const authResult = this.verifyDedicatedServerToken(ctx, request, { serverId });
        if (!authResult.success) return authResult;

        const requestedTtlSeconds = toInt(request.ttlSeconds ?? process.env.GAME_SERVER_SERVICE_TOKEN_RENEWAL_TTL_SECONDS, 300);
        const ttlSeconds = Math.max(30, Math.min(3600, requestedTtlSeconds));

        let renewedToken = "";

        try {
            renewedToken = this.serviceTokenService.createToken({
                serverId,
                ttlSeconds,
                metadata: {
                    source: "dedicated_service_token_renewal",
                    roomId,
                    renewedAt: Date.now()
                }
            });
        } catch (error) {
            return makeFailure("service_token_renewal_create_failed", error?.message ?? String(error));
        }

        const renewedCheck = this.serviceTokenService.verifyToken(renewedToken, { serverId });

        if (!renewedCheck.success) {
            return makeFailure("service_token_renewal_verify_failed", renewedCheck.message, {
                reason: renewedCheck.reason
            });
        }

        const payload = renewedCheck.payload ?? {};
        const issuedAt = Number.isFinite(payload.issuedAt) ? payload.issuedAt : Date.now();
        const expiresAt = Number.isFinite(payload.expiresAt) ? payload.expiresAt : issuedAt + ttlSeconds * 1000;
        const effectiveTtlSeconds = Math.max(1, Math.round((expiresAt - issuedAt) / 1000));
        const renewAfterSeconds = Math.max(30, effectiveTtlSeconds - 90);

        return makeSuccess("service_token_renewed", "Dedicated server service token renewed.", {
            serviceToken: renewedToken,
            serverId,
            roomId,
            issuedAt,
            expiresAt,
            ttlSeconds: effectiveTtlSeconds,
            renewAfterSeconds
        });
    }

    //* این تابع توکن سرویس ددیکیتد سرور را بررسی می کند.
    verifyDedicatedServerToken(ctx = {}, request = {}, expected = {}) {
        if (!this.serviceTokenService) {
            return createFailure("service_token_missing", "Game server service token service is not configured.");
        }

        const token = readServiceToken(ctx, request);

        if (!isNonEmptyString(token)) {
            return createFailure("service_token_required", "Dedicated server service token is required.");
        }

        const tokenResult = this.serviceTokenService.verifyToken(token, expected);

        if (!tokenResult.success) {
            const failureData = this.createSafeServiceTokenFailureData(tokenResult, expected);
            this.logServiceTokenFailure(tokenResult, expected, failureData);
            return createFailure(tokenResult.reason, tokenResult.message, failureData);
        }

        return createSuccess("service_token_valid", "Dedicated server service token is valid.", {
            payload: tokenResult.payload
        });
    }

    //* این تابع داده خطای توکن سرویس را بدون افشای توکن و نانس آماده می کند.
    createSafeServiceTokenFailureData(tokenResult = {}, expected = {}) {
        const payload = sanitizeServiceTokenPayload(tokenResult.payload);

        return {
            expectedServerId: cleanString(expected.serverId, ""),
            expectedPurpose: cleanString(expected.purpose, ""),
            tokenReason: cleanString(tokenResult.reason, ""),
            payload
        };
    }

    //* این تابع خطای توکن سرویس را برای دیباگ سرور لاگ می کند.
    logServiceTokenFailure(tokenResult = {}, expected = {}, failureData = {}) {
        const reason = cleanString(tokenResult.reason, "service_token_invalid");
        const expectedServerId = cleanString(expected.serverId, "");
        const tokenServerId = cleanString(failureData?.payload?.serverId, "");

        this.logger?.warn?.(`[DedicatedServerHandler] Service token rejected | reason=${reason} | expectedServerId=${expectedServerId} | tokenServerId=${tokenServerId}`);
    }

    //* این تابع سشن مربوط به تیکت تایید شده را پیدا می کند یا در صورت نیاز می سازد.
    resolveSessionForVerifiedTicket(request, ticket) {
        if (!this.sessionRegistry) return null;

        const sessionId = cleanString(request.sessionId, ticket?.metadata?.sessionId ?? "");

        if (sessionId) {
            const session = this.sessionRegistry.getSession(sessionId);
            if (session) return session;
        }

        if (request.roomId) {
            const session = this.sessionRegistry.findSessionByRoom(request.roomId);
            if (session) return session;
        }

        return this.sessionRegistry.getOrCreateSession({
            roomId: request.roomId,
            serverId: request.serverId,
            maxPlayers: 20,
            metadata: {
                createdBy: "dedicated_server_handler",
                ticketId: request.ticketId
            }
        });
    }

    //* این تابع درخواست ثبت ددیکیتد سرور را اعتبارسنجی می کند.
    validateRegisterRequest(request) {
        if (!request || typeof request !== "object") {
            return createFailure("request_required", "Register dedicated server request object is required.");
        }

        if (!isNonEmptyString(request.serverId)) {
            return createFailure("server_id_required", "serverId is required.");
        }

        return { success: true };
    }

    //* این تابع درخواست بررسی تیکت را اعتبارسنجی می کند.
    validateVerifyTicketRequest(request) {
        if (!request || typeof request !== "object") {
            return createFailure("request_required", "Verify game ticket request object is required.");
        }

        if (!isNonEmptyString(request.serverId)) {
            return createFailure("server_id_required", "serverId is required.");
        }

        if (!isNonEmptyString(request.userId)) {
            return createFailure("user_id_required", "userId is required.");
        }

        if (!isNonEmptyString(request.roomId)) {
            return createFailure("room_id_required", "roomId is required.");
        }

        if (!isNonEmptyString(request.ticketId)) {
            return createFailure("ticket_id_required", "ticketId is required.");
        }

        if (!isNonEmptyString(request.signature)) {
            return createFailure("ticket_signature_required", "ticket signature is required.");
        }

        return { success: true };
    }
}

//* این تابع یک نمونه جدید از هندلر ددیکیتد سرور می سازد.
function createDedicatedServerHandler(options = {}) {
    return new DedicatedServerHandler(options);
}

export {
    DedicatedServerHandler,
    createDedicatedServerHandler
};

// این فایل فقط هندلر داخلی درخواست های سمت ددیکیتد سرور را می سازد و هنوز هیچ روت یا اتصال به سرور اصلی ایجاد نمی کند.
