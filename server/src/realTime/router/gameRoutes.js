// File => src/realTime/router/gameRoutes.js

import { Channels } from "../protocol/channels.js";
import { MessageTypes } from "../protocol/messageTypes.js";
import { makeAckEnvelope, makeErrorEnvelope, RealtimeErrorCodes } from "../protocol/envelope.js";
import { requireRealtimeAuthenticated } from "../auth/realtimeAuth.js";
import { createGameServices } from "../modules/game/index.js";
import { readGameRoomIdFromEnvelope } from "../modules/game/gameRoomService.js";
import { broadcastRoomUpdatedToRealtimeRoom } from "../lobby/roomUpdateBroadcastService.js";

//* این تابع شناسه روم را از اِنولوپ یا پِیلود می خواند تا مسیرهای روم ورودی یکدست باشند.
function readRoomIdFromEnvelope(envelope) {
    return readGameRoomIdFromEnvelope(envelope);
}

//* این متغیر نسخه پیش فرض سرویس های بازی را نگه می دارد تا وقتی سرور سرویس تزریق نکرده باشد، رُت ها بدون کرش کار کنند.
let fallbackGameServices = null;

//* این تابع سرویس های بازی را از سرور می خواند و اگر هنوز تزریق نشده باشند، نسخه پیش فرض می سازد.
function resolveGameServices(ctx, server = null) {
    if (server?.gameServices) return server.gameServices;
    if (!fallbackGameServices) fallbackGameServices = createGameServices({ rooms: ctx?.rooms, registry: ctx?.registry, logger: ctx?.logger });
    return fallbackGameServices;
}

//* این تابع سرویس دایرکتوری روم را از سرور می خواند.
function resolveRoomDirectoryService(server = null) {
    return server?.roomDirectoryService ?? null;
}

//* این هَندلِر یوزر آث شده را بعد از تایید دایرکتوری روم وارد روم می کند و نتیجه را با اَک برمی گرداند.
async function handleGameJoinRoom(ctx, envelope, server = null) {
    requireRealtimeAuthenticated(ctx);

    const services = resolveGameServices(ctx, server);
    const roomDirectoryService = resolveRoomDirectoryService(server);
    const roomId = readGameRoomIdFromEnvelope(envelope);

    if (roomDirectoryService) {
        await roomDirectoryService.canJoinRoom(ctx, roomId);
    }

    const result = services.roomService.joinRoom(ctx, envelope);

    if (result.ok) {
        if (roomDirectoryService) {
            const roomInfo = services.roomService.getRoomInfo(ctx, result.roomId);
            const updatedRoom = await roomDirectoryService.markUserJoined(
                result.roomId,
                roomInfo.userCount ?? roomInfo.connectionCount
            );

            result.room = updatedRoom;
            result.connectionCount = roomInfo.connectionCount;
            result.userCount = roomInfo.userCount ?? roomInfo.connectionCount;
            result.roomUpdatedBroadcast = broadcastRoomUpdatedToRealtimeRoom(ctx, updatedRoom, {
                source: "game_join_room",
                logger: services.presenceService?.logger ?? ctx?.logger
            });
        }

        if (!result.logicalRejoin) {
            services.presenceService.broadcastPlayerJoined(ctx, envelope);
        } else {
            services.presenceService.logger?.info?.("Game presence player joined suppressed for reconnect rejoin", {
                roomId: result.roomId,
                userId: result.userId,
                replacedConnections: result.replacedConnections ?? 0
            });
        }
    }

    ctx.realtimeConnection?.sendEnvelope(
        makeAckEnvelope(envelope, result.ok ? "processed" : "failed", result)
    );

    return result.ok;
}

//* این هَندلِر یوزر آث شده را از روم مشخص خارج می کند، دیتابیس روم را آپدیت می کند و نتیجه را با اَک برمی گرداند.
async function handleGameLeaveRoom(ctx, envelope, server = null) {
    requireRealtimeAuthenticated(ctx);

    const services = resolveGameServices(ctx, server);
    const roomDirectoryService = resolveRoomDirectoryService(server);
    const roomId = readGameRoomIdFromEnvelope(envelope, ctx?.roomId);

    const result = services.roomService.leaveRoom(ctx, envelope);
    let leftPresence = { roomId, sent: 0, clearedState: false, skipped: true };

    if (result.ok && roomDirectoryService) {
        const roomInfo = services.roomService.getRoomInfo(ctx, result.roomId);
        const updatedRoom = await roomDirectoryService.markUserLeft(
            result.roomId,
            roomInfo.userCount ?? roomInfo.connectionCount
        );

        result.room = updatedRoom;
        result.connectionCount = roomInfo.connectionCount;
        result.userCount = roomInfo.userCount ?? roomInfo.connectionCount;
        result.roomUpdatedBroadcast = broadcastRoomUpdatedToRealtimeRoom(ctx, updatedRoom, {
            source: "game_leave_room",
            logger: services.presenceService?.logger ?? ctx?.logger
        });
    }

    if (result.ok) {
        leftPresence = services.presenceService.broadcastPlayerLeft(ctx, envelope, roomId);
    }

    ctx.realtimeConnection?.sendEnvelope(
        makeAckEnvelope(envelope, result.ok ? "processed" : "failed", { ...result, leftPresence })
    );

    return result.ok;
}

