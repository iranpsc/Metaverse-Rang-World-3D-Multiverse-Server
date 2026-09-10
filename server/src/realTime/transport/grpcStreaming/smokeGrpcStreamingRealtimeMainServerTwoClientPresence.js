import path from "path";
import grpc from "@grpc/grpc-js";
import mongoose from "mongoose";
import protoLoader from "@grpc/proto-loader";
import { randomUUID } from "crypto";

import { connectDatabase } from "../../../infra/mongo/connection.js";
import { UserModel } from "../../../infra/mongo/models/user.model.js";
import { RefreshTokenModel } from "../../../infra/mongo/models/refreshToken.model.js";
import { RoomModel } from "../../../infra/mongo/models/room.model.js";

const DEFAULT_TARGET = process.env.GRPC_REALTIME_MAIN_SERVER_TARGET || "127.0.0.1:50051";
const DEFAULT_TIMEOUT_MS = Number(process.env.GRPC_REALTIME_MAIN_SERVER_TWO_CLIENT_PRESENCE_TIMEOUT_MS || 9000);
const SHOULD_KEEP_DATA = process.env.GRPC_REALTIME_MAIN_SERVER_TWO_CLIENT_PRESENCE_KEEP_DATA === "1";

//* این آبجکت لاگ‌های ساده تست دو کلاینت روی سرور اصلی را چاپ می‌کند.
const logger = {
    info: (message, data = {}) => console.log("[G8-MainServerTwoClientPresenceSmoke][INFO]", message, data),
    warn: (message, data = {}) => console.warn("[G8-MainServerTwoClientPresenceSmoke][WARN]", message, data),
    error: (message, data = {}) => console.error("[G8-MainServerTwoClientPresenceSmoke][ERROR]", message, data)
};

//* این تابع مسیر فایل پروتوی آث را از روی ریشه پروژه می‌سازد.
function resolveAuthProtoPath() {
    return path.join(process.cwd(), "protos/auth/auth.proto");
}

//* این تابع مسیر فایل پروتوی اِستریم ریل‌تایم را از روی ریشه پروژه می‌سازد.
function resolveRealtimeStreamProtoPath() {
    return path.join(process.cwd(), "protos/realtime/realtime_stream.proto");
}

//* این تابع مسیر پوشه پروتوها را از روی ریشه پروژه می‌سازد.
function resolveProtoRootPath() {
    return path.join(process.cwd(), "protos");
}

//* این تابع یک فایل پروتو را لود می‌کند و ریشه پکیج جی‌آر‌پی‌سی را برمی‌گرداند.
function loadProtoRoot(protoPath) {
    const packageDefinition = protoLoader.loadSync(protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs: [resolveProtoRootPath()]
    });

    return grpc.loadPackageDefinition(packageDefinition);
}

//* این تابع کلاینت آث را برای اتصال به سرور اصلی می‌سازد.
function createMainServerAuthClient(authProtoRoot, target = DEFAULT_TARGET) {
    const AuthService = authProtoRoot?.metaverse?.v1?.AuthService;

    if (!AuthService) {
        throw new Error("Auth service client definition was not found");
    }

    return new AuthService(
        target,
        grpc.credentials.createInsecure()
    );
}

//* این تابع کلاینت اِستریم ریل‌تایم را برای اتصال به سرور اصلی می‌سازد.
function createMainServerRealtimeClient(realtimeProtoRoot, target = DEFAULT_TARGET) {
    const RealtimeStreamService = realtimeProtoRoot?.metaverse?.v1?.realtime?.RealtimeStreamService;

    if (!RealtimeStreamService) {
        throw new Error("Realtime stream service client definition was not found");
    }

    return new RealtimeStreamService(
        target,
        grpc.credentials.createInsecure()
    );
}

//* این تابع یک درخواست رجیستر یکتا برای سرور اصلی می‌سازد.
function createMainServerRegisterRequest(prefix) {
    const id = randomUUID().replace(/-/g, "").slice(0, 16);

    return {
        email: `g8-main-${prefix}-${id}@test.local`,
        password: `Test_${id}_12345`,
        userName: `g8_${prefix}_${id}`.slice(0, 32)
    };
}

