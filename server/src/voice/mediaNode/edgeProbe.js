import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import WebSocket from "ws";
import {
    VoiceMediaV2PacketKind,
    decodeVoiceMediaV2BindResult,
    decodeVoiceMediaV2Packet,
    encodeVoiceMediaV2BindRequest,
    encodeVoiceMediaV2Packet
} from "../mediaV2/voiceMediaV2Protocol.js";

const protoPath = fileURLToPath(new URL("../mediaV2/voiceMediaV2.proto", import.meta.url));
const publicHost = String(process.env.VOICE_MEDIA_NODE_EDGE_HOST ?? "dev-world-3d.metarang.com").trim();
const webSocketPort = Number(process.env.VOICE_MEDIA_NODE_EDGE_WS_PORT ?? 443);
const grpcPort = Number(process.env.VOICE_MEDIA_NODE_EDGE_GRPC_PORT ?? 50052);

//* این تابع یک درخواست بایند عمدا نامعتبر ولی از نظر قرارداد صحیح می سازد.
function createRejectedBindPacket() {
    const streamId = randomUUID();
    const controlConnectionId = randomUUID();
    return Object.freeze({
        streamId,
        packet: encodeVoiceMediaV2Packet({
            kind: VoiceMediaV2PacketKind.BIND_REQUEST,
            transportSequence: 1,
            streamId,
            payload: encodeVoiceMediaV2BindRequest({
                accessToken: "voice-media-node-edge-probe-invalid-token",
                roomId: "voice-media-node-edge-probe-room",
                controlConnectionId,
                platform: 1,
                clientBuild: "voice-media-node-edge-probe"
            })
        })
    });
}

//* این تابع پاسخ رد بایند را برای اثبات رسیدن درخواست به رانتایم رسانه بررسی می کند.
function validateRejectedBind(input, expectedStreamId) {
    const packet = decodeVoiceMediaV2Packet(input);
    if (packet.kind !== VoiceMediaV2PacketKind.BIND_RESULT) throw new Error("Unexpected media packet kind.");
    if (packet.streamId !== expectedStreamId) throw new Error("Media bind result stream does not match.");
    const result = decodeVoiceMediaV2BindResult(packet.payload);
    if (result.success !== false || result.retryable !== false || result.code !== 1 || result.message !== "media_bind_rejected") throw new Error("Media bind rejection contract does not match.");
}

//* این تابع مسیر عمومی وب سوکت را با درخواست بایند قراردادی تا نود رسانه بررسی می کند.
async function probeWebSocket() {
    const probe = createRejectedBindPacket();
    await new Promise((resolve, reject) => {
        const socket = new WebSocket(`wss://127.0.0.1:${webSocketPort}/ws?transport=voice-media-v2`, {
            rejectUnauthorized: false,
            servername: publicHost,
            headers: { Host: publicHost }
        });
        let finished = false;
        const timeout = setTimeout(() => finish(new Error("WebSocket bind probe timed out.")), 5000);

        //* این تابع منابع آزمون وب سوکت را فقط یک بار آزاد می کند.
        function finish(error = null) {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            try { socket.close(1000, "probe_done"); } catch { }
            if (error) reject(error);
            else resolve();
        }

        socket.once("open", () => {
            try {
                socket.send(probe.packet, { binary: true });
            } catch (error) {
                finish(error);
            }
        });
        socket.once("message", (data, isBinary) => {
            if (!isBinary) {
                finish(new Error("WebSocket media response is not binary."));
                return;
            }
            try {
                validateRejectedBind(Buffer.from(data), probe.streamId);
                finish();
            } catch (error) {
                finish(error);
            }
        });
        socket.once("error", (error) => finish(error));
        socket.once("close", () => {
            if (!finished) finish(new Error("WebSocket closed before bind result."));
        });
    });
    console.log("VME2_PHASE10_EDGE_WS=PASS");
}

//* این تابع قرارداد جی آر پی سی رسانه را برای آزمون مسیر عمومی بارگذاری می کند.
function loadGrpcPackage() {
    const definition = protoLoader.loadSync(protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
    });
    const loaded = grpc.loadPackageDefinition(definition);
    const servicePackage = loaded?.metaverse?.voice?.media?.v2;
    if (!servicePackage?.VoiceMediaTransport) throw new Error("Voice media gRPC package is unavailable.");
    return servicePackage;
}

//* این تابع مسیر عمومی جی آر پی سی را با درخواست بایند قراردادی تا نود رسانه بررسی می کند.
async function probeGrpc() {
    const probe = createRejectedBindPacket();
    const servicePackage = loadGrpcPackage();
    const client = new servicePackage.VoiceMediaTransport(
        `127.0.0.1:${grpcPort}`,
        grpc.credentials.createSsl(),
        {
            "grpc.ssl_target_name_override": publicHost,
            "grpc.default_authority": publicHost
        }
    );

    await new Promise((resolve, reject) => {
        const call = client.Connect();
        let finished = false;
        const timeout = setTimeout(() => finish(new Error("gRPC bind probe timed out.")), 5000);

        //* این تابع منابع آزمون جی آر پی سی را فقط یک بار آزاد می کند.
        function finish(error = null) {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            try { call.cancel(); } catch { }
            try { client.close(); } catch { }
            if (error) reject(error);
            else resolve();
        }

        call.once("data", (message) => {
            try {
                validateRejectedBind(message?.packet, probe.streamId);
                finish();
            } catch (error) {
                finish(error);
            }
        });
        call.once("error", (error) => {
            if (finished && error?.code === grpc.status.CANCELLED) return;
            finish(error);
        });
        call.once("end", () => {
            if (!finished) finish(new Error("gRPC stream ended before bind result."));
        });
        call.write({ packet: probe.packet });
    });
    console.log("VME2_PHASE10_EDGE_GRPC=PASS");
}

//* این تابع هر دو مسیر عمومی نود رسانه را به ترتیب بررسی می کند.
async function run() {
    await probeWebSocket();
    await probeGrpc();
    console.log("VME2_PHASE10_EDGE=PASS");
}

await run().catch((error) => {
    console.error("VME2_PHASE10_EDGE=FAIL", error);
    process.exit(1);
});
