// File => src/realTime/router/lobbyRoutes.js

import { Channels } from "../protocol/channels.js";
import { MessageTypes } from "../protocol/messageTypes.js";
import { makeAckEnvelope, makeErrorEnvelope } from "../protocol/envelope.js";
import { requireRealtimeAuthenticated } from "../auth/realtimeAuth.js";
import { RoomDirectoryService } from "../lobby/roomDirectoryService.js";

//* این متغیر نسخه پیش فرض سرویس دایرکتوری روم را نگه می دارد تا اگر سرور سرویس تزریق نکرده باشد، روت ها کرش نکنند.
let fallbackRoomDirectoryService = null;

//* این تابع سرویس دایرکتوری روم را از سرور می خواند و اگر نبود، نسخه پیش فرض می سازد.
function resolveRoomDirectoryService(ctx, server = null) {
    if (server?.roomDirectoryService) {
        return server.roomDirectoryService;
    }

    if (!fallbackRoomDirectoryService) {
        fallbackRoomDirectoryService = new RoomDirectoryService({
            logger: ctx?.logger
        });
    }

    return fallbackRoomDirectoryService;
}

//* این هندلر درخواست ساخت روم را از یوزر آث شده می گیرد، روم را در دیتابیس می سازد و نتیجه را با اک برمی گرداند.
async function handleLobbyCreateRoom(ctx, envelope, server = null) {
    requireRealtimeAuthenticated(ctx);

    const roomDirectoryService = resolveRoomDirectoryService(ctx, server);
    const room = await roomDirectoryService.createRoomForUser(ctx, envelope?.payload ?? {});

    const result = {
        ok: true,
        room
    };

    ctx.realtimeConnection?.sendEnvelope(
        makeAckEnvelope(envelope, "processed", result)
    );

    return true;
}

//* این هندلر لیست روم های قابل نمایش را از دیتابیس می خواند و با اک به همان کانکشن برمی گرداند.
async function handleLobbyListRooms(ctx, envelope, server = null) {
    requireRealtimeAuthenticated(ctx);

    const roomDirectoryService = resolveRoomDirectoryService(ctx, server);
    const rooms = await roomDirectoryService.listRoomsForUser(ctx, envelope?.payload ?? {});

    const result = {
        ok: true,
        rooms,
        count: rooms.length
    };

    ctx.realtimeConnection?.sendEnvelope(
        makeAckEnvelope(envelope, "processed", result)
    );

    return true;
}

//* این تابع مسیرهای لابی را روی رجیستری مسیر ثبت می کند.
function registerLobbyRoutes(routeRegistry) {
    return routeRegistry.registerMany([
        { ch: Channels.lobby, t: MessageTypes.lobby.createRoom, handler: handleLobbyCreateRoom },
        { ch: Channels.lobby, t: MessageTypes.lobby.listRooms, handler: handleLobbyListRooms }
    ]);
}

//* این تابع قدیمی مسیرهای لابی را حفظ می کند و پیام لابی را بدون نیاز مستقیم به رجیستری پردازش می کند.
async function lobbyRoutes(ctx, env, server = null) {
    try {
        if (env?.t === MessageTypes.lobby.createRoom) return await handleLobbyCreateRoom(ctx, env, server);
        if (env?.t === MessageTypes.lobby.listRooms) return await handleLobbyListRooms(ctx, env, server);
        return false;
    } catch (error) {
        ctx?.realtimeConnection?.sendEnvelope(
            makeErrorEnvelope(error, { replyTo: env?.id ?? "" })
        );
        return false;
    }
}

export {
    lobbyRoutes,
    registerLobbyRoutes,
    resolveRoomDirectoryService,
    handleLobbyCreateRoom,
    handleLobbyListRooms
};