//* این تابع یک متد تک‌پاسخ جی‌آر‌پی‌سی را با نام‌های احتمالی پیدا و اجرا می‌کند.
function callUnaryGrpcMethod(client, methodNames = [], request = {}, metadata = null) {
    const methodName = methodNames.find((name) => typeof client?.[name] === "function");

    if (!methodName) {
        throw new Error(`Unary gRPC method was not found: ${methodNames.join(", ")}`);
    }

    return new Promise((resolve, reject) => {
        const callback = (error, response) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(response);
        };

        if (metadata) {
            client[methodName](request, metadata, callback);
            return;
        }

        client[methodName](request, callback);
    });
}

//* این تابع رجیستر واقعی را از مسیر آث سرویس اصلی اجرا می‌کند.
async function registerMainServerUser(authClient, registerRequest) {
    const response = await callUnaryGrpcMethod(authClient, ["Register", "register"], registerRequest);

    if (!response?.success) {
        throw new Error(`Register response was not successful: ${response?.message ?? ""}`);
    }

    if (!response?.accessToken) {
        throw new Error("Register response did not return access token");
    }

    if (!response?.user?.id) {
        throw new Error("Register response did not return user id");
    }

    return response;
}

//* این تابع یک اِنولوپ پایه با ساختار فعلی ریل‌تایم می‌سازد.
function makeEnvelope({ channel, type, payload = null, room = "", prefix = "main_server_smoke" }) {
    return {
        v: 1,
        ch: channel,
        t: type,
        id: `${prefix}_${Date.now()}_${randomUUID()}`,
        ts: Date.now(),
        room,
        payload,
        requiresAck: false,
        replyTo: ""
    };
}

//* این تابع اِنولوپ آث ریل‌تایم را با اَکسس توکن واقعی می‌سازد.
function createRealtimeAuthEnvelope(accessToken) {
    return makeEnvelope({
        channel: "system",
        type: "auth",
        payload: { accessToken },
        prefix: "auth"
    });
}

//* این تابع اِنولوپ ساخت روم را برای مسیر لابی می‌سازد.
function createLobbyCreateRoomEnvelope(roomName) {
    return makeEnvelope({
        channel: "lobby",
        type: "create_room",
        payload: {
            roomName,
            description: "main server grpc realtime two client presence smoke",
            visibility: "public",
            maxPlayers: 20,
            metadata: {
                source: "main_server_grpc_realtime_two_client_presence_smoke"
            }
        },
        prefix: "create_room"
    });
}

//* این تابع اِنولوپ جوین روم را برای مسیر گیم می‌سازد.
function createGameJoinRoomEnvelope(roomId) {
    return makeEnvelope({
        channel: "game",
        type: "join_room",
        room: roomId,
        payload: {
            roomId
        },
        prefix: "join_room"
    });
}

//* این تابع یک اِنولوپ را به فریم خام تبدیل می‌کند و داخل اِستریم می‌فرستد.
function writeRawEnvelope(call, envelope) {
    const rawJson = JSON.stringify(envelope);

    call.write({
        rawJson
    });

    return {
        envelope,
        rawJson
    };
}

//* این تابع فریم بعدی اِستریم را با شرط داده‌شده منتظر می‌ماند.
function waitForNextFrame(state, matcher, label) {
    return new Promise((resolve, reject) => {
        const existingIndex = state.frames.findIndex((frame) => matcher(frame.envelope));

        if (existingIndex >= 0) {
            const [matched] = state.frames.splice(existingIndex, 1);
            resolve(matched);
            return;
        }

        const timeout = setTimeout(() => {
            const pendingIndex = state.waiters.indexOf(waiter);
            if (pendingIndex >= 0) state.waiters.splice(pendingIndex, 1);

            reject(new Error(`Timed out waiting for ${label}`));
        }, DEFAULT_TIMEOUT_MS);

        const waiter = {
            matcher,
            resolve: (frame) => {
                clearTimeout(timeout);
                resolve(frame);
            },
            reject: (error) => {
                clearTimeout(timeout);
                reject(error);
            }
        };

        state.waiters.push(waiter);
    });
}

