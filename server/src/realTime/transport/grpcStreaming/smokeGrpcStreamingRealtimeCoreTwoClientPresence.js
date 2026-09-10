import path from "path";
import grpc from "@grpc/grpc-js";
import mongoose from "mongoose";
import protoLoader from "@grpc/proto-loader";
import { randomUUID } from "crypto";
import { attachGrpcStreamingRealtimeCore } from "./attachGrpcStreamingRealtimeCore.js";
import { authHandlers } from "../../../transport/grpc/handlers/auth.handler.js";
import { tokenService } from "../../../core/auth/auth.instance.js";
import { connectDatabase } from "../../../infra/mongo/connection.js";
import { UserModel } from "../../../infra/mongo/models/user.model.js";
import { RefreshTokenModel } from "../../../infra/mongo/models/refreshToken.model.js";
import { RoomModel } from "../../../infra/mongo/models/room.model.js";

const DEFAULT_PORT = Number(process.env.GRPC_REALTIME_CORE_TWO_CLIENT_PRESENCE_PORT || 50078);
const DEFAULT_TIMEOUT_MS = Number(process.env.GRPC_REALTIME_CORE_TWO_CLIENT_PRESENCE_TIMEOUT_MS || 10000);
const SHOULD_KEEP_DATA = process.env.GRPC_REALTIME_CORE_TWO_CLIENT_PRESENCE_KEEP_DATA === "1";

