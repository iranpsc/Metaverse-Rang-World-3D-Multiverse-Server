// File => src/realTime/test/realtimeWebSocketSmoke.js

import crypto from "crypto";
import { WebSocket } from "ws";

const DefaultWsUrl = `ws://127.0.0.1:${process.env.WS_PORT || "8080"}`;
const RealtimeWsUrl = process.env.REALTIME_WS_URL || DefaultWsUrl;
const RealtimeAccessToken = process.env.REALTIME_TEST_ACCESS_TOKEN || process.env.ACCESS_TOKEN || "";
const TestRunId = process.env.REALTIME_TEST_RUN_ID || crypto.randomUUID();
const TestRoomId = process.env.REALTIME_TEST_ROOM || `smoke_room_${TestRunId.slice(0, 8)}`;
const TestTimeoutMs = Number(process.env.REALTIME_TEST_TIMEOUT_MS || 5000);
const ExpectedAuthFailureCode = process.env.REALTIME_TEST_EXPECT_AUTH_FAILURE_CODE || "";
const ShouldExpectAuthFailure = String(process.env.REALTIME_TEST_EXPECT_AUTH_FAILURE || "").toLowerCase() === "true" || ExpectedAuthFailureCode.trim().length > 0;
const ShouldRunAuthFlow = RealtimeAccessToken.trim().length > 0;

//* این تابع زمان فعلی را برمی گرداند تا اِنولوپ های تست زمان معتبر داشته باشند.
function nowMs() {
    return Date.now();
}

//* این تابع شناسه یکتای تست می سازد تا هر اِنولوپ ارسالی در لاگ و اَک قابل ردیابی باشد.
function createTestMessageId(prefix = "smoke") {
    return `${prefix}_${crypto.randomUUID()}`;
}

//* این تابع یک اِنولوپ تستی استاندارد می سازد تا کلاینت دودتست با همان قرارداد سرور پیام بفرستد.
function makeTestEnvelope({ ch, t, room = "", payload = null, requiresAck = false, replyTo = "" }) {
    return { v: 1, ch, t, id: createTestMessageId(t), ts: nowMs(), room, payload, requiresAck, replyTo };
}

//* این تابع متن دریافتی وب سوکت را به آبجکت تبدیل می کند تا دودتست بتواند پیام های سرور را بررسی کند.
function parseIncomingMessage(data) {
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data ?? "");
    return JSON.parse(text);
}

//* این تابع اجرای برنامه را برای مدت مشخص نگه می دارد تا بین پیام های ریل تایم فاصله کنترل شده داشته باشیم.
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

//* این تابع یک شرط را تا زمان مشخص انتظار می کشد و اگر پیام مناسب نرسد خطای تست می دهد.
function waitForMessage(receivedMessages, predicate, label, timeoutMs = TestTimeoutMs) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();

        const timer = setInterval(() => {
            const found = receivedMessages.find(predicate);
            if (found) {
                clearInterval(timer);
                resolve(found);
                return;
            }

            if (Date.now() - startedAt >= timeoutMs) {
                clearInterval(timer);
                reject(new Error(`Realtime smoke timeout while waiting for ${label}`));
            }
        }, 25);
    });
}

//* این تابع اِنولوپ را روی وب سوکت ارسال می کند و همان اِنولوپ را برای انتظار اَک به تست برمی گرداند.
function sendEnvelope(ws, envelope) {
    ws.send(JSON.stringify(envelope));
    return envelope;
}

//* این تابع اتصال وب سوکت را باز می کند و همه پیام های دریافتی را داخل لیست تست ذخیره می کند.
function connectRealtimeSocket(url) {
    const receivedMessages = [];
    const ws = new WebSocket(url);

    ws.on("message", (data) => {
        try {
            const message = parseIncomingMessage(data);
            receivedMessages.push(message);
            console.log("[realtime-smoke] received", JSON.stringify(message));
        } catch (error) {
            console.warn("[realtime-smoke] failed to parse incoming message", error?.message ?? String(error));
        }
    });

    const opened = new Promise((resolve, reject) => {
        ws.once("open", () => resolve(true));
        ws.once("error", (error) => reject(error));
    });

    return { ws, receivedMessages, opened };
}