//* این تابع فریم رسیده از اِستریم را بین منتظرها یا صف داخلی تقسیم می‌کند.
function pushIncomingFrame(state, rawJson) {
    const envelope = JSON.parse(rawJson);
    const frame = {
        rawJson,
        envelope
    };

    const waiterIndex = state.waiters.findIndex((waiter) => waiter.matcher(envelope));

    if (waiterIndex >= 0) {
        const [waiter] = state.waiters.splice(waiterIndex, 1);
        waiter.resolve(frame);
        return frame;
    }

    state.frames.push(frame);
    return frame;
}

//* این تابع همه منتظرهای باز اِستریم را با خطا می‌بندد.
function rejectAllWaiters(state, error) {
    const waiters = [...state.waiters];
    state.waiters.length = 0;

    for (const waiter of waiters) {
        waiter.reject(error);
    }
}

//* این تابع یک اِستریم ریل‌تایم باز می‌کند و ابزار ارسال و انتظار پاسخ را برمی‌گرداند.
function openRealtimeStream(realtimeClient) {
    const openMethod = typeof realtimeClient?.Open === "function" ? "Open" : "open";

    if (typeof realtimeClient?.[openMethod] !== "function") {
        throw new Error("Realtime open stream method was not found");
    }

    const call = realtimeClient[openMethod]();
    const state = {
        frames: [],
        waiters: []
    };

    call.on("data", (frame) => {
        try {
            pushIncomingFrame(state, frame?.rawJson ?? "");
        } catch (error) {
            rejectAllWaiters(state, error);
        }
    });

    call.on("error", (error) => {
        rejectAllWaiters(state, error);
    });

    call.on("end", () => {
        rejectAllWaiters(state, new Error("Realtime stream ended"));
    });

    return {
        call,
        send: (envelope) => writeRawEnvelope(call, envelope),
        waitFor: (matcher, label) => waitForNextFrame(state, matcher, label),
        close: () => call.end()
    };
}

//* این تابع آث یک اِستریم را اجرا و پاسخ آث اوکی را کنترل می‌کند.
async function authenticateRealtimeStream(realtimeStream, registerResponse) {
    const authEnvelope = createRealtimeAuthEnvelope(registerResponse.accessToken);
    realtimeStream.send(authEnvelope);

    const authFrame = await realtimeStream.waitFor(
        (envelope) => envelope.ch === "system" && envelope.t === "auth_ok" && envelope.replyTo === authEnvelope.id,
        "auth ok"
    );

    if (authFrame.envelope.payload?.ok !== true) {
        throw new Error("Auth ok payload ok is not true");
    }

    if (authFrame.envelope.payload?.userId !== registerResponse.user.id) {
        throw new Error("Auth ok user id does not match registered user");
    }

    return authFrame;
}

//* این تابع بررسی می‌کند اَک ساخت روم درست برگشته باشد و شناسه روم را برمی‌گرداند.
function assertCreateRoomAckFrame(createRoomEnvelope, frame) {
    const envelope = frame.envelope;

    if (envelope.ch !== "system") throw new Error(`Expected system channel but got ${envelope.ch}`);
    if (envelope.t !== "ack") throw new Error(`Expected ack type but got ${envelope.t}`);
    if (envelope.replyTo !== createRoomEnvelope.id) throw new Error("Create room ack replyTo does not match create room id");
    if (envelope.payload?.status !== "processed") throw new Error("Create room ack status is not processed");
    if (envelope.payload?.details?.ok !== true) throw new Error("Create room ack details ok is not true");

    const roomId = String(envelope.payload?.details?.room?.roomId ?? "").trim();

    if (!roomId) {
        throw new Error("Create room ack did not return room id");
    }

    return roomId;
}

