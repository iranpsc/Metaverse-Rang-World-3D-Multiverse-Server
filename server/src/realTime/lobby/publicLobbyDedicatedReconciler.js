// File => src/realTime/lobby/publicLobbyDedicatedReconciler.js

const DEFAULT_RECONCILE_INTERVAL_MS = 2000;
const HEALTHY_GAME_SERVER_STATUSES = new Set(["healthy", "warning"]);

//#region Phase 7.L - Public 3D Lobby Dedicated Helpers

//* این تابع متن را برای استفاده داخلی سرویس استاندارد می کند.
function cleanString(value, fallbackValue = "") {
    if (typeof value !== "string" || !value.trim()) return fallbackValue;
    return value.trim();
}

//* این تابع عدد صحیح را در بازه امن نگه می دارد.
function clampInteger(value, fallbackValue, minValue, maxValue) {
    const parsedValue = Number.parseInt(value, 10);

    if (!Number.isFinite(parsedValue)) return fallbackValue;
    if (parsedValue < minValue) return minValue;
    if (parsedValue > maxValue) return maxValue;

    return parsedValue;
}

//* این تابع مشخصات لازم روم عمومی لابی را برای بازیابی Dedicated آماده می کند.
function normalizePublicLobbyRoom(room = {}) {
    const metadata =
        room?.metadata &&
        typeof room.metadata === "object" &&
        !Array.isArray(room.metadata)
            ? room.metadata
            : {};

    return {
        roomId: cleanString(
            room.roomId,
            "room_public_lobby_main"
        ),

        roomName: cleanString(
            room.roomName,
            "Main Public Lobby"
        ),

        maxPlayers: clampInteger(
            room.maxPlayers,
            100,
            1,
            1024
        ),

        metadata: {
            ...metadata,
            roomType: "public_lobby",
            systemRoom: true,
            isPublic: true,
            isPermanent: true,
            autoCleanup: false,
            excludeFromRoomList: true,
            dedicatedRequired: true,
            autoCloseWhenEmpty: false
        }
    };
}

//* این تابع بررسی می کند Session هنوز باز و قابل استفاده است یا خیر.
function isOpenSession(sessionRegistry, session) {
    if (!session) return false;

    if (
        typeof sessionRegistry?.isPublicSessionOpen ===
        "function"
    ) {
        return sessionRegistry.isPublicSessionOpen(
            session
        );
    }

    return (
        session.status === "creating" ||
        session.status === "active"
    );
}

//* این تابع مشخص می کند وضعیت سلامت Dedicated برای لابی قابل قبول است یا خیر.
function isHealthyServer(
    gameServerControl,
    serverId
) {
    const health =
        gameServerControl?.healthStore?.getHealth?.(
            serverId
        ) ?? null;

    return (
        !!health &&
        HEALTHY_GAME_SERVER_STATUSES.has(
            cleanString(health.status, "")
        )
    );
}

//* این تابع تخصیص فعلی لابی را از رکورد Dedicated می خواند.
function readLobbyAssignment(
    server,
    roomId
) {
    if (
        !server?.assignedRooms ||
        typeof server.assignedRooms !== "object"
    ) {
        return null;
    }

    return server.assignedRooms[roomId] ?? null;
}

//#endregion Phase 7.L - Public 3D Lobby Dedicated Helpers

//#region Phase 7.L - Public 3D Lobby Dedicated Reconciler

//* این کلاس اتصال دائمی لابی عمومی به Dedicated Server و Session را ایجاد و بازیابی می کند.
class PublicLobbyDedicatedReconciler {
    constructor(options = {}) {
        this.gameServerControl =
            options.gameServerControl ?? null;

        this.publicLobbyRoom =
            normalizePublicLobbyRoom(
                options.publicLobbyRoom ?? {}
            );

        this.logger =
            options.logger ?? console;

        this.intervalMs =
            clampInteger(
                options.intervalMs,
                DEFAULT_RECONCILE_INTERVAL_MS,
                500,
                60000
            );

        this.timer = null;
        this.started = false;
        this.lastStateKey = "";
        this.lastResult = null;
    }

    //* این تابع سرویس را روشن می کند و بلافاصله یک بار وضعیت لابی را بررسی می کند.
    start() {
        if (this.started)
            return this.getStatus();

        this.started = true;

        this.reconcileSafely();

        this.timer = setInterval(() => {
            this.reconcileSafely();
        }, this.intervalMs);

        this.timer.unref?.();

        return this.getStatus();
    }

    //* این تابع تایمر سرویس را متوقف می کند ولی Dedicated و Session فعال را حذف نمی کند.
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        this.started = false;

