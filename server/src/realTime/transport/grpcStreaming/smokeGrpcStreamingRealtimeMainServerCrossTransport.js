import path from "path";
import grpc from "@grpc/grpc-js";
import mongoose from "mongoose";
import protoLoader from "@grpc/proto-loader";
import { WebSocket } from "ws";
import { randomUUID } from "crypto";

import { connectDatabase } from "../../../infra/mongo/connection.js";
import { UserModel } from "../../../infra/mongo/models/user.model.js";
import { RefreshTokenModel } from "../../../infra/mongo/models/refreshToken.model.js";
import { RoomModel } from "../../../infra/mongo/models/room.model.js";

const DEFAULT_GRPC_TARGET = process.env.GRPC_REALTIME_MAIN_SERVER_TARGET || "127.0.0.1:50051";
const DEFAULT_WS_URL = process.env.WS_REALTIME_MAIN_SERVER_URL || "ws://127.0.0.1:8080";
const DEFAULT_TIMEOUT_MS = Number(process.env.GRPC_REALTIME_MAIN_SERVER_CROSS_TIMEOUT_MS || 12000);
const SHOULD_KEEP_DATA = process.env.GRPC_REALTIME_MAIN_SERVER_CROSS_KEEP_DATA === "1";

//* این آبجکت لاگ‌های ساده تست مشترک سرور اصلی را چاپ می‌کند.
const logger = {
    info: (message, data = {}) => console.log("[G8-MainServerCrossTransportSmoke][INFO]", message, data),
    warn: (message, data = {}) => console.warn("[G8-MainServerCrossTransportSmoke][WARN]", message, data),
    error: (message, data = {}) => console.error("[G8-MainServerCrossTransportSmoke][ERROR]", message, data)
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
function createMainServerAuthClient(authProtoRoot, target = DEFAULT_GRPC_TARGET) {
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
function createMainServerRealtimeClient(realtimeProtoRoot, target = DEFAULT_GRPC_TARGET) {
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
        email: `g8-main-cross-${prefix}-${id}@test.local`,
        password: `Test_${id}_12345`,
        userName: `g8_cross_${prefix}_${id}`.slice(0, 32)
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
function makeEnvelope({
    channel,
    type,
    payload = null,
    room = "",
    prefix = "main_server_cross",
    requiresAck = false
}) {
    return {
        v: 1,
        ch: channel,
        t: type,
        id: `${prefix}_${Date.now()}_${randomUUID()}`,
        ts: Date.now(),
        room,
        payload,
        requiresAck,
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
            description: "main server cross transport smoke",
            visibility: "public",
            maxPlayers: 20,
            metadata: {
                source: "main_server_cross_transport_smoke"
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

//* این تابع پِیلود وضعیت پلیر را برای تست مشترک می‌سازد.
function createPlayerStatePayload() {
    return {
        position: {
            x: 21.25,
            y: 2,
            z: -8.5
        },
        rotation: {
            x: 0,
            y: 90,
            z: 0
        },
        velocity: {
            x: 0.75,
            y: 0,
            z: 0.5
        },
        animation: "walk",
        sequence: Date.now()
    };
}

//* این تابع اِنولوپ وضعیت پلیر را برای مسیر پرزنس می‌سازد.
function createPresencePlayerStateEnvelope(roomId, statePayload) {
    return makeEnvelope({
        channel: "presence",
        type: "player_state",
        room: roomId,
        payload: {
            roomId,
            data: statePayload
        },
        prefix: "player_state",
        requiresAck: true
    });
}

//* این تابع فریم خام وب‌سوکت را به اِنولوپ تبدیل می‌کند.
function parseRawEnvelope(raw) {
    const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? "");
    return JSON.parse(text);
}

//* این تابع فریم دریافتی را بین منتظرها یا صف داخلی تقسیم می‌کند.
function pushIncomingEnvelope(state, envelope, rawJson = "") {
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

//* این تابع فریم بعدی را با شرط داده‌شده منتظر می‌ماند.
function waitForNextFrame(state, matcher, label) {
    return new Promise((resolve, reject) => {
        const existingIndex = state.frames.findIndex((frame) => matcher(frame.envelope));

        if (existingIndex >= 0) {
            const [matched] = state.frames.splice(existingIndex, 1);
            resolve(matched);
            return;
        }

        const waiter = {
            matcher,
            resolve: null,
            reject: null
        };

        const timeout = setTimeout(() => {
            const pendingIndex = state.waiters.indexOf(waiter);
            if (pendingIndex >= 0) state.waiters.splice(pendingIndex, 1);

            reject(new Error(`Timed out waiting for ${label}`));
        }, DEFAULT_TIMEOUT_MS);

        waiter.resolve = (frame) => {
            clearTimeout(timeout);
            resolve(frame);
        };

        waiter.reject = (error) => {
            clearTimeout(timeout);
            reject(error);
        };

        state.waiters.push(waiter);
    });
}

//* این تابع همه منتظرهای باز را با خطا می‌بندد.
function rejectAllWaiters(state, error) {
    const waiters = [...state.waiters];
    state.waiters.length = 0;

    for (const waiter of waiters) {
        waiter.reject(error);
    }
}

//* این تابع یک کلاینت وب‌سوکت ریل‌تایم روی سرور اصلی باز می‌کند.
function openMainServerWebSocketRealtimeClient(url = DEFAULT_WS_URL) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        const state = {
            frames: [],
            waiters: []
        };

        let opened = false;

        const timeout = setTimeout(() => {
            if (opened) return;

            socket.close();
            reject(new Error("WebSocket client open timed out"));
        }, DEFAULT_TIMEOUT_MS);

        socket.on("open", () => {
            opened = true;
            clearTimeout(timeout);

            resolve({
                socket,
                send: (envelope) => socket.send(JSON.stringify(envelope)),
                waitFor: (matcher, label) => waitForNextFrame(state, matcher, label),
                close: () => socket.close()
            });
        });

        socket.on("message", (raw) => {
            try {
                const envelope = parseRawEnvelope(raw);
                pushIncomingEnvelope(state, envelope, Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? ""));
            } catch (error) {
                rejectAllWaiters(state, error);
            }
        });

        socket.on("error", (error) => {
            clearTimeout(timeout);
            rejectAllWaiters(state, error);

            if (!opened) {
                reject(error);
            }
        });

        socket.on("close", () => {
            rejectAllWaiters(state, new Error("WebSocket client closed"));
        });
    });
}

//* این تابع یک اِستریم جی‌آر‌پی‌سی ریل‌تایم روی سرور اصلی باز می‌کند.
function openMainServerGrpcRealtimeStream(realtimeClient) {
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
            const rawJson = frame?.rawJson ?? "";
            const envelope = JSON.parse(rawJson);
            pushIncomingEnvelope(state, envelope, rawJson);
        } catch (error) {
            rejectAllWaiters(state, error);
        }
    });

    call.on("error", (error) => {
        rejectAllWaiters(state, error);
    });

    call.on("end", () => {
        rejectAllWaiters(state, new Error("Grpc stream ended"));
    });

    return {
        call,
        send: (envelope) => call.write({ rawJson: JSON.stringify(envelope) }),
        waitFor: (matcher, label) => waitForNextFrame(state, matcher, label),
        close: () => call.end()
    };
}