//* این تابع بررسی می‌کند اَک جوین روم درست برگشته باشد.
function assertJoinRoomAckFrame(joinRoomEnvelope, frame, roomId, registerResponse) {
    const envelope = frame.envelope;

    if (envelope.ch !== "system") throw new Error(`Expected system channel but got ${envelope.ch}`);
    if (envelope.t !== "ack") throw new Error(`Expected ack type but got ${envelope.t}`);
    if (envelope.replyTo !== joinRoomEnvelope.id) throw new Error("Join room ack replyTo does not match join room id");
    if (envelope.payload?.status !== "processed") throw new Error("Join room ack status is not processed");
    if (envelope.payload?.details?.ok !== true) throw new Error("Join room ack details ok is not true");
    if (envelope.payload?.details?.roomId !== roomId) throw new Error("Join room ack room id does not match created room");
    if (envelope.payload?.details?.userId !== registerResponse.user.id) throw new Error("Join room ack user id does not match registered user");

    return true;
}

//* این تابع بررسی می‌کند پیام پرزنس ورود کاربر دوم به کاربر اول رسیده باشد.
function assertSecondUserPresenceFrame(frame, roomId, secondRegisterResponse) {
    const envelope = frame.envelope;

    if (envelope.ch !== "presence") throw new Error(`Expected presence channel but got ${envelope.ch}`);
    if (envelope.t !== "player_joined") throw new Error(`Expected player_joined type but got ${envelope.t}`);
    if (envelope.room !== roomId) throw new Error("Presence room id does not match created room");
    if (envelope.payload?.userId !== secondRegisterResponse.user.id) throw new Error("Presence user id does not match second user");

    return true;
}

//* این تابع داده‌های ساخته‌شده تست را از دیتابیس پاک می‌کند.
async function cleanupMainServerTwoClientPresenceData({ ownerUserId = "", secondUserId = "" } = {}) {
    if (SHOULD_KEEP_DATA || (!ownerUserId && !secondUserId)) {
        return {
            skipped: true,
            userIds: [ownerUserId, secondUserId].filter(Boolean)
        };
    }

    await connectDatabase();

    const userIds = [ownerUserId, secondUserId].filter(Boolean);

    if (ownerUserId) {
        await RoomModel.deleteMany({ ownerUserId });
    }

    if (userIds.length > 0) {
        await RefreshTokenModel.deleteMany({ userId: { $in: userIds } });
        await UserModel.deleteMany({ userId: { $in: userIds } });
    }

    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }

    return {
        skipped: false,
        userIds
    };
}

