import { GrpcStreamingRealtimeTransport } from "./grpcStreamingTransport.js";
import { loadRealtimeStreamProto } from "./setupGrpcStreamingRealtime.js";
import { setGrpcStreamingTransport } from "../../../transport/grpc/handlers/realtimeStream.handler.js";
import { registerRealtimeStreamService } from "../../../transport/grpc/registrars/realtimeStream.registrar.js";
import { createRealtimeServer } from "../../core/realtimeServer.js";
import { createRealtimeRouter } from "../../router/realtimeRouter.js";
import { ClientsRegistry } from "../../clientsRegistry.js";
import { RoomManager } from "../../roomManager.js";
import { createGameServices } from "../../modules/game/index.js";
import { makeFloodProtection } from "../../stability/floodProtection.js";
import { createAckTracker } from "../../stability/ackTracker.js";
import { cleanupRealtimeConnection } from "../../stability/disconnectCleanup.js";
import { RoomDirectoryService } from "../../lobby/roomDirectoryService.js";
import { broadcastRoomUpdatedToRealtimeRoom } from "../../lobby/roomUpdateBroadcastService.js";

//* این تابع فلاد پروتکشن مسیر جی‌آر‌پی‌سی را اجرا می‌کند تا پیام اسپم قبل از ورود به کُر ریل‌تایم رد شود.
function runGrpcRealtimeFloodProtection(ctx, floodProtection, logger = null) {
    if (!floodProtection?.allow(ctx)) {
        logger?.warn?.("Grpc realtime message blocked by flood protection", {
            connectionId: ctx?.connectionId,
            userId: ctx?.user?.id ?? ctx?.user?.userId ?? ""
        });
        return false;
    }

    return true;
}

//* این تابع اِنولوپ‌های اَک را بعد از خوانده شدن پیام به اَک‌ترکر تحویل می‌دهد.
function resolveGrpcRealtimeAckEnvelope(envelope, ackTracker) {
    ackTracker?.resolve?.(envelope);
    return true;
}

//* این تابع شناسه روم‌های کانکشن جی‌آر‌پی‌سی را قبل از کلیناپ می‌خواند.
function readGrpcRealtimeRoomIdsBeforeCleanup(ctx) {
    const connection = ctx?.realtimeConnection ?? ctx?.connection;
    const roomIds = typeof ctx?.rooms?.getConnectionRooms === "function" ? ctx.rooms.getConnectionRooms(connection) : [];
    const cleanRoomIds = [...new Set(roomIds.map((roomId) => String(roomId ?? "").trim()).filter(Boolean))];
    const fallbackRoomId = String(ctx?.roomId ?? "").trim();

    if (cleanRoomIds.length === 0 && fallbackRoomId) cleanRoomIds.push(fallbackRoomId);

    return cleanRoomIds;
}

//* این تابع اِنولوپ سبک خروج پلیر را برای حالت دیسکانکت جی‌آر‌پی‌سی می‌سازد.
function makeGrpcRealtimeDisconnectPresenceEnvelope(ctx, roomId, closeInfo = null) {
    return {
        id: `disconnect_${ctx?.connectionId ?? "unknown"}_${Date.now()}`,
        room: String(roomId ?? ""),
        payload: {
            roomId: String(roomId ?? ""),
            data: {
                reason: "disconnect",
                closeInfo
            }
        }
    };
}

//* این تابع قبل از حذف کانکشن از روم‌ها، خروج پلیر جی‌آر‌پی‌سی را برای اعضای همان روم برادکست می‌کند.
function broadcastGrpcRealtimeDisconnectPresence(ctx, roomIds = [], closeInfo = null, gameServices = null, logger = null) {
    if (!ctx || !gameServices?.presenceService || roomIds.length === 0) {
        return {
            roomCount: 0,
            sent: 0
        };
    }

    let sent = 0;

    for (const roomId of roomIds) {
        try {
            const envelope = makeGrpcRealtimeDisconnectPresenceEnvelope(ctx, roomId, closeInfo);
            const result = gameServices.presenceService.broadcastPlayerLeft(ctx, envelope, roomId);
            sent += Number(result?.sent ?? 0);
        } catch (error) {
            logger?.warn?.("Grpc realtime disconnect presence broadcast failed", {
                connectionId: ctx?.connectionId ?? "",
                roomId,
                error: error?.message ?? String(error)
            });
        }
    }

    logger?.info?.("Grpc realtime disconnect presence broadcast completed", {
        connectionId: ctx?.connectionId ?? "",
        userId: ctx?.user?.id ?? ctx?.user?.userId ?? "",
        roomCount: roomIds.length,
        sent
    });

    return {
        roomCount: roomIds.length,
        sent
    };
}

