import http from "http";
import path from "path";
import grpc from "@grpc/grpc-js";
import mongoose from "mongoose";
import protoLoader from "@grpc/proto-loader";
import { WebSocket } from "ws";
import { randomUUID } from "crypto";
import { attachRealtime } from "../../index.js";
import { attachGrpcStreamingRealtimeCore } from "./attachGrpcStreamingRealtimeCore.js";
import { authHandlers } from "../../../transport/grpc/handlers/auth.handler.js";
import { tokenService } from "../../../core/auth/auth.instance.js";
import { connectDatabase } from "../../../infra/mongo/connection.js";
import { UserModel } from "../../../infra/mongo/models/user.model.js";
import { RefreshTokenModel } from "../../../infra/mongo/models/refreshToken.model.js";
import { RoomModel } from "../../../infra/mongo/models/room.model.js";

const DEFAULT_GRPC_PORT = Number(process.env.GRPC_REALTIME_CROSS_TRANSPORT_GRPC_PORT || 50082);
const DEFAULT_TIMEOUT_MS = Number(process.env.GRPC_REALTIME_CROSS_TRANSPORT_TIMEOUT_MS || 12000);
const SHOULD_KEEP_DATA = process.env.GRPC_REALTIME_CROSS_TRANSPORT_KEEP_DATA === "1";

const logger = {
    info: (message, data = {}) => console.log("[G8-CrossTransportSmoke][INFO]", message, data),
    warn: (message, data = {}) => console.warn("[G8-CrossTransportSmoke][WARN]", message, data),
    error: (message, data = {}) => console.error("[G8-CrossTransportSmoke][ERROR]", message, data)
};

//* این تابع مسیر فایل پروتوی آث را از روی ریشه پروژه می‌سازد.
function resolveAuthProtoPath() {
    return path.join(process.cwd(), "protos/auth/auth.proto");
}

//* این تابع مسیر پوشه پروتوها را از روی ریشه پروژه می‌سازد.
function resolveProtoRootPath() {
    return path.join(process.cwd(), "protos");
}

//* این تابع پروتوی آث را برای ساخت سرویس و کلاینت تستی لود می‌کند.
function loadAuthProtoRoot() {
    const packageDefinition = protoLoader.loadSync(resolveAuthProtoPath(), {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs: [resolveProtoRootPath()]
    });

    return grpc.loadPackageDefinition(packageDefinition);
}

//* این تابع سرویس آث واقعی را روی سرور جی‌آر‌پی‌سی موقت ثبت می‌کند.
function registerAuthSmokeService(grpcServer, authProtoRoot) {
    const serviceDefinition = authProtoRoot?.metaverse?.v1?.AuthService?.service;

    if (!serviceDefinition) {
        throw new Error("Auth service definition was not found");
    }

    grpcServer.addService(serviceDefinition, authHandlers);

    return {
        ok: true,
        serviceName: "AuthService"
    };
}

//* این تابع سرور اچ‌تی‌تی‌پی موقت را روی پورت آزاد اجرا می‌کند.
function listenHttpServer(httpServer) {
    return new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(0, "127.0.0.1", () => {
            httpServer.off("error", reject);
            resolve(httpServer.address().port);
        });
    });
}

//* این تابع سرور جی‌آر‌پی‌سی موقت را روی پورت تست اجرا می‌کند.
function bindSmokeGrpcServer(grpcServer, port = DEFAULT_GRPC_PORT) {
    return new Promise((resolve, reject) => {
        grpcServer.bindAsync(
            `0.0.0.0:${port}`,
            grpc.ServerCredentials.createInsecure(),
            (error, boundPort) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve(boundPort);
            }
        );
    });
}

//* این تابع سرور اچ‌تی‌تی‌پی موقت را به شکل امن می‌بندد.
function closeHttpServer(httpServer) {
    return new Promise((resolve) => {
        if (!httpServer?.listening) {
            resolve();
            return;
        }

        httpServer.close(() => resolve());
    });
}

//* این تابع کلاینت آث جی‌آر‌پی‌سی را از روی پروتوی لودشده می‌سازد.
function createAuthSmokeClient(authProtoRoot, port = DEFAULT_GRPC_PORT) {
    const AuthService = authProtoRoot?.metaverse?.v1?.AuthService;

    if (!AuthService) {
        throw new Error("Auth service client definition was not found");
    }

    return new AuthService(
        `127.0.0.1:${port}`,
        grpc.credentials.createInsecure()
    );
}

