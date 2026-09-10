// File => src/realTime/router/npcRoutes.js

import { Channels } from "../protocol/channels.js";
import { MessageTypes } from "../protocol/messageTypes.js";
import { makeAckEnvelope, makeErrorEnvelope, RealtimeErrorCodes } from "../protocol/envelope.js";
import { requireRealtimeAuthenticated } from "../auth/realtimeAuth.js";

//* این تابع شناسه روم اِن پی سی را از اِنولوپ یا کانتکست می خواند.
function readNpcRoomId(ctx, envelope) {
    return String(envelope?.room ?? envelope?.payload?.roomId ?? ctx?.roomId ?? "").trim();
}

//* این تابع پیام اِن پی سی را به اعضای روم برادکست می کند.
function broadcastNpcEnvelope(ctx, envelope) {
    requireRealtimeAuthenticated(ctx);
    const roomId = readNpcRoomId(ctx, envelope);
    if (!roomId) throw { code: RealtimeErrorCodes.roomRequired, message: "Room id is required" };
    const sent = ctx.rooms?.broadcast?.(roomId, envelope) ?? 0;
    if (envelope?.requiresAck) ctx.realtimeConnection?.sendEnvelope(makeAckEnvelope(envelope, "processed", { roomId, sent }));
    return sent;
}

//* این هَندلِر دیالوگ اِن پی سی را به روم مربوطه می فرستد.
function handleNpcDialogue(ctx, envelope) {
    return broadcastNpcEnvelope(ctx, envelope);
}

//* این هَندلِر اَکشن اِن پی سی را به روم مربوطه می فرستد.
function handleNpcAction(ctx, envelope) {
    return broadcastNpcEnvelope(ctx, envelope);
}

//* این تابع مسیرهای اِن پی سی را روی رجیستری مسیر ثبت می کند.
function registerNpcRoutes(routeRegistry) {
    return routeRegistry.registerMany([
        { ch: Channels.npc, t: MessageTypes.npc.dialogue, handler: handleNpcDialogue },
        { ch: Channels.npc, t: MessageTypes.npc.action, handler: handleNpcAction }
    ]);
}

//* این تابع قدیمی مسیرهای اِن پی سی را حفظ می کند و پیام اِن پی سی را بدون نیاز مستقیم به رجیستری پردازش می کند.
function npcRoutes(ctx, env, server = null) {
    try {
        if (env?.t === MessageTypes.npc.dialogue) return handleNpcDialogue(ctx, env, server);
        if (env?.t === MessageTypes.npc.action) return handleNpcAction(ctx, env, server);
        return false;
    } catch (error) {
        ctx?.realtimeConnection?.sendEnvelope(makeErrorEnvelope(error, { replyTo: env?.id ?? "" }));
        return false;
    }
}

/*
توضیح کلی اسکریپت:
این فایل مسیرهای پایه اِن پی سی را مدیریت می کند.
پیام های دیالوگ و اَکشن اِن پی سی از این فایل عبور می کنند.
در این فاز پیام های اِن پی سی فقط به روم مربوطه برادکست می شوند و هوش مصنوعی اِن پی سی اینجا اجرا نمی شود.
این فایل نباید ترنسپورت خام، آث واقعی یا لاجیک بازی سنگین داشته باشد.
وظیفه این فایل فقط ثبت و اجرای مسیرهای پایه اِن پی سی است.
*/

export { npcRoutes, registerNpcRoutes, readNpcRoomId, broadcastNpcEnvelope, handleNpcDialogue, handleNpcAction };
