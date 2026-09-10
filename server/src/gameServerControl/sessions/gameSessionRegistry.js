import crypto from "crypto";

const GAME_SESSION_STATUS = Object.freeze({
    CREATING: "creating",
    ACTIVE: "active",
    CLOSING: "closing",
    CLOSED: "closed",
    FAILED: "failed"
});

const DEFAULT_MAX_PLAYERS = 20;
const DEFAULT_CLOSED_SESSION_TTL_SECONDS = 300;

function nowMs() { return Date.now(); }

function isNonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }

function clampInteger(value, fallbackValue, minValue, maxValue) {
    const parsedValue = Number.parseInt(value, 10);

    if (!Number.isFinite(parsedValue)) return fallbackValue;
    if (parsedValue < minValue) return minValue;
    if (parsedValue > maxValue) return maxValue;

    return parsedValue;
}

function cleanString(value, fallbackValue = "") {
    if (!isNonEmptyString(value)) return fallbackValue;
    return value.trim();
}

//#region Phase 7.L - Public 3D Lobby Session Persistence

//* این تابع مشخص می کند یک سشن باید در حالت خالی نیز باز و آماده باقی بماند یا خیر.
function isPermanentGameSession(session) {
    const metadata = session?.metadata && typeof session.metadata === "object"
        ? session.metadata
        : {};

    return metadata.isPermanent === true ||
        metadata.autoCloseWhenEmpty === false;
}

//#endregion Phase 7.L - Public 3D Lobby Session Persistence