        return this.getStatus();
    }

    //* این تابع Reconcile را با مدیریت خطا اجرا می کند تا خطای موقت Dedicated باعث توقف Node نشود.
    reconcileSafely() {
        try {
            return this.reconcileNow();
        } catch (error) {
            return this.publishResult({
                success: false,
                state: "error",
                reason:
                    "public_lobby_reconcile_exception",
                message:
                    error?.message ??
                    String(error),
                error:
                    error?.stack ??
                    String(error)
            });
        }
    }

    //* این تابع تخصیص Dedicated و Session لابی را بررسی و در صورت نیاز بازسازی می کند.
    reconcileNow() {
        const control =
            this.gameServerControl;

        const room =
            this.publicLobbyRoom;

        if (
            !control?.registry ||
            !control?.healthStore ||
            !control?.allocator ||
            !control?.sessionRegistry
        ) {
            return this.publishResult({
                success: false,
                state: "waiting",
                reason:
                    "game_server_control_dependencies_missing",
                message:
                    "Game server control dependencies are not ready."
            });
        }

        const existingSession =
            control.sessionRegistry.findSessionByRoom(
                room.roomId
            );

        if (
            isOpenSession(
                control.sessionRegistry,
                existingSession
            )
        ) {
            const sessionServer =
                control.registry.getServer(
                    existingSession.serverId
                );

            if (!sessionServer) {
                control.sessionRegistry.closeSession(
                    existingSession.sessionId,
                    "public_lobby_server_missing"
                );
            } else if (
                !isHealthyServer(
                    control,
                    sessionServer.serverId
                )
            ) {
                return this.publishResult({
                    success: false,
                    state: "waiting",
                    reason:
                        "public_lobby_server_not_healthy",
                    message:
                        "Assigned public lobby server is waiting for a healthy heartbeat.",
                    serverId:
                        sessionServer.serverId,
                    sessionId:
                        existingSession.sessionId
                });
            } else {
                const assignmentResult =
                    this.ensureRoomAssignment(
                        sessionServer
                    );

                if (!assignmentResult.success)
                    return this.publishResult(
                        assignmentResult
                    );

                return this.publishResult({
                    success: true,
                    state: "ready",
                    reason:
                        "public_lobby_dedicated_ready",
                    message:
                        "Public lobby Dedicated Server and Session are ready.",
                    serverId:
                        assignmentResult.server.serverId,
                    sessionId:
                        existingSession.sessionId,
                    roomId:
                        room.roomId,
                    server:
                        assignmentResult.server,
                    session:
                        existingSession
                });
            }
        }

        const assignedServers =
            control.registry
                .listServers()
                .filter((server) =>
                    readLobbyAssignment(
                        server,
                        room.roomId
                    )
                );

        if (assignedServers.length > 1) {
            return this.publishResult({
                success: false,
                state: "error",
                reason:
                    "public_lobby_duplicate_server_assignments",
                message:
                    "Public lobby is assigned to more than one Dedicated Server.",
                serverIds:
                    assignedServers.map(
                        (server) =>
                            server.serverId
                    )
            });
        }

        let selectedServer =
            assignedServers[0] ?? null;

        if (
            selectedServer &&
            !isHealthyServer(
                control,
                selectedServer.serverId
            )
        ) {
            return this.publishResult({
                success: false,
                state: "waiting",
                reason:
                    "public_lobby_assigned_server_not_healthy",
                message:
                    "Assigned public lobby server is waiting for a healthy heartbeat.",
                serverId:
                    selectedServer.serverId
            });
        }

        if (!selectedServer) {
            const allocationResult =
                control.allocator.allocateServer({
                    roomId:
                        room.roomId,

                    roomMaxPlayers:
                        room.maxPlayers,

                    minFreeSlots: 1,

                    requireHealthy: true,
                    allowWarm: true,
                    allowBusy: true,
                    allowReserved: true,
                    allowClaimed: true,

                    metadata: {
                        source:
                            "public_lobby_dedicated_reconciler"
                    }
                });

            if (!allocationResult.success) {
                return this.publishResult({
                    success: false,
                    state: "waiting",
                    reason:
                        allocationResult.reason,
                    message:
                        allocationResult.message,
                    allocation:
                        allocationResult
                });
            }

            selectedServer =
                allocationResult.server;
        }

        const assignmentResult =
            this.ensureRoomAssignment(
                selectedServer
            );

        if (!assignmentResult.success)
            return this.publishResult(
                assignmentResult
            );

        selectedServer =
            assignmentResult.server;

        const session =
            control.sessionRegistry.getOrCreateSession({
                roomId:
                    room.roomId,

                serverId:
                    selectedServer.serverId,

                status: "active",

                region:
                    selectedServer.region,

                zone:
                    selectedServer.zone,

                maxPlayers:
                    room.maxPlayers,

                metadata: {
                    ...room.metadata,
                    createdBy:
                        "public_lobby_dedicated_reconciler",
                    roomName:
                        room.roomName,
                    roomMaxPlayers:
                        room.maxPlayers,
                    assignedServerId:
                        selectedServer.serverId,
                    isPermanent: true,
                    autoCloseWhenEmpty: false
                }
            });

        return this.publishResult({
            success: true,
            state: "ready",
            reason:
                "public_lobby_dedicated_created",
            message:
                "Public lobby Dedicated Server assignment and Session were created.",
            serverId:
                selectedServer.serverId,
            sessionId:
                session.sessionId,
            roomId:
                room.roomId,
            server:
                selectedServer,
            session
        });
    }

    //* این تابع ظرفیت روم لابی را روی Dedicated انتخاب شده رزرو یا تایید می کند.
    ensureRoomAssignment(server) {
        const control =
            this.gameServerControl;

        const room =
            this.publicLobbyRoom;

        const existingAssignment =
            readLobbyAssignment(
                server,
                room.roomId
            );

        if (existingAssignment) {
            const assignResult =
                control.registry.assignRoomToServer({
                    serverId:
                        server.serverId,
                    roomId:
                        room.roomId,
                    roomName:
                        room.roomName,
                    roomMaxPlayers:
                        room.maxPlayers,
                    reason:
                        "public_lobby_assignment_reconciled"
                });

            return assignResult.success
                ? assignResult
                : {
                    ...assignResult,
                    state: "error"
                };
        }

        if (
            server.status === "warm" &&
            typeof control.registry
                .claimWarmServerForRoom ===
                "function"
        ) {
            const claimResult =
                control.registry.claimWarmServerForRoom({
                    serverId:
                        server.serverId,
                    roomId:
                        room.roomId,
                    roomName:
                        room.roomName,
                    roomMaxPlayers:
                        room.maxPlayers,
                    region:
                        server.region,
                    zone:
                        server.zone,
                    reason:
                        "public_lobby_warm_server_claimed"
                });

            return claimResult.success
                ? claimResult
                : {
                    ...claimResult,
                    state: "waiting"
                };
        }

        const assignResult =
            control.registry.assignRoomToServer({
                serverId:
                    server.serverId,
                roomId:
                    room.roomId,
                roomName:
                    room.roomName,
                roomMaxPlayers:
                    room.maxPlayers,
                reason:
                    "public_lobby_room_assigned"
            });

        return assignResult.success
            ? assignResult
            : {
                ...assignResult,
                state: "waiting"
            };
    }

    //* این تابع نتیجه را ذخیره و فقط هنگام تغییر وضعیت در لاگ ثبت می کند.
    publishResult(result = {}) {
        const normalizedResult = {
            success:
                result.success === true,

            state:
                cleanString(
                    result.state,
                    result.success === true
                        ? "ready"
                        : "waiting"
                ),

            reason:
                cleanString(
                    result.reason,
                    "unknown"
                ),

            message:
                cleanString(
                    result.message,
                    ""
                ),

            roomId:
                this.publicLobbyRoom.roomId,

            serverId:
                cleanString(
                    result.serverId,
                    ""
                ),

            sessionId:
                cleanString(
                    result.sessionId,
                    ""
                ),

            server:
                result.server ?? null,

            session:
                result.session ?? null,

            allocation:
                result.allocation ?? null,

            serverIds:
                Array.isArray(
                    result.serverIds
                )
                    ? result.serverIds
                    : [],

            error:
                result.error ?? null,

            updatedAt:
                Date.now()
        };

        this.lastResult =
            normalizedResult;

        const stateKey = [
            normalizedResult.state,
            normalizedResult.reason,
            normalizedResult.serverId,
            normalizedResult.sessionId
        ].join("|");

        if (
            stateKey !==
            this.lastStateKey
        ) {
            this.lastStateKey =
                stateKey;

            const logData = {
                roomId:
                    normalizedResult.roomId,
                state:
                    normalizedResult.state,
                reason:
                    normalizedResult.reason,
                serverId:
                    normalizedResult.serverId,
                sessionId:
                    normalizedResult.sessionId
            };

            if (
                normalizedResult.state ===
                "ready"
            ) {
                this.logger?.info?.(
                    "[PublicLobbyDedicated] Public lobby Dedicated is ready.",
                    logData
                );
            } else if (
                normalizedResult.state ===
                "error"
            ) {
                this.logger?.error?.(
                    "[PublicLobbyDedicated] Public lobby Dedicated reconcile failed.",
                    {
                        ...logData,
                        error:
                            normalizedResult.error
                    }
                );
            } else {
                this.logger?.warn?.(
                    "[PublicLobbyDedicated] Public lobby Dedicated is waiting.",
                    logData
                );
            }
        }

        return normalizedResult;
    }

    //* این تابع وضعیت فعلی سرویس را برای Shutdown، تست و مانیتورینگ بر می گرداند.
    getStatus() {
        return {
            started:
                this.started,

            intervalMs:
                this.intervalMs,

            room: {
                ...this.publicLobbyRoom,

                metadata: {
                    ...this.publicLobbyRoom
                        .metadata
                }
            },

            lastResult:
                this.lastResult
        };
    }
}

//* این تابع نمونه سرویس Reconcile لابی عمومی را می سازد.
function createPublicLobbyDedicatedReconciler(
    options = {}
) {
    return new PublicLobbyDedicatedReconciler(
        options
    );
}

//#endregion Phase 7.L - Public 3D Lobby Dedicated Reconciler

export {
    PublicLobbyDedicatedReconciler,
    createPublicLobbyDedicatedReconciler,
    normalizePublicLobbyRoom
};