//* این تابع پیام پینگ سیستم را تست می کند و انتظار دارد سرور برای همان پیام پونگ برگرداند.
async function runPingScenario(ws, receivedMessages) {
    const pingEnvelope = sendEnvelope(ws, makeTestEnvelope({ ch: "system", t: "ping" }));
    const pong = await waitForMessage(receivedMessages, (m) => m.ch === "system" && m.t === "pong" && m.replyTo === pingEnvelope.id, "system/pong");
    console.log("[realtime-smoke] ping scenario passed", { replyTo: pong.replyTo });
}

//* این تابع پیام آث سیستم را با اَکسس توکن می فرستد و نتیجه آث اوکی یا آث فِیلد را برمی گرداند.
async function sendAuthAndWaitForResult(ws, receivedMessages) {
    const authEnvelope = sendEnvelope(ws, makeTestEnvelope({ ch: "system", t: "auth", payload: { accessToken: RealtimeAccessToken } }));
    return await waitForMessage(receivedMessages, (m) => m.ch === "system" && (m.t === "auth_ok" || m.t === "auth_failed") && m.replyTo === authEnvelope.id, "system/auth result");
}

//* این تابع پیام آث سیستم را با اَکسس توکن سالم تست می کند و انتظار دارد سرور آث اوکی برگرداند.
async function runAuthScenario(ws, receivedMessages) {
    const authResult = await sendAuthAndWaitForResult(ws, receivedMessages);
    if (authResult.t !== "auth_ok") throw new Error(`Realtime auth failed: ${JSON.stringify(authResult.payload ?? {})}`);
    console.log("[realtime-smoke] auth scenario passed", { userId: authResult.payload?.userId ?? "" });
}

//* این تابع سناریوی منفی آث را تست می کند تا خطاهایی مثل توکن اکسپایرد با کد استاندارد برگردند.
async function runExpectedAuthFailureScenario(ws, receivedMessages) {
    const authResult = await sendAuthAndWaitForResult(ws, receivedMessages);
    if (authResult.t !== "auth_failed") throw new Error(`Expected auth_failed but received: ${JSON.stringify(authResult)}`);

    const actualCode = authResult.payload?.code ?? "";
    if (ExpectedAuthFailureCode && actualCode !== ExpectedAuthFailureCode) {
        throw new Error(`Expected auth failure code ${ExpectedAuthFailureCode} but received ${actualCode}`);
    }

    console.log("[realtime-smoke] expected auth failure scenario passed", { code: actualCode, message: authResult.payload?.message ?? "" });
}

//* این تابع جوین روم را تست می کند و انتظار دارد برای پیام جوین، اَک پردازش شده دریافت شود.
async function runJoinRoomScenario(ws, receivedMessages) {
    const joinEnvelope = sendEnvelope(ws, makeTestEnvelope({ ch: "game", t: "join_room", room: TestRoomId, payload: { roomId: TestRoomId }, requiresAck: true }));
    const ack = await waitForMessage(receivedMessages, (m) => m.ch === "system" && m.t === "ack" && m.replyTo === joinEnvelope.id, "game/join_room ack");
    if (ack.payload?.status !== "processed") throw new Error(`Join room ack failed: ${JSON.stringify(ack.payload ?? {})}`);
    console.log("[realtime-smoke] join room scenario passed", { roomId: TestRoomId });
}

//* این تابع اکشن پلیر را تست می کند و انتظار دارد سرور اَک استاندارد برگرداند.
async function runPlayerActionScenario(ws, receivedMessages) {
    const actionEnvelope = sendEnvelope(ws, makeTestEnvelope({ ch: "game", t: "player_action", room: TestRoomId, payload: { action: "move", x: 1, y: 0, z: 2 }, requiresAck: true }));
    const ack = await waitForMessage(receivedMessages, (m) => m.ch === "system" && m.t === "ack" && m.replyTo === actionEnvelope.id, "game/player_action ack");
    if (ack.payload?.status !== "processed") throw new Error(`Player action ack failed: ${JSON.stringify(ack.payload ?? {})}`);
    console.log("[realtime-smoke] player action scenario passed", { roomId: TestRoomId, actionCount: ack.payload?.details?.actionCount ?? null });
}