function createSessionId(roomId, serverId) {
    const nonce = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : crypto.randomBytes(16).toString("hex");

    return `session_${roomId}_${serverId}_${nonce}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function normalizeSessionStatus(status, fallbackValue = GAME_SESSION_STATUS.CREATING) {
    const cleanStatus = cleanString(status, fallbackValue);
    if (Object.values(GAME_SESSION_STATUS).includes(cleanStatus)) return cleanStatus;
    return fallbackValue;
}

function createSessionPlayerRecord(player) {
    const joinedAt = nowMs();

    return {
        userId: player.userId.trim(),
        connectionId: cleanString(player.connectionId, ""),
        playerId: cleanString(player.playerId, player.userId.trim()),
        userName: cleanString(player.userName, ""),
        joinedAt,
        lastSeenAt: joinedAt,
        isReady: player.isReady === true,
        metadata: player.metadata ?? {}
    };
}

function createGameSessionRecord(request) {
    const roomId = request.roomId.trim();
    const serverId = request.serverId.trim();
    const createdAt = nowMs();
    const maxPlayers = clampInteger(request.maxPlayers, DEFAULT_MAX_PLAYERS, 1, 1024);

    return {
        sessionId: cleanString(request.sessionId, createSessionId(roomId, serverId)),
        roomId,
        serverId,
        status: normalizeSessionStatus(request.status, GAME_SESSION_STATUS.CREATING),
        maxPlayers,
        playersByUserId: new Map(),
        createdAt,
        startedAt: Number.isFinite(request.startedAt) ? request.startedAt : null,
        closedAt: null,
        updatedAt: createdAt,
        region: cleanString(request.region, ""),
        zone: cleanString(request.zone, ""),
        metadata: request.metadata ?? {}
    };
}

function playersMapToArray(playersByUserId) {
    return Array.from(playersByUserId.values()).map((player) => ({ ...player }));
}

class GameSessionRegistry {
    constructor(options = {}) {
        this.sessionsById = new Map();
        this.sessionIdByRoomId = new Map();

        this.closedSessionTtlMs = clampInteger(
            options.closedSessionTtlSeconds,
            DEFAULT_CLOSED_SESSION_TTL_SECONDS,
            30,
            86400
        ) * 1000;
    }

    createSession(request) {
        this.validateCreateSessionRequest(request);

        const roomId = request.roomId.trim();

        if (this.sessionIdByRoomId.has(roomId)) {
            const existingSessionId = this.sessionIdByRoomId.get(roomId);
            const existingSession = this.sessionsById.get(existingSessionId);

            if (existingSession && this.isSessionOpen(existingSession)) {
                throw new Error("[GameSessionRegistry] Active session already exists for this roomId.");
            }
        }

        const record = createGameSessionRecord(request);

        this.sessionsById.set(record.sessionId, record);
        this.sessionIdByRoomId.set(record.roomId, record.sessionId);

        return this.toPublicSessionRecord(record);
    }

    getOrCreateSession(request) {
        if (request && isNonEmptyString(request.roomId)) {
            const existingSession = this.findSessionByRoom(request.roomId);

            if (existingSession && this.isPublicSessionOpen(existingSession)) return existingSession;
        }

        return this.createSession(request);
    }

    getSession(sessionId) {
        if (!isNonEmptyString(sessionId)) return null;

        const record = this.sessionsById.get(sessionId);
        if (!record) return null;

        return this.toPublicSessionRecord(record);
    }

    findSessionByRoom(roomId) {
        if (!isNonEmptyString(roomId)) return null;

        const sessionId = this.sessionIdByRoomId.get(roomId.trim());
        if (!sessionId) return null;

        return this.getSession(sessionId);
    }

    listSessionsByServer(serverId) {
        if (!isNonEmptyString(serverId)) return [];
        return this.listSessions({ serverId: serverId.trim() });
    }

    listSessions(filters = {}) {
        const result = [];

        for (const record of this.sessionsById.values()) {
            const publicRecord = this.toPublicSessionRecord(record);
            if (!this.matchesFilters(publicRecord, filters)) continue;
            result.push(publicRecord);
        }

        return result;
    }

    addPlayer(sessionId, player) {
        const record = this.sessionsById.get(sessionId);

        if (!record) {
            return this.failure("session_not_found", "Game session was not found.", null);
        }

        if (!this.isSessionOpen(record)) {
            return this.failure("session_not_open", "Game session is not open.", this.toPublicSessionRecord(record));
        }

        if (!player || !isNonEmptyString(player.userId)) {
            return this.failure("user_id_required", "Player userId is required.", this.toPublicSessionRecord(record));
        }

        if (record.playersByUserId.size >= record.maxPlayers && !record.playersByUserId.has(player.userId.trim())) {
            return this.failure("session_full", "Game session is full.", this.toPublicSessionRecord(record));
        }

        const playerRecord = createSessionPlayerRecord(player);

        record.playersByUserId.set(playerRecord.userId, playerRecord);
        record.updatedAt = nowMs();

        if (record.status === GAME_SESSION_STATUS.CREATING) {
            record.status = GAME_SESSION_STATUS.ACTIVE;
            record.startedAt = record.startedAt ?? nowMs();
        }

        this.sessionsById.set(sessionId, record);

        return this.success("player_added", "Player added to game session.", this.toPublicSessionRecord(record));
    }

    removePlayer(sessionId, userId, expectedConnectionId = "") {
        const record = this.sessionsById.get(sessionId);

        if (!record) {
            return this.failure("session_not_found", "Game session was not found.", null);
        }

        if (!isNonEmptyString(userId)) {
            return this.failure("user_id_required", "userId is required.", this.toPublicSessionRecord(record));
        }

        const safeUserId = userId.trim();
        const safeExpectedConnectionId = cleanString(expectedConnectionId, "");
        const existingPlayer = record.playersByUserId.get(safeUserId);

        if (!existingPlayer) {
            record.updatedAt = nowMs();
            this.sessionsById.set(sessionId, record);

            return this.failure("player_not_found", "Player was not found in game session.", this.toPublicSessionRecord(record));
        }

        const existingConnectionId = cleanString(existingPlayer.connectionId, "");

        if (safeExpectedConnectionId && existingConnectionId && existingConnectionId !== safeExpectedConnectionId) {
            record.updatedAt = nowMs();
            this.sessionsById.set(sessionId, record);

            return this.success(
                "player_remove_ignored_connection_mismatch",
                "Player remove ignored because the reported connectionId belongs to an old replaced connection.",
                this.toPublicSessionRecord(record)
            );
        }

        const removed = record.playersByUserId.delete(safeUserId);

        record.updatedAt = nowMs();
        this.sessionsById.set(sessionId, record);

        return removed
            ? this.success("player_removed", "Player removed from game session.", this.toPublicSessionRecord(record))
            : this.failure("player_not_found", "Player was not found in game session.", this.toPublicSessionRecord(record));
    }

    setPlayerReady(sessionId, userId, isReady) {
        const record = this.sessionsById.get(sessionId);

        if (!record) {
            return this.failure("session_not_found", "Game session was not found.", null);
        }

        if (!isNonEmptyString(userId)) {
            return this.failure("user_id_required", "userId is required.", this.toPublicSessionRecord(record));
        }

        const player = record.playersByUserId.get(userId.trim());

        if (!player) {
            return this.failure("player_not_found", "Player was not found in game session.", this.toPublicSessionRecord(record));
        }

        player.isReady = isReady === true;
        player.lastSeenAt = nowMs();

        record.playersByUserId.set(player.userId, player);
        record.updatedAt = nowMs();
        this.sessionsById.set(sessionId, record);

        return this.success("player_ready_updated", "Player ready state updated.", this.toPublicSessionRecord(record));
    }

    touchPlayer(sessionId, userId) {
        const record = this.sessionsById.get(sessionId);

        if (!record || !isNonEmptyString(userId)) return false;

        const player = record.playersByUserId.get(userId.trim());
        if (!player) return false;

        player.lastSeenAt = nowMs();
        record.playersByUserId.set(player.userId, player);
        record.updatedAt = nowMs();
        this.sessionsById.set(sessionId, record);

        return true;
    }

    updateSessionStatus(sessionId, status) {
        const record = this.sessionsById.get(sessionId);

        if (!record) {
            return this.failure("session_not_found", "Game session was not found.", null);
        }

        const nextStatus = normalizeSessionStatus(status, record.status);

        record.status = nextStatus;
        record.updatedAt = nowMs();

        if (nextStatus === GAME_SESSION_STATUS.ACTIVE && record.startedAt === null) record.startedAt = nowMs();

        if (nextStatus === GAME_SESSION_STATUS.CLOSED || nextStatus === GAME_SESSION_STATUS.FAILED) {
            record.closedAt = nowMs();
        }

        this.sessionsById.set(sessionId, record);

        return this.success("session_status_updated", "Game session status updated.", this.toPublicSessionRecord(record));
    }

    closeSession(sessionId, reason = "closed") {
        const record = this.sessionsById.get(sessionId);

        if (!record) {
            return this.failure("session_not_found", "Game session was not found.", null);
        }

        record.status = GAME_SESSION_STATUS.CLOSED;
        record.closedAt = nowMs();
        record.updatedAt = record.closedAt;
        record.metadata = { ...record.metadata, closeReason: reason };

        this.sessionsById.set(sessionId, record);

        return this.success("session_closed", "Game session closed.", this.toPublicSessionRecord(record));
    }

    failSession(sessionId, reason = "failed") {
        const record = this.sessionsById.get(sessionId);

        if (!record) {
            return this.failure("session_not_found", "Game session was not found.", null);
        }

        record.status = GAME_SESSION_STATUS.FAILED;
        record.closedAt = nowMs();
        record.updatedAt = record.closedAt;
        record.metadata = { ...record.metadata, failReason: reason };

        this.sessionsById.set(sessionId, record);

        return this.success("session_failed", "Game session failed.", this.toPublicSessionRecord(record));
    }

    deleteSession(sessionId) {
        if (!isNonEmptyString(sessionId)) return false;

        const record = this.sessionsById.get(sessionId);

        if (record && this.sessionIdByRoomId.get(record.roomId) === sessionId) {
            this.sessionIdByRoomId.delete(record.roomId);
        }

        return this.sessionsById.delete(sessionId);
    }

    removePlayerFromServer(request = {}) {
        const safeText = (value) => typeof value === "string" ? value.trim() : "";
        const safeNumber = (value, fallbackValue = null) => {
            const parsedValue = Number(value);
            return Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
        };

        const serverId = safeText(request.serverId);
        const roomId = safeText(request.roomId);
        const userId = safeText(request.userId);
        const expectedConnectionId = safeText(request.connectionId);
        const preferredSessionId = safeText(request.sessionId);
        const reason = safeText(request.reason);
        const reportedCurrentPlayers = safeNumber(request.currentPlayers, null);

        if (!serverId) {
            return {
                success: false,
                reason: "server_id_required",
                message: "serverId is required.",
                session: null,
                sessions: [],
                serverCurrentPlayers: 0
            };
        }

        if (!userId) {
            return {
                success: false,
                reason: "user_id_required",
                message: "userId is required.",
                session: null,
                sessions: [],
                serverCurrentPlayers: 0
            };
        }

        const listSessions = () => {
            if (typeof this.listSessionsByServer !== "function") return [];

            return this.listSessionsByServer(serverId).filter((session) => {
                return !roomId || session.roomId === roomId;
            });
        };

        const calculateServerCurrentPlayers = (sessions) => {
            const registryPlayerCount = sessions.reduce((sum, session) => {
                const status = safeText(session?.status);
                const players = Array.isArray(session?.players) ? session.players : [];
                if (status === "closed" || status === "failed") return sum;
                return sum + players.length;
            }, 0);

            if (reportedCurrentPlayers !== null && reportedCurrentPlayers > registryPlayerCount) return reportedCurrentPlayers;

            return registryPlayerCount;
        };

        const sessionsBefore = listSessions();

        if (reason === "duplicate_user_replaced" && !expectedConnectionId) {
            return {
                success: true,
                reason: "player_remove_ignored_duplicate_user_replaced_missing_connection_id",
                message: "Player remove ignored because duplicate_user_replaced was reported without connectionId.",
                session: null,
                sessions: sessionsBefore,
                removeResults: [
                    {
                        success: true,
                        reason: "duplicate_user_replaced_requires_connection_id",
                        sessionId: preferredSessionId
                    }
                ],
                serverCurrentPlayers: calculateServerCurrentPlayers(sessionsBefore)
            };
        }

        const orderedSessions = [
            ...sessionsBefore.filter((session) => preferredSessionId && session.sessionId === preferredSessionId),
            ...sessionsBefore.filter((session) => !preferredSessionId || session.sessionId !== preferredSessionId)
        ];

        const removeResults = [];
        let lastSuccess = null;

        for (const session of orderedSessions) {
            const players = Array.isArray(session?.players) ? session.players : [];
            const hasPlayer = players.some((player) => {
                const isSameUser =
                    safeText(player?.userId) === userId ||
                    safeText(player?.playerId) === userId;

                if (!isSameUser) return false;
                if (!expectedConnectionId) return true;

                const playerConnectionId = safeText(player?.connectionId);
                return !playerConnectionId || playerConnectionId === expectedConnectionId;
            });

            if (!hasPlayer) continue;

            const result = typeof this.removePlayer === "function"
                ? this.removePlayer(session.sessionId, userId, expectedConnectionId)
                : {
                    success: false,
                    reason: "remove_player_missing",
                    message: "removePlayer is not configured.",
                    session
                };

            removeResults.push({
                success: result.success,
                reason: result.reason,
                sessionId: session.sessionId
            });

            if (result.success) lastSuccess = result;
        }

        const sessionsAfterRemove = listSessions();

        for (const session of sessionsAfterRemove) {
            const players = Array.isArray(session?.players) ? session.players : [];
            const currentPlayers = Number.isFinite(session?.currentPlayers) ? session.currentPlayers : players.length;
            const status = safeText(session?.status);

            if (players.length > 0 || currentPlayers > 0 || status === "closed" || status === "failed") continue;

            //#region Phase 7.L - Public 3D Lobby Session Persistence

            //* سشن دائمی لابی پس از خروج آخرین بازیکن بسته نمی شود و برای ورود کاربران بعدی آماده باقی می ماند.
            if (isPermanentGameSession(session)) continue;

            //#endregion Phase 7.L - Public 3D Lobby Session Persistence

            if (typeof this.closeSession === "function") {
                this.closeSession(session.sessionId, "empty_session_after_player_left");
                continue;
            }

            if (this.sessions && typeof this.sessions.get === "function" && typeof this.sessions.set === "function") {
                const rawSession = this.sessions.get(session.sessionId);

                if (rawSession) {
                    rawSession.status = "closed";
                    rawSession.closedAt = Date.now();
                    rawSession.closeReason = "empty_session_after_player_left";
                    rawSession.players = [];
                    rawSession.currentPlayers = 0;
                    this.sessions.set(session.sessionId, rawSession);
                }
            }
        }

        const finalSessions = listSessions();
        const liveSessions = finalSessions.filter((session) => {
            const status = safeText(session?.status);
            const players = Array.isArray(session?.players) ? session.players : [];
            const currentPlayers = Number.isFinite(session?.currentPlayers) ? session.currentPlayers : players.length;

            return status !== "closed" && status !== "failed" && currentPlayers > 0;
        });

        const serverCurrentPlayers = liveSessions.reduce((sum, session) => {
            const players = Array.isArray(session?.players) ? session.players : [];
            return sum + players.length;
        }, 0);

        if (!lastSuccess) {
            return {
                success: false,
                reason: "player_not_found_in_server_sessions",
                message: "Player was not found in server sessions.",
                session: null,
                sessions: finalSessions,
                removeResults,
                serverCurrentPlayers
            };
        }

        return {
            success: true,
            reason: "player_removed_from_server_sessions",
            message: "Player removed from server sessions.",
            session: lastSuccess.session,
            sessions: finalSessions,
            removeResults,
            serverCurrentPlayers
        };
    }

    syncEmptyServerSessions(request = {}) {
        const serverId = cleanString(request.serverId, "");
        const roomId = cleanString(request.roomId, "");
        const reason = cleanString(request.reason, "server_reported_empty");

        if (!serverId && !roomId) {
            return this.failure("server_or_room_required", "serverId or roomId is required.", null);
        }

        let matchedSessions = 0;
        let changedSessions = 0;
        let removedPlayers = 0;
        const sessions = [];
        const syncedAt = nowMs();

        for (const [sessionId, record] of this.sessionsById.entries()) {
            if (serverId && record.serverId !== serverId) continue;
            if (roomId && record.roomId !== roomId) continue;
            if (!this.isSessionOpen(record)) continue;

            matchedSessions++;

            const playerCount = record.playersByUserId.size;
            if (playerCount <= 0) {
                sessions.push(this.toPublicSessionRecord(record));
                continue;
            }

            record.playersByUserId.clear();
            removedPlayers += playerCount;
            changedSessions++;
            record.updatedAt = syncedAt;
            record.metadata = {
                ...record.metadata,
                lastEmptySyncReason: reason,
                lastEmptySyncedAt: syncedAt,
                lastEmptySyncedPlayerCount: playerCount
            };

            this.sessionsById.set(sessionId, record);
            sessions.push(this.toPublicSessionRecord(record));
        }

        return this.success("empty_server_sessions_synced", "Empty server sessions synced.", {
            serverId,
            roomId,
            matchedSessions,
            changedSessions,
            removedPlayers,
            sessions
        });
    }

    cleanupClosedSessions() {
        let removedCount = 0;
        const currentTime = nowMs();

        for (const [sessionId, record] of this.sessionsById.entries()) {
            if (!record.closedAt) continue;
            if (currentTime - record.closedAt < this.closedSessionTtlMs) continue;

            this.sessionsById.delete(sessionId);

            if (this.sessionIdByRoomId.get(record.roomId) === sessionId) {
                this.sessionIdByRoomId.delete(record.roomId);
            }

            removedCount++;
        }

        return removedCount;
    }

    clear() {
        const count = this.sessionsById.size;
        this.sessionsById.clear();
        this.sessionIdByRoomId.clear();
        return count;
    }

    getStats() {
        const stats = {
            total: this.sessionsById.size,
            creating: 0,
            active: 0,
            closing: 0,
            closed: 0,
            failed: 0,
            totalPlayers: 0,
            totalCapacity: 0,
            byServer: {},
            byRegion: {},
            byRoom: {}
        };

        for (const record of this.sessionsById.values()) {
            if (stats[record.status] !== undefined) stats[record.status]++;

            const playerCount = record.playersByUserId.size;
            const isOpenSession = this.isSessionOpen(record);

            if (!isOpenSession) {
                continue;
            }

            stats.totalPlayers += playerCount;
            stats.totalCapacity += record.maxPlayers;

            const roomKey = record.roomId || "unknown";

            if (!stats.byRoom[roomKey]) {
                stats.byRoom[roomKey] = {
                    roomName: cleanString(record?.metadata?.roomName, roomKey),
                    sessions: 0,
                    players: 0,
                    capacity: 0,
                    serverId: record.serverId,
                    region: record.region || "unknown",
                    zone: record.zone || "unknown",
                    statusCounts: {}
                };
            }

            // Phase 7.L - Session Room Display Name

            //* نام روم از همان نام ارسالی کلاینت و Metadata سشن خوانده می شود.
            const sessionRoomDisplayName = cleanString(
                record?.metadata?.roomName,
                ""
            );

            if (sessionRoomDisplayName)
                stats.byRoom[roomKey].roomName = sessionRoomDisplayName;

            stats.byRoom[roomKey].sessions++;
            stats.byRoom[roomKey].players += playerCount;
            stats.byRoom[roomKey].capacity += record.maxPlayers;
            stats.byRoom[roomKey].statusCounts[record.status] =
                (stats.byRoom[roomKey].statusCounts[record.status] ?? 0) + 1;

            if (!stats.byServer[record.serverId]) {
                stats.byServer[record.serverId] = {
                    sessions: 0,
                    players: 0,
                    capacity: 0
                };
            }

            stats.byServer[record.serverId].sessions++;
            stats.byServer[record.serverId].players += playerCount;
            stats.byServer[record.serverId].capacity += record.maxPlayers;

            const regionKey = record.region || "unknown";

            if (!stats.byRegion[regionKey]) {
                stats.byRegion[regionKey] = {
                    sessions: 0,
                    players: 0,
                    capacity: 0
                };
            }

            stats.byRegion[regionKey].sessions++;
            stats.byRegion[regionKey].players += playerCount;
            stats.byRegion[regionKey].capacity += record.maxPlayers;
        }

        return stats;
    }


    isSessionOpen(record) {
        if (!record) return false;

        return record.status === GAME_SESSION_STATUS.CREATING ||
               record.status === GAME_SESSION_STATUS.ACTIVE;
    }

    isPublicSessionOpen(session) {
        if (!session) return false;

        return session.status === GAME_SESSION_STATUS.CREATING ||
               session.status === GAME_SESSION_STATUS.ACTIVE;
    }

    matchesFilters(session, filters = {}) {
        if (!session) return false;

        if (isNonEmptyString(filters.sessionId) && session.sessionId !== filters.sessionId.trim()) return false;
        if (isNonEmptyString(filters.roomId) && session.roomId !== filters.roomId.trim()) return false;
        if (isNonEmptyString(filters.serverId) && session.serverId !== filters.serverId.trim()) return false;
        if (isNonEmptyString(filters.status) && session.status !== filters.status.trim()) return false;
        if (isNonEmptyString(filters.region) && session.region !== filters.region.trim()) return false;
        if (isNonEmptyString(filters.zone) && session.zone !== filters.zone.trim()) return false;

        return true;
    }

    validateCreateSessionRequest(request) {
        if (!request || typeof request !== "object") {
            throw new Error("[GameSessionRegistry] createSession request object is required.");
        }

        if (!isNonEmptyString(request.roomId)) {
            throw new Error("[GameSessionRegistry] roomId is required.");
        }

        if (!isNonEmptyString(request.serverId)) {
            throw new Error("[GameSessionRegistry] serverId is required.");
        }

        if (request.maxPlayers !== undefined) {
            const maxPlayers = Number.parseInt(request.maxPlayers, 10);

            if (!Number.isInteger(maxPlayers) || maxPlayers < 1) {
                throw new Error("[GameSessionRegistry] maxPlayers must be at least 1.");
            }
        }
    }

    toPublicSessionRecord(record) {
        if (!record) return null;

        return {
            sessionId: record.sessionId,
            roomId: record.roomId,
            serverId: record.serverId,
            status: record.status,
            maxPlayers: record.maxPlayers,
            currentPlayers: record.playersByUserId.size,
            players: playersMapToArray(record.playersByUserId),
            createdAt: record.createdAt,
            startedAt: record.startedAt,
            closedAt: record.closedAt,
            updatedAt: record.updatedAt,
            region: record.region,
            zone: record.zone,
            metadata: record.metadata ?? {}
        };
    }

    success(reason, message, session) {
        return {
            success: true,
            reason,
            message,
            session
        };
    }

    failure(reason, message, session) {
        return {
            success: false,
            reason,
            message,
            session
        };
    }
}

function createGameSessionRegistry(options = {}) {
    return new GameSessionRegistry(options);
}

export {
    GAME_SESSION_STATUS,
    GameSessionRegistry,
    createGameSessionRegistry
};