const logger = {
    info: (message, data = {}) => console.log("[G8-TwoClientPresenceSmoke][INFO]", message, data),
    warn: (message, data = {}) => console.warn("[G8-TwoClientPresenceSmoke][WARN]", message, data),
    error: (message, data = {}) => console.error("[G8-TwoClientPresenceSmoke][ERROR]", message, data)
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

//* این تابع سرور جی‌آر‌پی‌سی موقت را روی پورت تست اجرا می‌کند.
function bindSmokeGrpcServer(grpcServer, port = DEFAULT_PORT) {
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

//* این تابع کلاینت آث جی‌آر‌پی‌سی را از روی پروتوی لودشده می‌سازد.
function createAuthSmokeClient(authProtoRoot, port = DEFAULT_PORT) {
    const AuthService = authProtoRoot?.metaverse?.v1?.AuthService;

    if (!AuthService) {
        throw new Error("Auth service client definition was not found");
    }

    return new AuthService(
        `127.0.0.1:${port}`,
        grpc.credentials.createInsecure()
    );
}

//* این تابع کلاینت استریم ریل‌تایم را از روی پروتوی لودشده می‌سازد.
function createRealtimeSmokeClient(realtimeProtoRoot, port = DEFAULT_PORT) {
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
        email: `g8-grpc-presence-${label}-${id}@test.local`,
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
function makeEnvelope({ channel, type, payload = null, room = "", prefix = "grpc_smoke" }) {
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
            description: "grpc realtime two client presence smoke",
            visibility: "public",
            maxPlayers: 20,
            metadata: {
                source: "grpc_realtime_two_client_presence_smoke"
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

//* این تابع یک فریم خام را روی استریم جی‌آر‌پی‌سی می‌فرستد.
function writeRawEnvelope(call, envelope) {
    call.write({
        rawJson: JSON.stringify(envelope)
    });

    return envelope;
}

//* این تابع فریم بعدی استریم را با شرط داده‌شده منتظر می‌ماند.
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

//* این تابع فریم رسیده از استریم را بین منتظرها یا صف داخلی تقسیم می‌کند.
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

//* این تابع همه منتظرهای باز استریم را با خطا می‌بندد.
function rejectAllWaiters(state, error) {
    const waiters = [...state.waiters];
    state.waiters.length = 0;

    for (const waiter of waiters) {
        waiter.reject(error);
    }
}

//* این تابع یک استریم ریل‌تایم باز می‌کند و ابزار ارسال و انتظار پاسخ را برمی‌گرداند.
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

//* این تابع آث یک استریم را انجام می‌دهد و پاسخ آث اوکی را کنترل می‌کند.
async function authenticateRealtimeStream(realtimeStream, registerResponse) {
    const authEnvelope = createRealtimeAuthEnvelope(registerResponse.accessToken);

    realtimeStream.send(authEnvelope);

    const authFrame = await realtimeStream.waitFor(
        (envelope) => envelope.ch === "system" && envelope.t === "auth_ok" && envelope.replyTo === authEnvelope.id,
        "auth ok"
    );

    if (authFrame.envelope.payload?.userId !== registerResponse.user.id) {
        throw new Error("Auth ok user id does not match registered user");
    }

    return authFrame;
}

//* این تابع ساخت روم و ورود سازنده روم را از روی استریم اول انجام می‌دهد.
async function createAndJoinRoomAsOwner(realtimeStream, roomName, registerResponse) {
    const createRoomEnvelope = createLobbyCreateRoomEnvelope(roomName);

    realtimeStream.send(createRoomEnvelope);

    const createRoomFrame = await realtimeStream.waitFor(
        (envelope) => envelope.ch === "system" && envelope.t === "ack" && envelope.replyTo === createRoomEnvelope.id,
        "create room ack"
    );

    const roomId = String(createRoomFrame.envelope.payload?.details?.room?.roomId ?? "").trim();

    if (!roomId) {
        throw new Error("Create room ack did not return room id");
    }

    const joinRoomEnvelope = createGameJoinRoomEnvelope(roomId);

    realtimeStream.send(joinRoomEnvelope);

    const joinRoomFrame = await realtimeStream.waitFor(
        (envelope) => envelope.ch === "system" && envelope.t === "ack" && envelope.replyTo === joinRoomEnvelope.id,
        "owner join room ack"
    );

    if (joinRoomFrame.envelope.payload?.details?.roomId !== roomId) {
        throw new Error("Owner join room ack room id does not match created room");
    }

    if (joinRoomFrame.envelope.payload?.details?.userId !== registerResponse.user.id) {
        throw new Error("Owner join room ack user id does not match owner user");
    }

    return {
        roomId,
        createRoomEnvelope,
        createRoomFrame,
        joinRoomEnvelope,
        joinRoomFrame
    };
}

//* این تابع کاربر دوم را وارد روم می‌کند و پیام پرزنس روی استریم اول را کنترل می‌کند.
async function joinRoomAsSecondUserAndExpectPresence(ownerStream, secondStream, roomId, secondRegisterResponse) {
    const joinRoomEnvelope = createGameJoinRoomEnvelope(roomId);

    const ownerPresencePromise = ownerStream.waitFor(
        (envelope) => {
            const payloadUserId = envelope?.payload?.userId ?? envelope?.payload?.player?.userId ?? envelope?.payload?.user?.userId ?? envelope?.payload?.data?.userId ?? "";
            const payloadRoomId = envelope?.room ?? envelope?.payload?.roomId ?? envelope?.payload?.data?.roomId ?? "";

            return envelope.ch === "presence"
                && envelope.t === "player_joined"
                && String(payloadRoomId) === roomId
                && String(payloadUserId) === secondRegisterResponse.user.id;
        },
        "owner player joined presence"
    );

    const secondJoinAckPromise = secondStream.waitFor(
        (envelope) => envelope.ch === "system" && envelope.t === "ack" && envelope.replyTo === joinRoomEnvelope.id,
        "second join room ack"
    );

    secondStream.send(joinRoomEnvelope);

    const [ownerPresenceFrame, secondJoinAckFrame] = await Promise.all([
        ownerPresencePromise,
        secondJoinAckPromise
    ]);

    if (secondJoinAckFrame.envelope.payload?.details?.roomId !== roomId) {
        throw new Error("Second join room ack room id does not match created room");
    }

    if (secondJoinAckFrame.envelope.payload?.details?.userId !== secondRegisterResponse.user.id) {
        throw new Error("Second join room ack user id does not match second user");
    }

    return {
        joinRoomEnvelope,
        ownerPresenceFrame,
        secondJoinAckFrame
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

//* این تابع کل تست دو کلاینت، یک روم و پرزنس را اجرا می‌کند.
async function runGrpcStreamingRealtimeCoreTwoClientPresenceSmoke() {
    const grpcServer = new grpc.Server();
    let attachResult = null;
    let ownerStream = null;
    let secondStream = null;
    let ownerUserId = "";
    let secondUserId = "";
    let roomId = "";

    try {
        await connectDatabase();

        const authProtoRoot = loadAuthProtoRoot();

        registerAuthSmokeService(grpcServer, authProtoRoot);

        attachResult = attachGrpcStreamingRealtimeCore({
            grpcServer,
            logger,
            tokenService
        });

        const boundPort = await bindSmokeGrpcServer(grpcServer, DEFAULT_PORT);
        const authClient = createAuthSmokeClient(authProtoRoot, boundPort);
        const realtimeClient = createRealtimeSmokeClient(attachResult.protoRoot, boundPort);

        const ownerRegisterResponse = await registerSmokeUser(authClient, createRegisterRequest("owner"));
        const secondRegisterResponse = await registerSmokeUser(authClient, createRegisterRequest("second"));

        ownerUserId = ownerRegisterResponse.user.id;
        secondUserId = secondRegisterResponse.user.id;

        ownerStream = openRealtimeStream(realtimeClient);
        secondStream = openRealtimeStream(realtimeClient);

        await authenticateRealtimeStream(ownerStream, ownerRegisterResponse);
        await authenticateRealtimeStream(secondStream, secondRegisterResponse);

        const roomName = `g8 grpc two client ${randomUUID().slice(0, 8)}`;
        const ownerRoomResult = await createAndJoinRoomAsOwner(ownerStream, roomName, ownerRegisterResponse);

        roomId = ownerRoomResult.roomId;

        const secondJoinResult = await joinRoomAsSecondUserAndExpectPresence(
            ownerStream,
            secondStream,
            roomId,
            secondRegisterResponse
        );

        logger.info("Grpc streaming realtime core two client presence smoke passed", {
            port: boundPort,
            ownerUserId,
            secondUserId,
            roomId,
            roomName,
            ownerPresenceType: secondJoinResult.ownerPresenceFrame.envelope.t,
            stats: attachResult.getStats()
        });

        return true;
    } finally {
        secondStream?.close?.();
        ownerStream?.close?.();

        const cleanup = await cleanupSmokeData({
            userIds: [ownerUserId, secondUserId],
            roomId
        });

        logger.info("Grpc streaming realtime core two client presence smoke cleanup completed", cleanup);

        attachResult?.stop?.();
        grpcServer.forceShutdown();

        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
    }
}

//* این تابع خط فرمان تست دو کلاینت و پرزنس را اجرا می‌کند.
async function main() {
    try {
        await runGrpcStreamingRealtimeCoreTwoClientPresenceSmoke();
        process.exitCode = 0;
    } catch (error) {
        logger.error("Grpc streaming realtime core two client presence smoke failed", {
            error: error?.message ?? String(error)
        });
        process.exitCode = 1;
    }
}

main();

//* توضیح کلی فایل:
//* این فایل تست مستقل دو کلاینت جی‌آر‌پی‌سی داخل یک روم است.
//* این تست دو کاربر واقعی را از سرویس آث می‌سازد و برای هر کدام استریم ریل‌تایم جدا باز می‌کند.
//* هر دو استریم با توکن واقعی آث می‌شوند.
//* کاربر اول روم می‌سازد و وارد همان روم می‌شود.
//* کاربر دوم وارد همان روم می‌شود و استریم کاربر اول باید پیام پرزنس ورود کاربر دوم را بگیرد.
//* در پایان استریم‌ها بسته می‌شوند و داده‌های تستی از دیتابیس پاک می‌شوند.
//* هدف این فایل بررسی پخش پرزنس بین دو کلاینت جی‌آر‌پی‌سی از مسیر کُر واقعی ریل‌تایم است.

export {
    runGrpcStreamingRealtimeCoreTwoClientPresenceSmoke,
    createRegisterRequest,
    createRealtimeAuthEnvelope,
    createLobbyCreateRoomEnvelope,
    createGameJoinRoomEnvelope,
    authenticateRealtimeStream,
    createAndJoinRoomAsOwner,
    joinRoomAsSecondUserAndExpectPresence
};
