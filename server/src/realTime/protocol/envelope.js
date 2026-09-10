// File => src/realTime/protocol/envelope.js

import crypto from "crypto";
import { Channels, isValidChannel } from "./channels.js";
import { MessageTypes, isValidMessageType } from "./messageTypes.js";
import { RealtimeErrorCodes, makeRealtimeError, normalizeError } from "./errors.js";
import { makeAckPayload } from "./ack.js";

const RealtimeProtocolVersion = 1;
const MaxEnvelopeBytes = 64 * 1024;

//* این تابع یک شناسه یکتای پیام می سازد تا هر پیام ریل تایم برای لاگ، اَک و دیباگ قابل ردیابی باشد.
function createMessageId(prefix = "msg") {
    return `${prefix}_${crypto.randomUUID()}`;
}

//* این تابع پیام خام دریافتی را به متن تبدیل می کند تا قبل از جیسون پَرس قابل پردازش باشد.
function readRawText(raw) {
    if (Buffer.isBuffer(raw)) return raw.toString("utf8");
    if (typeof raw === "string") return raw;
    if (raw && typeof raw === "object") return JSON.stringify(raw);
    return String(raw ?? "");
}

//* این تابع ورودی پیام را به ساختار استاندارد اِنولوپ تبدیل می کند و نام های جایگزین مثل چَنِل و تایپ را هم پشتیبانی می کند.
function normalizeEnvelope(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        throw new Error("Invalid envelope");
    }

    const env = {
        v: Number(obj.v ?? obj.version ?? RealtimeProtocolVersion),
        ch: String(obj.ch ?? obj.channel ?? ""),
        t: String(obj.t ?? obj.type ?? ""),
        id: String(obj.id ?? obj.messageId ?? createMessageId()),
        ts: Number(obj.ts ?? obj.timestamp ?? Date.now()),
        room: String(obj.room ?? obj.roomId ?? ""),
        payload: obj.payload ?? null,
        requiresAck: Boolean(obj.requiresAck ?? false),
        replyTo: obj.replyTo ? String(obj.replyTo) : ""
    };

    validateEnvelope(env);
    return env;
}

//* این تابع ساختار اِنولوپ را بررسی می کند تا پیام نامعتبر وارد رُتِر و لاجیک بازی نشود.
function validateEnvelope(env) {
    if (!env || typeof env !== "object") throw new Error("Invalid envelope");
    if (env.v !== RealtimeProtocolVersion) throw new Error(`Unsupported realtime protocol version: ${env.v}`);
    if (!env.ch) throw new Error("Envelope missing ch");
    if (!env.t) throw new Error("Envelope missing t");
    if (!env.id) throw new Error("Envelope missing id");
    if (!Number.isFinite(env.ts) || env.ts <= 0) throw new Error("Envelope invalid ts");
    if (!isValidChannel(env.ch)) throw new Error(`Invalid realtime channel: ${env.ch}`);
    if (!isValidMessageType(env.ch, env.t)) throw new Error(`Invalid realtime message type: ${env.ch}/${env.t}`);
    return true;
}

//* این تابع پیام خام دریافتی از ترنسپورت را می خواند، محدودیت حجم را چک می کند و آن را به اِنولوپ معتبر تبدیل می کند.
function parseEnvelope(raw) {
    const txt = readRawText(raw);// تبدیل به رشته
    if (Buffer.byteLength(txt, "utf8") > MaxEnvelopeBytes) throw new Error("Envelope is too large");
    const obj = JSON.parse(txt);
    return normalizeEnvelope(obj);
}

//* این تابع یک اِنولوپ استاندارد می سازد تا همه پیام های خروجی سرور با قالب ثابت ارسال شوند.
function makeEnvelope({ v = RealtimeProtocolVersion, ch, t, id = createMessageId(), ts = Date.now(), room = "", payload = null, requiresAck = false, replyTo = "" }) {
    const env = normalizeEnvelope({ v, ch, t, id, ts, room, payload, requiresAck, replyTo });
    return env;
}

//* این تابع اِنولوپ را بعد از وَلیدِیت به متن جیسون تبدیل می کند تا ترنسپورت بتواند آن را ارسال کند.
function serializeEnvelope(env) {
    return JSON.stringify(normalizeEnvelope(env));
}

//* این تابع برای ساخت پیام های چَنِل سیستم استفاده می شود تا پیام هایی مثل آث اوکی، پینگ، پونگ، اَک و اِرور یکدست ساخته شوند.
function makeSystemEnvelope(type, payload = null, options = {}) {
    return makeEnvelope({ ch: Channels.system, t: type, payload, ...options });
}

//* این تابع برای یک پیام دریافتی، اِنولوپ مخصوص اَک می سازد تا گیرنده بداند پیام قبلی دریافت یا پردازش شده است.
function makeAckEnvelope(originalEnvelope, status, details = null) {
    return makeSystemEnvelope(MessageTypes.system.ack, makeAckPayload(originalEnvelope?.id, status, details), { replyTo: originalEnvelope?.id ?? "" });
}

//* این تابع خطای داخلی یا خطای ریل تایم را به اِنولوپ استاندارد سیستم اِرور تبدیل می کند تا یونیتی بتواند خطا را دقیق بخواند.
function makeErrorEnvelope(error, options = {}) {
    const realtimeError = normalizeError(error, RealtimeErrorCodes.internalError);
    return makeSystemEnvelope(MessageTypes.system.error, realtimeError, options);
}

/*
توضیح کلی اسکریپت:
این فایل قرارداد اصلی پیام های ریل تایم را مدیریت می کند.
هر پیام ورودی یا خروجی باید داخل اِنولوپ استاندارد قرار بگیرد.
اِنولوپ مشخص می کند پیام برای کدام چَنِل است، چه تایپی دارد، شناسه پیام چیست، مربوط به کدام روم است و آیا اَک نیاز دارد یا نه.
این فایل قبل از ورود پیام به رُتِر، پیام را پَرس و وَلیدِیت می کند تا پیام خراب وارد لاجیک بازی نشود.
همچنین برای ساخت پیام های خروجی مثل سیستم اَک و سیستم اِرور تابع های آماده فراهم می کند.
این فایل نباید لاجیک بازی، روم مَنِیجِر، آث فلو یا وب سوکت خام داشته باشد.
وظیفه این فایل فقط ساخت، خواندن، وَلیدِیت و سریالایز کردن اِنولوپ استاندارد ریل تایم است.
*/

export {
    RealtimeProtocolVersion,
    MaxEnvelopeBytes,
    createMessageId,
    parseEnvelope,
    makeEnvelope,
    serializeEnvelope,
    validateEnvelope,
    normalizeEnvelope,
    makeSystemEnvelope,
    makeAckEnvelope,
    makeErrorEnvelope,
    makeRealtimeError,
    RealtimeErrorCodes
};