//* این هَندلِر اکشن بازی را به سرویس وضعیت بازی می دهد تا ثبت شود و به روم فعلی برادکست شود.
function handleGamePlayerAction(ctx, envelope, server = null) {
    requireRealtimeAuthenticated(ctx);
    const services = resolveGameServices(ctx, server);
    const result = services.stateService.processPlayerAction(ctx, envelope);
    ctx.realtimeConnection?.sendEnvelope(makeAckEnvelope(envelope, "processed", result));
    return result.sent;
}

//* این هَندلِر رویداد جهان بازی را به سرویس وضعیت بازی می دهد تا ثبت شود و به اعضای روم برادکست شود.
function handleGameWorldEvent(ctx, envelope, server = null) {
    requireRealtimeAuthenticated(ctx);
    const services = resolveGameServices(ctx, server);
    const result = services.stateService.processWorldEvent(ctx, envelope);
    ctx.realtimeConnection?.sendEnvelope(makeAckEnvelope(envelope, "processed", result));
    return result.sent;
}

//* این تابع مسیرهای بازی را روی رجیستری مسیر ثبت می کند.
function registerGameRoutes(routeRegistry) {
    return routeRegistry.registerMany([
        { ch: Channels.game, t: MessageTypes.game.joinRoom, handler: handleGameJoinRoom },
        { ch: Channels.game, t: MessageTypes.game.leaveRoom, handler: handleGameLeaveRoom },
        { ch: Channels.game, t: MessageTypes.game.playerAction, handler: handleGamePlayerAction },
        { ch: Channels.game, t: MessageTypes.game.worldEvent, handler: handleGameWorldEvent }
    ]);
}

//* این تابع قدیمی مسیرهای بازی را حفظ می کند و پیام بازی را بدون نیاز مستقیم به رجیستری پردازش می کند.
async function gameRoutes(ctx, env, server = null) {
    try {
        if (env?.t === MessageTypes.game.joinRoom) return await handleGameJoinRoom(ctx, env, server);
        if (env?.t === MessageTypes.game.leaveRoom) return await handleGameLeaveRoom(ctx, env, server);
        if (env?.t === MessageTypes.game.playerAction) return handleGamePlayerAction(ctx, env, server);
        if (env?.t === MessageTypes.game.worldEvent) return handleGameWorldEvent(ctx, env, server);
        return false;
    } catch (error) {
        ctx?.realtimeConnection?.sendEnvelope(makeErrorEnvelope(error, { replyTo: env?.id ?? "" }));
        return false;
    }
}

/*
توضیح کلی اسکریپت:
این فایل مسیرهای چَنِل بازی را مدیریت می کند.
در این فاز رُت های بازی دیگر لاجیک روم و وضعیت را مستقیم انجام نمی دهند و کار را به سرویس های ماژول بازی می سپارند.
جوین روم و لیو روم از سرویس روم بازی استفاده می کنند.
اکشن پلیر و رویداد جهان از سرویس وضعیت بازی استفاده می کنند.
پیام های ورود و خروج پلیر از سرویس پرزنس بازی برادکست می شوند.
تمام پیام های بازی باید بعد از آث موفق اجرا شوند.
این فایل نباید ترنسپورت خام، آث واقعی یا کُر ریل تایم بسازد.
وظیفه این فایل فقط وصل کردن رُت های بازی به سرویس های ماژول بازی و ارسال اَک استاندارد است.
*/

export {
    gameRoutes,
    registerGameRoutes,
    readRoomIdFromEnvelope,
    resolveGameServices,
    resolveRoomDirectoryService,
    handleGameJoinRoom,
    handleGameLeaveRoom,
    handleGamePlayerAction,
    handleGameWorldEvent
};