//* این تابع آث وب‌سوکت را با توکن واقعی انجام می‌دهد.
async function authenticateWebSocketClient(wsClient, registerResponse) {
    const authEnvelope = createRealtimeAuthEnvelope(registerResponse.accessToken);

    wsClient.send(authEnvelope);

    const authFrame = await wsClient.waitFor(
        (envelope) => envelope.ch === "system" && envelope.t === "auth_ok" && envelope.replyTo === authEnvelope.id,
        "websocket auth ok"
    );

    if (authFrame.envelope.payload?.userId !== registerResponse.user.id) {
        throw new Error("WebSocket auth user id does not match registered user");
    }

    return authFrame;
}

//* این تابع آث جی‌آر‌پی‌سی را با توکن واقعی انجام می‌دهد.
async function authenticateGrpcStream(grpcStream, registerResponse) {
    const authEnvelope = createRealtimeAuthEnvelope(registerResponse.accessToken);

    grpcStream.send(authEnvelope);

    const authFrame = await grpcStream.waitFor(
        (envelope) => envelope.ch === "system" && envelope.t === "auth_ok" && envelope.replyTo === authEnvelope.id,
        "grpc auth ok"
    );

    if (authFrame.envelope.payload?.userId !== registerResponse.user.id) {
        throw new Error("Grpc auth user id does not match registered user");
    }

    return authFrame;
}

