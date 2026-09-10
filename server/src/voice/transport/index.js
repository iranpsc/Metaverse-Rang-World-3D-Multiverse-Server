// مسیر فایل: src/voice/transport/index.js

export {
    VoiceTransportCloseCode,
    VoiceTransportConnectionState,
    VoiceTransportDefaultPolicy,
    VoiceTransportName,
    createVoiceTransportPolicy
} from "./voiceTransportConstants.js";

export {
    VOICE_HEARTBEAT_ACK_BYTES,
    decodeVoiceHeartbeatAckPayload,
    encodeVoiceHeartbeatAckPayload
} from "./voiceHeartbeatPayload.js";

export {
    VoiceTransportConnection,
    VoiceTransportFailure
} from "./voiceTransportConnection.js";

export {
    VoiceTransportGateway
} from "./voiceTransportGateway.js";

export {
    VoiceWebSocketTestAdapter,
    VoiceWebSocketTestListener
} from "./websocket/voiceWebSocketTestAdapter.js";

export {
    attachVoiceWebSocketTransport
} from "./websocket/attachVoiceWebSocketTransport.js";

export {
    VOICE_GRPC_PROTO_PATH,
    VOICE_GRPC_TEST_PROTO_PATH,
    VoiceGrpcTestAdapter,
    VoiceGrpcTestListener,
    createVoiceGrpcTestClient,
    loadVoiceGrpcTestDefinition,
    loadVoiceGrpcTransportDefinition
} from "./grpc/voiceGrpcTestAdapter.js";

export {
    VOICE_GRPC_RUNTIME_PROTO_PATH,
    loadVoiceGrpcRuntimeDefinition,
    registerVoiceGrpcTransport
} from "./grpc/registerVoiceGrpcTransport.js";

/*
توضیح فایل:
این فایل اجزای پایه انتقال صوتی را همراه نام‌های جدید و نام‌های سازگار با آزمون‌های قبلی از یک مسیر واحد صادر می‌کند.
*/