//* این تابع بعد از دیسکانکت جی‌آر‌پی‌سی، شمارنده آنلاین روم را در دایرکتوری روم به‌روزرسانی می‌کند.
function updateGrpcRealtimeRoomDirectoryAfterDisconnect(ctx, roomIds = [], roomDirectoryService = null, logger = null) {
    if (!ctx || !roomDirectoryService || roomIds.length === 0) {
        return {
            scheduled: false,
            roomCount: 0
        };
    }

    const tasks = roomIds.map(async (roomId) => {
        const connectionCount = typeof ctx?.rooms?.getRoomSize === "function"
            ? ctx.rooms.getRoomSize(roomId)
            : 0;
        const onlineCount = typeof ctx?.rooms?.getRoomUserCount === "function"
            ? ctx.rooms.getRoomUserCount(roomId)
            : connectionCount;

        const updatedRoom = await roomDirectoryService.markUserLeft(roomId, onlineCount);
        const roomUpdateBroadcast = broadcastRoomUpdatedToRealtimeRoom(ctx, updatedRoom, {
            source: "grpc_disconnect",
            logger
        });

        logger?.info?.("Grpc realtime disconnect room directory updated", {
            roomId,
            connectionCount,
            userCount: onlineCount,
            roomUpdateSent: roomUpdateBroadcast.sent ?? 0,
            status: updatedRoom?.status ?? "",
            onlineCount: updatedRoom?.onlineCount ?? onlineCount
        });

        return {
            roomId,
            connectionCount,
            userCount: onlineCount,
            roomUpdateSent: roomUpdateBroadcast.sent ?? 0,
            status: updatedRoom?.status ?? "",
            onlineCount: updatedRoom?.onlineCount ?? onlineCount
        };
    });

    Promise.allSettled(tasks).then((results) => {
        const failed = results.filter((item) => item.status === "rejected");

        if (failed.length > 0) {
            logger?.warn?.("Grpc realtime disconnect room directory update partially failed", {
                roomCount: roomIds.length,
                failedCount: failed.length,
                errors: failed.map((item) => item.reason?.message ?? String(item.reason))
            });
        }
    }).catch((error) => {
        logger?.warn?.("Grpc realtime disconnect room directory update failed", {
            error: error?.message ?? String(error)
        });
    });

    return {
        scheduled: true,
        roomCount: roomIds.length
    };
}

//* این تابع هنگام بسته شدن کانکشن جی‌آر‌پی‌سی، پرزنس خروج، کلیناپ کانکشن و آپدیت دایرکتوری روم را پشت سر هم اجرا می‌کند.
function cleanupGrpcRealtimeContext(ctx, closeInfo = null, gameServices = null, roomDirectoryService = null, logger = null) {
    const roomIds = readGrpcRealtimeRoomIdsBeforeCleanup(ctx);
    const presence = broadcastGrpcRealtimeDisconnectPresence(ctx, roomIds, closeInfo, gameServices, logger);
    const cleaned = cleanupRealtimeConnection(ctx, { closeInfo });
    const roomDirectory = updateGrpcRealtimeRoomDirectoryAfterDisconnect(ctx, roomIds, roomDirectoryService, logger);

    return {
        cleaned,
        presence,
        roomDirectory
    };
}

//* این تابع وابستگی‌های کُر ریل‌تایم را برای مسیر جی‌آر‌پی‌سی می‌سازد یا از مسیر مشترک فعلی می‌گیرد.
function createGrpcRealtimeCoreDependencies({ logger = null, sharedRealtime = null } = {}) {
    const registry = sharedRealtime?.registry ?? new ClientsRegistry();
    const rooms = sharedRealtime?.rooms ?? new RoomManager();
    const router = sharedRealtime?.router ?? createRealtimeRouter({ logger });
    const floodProtection = sharedRealtime?.floodProtection ?? makeFloodProtection({ logger });
    const ackTracker = sharedRealtime?.ackTracker ?? createAckTracker({ logger });
    const gameServices = sharedRealtime?.gameServices ?? createGameServices({ rooms, registry, logger });
    const roomDirectoryService = sharedRealtime?.roomDirectoryService ?? new RoomDirectoryService({ logger });

    return {
        registry,
        rooms,
        router,
        floodProtection,
        ackTracker,
        gameServices,
        roomDirectoryService,
        ownsFloodProtection: !sharedRealtime?.floodProtection,
        ownsAckTracker: !sharedRealtime?.ackTracker
    };
}

//* این تابع ورودی‌های لازم برای وصل کردن جی‌آر‌پی‌سی به کُر واقعی ریل‌تایم را بررسی می‌کند.
function assertAttachGrpcRealtimeCoreInputs({ grpcServer = null } = {}) {
    if (!grpcServer || typeof grpcServer.addService !== "function") {
        throw new Error("attachGrpcStreamingRealtimeCore requires grpcServer with addService");
    }
}