//* این تابع روم را از وب‌سوکت می‌سازد و همان کاربر را وارد روم می‌کند.
async function createAndJoinRoomFromWebSocket(wsClient, roomName, registerResponse) {
    const createRoomEnvelope = createLobbyCreateRoomEnvelope(roomName);

    wsClient.send(createRoomEnvelope);

    const createRoomFrame = await wsClient.waitFor(
        (envelope) => envelope.ch === "system" && envelope.t === "ack" && envelope.replyTo === createRoomEnvelope.id,
        "websocket create room ack"
    );

    const roomId = String(
        createRoomFrame.envelope.payload?.details?.room?.roomId ??
        createRoomFrame.envelope.payload?.details?.roomId ??
        ""
    ).trim();

    if (!roomId) {
        throw new Error("Create room ack did not return room id");
    }

    const joinRoomEnvelope = createGameJoinRoomEnvelope(roomId);

    wsClient.send(joinRoomEnvelope);

    const joinRoomFrame = await wsClient.waitFor(
        (envelope) => envelope.ch === "system" && envelope.t === "ack" && envelope.replyTo === joinRoomEnvelope.id,
        "websocket join room ack"
    );

    if (joinRoomFrame.envelope.payload?.details?.roomId !== roomId) {
        throw new Error("WebSocket join room ack room id does not match created room");
    }

    if (joinRoomFrame.envelope.payload?.details?.userId !== registerResponse.user.id) {
        throw new Error("WebSocket join room ack user id does not match registered user");
    }

    return {
        roomId,
        createRoomFrame,
        joinRoomFrame
    };
}

//* این تابع کاربر جی‌آر‌پی‌سی را وارد روم وب‌سوکت می‌کند و پرزنس را روی وب‌سوکت کنترل می‌کند.
async function joinRoomFromGrpcAndExpectWebSocketPresence(wsClient, grpcStream, roomId, grpcRegisterResponse) {
    const joinRoomEnvelope = createGameJoinRoomEnvelope(roomId);

    const wsPresencePromise = wsClient.waitFor(
        (envelope) => {
            const payloadUserId = envelope?.payload?.userId ?? envelope?.payload?.data?.userId ?? "";
            const payloadRoomId = envelope?.room ?? envelope?.payload?.roomId ?? envelope?.payload?.data?.roomId ?? "";

            return envelope.ch === "presence"
                && envelope.t === "player_joined"
                && String(payloadRoomId) === roomId
                && String(payloadUserId) === grpcRegisterResponse.user.id;
        },
        "websocket receives grpc player joined"
    );

    const grpcJoinAckPromise = grpcStream.waitFor(
        (envelope) => envelope.ch === "system" && envelope.t === "ack" && envelope.replyTo === joinRoomEnvelope.id,
        "grpc join room ack"
    );

    grpcStream.send(joinRoomEnvelope);

    const [wsPresenceFrame, grpcJoinAckFrame] = await Promise.all([
        wsPresencePromise,
        grpcJoinAckPromise
    ]);

    if (grpcJoinAckFrame.envelope.payload?.details?.roomId !== roomId) {
        throw new Error("Grpc join room ack room id does not match created room");
    }

    if (grpcJoinAckFrame.envelope.payload?.details?.userId !== grpcRegisterResponse.user.id) {
        throw new Error("Grpc join room ack user id does not match registered user");
    }

    return {
        wsPresenceFrame,
        grpcJoinAckFrame
    };
}