//* این تابع لیو روم را تست می کند و انتظار دارد برای پیام خروج از روم، اَک دریافت شود.
async function runLeaveRoomScenario(ws, receivedMessages) {
    const leaveEnvelope = sendEnvelope(ws, makeTestEnvelope({ ch: "game", t: "leave_room", room: TestRoomId, payload: { roomId: TestRoomId }, requiresAck: true }));
    const ack = await waitForMessage(receivedMessages, (m) => m.ch === "system" && m.t === "ack" && m.replyTo === leaveEnvelope.id, "game/leave_room ack");
    if (!["processed", "failed"].includes(ack.payload?.status)) throw new Error(`Leave room ack invalid: ${JSON.stringify(ack.payload ?? {})}`);
    console.log("[realtime-smoke] leave room scenario completed", { status: ack.payload?.status });
}

//* این تابع اتصال را می بندد و کمی صبر می کند تا کلیناپ دیسکانکت سمت سرور فرصت اجرا داشته باشد.
async function closeSocketGracefully(ws) {
    if (ws.readyState === WebSocket.OPEN) ws.close(1000, "smoke_test_done");
    await delay(250);
}

//* این تابع سناریوهای دودتست را به ترتیب اجرا می کند و حالت مثبت یا منفی آث را کنترل شده جدا می کند.
async function runRealtimeWebSocketSmokeTest() {
    console.log("[realtime-smoke] connecting", {
        url: RealtimeWsUrl,
        roomId: TestRoomId,
        runId: TestRunId,
        auth: ShouldRunAuthFlow ? "enabled" : "skipped",
        expectedAuthFailure: ShouldExpectAuthFailure ? (ExpectedAuthFailureCode || "any") : "disabled"
    });

    const { ws, receivedMessages, opened } = connectRealtimeSocket(RealtimeWsUrl);
    await opened;
    console.log("[realtime-smoke] connected");

    try {
        await runPingScenario(ws, receivedMessages);

        if (!ShouldRunAuthFlow) {
            console.warn("[realtime-smoke] REALTIME_TEST_ACCESS_TOKEN is empty; auth and game scenarios skipped");
            return { ok: true, skippedAuth: true, roomId: TestRoomId };
        }

        if (ShouldExpectAuthFailure) {
            await runExpectedAuthFailureScenario(ws, receivedMessages);
            return { ok: true, expectedAuthFailure: true, roomId: TestRoomId };
        }

        await runAuthScenario(ws, receivedMessages);
        await runJoinRoomScenario(ws, receivedMessages);
        await runPlayerActionScenario(ws, receivedMessages);
        await runLeaveRoomScenario(ws, receivedMessages);
        return { ok: true, skippedAuth: false, roomId: TestRoomId };
    } finally {
        await closeSocketGracefully(ws);
    }
}

//* این بخش دودتست را اجرا می کند و نتیجه نهایی را با کد خروج مناسب به ترمینال برمی گرداند.
runRealtimeWebSocketSmokeTest()
    .then((result) => {
        console.log("[realtime-smoke] completed", result);
        process.exit(0);
    })
    .catch((error) => {
        console.error("[realtime-smoke] failed", error?.stack ?? error?.message ?? String(error));
        process.exit(1);
    });

/*
توضیح کلی اسکریپت:
این فایل دودتست وب سوکت برای ریل تایم سرور است.
هدف این فایل این است که بعد از اجرای سرور، مسیر واقعی وب سوکت، کُر، رُتِر، آث، روم، اَک و کلیناپ اولیه بررسی شود.
این فایل خودش سرور را استارت نمی کند و فقط مثل یک کلاینت وب سوکت به سرور وصل می شود.
اگر اَکسس توکن تست وجود داشته باشد، سناریوهای آث، جوین روم، اکشن پلیر و لیو روم اجرا می شوند.
اگر اَکسس توکن تست وجود نداشته باشد، فقط اتصال و پینگ تست می شود و تست های آث و بازی اسکیپ می شوند.
اگر تست در حالت خطای آث مورد انتظار اجرا شود، دریافت auth_failed با کد مشخص مثل token_expired موفقیت محسوب می شود.
برای تمیز ماندن وضعیت حافظه ای بازی، اگر روم تست دستی داده نشود، هر اجرای تست یک روم آی دی یکتا می سازد.
این فایل نباید لاجیک سرور، ترنسپورت سرور یا سرویس های بازی را تغییر دهد.
*/
