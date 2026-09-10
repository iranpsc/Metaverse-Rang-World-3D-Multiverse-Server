// File => src/realTime/router/presenceRoutes.js

import { Channels } from "../protocol/channels.js";
import { MessageTypes } from "../protocol/messageTypes.js";
import { makeAckEnvelope, makeErrorEnvelope, RealtimeErrorCodes } from "../protocol/envelope.js";
import { requireRealtimeAuthenticated } from "../auth/realtimeAuth.js";
import { createGamePresenceService } from "../modules/game/gamePresenceService.js";

//* این تابع شناسه روم فعال را از اِنولوپ یا کانتکست می خواند تا پیام پرزنس در روم درست منتشر شود.
function readPresenceRoomId(ctx, envelope) {
    return String(envelope?.room ?? envelope?.payload?.roomId ?? ctx?.roomId ?? "").trim();
}
//* این متغیر نسخه پیش فرض سرویس پرزنس را نگه می دارد تا اگر سرور سرویس تزریق نکرده باشد، رُت ها بدون کرش کار کنند.
let fallbackPresenceService = null;

//* این تابع سرویس پرزنس را از سرور می خواند و اگر هنوز تزریق نشده باشد، نسخه پیش فرض می سازد.
function resolveGamePresenceService(ctx, server = null) {
    if (server?.gameServices?.presenceService) return server.gameServices.presenceService;
    if (!fallbackPresenceService) fallbackPresenceService = createGamePresenceService({ rooms: ctx?.rooms, logger: ctx?.logger });
    return fallbackPresenceService;
}
//* این هَندلِر وضعیت پلیر را از سرویس پرزنس عبور می دهد تا هم برادکست شود و هم برای اسنپ شات بعدی ذخیره بماند.
function handlePresencePlayerState(ctx, envelope, server = null) {
    requireRealtimeAuthenticated(ctx);
    const roomId = readPresenceRoomId(ctx, envelope);
    if (!roomId) throw { code: RealtimeErrorCodes.roomRequired, message: "Room id is required" };

    const presenceService = resolveGamePresenceService(ctx, server);
    const result = presenceService.broadcastPlayerState(ctx, { ...envelope, room: roomId });
    if (envelope?.requiresAck) ctx.realtimeConnection?.sendEnvelope(makeAckEnvelope(envelope, "processed", result));
    return result.sent;
}

//* این هَندلِر پیام ورود پلیر را از سرویس پرزنس منتشر می کند تا قالب پیام ها یکسان بماند.
function handlePresencePlayerJoined(ctx, envelope, server = null) {
    requireRealtimeAuthenticated(ctx);
    const roomId = readPresenceRoomId(ctx, envelope);
    if (!roomId) throw { code: RealtimeErrorCodes.roomRequired, message: "Room id is required" };

    const presenceService = resolveGamePresenceService(ctx, server);
    const result = presenceService.broadcastPlayerJoined(ctx, { ...envelope, room: roomId });
    return result.sent;
}

//* این هَندلِر پیام خروج پلیر را از سرویس پرزنس منتشر می کند و وضعیت حرکتی ذخیره شده را پاک می کند.
function handlePresencePlayerLeft(ctx, envelope, server = null) {
    requireRealtimeAuthenticated(ctx);
    const roomId = readPresenceRoomId(ctx, envelope);
    if (!roomId) throw { code: RealtimeErrorCodes.roomRequired, message: "Room id is required" };

    const presenceService = resolveGamePresenceService(ctx, server);
    const result = presenceService.broadcastPlayerLeft(ctx, { ...envelope, room: roomId }, roomId);
    return result.sent;
}

//* این هَندلِر اسنپ شات اعضای زنده روم را فقط برای کانکشن درخواست کننده می فرستد.
function handlePresenceRoomMembersRequest(ctx, envelope, server = null) {
    requireRealtimeAuthenticated(ctx);
    const roomId = readPresenceRoomId(ctx, envelope);
    if (!roomId) throw { code: RealtimeErrorCodes.roomRequired, message: "Room id is required" };

    const presenceService = resolveGamePresenceService(ctx, server);
    const result = presenceService.sendRoomMembersSnapshot(ctx, { ...envelope, room: roomId });
    if (envelope?.requiresAck) ctx.realtimeConnection?.sendEnvelope(makeAckEnvelope(envelope, "processed", {
        roomId: result.roomId,
        sent: result.sent,
        memberCount: result.memberCount,
        stateCount: result.stateCount
    }));
    return result.sent;
}

//* این تابع مسیرهای پرزنس را روی رجیستری مسیر ثبت می کند.
function registerPresenceRoutes(routeRegistry) {
    return routeRegistry.registerMany([
        { ch: Channels.presence, t: MessageTypes.presence.playerState, handler: handlePresencePlayerState },
        { ch: Channels.presence, t: MessageTypes.presence.playerJoined, handler: handlePresencePlayerJoined },
        { ch: Channels.presence, t: MessageTypes.presence.playerLeft, handler: handlePresencePlayerLeft },
        { ch: Channels.presence, t: MessageTypes.presence.roomMembersRequest, handler: handlePresenceRoomMembersRequest }
    ]);
}

//* این تابع قدیمی مسیرهای پرزنس را حفظ می کند و پیام پرزنس را بدون نیاز مستقیم به رجیستری پردازش می کند.
function presenceRoutes(ctx, env, server = null) {
    try {
        if (env?.t === MessageTypes.presence.playerState) return handlePresencePlayerState(ctx, env, server);
        if (env?.t === MessageTypes.presence.playerJoined) return handlePresencePlayerJoined(ctx, env, server);
        if (env?.t === MessageTypes.presence.playerLeft) return handlePresencePlayerLeft(ctx, env, server);
        if (env?.t === MessageTypes.presence.roomMembersRequest) return handlePresenceRoomMembersRequest(ctx, env, server);
        return false;
    } catch (error) {
        ctx?.realtimeConnection?.sendEnvelope(makeErrorEnvelope(error, { replyTo: env?.id ?? "" }));
        return false;
    }
}

/*
توضیح کلی اسکریپت:
این فایل مسیرهای پرزنس را مدیریت می کند.
پرزنس برای وضعیت زنده پلیر، ورود پلیر و خروج پلیر استفاده می شود.
در این فاز پیام های پرزنس فقط به روم فعال برادکست می شوند.
این فایل نباید ترنسپورت خام، آث واقعی، روم مَنِیجِر جدید یا لاجیک بازی سنگین بسازد.
وظیفه این فایل فقط وصل کردن پیام های پرزنس به رُتِر و روم مَنِیجِر است.
*/

export {
    presenceRoutes,
    registerPresenceRoutes,
    readPresenceRoomId,
    resolveGamePresenceService,
    handlePresencePlayerState,
    handlePresencePlayerJoined,
    handlePresencePlayerLeft,
    handlePresenceRoomMembersRequest
};