//* این تابع وضعیت پلیر را از جی‌آر‌پی‌سی می‌فرستد و دریافت آن را روی وب‌سوکت کنترل می‌کند.
async function sendGrpcPlayerStateAndExpectWebSocketReceive(wsClient, grpcStream, roomId, grpcRegisterResponse) {
    const statePayload = createPlayerStatePayload();
    const playerStateEnvelope = createPresencePlayerStateEnvelope(roomId, statePayload);

    const wsStatePromise = wsClient.waitFor(
        (envelope) => {
            const payloadUserId = envelope?.payload?.userId ?? "";
            const payloadRoomId = envelope?.room ?? envelope?.payload?.roomId ?? "";
            const positionX = envelope?.payload?.data?.position?.x ?? envelope?.payload?.state?.position?.x;

            return envelope.ch === "presence"
                && envelope.t === "player_state"
                && String(payloadRoomId) === roomId
                && String(payloadUserId) === grpcRegisterResponse.user.id
                && Number(positionX) === statePayload.position.x;
        },
        "websocket receives grpc player state"
    );

    const grpcAckPromise = grpcStream.waitFor(
        (envelope) => envelope.ch === "system" && envelope.t === "ack" && envelope.replyTo === playerStateEnvelope.id,
        "grpc player state ack"
    );

    grpcStream.send(playerStateEnvelope);

    const [wsStateFrame, grpcAckFrame] = await Promise.all([
        wsStatePromise,
        grpcAckPromise
    ]);

    if (grpcAckFrame.envelope.payload?.status !== "processed") {
        throw new Error("Grpc player state ack status is not processed");
    }

    if (grpcAckFrame.envelope.payload?.details?.sent !== 1) {
        throw new Error("Grpc player state ack sent count is not one");
    }

    return {
        statePayload,
        wsStateFrame,
        grpcAckFrame
    };
}

//* این تابع داده‌های ساخته‌شده تست را از دیتابیس پاک می‌کند.
async function cleanupMainServerCrossTransportData({ userIds = [], roomId = "" } = {}) {
    const cleanUserIds = [...new Set(userIds.map((userId) => String(userId ?? "").trim()).filter(Boolean))];

    if (SHOULD_KEEP_DATA || cleanUserIds.length === 0) {
        return {
            skipped: true,
            userIds: cleanUserIds,
            roomId
        };
    }

    await connectDatabase();

    const roomConditions = [];

    if (roomId) roomConditions.push({ roomId });
    roomConditions.push({ ownerUserId: { $in: cleanUserIds } });
    roomConditions.push({ ownerId: { $in: cleanUserIds } });
    roomConditions.push({ createdByUserId: { $in: cleanUserIds } });
    roomConditions.push({ createdBy: { $in: cleanUserIds } });

    await RoomModel.deleteMany({ $or: roomConditions });
    await RefreshTokenModel.deleteMany({ userId: { $in: cleanUserIds } });
    await UserModel.deleteMany({ userId: { $in: cleanUserIds } });

    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }

    return {
        skipped: false,
        userIds: cleanUserIds,
        roomId
    };
}