//* این تابع ترنسپورت جی‌آر‌پی‌سی را به کُر واقعی ریل‌تایم وصل می‌کند و سرویس اوپن اِستریم را روی سرور جی‌آر‌پی‌سی ثبت می‌کند.
function attachGrpcStreamingRealtimeCore({
    grpcServer = null,
    tokenService = null,
    logger = null,
    sharedRealtime = null,
    protoPath = "protos/realtime/realtime_stream.proto",
    includeDirs = ["protos"]
} = {}) {
    assertAttachGrpcRealtimeCoreInputs({ grpcServer });

    const dependencies = createGrpcRealtimeCoreDependencies({
        logger,
        sharedRealtime
    });

    const transport = new GrpcStreamingRealtimeTransport({ logger });

    const realtimeServer = createRealtimeServer({
        transport,
        router: dependencies.router,
        logger,
        tokenService: tokenService ?? sharedRealtime?.realtimeServer?.tokenService ?? null,
        registry: dependencies.registry,
        rooms: dependencies.rooms,
        hooks: {
            onConnection: (ctx) => {
                logger?.info?.("Grpc realtime core connection attached", {
                    connectionId: ctx?.connectionId ?? "",
                    transportKind: ctx?.transportKind ?? ""
                });
            },
            beforeMessage: (ctx) => runGrpcRealtimeFloodProtection(ctx, dependencies.floodProtection, logger),
            afterEnvelope: (ctx, envelope) => resolveGrpcRealtimeAckEnvelope(envelope, dependencies.ackTracker),
            onClose: (ctx, closeInfo) => cleanupGrpcRealtimeContext(ctx, closeInfo, dependencies.gameServices, dependencies.roomDirectoryService, logger),
            onError: (ctx, error) => logger?.warn?.("Grpc realtime connection error observed in bootstrap", {
                connectionId: ctx?.connectionId,
                error: error?.message ?? String(error)
            }),
            onStop: () => {
                if (dependencies.ownsAckTracker) dependencies.ackTracker.clear();
                if (dependencies.ownsFloodProtection) dependencies.floodProtection.cleanup?.(0);
            }
        }
    });

    realtimeServer.registry = dependencies.registry;
    realtimeServer.rooms = dependencies.rooms;
    realtimeServer.router = dependencies.router;
    realtimeServer.gameServices = dependencies.gameServices;
    realtimeServer.roomDirectoryService = dependencies.roomDirectoryService;
    realtimeServer.floodProtection = dependencies.floodProtection;
    realtimeServer.ackTracker = dependencies.ackTracker;

    realtimeServer.start();

    setGrpcStreamingTransport(transport);

    const protoRoot = loadRealtimeStreamProto({ protoPath, includeDirs });
    const registration = registerRealtimeStreamService({
        grpcServer,
        protoRoot,
        logger
    });

    logger?.info?.("Grpc streaming realtime core attached", {
        transport: "grpcStreaming",
        serviceName: registration.serviceName,
        sharedRegistry: Boolean(sharedRealtime?.registry),
        sharedRooms: Boolean(sharedRealtime?.rooms),
        routes: dependencies.router.getSnapshot?.()?.routeCount ?? 0
    });

    return {
        realtimeServer,
        transport,
        registry: dependencies.registry,
        rooms: dependencies.rooms,
        router: dependencies.router,
        gameServices: dependencies.gameServices,
        floodProtection: dependencies.floodProtection,
        ackTracker: dependencies.ackTracker,
        roomDirectoryService: dependencies.roomDirectoryService,
        protoRoot,
        registration,
        stop: () => realtimeServer.stop(),
        getStats: () => realtimeServer.getStats()
    };
}

//* توضیح کلی فایل:
//* این فایل اتصال‌دهنده جداگانه مسیر جی‌آر‌پی‌سی اِستریمینگ به کُر واقعی ریل‌تایم است.
//* این فایل مسیر وب‌سوکت، اِنولوپ، رُتِر و فایل اتچ ریل‌تایم را تغییر نمی‌دهد.
//* این فایل یک ترنسپورت جی‌آر‌پی‌سی می‌سازد و آن را به کُر ریل‌تایم می‌دهد.
//* سپس سرویس اِستریم ریل‌تایم را روی سرور جی‌آر‌پی‌سی ثبت می‌کند.
//* بعد از ثبت سرویس، کال‌های جی‌آر‌پی‌سی از مسیر اوپن وارد همان کُر واقعی ریل‌تایم می‌شوند.
//* اگر خروجی اتچ ریل‌تایم به مسیر مشترک داده شود، رجیستری، روم‌ها، رُتِر و سرویس‌های گیم بین وب‌سوکت و جی‌آر‌پی‌سی مشترک می‌شوند.
//* هدف این فایل آماده کردن مسیر واقعی نِیتیو جی‌آر‌پی‌سی بدون خراب کردن مسیر فعلی وب‌سوکت است.

export {
    attachGrpcStreamingRealtimeCore,
    createGrpcRealtimeCoreDependencies,
    cleanupGrpcRealtimeContext,
    runGrpcRealtimeFloodProtection,
    resolveGrpcRealtimeAckEnvelope
};
