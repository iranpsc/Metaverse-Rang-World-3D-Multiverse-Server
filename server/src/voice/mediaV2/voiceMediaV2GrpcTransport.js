import { fileURLToPath } from "node:url";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

const VOICE_MEDIA_V2_PROTO_PATH = fileURLToPath(new URL("./voiceMediaV2.proto", import.meta.url));

//* این تابع قرارداد جی آر پی سی مسیر رسانه نسل دوم را از فایل پروتو بارگذاری می کند.
function loadVoiceMediaV2GrpcDefinition() {
    const definition = protoLoader.loadSync(VOICE_MEDIA_V2_PROTO_PATH, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
    const loaded = grpc.loadPackageDefinition(definition);
    const servicePackage = loaded?.metaverse?.voice?.media?.v2;
    if (!servicePackage?.VoiceMediaTransport?.service) throw new Error("Voice media v2 gRPC definition could not be loaded.");
    return servicePackage;
}

//* این تابع سرویس جی آر پی سی مستقل مسیر رسانه را روی سرور تزریق شده ثبت می کند.
function registerVoiceMediaV2GrpcTransport({ grpcServer, runtime, logger = null } = {}) {
    if (!grpcServer || typeof grpcServer.addService !== "function") throw new TypeError("grpcServer is invalid.");
    if (!runtime || typeof runtime.acceptConnection !== "function") throw new TypeError("runtime is invalid.");
    const servicePackage = loadVoiceMediaV2GrpcDefinition();
    let sequence = 0;

    //* این تابع هر جریان دوطرفه جی آر پی سی را به یک اتصال مستقل مسیر رسانه تبدیل می کند.
    function connect(call) {
        sequence += 1;
        const transportConnectionKey = `voice-media-v2-grpc:${sequence}`;
        const accepted = runtime.acceptConnection({
            transportConnectionKey,
            sendPacket(packet) {
                return new Promise((resolve, reject) => {
                    call.write({ packet }, (error) => error ? reject(error) : resolve());
                });
            },
            closeTransport() {
                try { call.end(); } catch { }
            }
        });

        call.on("data", (message) => {
            const packet = message?.packet;
            void accepted.receive(packet).catch((error) => {
                logger?.warn?.("VME2_PHASE9_MEDIA_GRPC_RECEIVE=FAIL", { error: error?.message ?? String(error) });
                void accepted.closed("media_protocol_error");
            });
        });
        call.on("end", () => { void accepted.closed("media_grpc_end"); });
        call.on("error", () => { void accepted.closed("media_grpc_error"); });
        call.on("cancelled", () => { void accepted.closed("media_grpc_cancelled"); });
    }

    grpcServer.addService(servicePackage.VoiceMediaTransport.service, { connect });
    return Object.freeze({ registered: true, serviceName: "metaverse.voice.media.v2.VoiceMediaTransport", connect });
}

export {
    VOICE_MEDIA_V2_PROTO_PATH,
    loadVoiceMediaV2GrpcDefinition,
    registerVoiceMediaV2GrpcTransport
};
