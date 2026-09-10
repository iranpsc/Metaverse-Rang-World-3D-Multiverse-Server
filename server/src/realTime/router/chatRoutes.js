// File => src/realTime/router/chatRoutes.js

import { Channels } from "../protocol/channels.js";
import { MessageTypes } from "../protocol/messageTypes.js";
import { makeAckEnvelope, makeErrorEnvelope, RealtimeErrorCodes } from "../protocol/envelope.js";
import { requireRealtimeAuthenticated } from "../auth/realtimeAuth.js";

//* این تابع شناسه روم چت را از اِنولوپ یا کانتکست می خواند.
function readChatRoomId(ctx, envelope) {
    return String(envelope?.room ?? envelope?.payload?.roomId ?? ctx?.roomId ?? "").trim();
}

//* این تابع پیام چت را بعد از آث به اعضای روم برادکست می کند.
function handleChatMessage(ctx, envelope) {
    requireRealtimeAuthenticated(ctx);
    const roomId = readChatRoomId(ctx, envelope);
    if (!roomId) throw { code: RealtimeErrorCodes.roomRequired, message: "Room id is required" };
    const sent = ctx.rooms?.broadcast?.(roomId, envelope) ?? 0;
    ctx.realtimeConnection?.sendEnvelope(makeAckEnvelope(envelope, "processed", { roomId, sent }));
    return sent;
}

//* این تابع وضعیت تایپ کردن را به اعضای روم برادکست می کند.
function handleChatTyping(ctx, envelope) {
    requireRealtimeAuthenticated(ctx);
    const roomId = readChatRoomId(ctx, envelope);
    if (!roomId) throw { code: RealtimeErrorCodes.roomRequired, message: "Room id is required" };
    return ctx.rooms?.broadcast?.(roomId, envelope, { exceptConnection: ctx.realtimeConnection }) ?? 0;
}

//* این تابع رسید خوانده شدن پیام چت را به اعضای روم برادکست می کند.
function handleChatRead(ctx, envelope) {
    requireRealtimeAuthenticated(ctx);
    const roomId = readChatRoomId(ctx, envelope);
    if (!roomId) throw { code: RealtimeErrorCodes.roomRequired, message: "Room id is required" };
    return ctx.rooms?.broadcast?.(roomId, envelope, { exceptConnection: ctx.realtimeConnection }) ?? 0;
}

//* این تابع مسیرهای چت را روی رجیستری مسیر ثبت می کند.
function registerChatRoutes(routeRegistry) {
    return routeRegistry.registerMany([
        { ch: Channels.chat, t: MessageTypes.chat.message, handler: handleChatMessage },
        { ch: Channels.chat, t: MessageTypes.chat.typing, handler: handleChatTyping },
        { ch: Channels.chat, t: MessageTypes.chat.read, handler: handleChatRead }
    ]);
}

//* این تابع مسیرهای چت را بدون نیاز مستقیم به رجیستری پردازش می کند.
function chatRoutes(ctx, env, server = null) {
    try {
        if (env?.t === MessageTypes.chat.message) return handleChatMessage(ctx, env, server);
        if (env?.t === MessageTypes.chat.typing) return handleChatTyping(ctx, env, server);
        if (env?.t === MessageTypes.chat.read) return handleChatRead(ctx, env, server);
        return false;
    } catch (error) {
        ctx?.realtimeConnection?.sendEnvelope(makeErrorEnvelope(error, { replyTo: env?.id ?? "" }));
        return false;
    }
}

/*
توضیح کلی اسکریپت:
این فایل مسیرهای پایه چت را مدیریت می کند.
پیام چت، تایپ کردن و رسید خواندن از این فایل عبور می کنند.
در این فاز چت فقط از مسیر روم مَنِیجِر برادکست می شود و ذخیره سازی پیام انجام نمی شود.
این فایل نباید ترنسپورت خام، آث واقعی یا دیتابیس چت داشته باشد.
وظیفه این فایل فقط ثبت و اجرای مسیرهای پایه چت است.
*/

export { chatRoutes, registerChatRoutes, readChatRoomId, handleChatMessage, handleChatTyping, handleChatRead };