//* این تابع کلاینت استریم ریل‌تایم جی‌آر‌پی‌سی را از روی پروتوی لودشده می‌سازد.
function createGrpcRealtimeSmokeClient(realtimeProtoRoot, port = DEFAULT_GRPC_PORT) {
    const RealtimeStreamService = realtimeProtoRoot?.metaverse?.v1?.realtime?.RealtimeStreamService;

    if (!RealtimeStreamService) {
        throw new Error("Realtime stream service client definition was not found");
    }

    return new RealtimeStreamService(
        `127.0.0.1:${port}`,
        grpc.credentials.createInsecure()
    );
}

//* این تابع یک درخواست ثبت‌نام واقعی و یکتا برای تست می‌سازد.
function createRegisterRequest(label) {
    const id = randomUUID().replace(/-/g, "").slice(0, 14);

    return {
        email: `g8-cross-${label}-${id}@test.local`,
        password: `Test_${label}_${id}_12345`,
        userName: `g8_${label}_${id}`.slice(0, 32)
    };
}

//* این تابع یک متد تک‌پاسخ جی‌آر‌پی‌سی را با نام‌های احتمالی پیدا و اجرا می‌کند.
function callUnaryGrpcMethod(client, methodNames = [], request = {}) {
    const methodName = methodNames.find((name) => typeof client?.[name] === "function");

    if (!methodName) {
        throw new Error(`Unary gRPC method was not found: ${methodNames.join(", ")}`);
    }

    return new Promise((resolve, reject) => {
        client[methodName](request, (error, response) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(response);
        });
    });
}

//* این تابع ثبت‌نام واقعی را از مسیر سرویس آث اجرا می‌کند.
async function registerSmokeUser(authClient, registerRequest) {
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
function makeEnvelope({ channel, type, payload = null, room = "", prefix = "cross_smoke", requiresAck = false }) {
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

//* این تابع اِنولوپ آث ریل‌تایم را با توکن واقعی می‌سازد.
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
            description: "cross transport smoke",
            visibility: "public",
            maxPlayers: 20,
            metadata: {
                source: "cross_transport_smoke"
            }
        },
        prefix: "create_room"
    });
}

//* این تابع اِنولوپ جوین روم را برای مسیر بازی می‌سازد.
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

//* این تابع فریم خام را به اِنولوپ تبدیل می‌کند.
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

