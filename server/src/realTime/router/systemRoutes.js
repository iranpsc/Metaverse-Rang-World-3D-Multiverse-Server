// File => src/realTime/router/systemRoutes.js

import { Channels } from "../protocol/channels.js";
import { MessageTypes } from "../protocol/messageTypes.js";
import { makeSystemEnvelope, makeAckEnvelope } from "../protocol/envelope.js";
import { handleRealtimeAuthEnvelope } from "../auth/realtimeAuth.js";

//* این هَندلِر پیام آث سیستم را به ماژول آث ریل تایم می سپارد.
async function handleSystemAuth(ctx, envelope) {
    return await handleRealtimeAuthEnvelope(ctx, envelope);
}

//* این هَندلِر پیام پینگ را می گیرد و برای همان کانکشن پیام پونگ می فرستد.
function handleSystemPing(ctx, envelope) {
    const pongEnvelope = makeSystemEnvelope(MessageTypes.system.pong, { ts: Date.now() }, { replyTo: envelope?.id ?? "" });
    return ctx?.realtimeConnection?.sendEnvelope(pongEnvelope) ?? false;
}

//* این هَندلِر پیام اَک ورودی را فعلاً تایید می کند و برای فاز اَک ترَکِر جای اتصال نگه می دارد.
function handleSystemAck(ctx, envelope) {
    ctx.meta.lastAck = { replyTo: envelope?.replyTo ?? envelope?.payload?.originalMessageId ?? "", receivedAt: Date.now() };
    return true;
}

//* این هَندلِر پیام اِرور ورودی را فقط لاگ می کند و تصمیم عملیاتی نمی گیرد.
function handleSystemError(ctx, envelope) {
    ctx.logger?.warn?.("Realtime client error envelope", { connectionId: ctx.connectionId, payload: envelope?.payload ?? null });
    return true;
}

//* این تابع مسیرهای سیستم را روی رجیستری مسیر ثبت می کند.
function registerSystemRoutes(routeRegistry) {
    return routeRegistry.registerMany([
        { ch: Channels.system, t: MessageTypes.system.auth, handler: handleSystemAuth },
        { ch: Channels.system, t: MessageTypes.system.ping, handler: handleSystemPing },
        { ch: Channels.system, t: MessageTypes.system.ack, handler: handleSystemAck },
        { ch: Channels.system, t: MessageTypes.system.error, handler: handleSystemError }
    ]);
}

//* این تابع قدیمی مسیرهای سیستم را حفظ می کند و پیام سیستم را بدون نیاز مستقیم به رجیستری پردازش می کند.
function systemRoutes(ctx, env, server = null) {
    if (env?.t === MessageTypes.system.auth) return handleSystemAuth(ctx, env, server);
    if (env?.t === MessageTypes.system.ping) return handleSystemPing(ctx, env, server);
    if (env?.t === MessageTypes.system.ack) return handleSystemAck(ctx, env, server);
    if (env?.t === MessageTypes.system.error) return handleSystemError(ctx, env, server);
    return false;
}

/*
توضیح کلی اسکریپت:
این فایل مسیرهای چَنِل سیستم را مدیریت می کند.
پیام هایی مثل آث، پینگ، پونگ، اَک و اِرور از این فایل عبور می کنند.
آث واقعی به فایل آث ریل تایم سپرده می شود و این فایل فقط مسیر را وصل می کند.
این فایل نباید جوین روم، پلیر استیت یا لاجیک بازی انجام دهد.
وظیفه این فایل فقط ثبت و اجرای هَندلِرهای سیستم است.
*/

export { systemRoutes, registerSystemRoutes, handleSystemAuth, handleSystemPing, handleSystemAck, handleSystemError };