//* این تابع کل تست مشترک وب‌سوکت و جی‌آر‌پی‌سی را روی سرور اصلی اجرا می‌کند.
async function runGrpcStreamingRealtimeMainServerCrossTransportSmoke() {
    let wsClient = null;
    let grpcStream = null;
    let websocketUserId = "";
    let grpcUserId = "";
    let roomId = "";

    try {
        const authProtoRoot = loadProtoRoot(resolveAuthProtoPath());
        const realtimeProtoRoot = loadProtoRoot(resolveRealtimeStreamProtoPath());

        const authClient = createMainServerAuthClient(authProtoRoot, DEFAULT_GRPC_TARGET);
        const grpcRealtimeClient = createMainServerRealtimeClient(realtimeProtoRoot, DEFAULT_GRPC_TARGET);

        const websocketRegisterResponse = await registerMainServerUser(
            authClient,
            createMainServerRegisterRequest("websocket")
        );

        const grpcRegisterResponse = await registerMainServerUser(
            authClient,
            createMainServerRegisterRequest("grpc")
        );

        websocketUserId = websocketRegisterResponse.user.id;
        grpcUserId = grpcRegisterResponse.user.id;

        wsClient = await openMainServerWebSocketRealtimeClient(DEFAULT_WS_URL);
        grpcStream = openMainServerGrpcRealtimeStream(grpcRealtimeClient);

        await authenticateWebSocketClient(wsClient, websocketRegisterResponse);
        await authenticateGrpcStream(grpcStream, grpcRegisterResponse);

        const roomName = `g8 main cross ${randomUUID().slice(0, 8)}`;
        const wsRoomResult = await createAndJoinRoomFromWebSocket(
            wsClient,
            roomName,
            websocketRegisterResponse
        );

        roomId = wsRoomResult.roomId;

        const grpcJoinResult = await joinRoomFromGrpcAndExpectWebSocketPresence(
            wsClient,
            grpcStream,
            roomId,
            grpcRegisterResponse
        );

        const grpcStateResult = await sendGrpcPlayerStateAndExpectWebSocketReceive(
            wsClient,
            grpcStream,
            roomId,
            grpcRegisterResponse
        );

        logger.info("Grpc streaming realtime main server cross transport smoke passed", {
            grpcTarget: DEFAULT_GRPC_TARGET,
            wsUrl: DEFAULT_WS_URL,
            websocketUserId,
            grpcUserId,
            roomId,
            roomName,
            presenceType: grpcJoinResult.wsPresenceFrame.envelope.t,
            stateType: grpcStateResult.wsStateFrame.envelope.t,
            positionX: grpcStateResult.wsStateFrame.envelope.payload?.data?.position?.x,
            grpcAckSent: grpcStateResult.grpcAckFrame.envelope.payload?.details?.sent
        });

        return true;
    } finally {
        grpcStream?.close?.();
        wsClient?.close?.();

        const cleanup = await cleanupMainServerCrossTransportData({
            userIds: [websocketUserId, grpcUserId],
            roomId
        });

        logger.info("Grpc streaming realtime main server cross transport cleanup completed", cleanup);
    }
}

//* این تابع خط فرمان تست مشترک وب‌سوکت و جی‌آر‌پی‌سی روی سرور اصلی را اجرا می‌کند.
async function main() {
    try {
        await runGrpcStreamingRealtimeMainServerCrossTransportSmoke();
        process.exitCode = 0;
    } catch (error) {
        logger.error("Grpc streaming realtime main server cross transport smoke failed", {
            grpcTarget: DEFAULT_GRPC_TARGET,
            wsUrl: DEFAULT_WS_URL,
            error: error?.message ?? String(error)
        });
        process.exitCode = 1;
    }
}

main();

//* توضیح کلی فایل:
//* این فایل تست مستقل مسیر مشترک وب‌سوکت و جی‌آر‌پی‌سی روی سرور اصلی در حال اجرا است.
//* این فایل هیچ سرور موقتی نمی‌سازد.
//* یک کاربر از وب‌سوکت اصلی وصل می‌شود و یک کاربر از جی‌آر‌پی‌سی اصلی وصل می‌شود.
//* هر دو کاربر از مسیر آث سرویس اصلی رجیستر می‌شوند و با توکن واقعی آث ریل‌تایم می‌شوند.
//* کاربر وب‌سوکت روم می‌سازد و وارد روم می‌شود.
//* کاربر جی‌آر‌پی‌سی وارد همان روم می‌شود و وب‌سوکت باید پرزنس ورود او را دریافت کند.
//* سپس کاربر جی‌آر‌پی‌سی وضعیت پلیر را ارسال می‌کند و وب‌سوکت باید همان وضعیت را دریافت کند.
//* در پایان داده‌های تستی از دیتابیس پاک می‌شوند.
//* هدف این فایل اثبات مسیر مشترک واقعی بین وب‌سوکت و جی‌آر‌پی‌سی روی اجرای اصلی سرور است.

export {
    runGrpcStreamingRealtimeMainServerCrossTransportSmoke,
    createRealtimeAuthEnvelope,
    createLobbyCreateRoomEnvelope,
    createGameJoinRoomEnvelope,
    createPresencePlayerStateEnvelope,
    sendGrpcPlayerStateAndExpectWebSocketReceive,
    joinRoomFromGrpcAndExpectWebSocketPresence
};