//* این تابع یک کلاینت وب‌سوکت ریل‌تایم باز می‌کند.
function openWebSocketRealtimeClient(port) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}`);
        const state = {
            frames: [],
            waiters: []
        };

        const timeout = setTimeout(() => {
            socket.close();
            reject(new Error("WebSocket client open timed out"));
        }, DEFAULT_TIMEOUT_MS);

        socket.on("open", () => {
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
            reject(error);
        });

        socket.on("close", () => {
            rejectAllWaiters(state, new Error("WebSocket client closed"));
        });
    });
}

//* این تابع یک استریم جی‌آر‌پی‌سی ریل‌تایم باز می‌کند.
function openGrpcRealtimeStream(realtimeClient) {
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

    const roomId = String(createRoomFrame.envelope.payload?.details?.room?.roomId ?? "").trim();

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
async function cleanupSmokeData({ userIds = [], roomId = "" } = {}) {
    const cleanUserIds = [...new Set(userIds.map((userId) => String(userId ?? "").trim()).filter(Boolean))];

    if (SHOULD_KEEP_DATA || cleanUserIds.length === 0) {
        return {
            skipped: true,
            userIds: cleanUserIds,
            roomId
        };
    }

    const roomConditions = [];

    if (roomId) roomConditions.push({ roomId });
    roomConditions.push({ ownerUserId: { $in: cleanUserIds } });
    roomConditions.push({ ownerId: { $in: cleanUserIds } });
    roomConditions.push({ createdByUserId: { $in: cleanUserIds } });
    roomConditions.push({ createdBy: { $in: cleanUserIds } });

    await RoomModel.deleteMany({ $or: roomConditions });
    await RefreshTokenModel.deleteMany({ userId: { $in: cleanUserIds } });
    await UserModel.deleteMany({ userId: { $in: cleanUserIds } });

    return {
        skipped: false,
        userIds: cleanUserIds,
        roomId
    };
}

//* این تابع کل تست مشترک وب‌سوکت و جی‌آر‌پی‌سی را اجرا می‌کند.
async function runGrpcStreamingRealtimeCrossTransportSmoke() {
    const grpcServer = new grpc.Server();
    const httpServer = http.createServer();
    let websocketRuntime = null;
    let grpcRuntime = null;
    let wsClient = null;
    let grpcStream = null;
    let websocketUserId = "";
    let grpcUserId = "";
    let roomId = "";

    try {
        await connectDatabase();

        const authProtoRoot = loadAuthProtoRoot();

        registerAuthSmokeService(grpcServer, authProtoRoot);

        websocketRuntime = attachRealtime({
            server: httpServer,
            logger,
            tokenService
        });

        grpcRuntime = attachGrpcStreamingRealtimeCore({
            grpcServer,
            logger,
            tokenService,
            sharedRealtime: websocketRuntime
        });

        const wsPort = await listenHttpServer(httpServer);
        const grpcPort = await bindSmokeGrpcServer(grpcServer, DEFAULT_GRPC_PORT);

        const authClient = createAuthSmokeClient(authProtoRoot, grpcPort);
        const grpcRealtimeClient = createGrpcRealtimeSmokeClient(grpcRuntime.protoRoot, grpcPort);

        const websocketRegisterResponse = await registerSmokeUser(authClient, createRegisterRequest("websocket"));
        const grpcRegisterResponse = await registerSmokeUser(authClient, createRegisterRequest("grpc"));

        websocketUserId = websocketRegisterResponse.user.id;
        grpcUserId = grpcRegisterResponse.user.id;

        wsClient = await openWebSocketRealtimeClient(wsPort);
        grpcStream = openGrpcRealtimeStream(grpcRealtimeClient);

        await authenticateWebSocketClient(wsClient, websocketRegisterResponse);
        await authenticateGrpcStream(grpcStream, grpcRegisterResponse);

        const roomName = `g8 cross ${randomUUID().slice(0, 8)}`;
        const wsRoomResult = await createAndJoinRoomFromWebSocket(wsClient, roomName, websocketRegisterResponse);

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

        logger.info("Grpc streaming realtime cross transport smoke passed", {
            grpcPort,
            wsPort,
            websocketUserId,
            grpcUserId,
            roomId,
            roomName,
            presenceType: grpcJoinResult.wsPresenceFrame.envelope.t,
            stateType: grpcStateResult.wsStateFrame.envelope.t,
            positionX: grpcStateResult.wsStateFrame.envelope.payload?.data?.position?.x,
            grpcAckSent: grpcStateResult.grpcAckFrame.envelope.payload?.details?.sent,
            websocketStats: websocketRuntime.getStats(),
            grpcStats: grpcRuntime.getStats()
        });

        return true;
    } finally {
        grpcStream?.close?.();
        wsClient?.close?.();

        const cleanup = await cleanupSmokeData({
            userIds: [websocketUserId, grpcUserId],
            roomId
        });

        logger.info("Grpc streaming realtime cross transport smoke cleanup completed", cleanup);

        grpcRuntime?.stop?.();
        websocketRuntime?.stop?.();

        grpcServer.forceShutdown();
        await closeHttpServer(httpServer);

        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
    }
}

//* این تابع خط فرمان تست مشترک وب‌سوکت و جی‌آر‌پی‌سی را اجرا می‌کند.
async function main() {
    try {
        await runGrpcStreamingRealtimeCrossTransportSmoke();
        process.exitCode = 0;
    } catch (error) {
        logger.error("Grpc streaming realtime cross transport smoke failed", {
            error: error?.message ?? String(error)
        });
        process.exitCode = 1;
    }
}

main();

//* توضیح کلی فایل:
//* این فایل تست مستقل مسیر مشترک وب‌سوکت و جی‌آر‌پی‌سی روی یک کُر ریل‌تایم است.
//* این تست یک سرور وب‌سوکت و یک سرور جی‌آر‌پی‌سی موقت می‌سازد.
//* مسیر جی‌آر‌پی‌سی با خروجی مسیر وب‌سوکت به صورت مشترک به کُر وصل می‌شود.
//* یک کاربر از وب‌سوکت وصل می‌شود و یک کاربر از جی‌آر‌پی‌سی وصل می‌شود.
//* کاربر وب‌سوکت روم می‌سازد و وارد روم می‌شود.
//* کاربر جی‌آر‌پی‌سی وارد همان روم می‌شود و کاربر وب‌سوکت باید پرزنس ورود او را دریافت کند.
//* سپس کاربر جی‌آر‌پی‌سی وضعیت پلیر را ارسال می‌کند و کاربر وب‌سوکت باید همان وضعیت را دریافت کند.
//* هدف این فایل اثبات مسیر مشترک وب‌سوکت و جی‌آر‌پی‌سی بدون تغییر دادن مسیر فعلی وب‌سوکت است.

export {
    runGrpcStreamingRealtimeCrossTransportSmoke,
    createRealtimeAuthEnvelope,
    createLobbyCreateRoomEnvelope,
    createGameJoinRoomEnvelope,
    createPresencePlayerStateEnvelope,
    sendGrpcPlayerStateAndExpectWebSocketReceive,
    joinRoomFromGrpcAndExpectWebSocketPresence
};
