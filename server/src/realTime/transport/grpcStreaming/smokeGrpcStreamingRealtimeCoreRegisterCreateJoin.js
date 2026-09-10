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

const DEFAULT_PORT = Number(process.env.GRPC_REALTIME_CORE_REGISTER_CREATE_JOIN_PORT || 50076);
const DEFAULT_TIMEOUT_MS = Number(process.env.GRPC_REALTIME_CORE_REGISTER_CREATE_JOIN_TIMEOUT_MS || 9000);
const SHOULD_KEEP_DATA = process.env.GRPC_REALTIME_CORE_REGISTER_CREATE_JOIN_KEEP_DATA === "1";

//* این آبجکت لاگ‌های ساده تست ثبت‌نام، ساخت روم و جوین روم را چاپ می‌کند.
const logger = {
    info: (message, data = {}) => console.log("[G8-CoreRegisterCreateJoinSmoke][INFO]", message, data),
    warn: (message, data = {}) => console.warn("[G8-CoreRegisterCreateJoinSmoke][WARN]", message, data),
    error: (message, data = {}) => console.error("[G8-CoreRegisterCreateJoinSmoke][ERROR]", message, data)
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
function createRegisterRequest() {
    const id = randomUUID().replace(/-/g, "").slice(0, 16);

    return {
        email: `g8-grpc-room-${id}@test.local`,
        password: `Test_${id}_12345`,
        userName: `g8_room_${id}`.slice(0, 32)
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
            description: "grpc realtime create join smoke",
            visibility: "public",
            maxPlayers: 20,
            metadata: {
                source: "grpc_realtime_create_join_smoke"
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

//* این تابع بررسی می‌کند پاسخ آث اوکی برای پیام آث درست برگشته باشد.
function assertAuthOkFrame(authEnvelope, frame, registerResponse) {
    const envelope = frame.envelope;

    if (envelope.ch !== "system") throw new Error(`Expected system channel but got ${envelope.ch}`);
    if (envelope.t !== "auth_ok") throw new Error(`Expected auth_ok type but got ${envelope.t}`);
    if (envelope.replyTo !== authEnvelope.id) throw new Error("Auth ok replyTo does not match auth id");
    if (envelope.payload?.ok !== true) throw new Error("Auth ok payload ok is not true");
    if (envelope.payload?.userId !== registerResponse.user.id) throw new Error("Auth ok user id does not match registered user");

    return true;
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

//* این تابع داده‌های ساخته‌شده تست را از دیتابیس پاک می‌کند.
async function cleanupSmokeData(userId) {
    if (SHOULD_KEEP_DATA || !userId) {
        return {
            skipped: true,
            userId
        };
    }

    await RoomModel.deleteMany({ ownerUserId: userId });
    await RefreshTokenModel.deleteMany({ userId });
    await UserModel.deleteOne({ userId });

    return {
        skipped: false,
        userId
    };
}

//* این تابع کل تست ثبت‌نام، آث، ساخت روم و جوین روم را اجرا می‌کند.
async function runGrpcStreamingRealtimeCoreRegisterCreateJoinSmoke() {
    const grpcServer = new grpc.Server();
    let attachResult = null;
    let registeredUserId = "";
    let realtimeStream = null;

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

        const registerRequest = createRegisterRequest();
        const registerResponse = await registerSmokeUser(authClient, registerRequest);

        registeredUserId = registerResponse.user.id;
        realtimeStream = openRealtimeStream(realtimeClient);

        const authEnvelope = createRealtimeAuthEnvelope(registerResponse.accessToken);
        realtimeStream.send(authEnvelope);

        const authFrame = await realtimeStream.waitFor(
            (envelope) => envelope.ch === "system" && envelope.t === "auth_ok" && envelope.replyTo === authEnvelope.id,
            "auth ok"
        );

        assertAuthOkFrame(authEnvelope, authFrame, registerResponse);

        const roomName = `g8 grpc room ${randomUUID().slice(0, 8)}`;
        const createRoomEnvelope = createLobbyCreateRoomEnvelope(roomName);
        realtimeStream.send(createRoomEnvelope);

        const createRoomFrame = await realtimeStream.waitFor(
            (envelope) => envelope.ch === "system" && envelope.t === "ack" && envelope.replyTo === createRoomEnvelope.id,
            "create room ack"
        );

        const roomId = assertCreateRoomAckFrame(createRoomEnvelope, createRoomFrame);

        const joinRoomEnvelope = createGameJoinRoomEnvelope(roomId);
        realtimeStream.send(joinRoomEnvelope);

        const joinRoomFrame = await realtimeStream.waitFor(
            (envelope) => envelope.ch === "system" && envelope.t === "ack" && envelope.replyTo === joinRoomEnvelope.id,
            "join room ack"
        );

        assertJoinRoomAckFrame(joinRoomEnvelope, joinRoomFrame, roomId, registerResponse);

        logger.info("Grpc streaming realtime core register create join smoke passed", {
            port: boundPort,
            userId: registeredUserId,
            roomId,
            roomName,
            stats: attachResult.getStats()
        });

        return true;
    } finally {
        realtimeStream?.close?.();

        const cleanup = await cleanupSmokeData(registeredUserId);

        logger.info("Grpc streaming realtime core register create join smoke cleanup completed", cleanup);

        attachResult?.stop?.();
        grpcServer.forceShutdown();

        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
    }
}

//* این تابع خط فرمان تست ثبت‌نام، ساخت روم و جوین روم را اجرا می‌کند.
async function main() {
    try {
        await runGrpcStreamingRealtimeCoreRegisterCreateJoinSmoke();
        process.exitCode = 0;
    } catch (error) {
        logger.error("Grpc streaming realtime core register create join smoke failed", {
            error: error?.message ?? String(error)
        });
        process.exitCode = 1;
    }
}

main();

//* توضیح کلی فایل:
//* این فایل تست مستقل مسیر ثبت‌نام، آث، ساخت روم و جوین روم از راه جی‌آر‌پی‌سی است.
//* این تست ابتدا کاربر واقعی را از سرویس آث می‌سازد و توکن دسترسی واقعی می‌گیرد.
//* سپس همان توکن را روی استریم ریل‌تایم می‌فرستد تا کانکشن احراز شود.
//* بعد از آث، پیام ساخت روم از مسیر لابی فرستاده می‌شود و اَک ساخت روم کنترل می‌شود.
//* سپس شناسه روم ساخته‌شده برای پیام جوین روم استفاده می‌شود و اَک جوین روم کنترل می‌شود.
//* در پایان داده‌های تستی از دیتابیس پاک می‌شوند.
//* هدف این فایل بررسی مسیر کامل ریل‌تایم جی‌آر‌پی‌سی تا ورود واقعی به روم است.

export {
    runGrpcStreamingRealtimeCoreRegisterCreateJoinSmoke,
    createRegisterRequest,
    createRealtimeAuthEnvelope,
    createLobbyCreateRoomEnvelope,
    createGameJoinRoomEnvelope,
    assertAuthOkFrame,
    assertCreateRoomAckFrame,
    assertJoinRoomAckFrame
};