//* این تابع کل تست دو کلاینت و پرزنس را روی سرور اصلی اجرا می‌کند.
async function runGrpcStreamingRealtimeMainServerTwoClientPresenceSmoke() {
    let ownerUserId = "";
    let secondUserId = "";
    let ownerStream = null;
    let secondStream = null;

    try {
        const authProtoRoot = loadProtoRoot(resolveAuthProtoPath());
        const realtimeProtoRoot = loadProtoRoot(resolveRealtimeStreamProtoPath());

        const authClient = createMainServerAuthClient(authProtoRoot, DEFAULT_TARGET);
        const realtimeClient = createMainServerRealtimeClient(realtimeProtoRoot, DEFAULT_TARGET);

        const ownerRegisterResponse = await registerMainServerUser(
            authClient,
            createMainServerRegisterRequest("owner")
        );

        const secondRegisterResponse = await registerMainServerUser(
            authClient,
            createMainServerRegisterRequest("second")
        );

        ownerUserId = ownerRegisterResponse.user.id;
        secondUserId = secondRegisterResponse.user.id;

        ownerStream = openRealtimeStream(realtimeClient);
        secondStream = openRealtimeStream(realtimeClient);

        await authenticateRealtimeStream(ownerStream, ownerRegisterResponse);
        await authenticateRealtimeStream(secondStream, secondRegisterResponse);

        const roomName = `g8 main two client ${randomUUID().slice(0, 8)}`;
        const createRoomEnvelope = createLobbyCreateRoomEnvelope(roomName);

        ownerStream.send(createRoomEnvelope);

        const createRoomFrame = await ownerStream.waitFor(
            (envelope) => envelope.ch === "system" && envelope.t === "ack" && envelope.replyTo === createRoomEnvelope.id,
            "create room ack"
        );

        const roomId = assertCreateRoomAckFrame(createRoomEnvelope, createRoomFrame);

        const ownerJoinEnvelope = createGameJoinRoomEnvelope(roomId);
        ownerStream.send(ownerJoinEnvelope);

        const ownerJoinFrame = await ownerStream.waitFor(
            (envelope) => envelope.ch === "system" && envelope.t === "ack" && envelope.replyTo === ownerJoinEnvelope.id,
            "owner join room ack"
        );

        assertJoinRoomAckFrame(ownerJoinEnvelope, ownerJoinFrame, roomId, ownerRegisterResponse);

        const secondJoinEnvelope = createGameJoinRoomEnvelope(roomId);
        secondStream.send(secondJoinEnvelope);

        const [secondJoinFrame, ownerPresenceFrame] = await Promise.all([
            secondStream.waitFor(
                (envelope) => envelope.ch === "system" && envelope.t === "ack" && envelope.replyTo === secondJoinEnvelope.id,
                "second join room ack"
            ),
            ownerStream.waitFor(
                (envelope) => envelope.ch === "presence" && envelope.t === "player_joined" && envelope.payload?.userId === secondUserId,
                "owner receives second user presence"
            )
        ]);

        assertJoinRoomAckFrame(secondJoinEnvelope, secondJoinFrame, roomId, secondRegisterResponse);
        assertSecondUserPresenceFrame(ownerPresenceFrame, roomId, secondRegisterResponse);

        logger.info("Grpc streaming realtime main server two client presence smoke passed", {
            target: DEFAULT_TARGET,
            ownerUserId,
            secondUserId,
            roomId,
            roomName,
            ownerPresenceType: ownerPresenceFrame.envelope.t
        });

        return true;
    } finally {
        secondStream?.close?.();
        ownerStream?.close?.();

        const cleanup = await cleanupMainServerTwoClientPresenceData({
            ownerUserId,
            secondUserId
        });

        logger.info("Grpc streaming realtime main server two client presence cleanup completed", cleanup);
    }
}

//* این تابع خط فرمان تست دو کلاینت و پرزنس روی سرور اصلی را اجرا می‌کند.
async function main() {
    try {
        await runGrpcStreamingRealtimeMainServerTwoClientPresenceSmoke();
        process.exitCode = 0;
    } catch (error) {
        logger.error("Grpc streaming realtime main server two client presence smoke failed", {
            target: DEFAULT_TARGET,
            error: error?.message ?? String(error)
        });
        process.exitCode = 1;
    }
}

main();

//* توضیح کلی فایل:
//* این فایل تست مستقل دو کلاینت جی‌آر‌پی‌سی روی سرور اصلی در حال اجرا است.
//* این فایل سرور جدید نمی‌سازد و فقط به سرور جی‌آر‌پی‌سی اصلی وصل می‌شود.
//* ابتدا دو یوزر واقعی ساخته می‌شوند و برای هرکدام یک اِستریم ریل‌تایم باز می‌شود.
//* هر دو اِستریم با توکن واقعی آث می‌شوند.
//* کاربر اول روم می‌سازد و وارد روم می‌شود.
//* کاربر دوم همان روم را جوین می‌شود.
//* سپس دریافت پیام پرزنس ورود کاربر دوم روی اِستریم کاربر اول کنترل می‌شود.
//* در پایان داده‌های تستی از دیتابیس پاک می‌شوند.
//* هدف این فایل اثبات پرزنس واقعی بین دو کلاینت جی‌آر‌پی‌سی روی اجرای اصلی سرور است.

export {
    runGrpcStreamingRealtimeMainServerTwoClientPresenceSmoke,
    createMainServerRegisterRequest,
    createRealtimeAuthEnvelope,
    createLobbyCreateRoomEnvelope,
    createGameJoinRoomEnvelope,
    assertCreateRoomAckFrame,
    assertJoinRoomAckFrame,
    assertSecondUserPresenceFrame
};
