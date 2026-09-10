// File => src/realTime/router/worldRoutes.js

import { Channels } from "../protocol/channels.js";
import { MessageTypes } from "../protocol/messageTypes.js";
import { makeAckEnvelope, makeErrorEnvelope, RealtimeErrorCodes } from "../protocol/envelope.js";
import { requireRealtimeAuthenticated } from "../auth/realtimeAuth.js";

//* این تابع شناسه روم جهان را از اِنولوپ یا کانتکست می خواند.
function readWorldRoomId(ctx, envelope) {
    return String(envelope?.room ?? envelope?.payload?.roomId ?? ctx?.roomId ?? "").trim();
}

//* این تابع رویدادهای آبجکت جهان را به اعضای روم برادکست می کند.
function broadcastWorldEnvelope(ctx, envelope) {
    requireRealtimeAuthenticated(ctx);
    const roomId = readWorldRoomId(ctx, envelope);
    if (!roomId) throw { code: RealtimeErrorCodes.roomRequired, message: "Room id is required" };
    const sent = ctx.rooms?.broadcast?.(roomId, envelope) ?? 0;
    if (envelope?.requiresAck) ctx.realtimeConnection?.sendEnvelope(makeAckEnvelope(envelope, "processed", { roomId, sent }));
    return sent;
}

//* این هَندلِر ساخت آبجکت جهان را در روم منتشر می کند.
function handleWorldObjectSpawn(ctx, envelope) {
    return broadcastWorldEnvelope(ctx, envelope);
}

//* این هَندلِر به روزرسانی آبجکت جهان را در روم منتشر می کند.
function handleWorldObjectUpdate(ctx, envelope) {
    return broadcastWorldEnvelope(ctx, envelope);
}

//* این هَندلِر حذف آبجکت جهان را در روم منتشر می کند.
function handleWorldObjectDespawn(ctx, envelope) {
    return broadcastWorldEnvelope(ctx, envelope);
}

//* این تابع مسیرهای جهان را روی رجیستری مسیر ثبت می کند.
function registerWorldRoutes(routeRegistry) {
    return routeRegistry.registerMany([
        { ch: Channels.world, t: MessageTypes.world.objectSpawn, handler: handleWorldObjectSpawn },
        { ch: Channels.world, t: MessageTypes.world.objectUpdate, handler: handleWorldObjectUpdate },
        { ch: Channels.world, t: MessageTypes.world.objectDespawn, handler: handleWorldObjectDespawn }
    ]);
}

//* این تابع قدیمی مسیرهای جهان را حفظ می کند و پیام جهان را بدون نیاز مستقیم به رجیستری پردازش می کند.
function worldRoutes(ctx, env, server = null) {
    try {
        if (env?.t === MessageTypes.world.objectSpawn) return handleWorldObjectSpawn(ctx, env, server);
        if (env?.t === MessageTypes.world.objectUpdate) return handleWorldObjectUpdate(ctx, env, server);
        if (env?.t === MessageTypes.world.objectDespawn) return handleWorldObjectDespawn(ctx, env, server);
        return false;
    } catch (error) {
        ctx?.realtimeConnection?.sendEnvelope(makeErrorEnvelope(error, { replyTo: env?.id ?? "" }));
        return false;
    }
}

/*
توضیح کلی اسکریپت:
این فایل مسیرهای چَنِل جهان را مدیریت می کند.
پیام های ساخت، به روزرسانی و حذف آبجکت از این فایل عبور می کنند.
در این فاز پیام های جهان فقط به روم مربوطه برادکست می شوند و لاجیک کامل جهان هنوز اینجا نوشته نمی شود.
این فایل نباید ترنسپورت خام، آث واقعی یا لاجیک بازی سنگین داشته باشد.
وظیفه این فایل فقط ثبت و اجرای مسیرهای پایه جهان است.
*/

export {
    worldRoutes,
    registerWorldRoutes,
    readWorldRoomId,
    broadcastWorldEnvelope,
    handleWorldObjectSpawn,
    handleWorldObjectUpdate,
    handleWorldObjectDespawn
};
