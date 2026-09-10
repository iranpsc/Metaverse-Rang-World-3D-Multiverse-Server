import { fileURLToPath } from "node:url";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

const VOICE_NPC_PROTO_PATH = fileURLToPath(new URL("./voiceNpcPublisher.proto", import.meta.url));

//* این تابع Bearer Service Token را از Metadata داخلی gRPC می‌خواند.
function readNpcBearerToken(metadata) {
    const values = metadata?.get?.("authorization") ?? [];
    const authorization = String(values[0] ?? "").trim();
    return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

//* این تابع سرویس Client Streaming NPC را روی همان gRPC Server اصلی ثبت می‌کند.
function registerVoiceNpcGrpcPublisher({ grpcServer, publisherService, logger = null } = {}) {
    if (!grpcServer || typeof grpcServer.addService !== "function") throw new TypeError("grpcServer is required.");
    if (!publisherService || typeof publisherService.publishFrame !== "function") throw new TypeError("publisherService is required.");

    const definition = protoLoader.loadSync(VOICE_NPC_PROTO_PATH, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
    });
    const loaded = grpc.loadPackageDefinition(definition);
    const service = loaded?.metaverse?.voice?.npc?.v1?.VoiceNpcPublisher?.service;
    if (!service) throw new Error("Voice NPC gRPC definition could not be loaded.");

    async function publish(call, callback) {
        const token = readNpcBearerToken(call.metadata);
        let acceptedFrames = 0;
        let rejectedFrames = 0;
        let lastReason = "";
        let operationTail = Promise.resolve();

        call.on("data", (message) => {
            operationTail = operationTail.then(async () => {
                const timestampMs = Number(message?.timestamp_ms ?? 0);
                const result = await publisherService.publishFrame({
                    token,
                    sessionId: message?.session_id,
                    npcId: message?.npc_id,
                    serverId: message?.server_id,
                    sequence: Number(message?.sequence ?? 0),
                    timestampMs,
                    opusFrame: message?.opus_frame
                });
                if (result.accepted) acceptedFrames += 1;
                else rejectedFrames += 1;
                lastReason = result.reason;
            });
        });

        call.once("end", () => {
            void operationTail.then(() => callback(null, {
                success: rejectedFrames === 0,
                accepted_frames: acceptedFrames,
                rejected_frames: rejectedFrames,
                reason: lastReason || "npc_stream_completed"
            })).catch((error) => {
                logger?.warn?.("[VoiceNpc] Publish stream failed.", { error: error?.message ?? String(error) });
                callback({ code: grpc.status.PERMISSION_DENIED, message: "Voice NPC publish rejected." });
            });
        });

        call.once("error", (error) => {
            logger?.warn?.("[VoiceNpc] gRPC stream error.", { error: error?.message ?? String(error) });
        });
    }

    async function authorizeSession(call, callback) {
        try {
            const message = call.request ?? {};
            const result = await publisherService.authorizeSession({
                token: readNpcBearerToken(call.metadata),
                sessionId: message.session_id,
                npcId: message.npc_id,
                npcUserId: message.npc_user_id,
                publisherConnectionId: message.publisher_connection_id,
                serverId: message.server_id,
                roomId: message.room_id,
                listeners: (message.listeners ?? []).map((listener) => ({
                    userId: listener.user_id,
                    connectionId: listener.connection_id
                }))
            });
            callback(null, {
                success: result.authorized === true,
                reason: result.reason,
                session_id: result.session?.sessionId ?? ""
            });
        } catch (error) {
            logger?.warn?.("[VoiceNpc] Authorize session rejected.", { error: error?.message ?? String(error) });
            callback({ code: grpc.status.PERMISSION_DENIED, message: "Voice NPC session authorization rejected." });
        }
    }

    async function setRecordingConsent(call, callback) {
        try {
            const message = call.request ?? {};
            const result = await publisherService.setRecordingConsent({
                token: readNpcBearerToken(call.metadata),
                sessionId: message.session_id,
                npcId: message.npc_id,
                serverId: message.server_id,
                consented: message.consented === true
            });
            callback(null, { success: result.accepted === true, reason: result.reason });
        } catch (error) {
            logger?.warn?.("[VoiceNpc] Recording consent rejected.", { error: error?.message ?? String(error) });
            callback({ code: grpc.status.PERMISSION_DENIED, message: "Voice NPC recording consent rejected." });
        }
    }

    async function closeSession(call, callback) {
        try {
            const message = call.request ?? {};
            const result = await publisherService.closeSession({
                token: readNpcBearerToken(call.metadata),
                sessionId: message.session_id,
                npcId: message.npc_id,
                serverId: message.server_id
            });
            callback(null, { success: result.closed === true, reason: result.reason });
        } catch (error) {
            logger?.warn?.("[VoiceNpc] Close session rejected.", { error: error?.message ?? String(error) });
            callback({ code: grpc.status.PERMISSION_DENIED, message: "Voice NPC close session rejected." });
        }
    }

    grpcServer.addService(service, { authorizeSession, publish, setRecordingConsent, closeSession });
    return Object.freeze({
        registered: true,
        serviceName: "metaverse.voice.npc.v1.VoiceNpcPublisher",
        authorizeSession,
        publish,
        setRecordingConsent,
        closeSession
    });
}

export { VOICE_NPC_PROTO_PATH, readNpcBearerToken, registerVoiceNpcGrpcPublisher };

/*
توضیح فایل:
این فایل سرویس Client Streaming داخلی NPC را روی gRPC Server اصلی ثبت می‌کند، Service Token را از Metadata می‌گیرد و هیچ پورت جداگانه‌ای باز نمی‌کند.
*/
