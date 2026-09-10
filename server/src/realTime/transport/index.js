// File => src/realTime/transport/index.js

export { WebSocketRealtimeTransport, isSocketOpen, createWebSocketConnection } from "./websocket/websocketTransport.js";
export { GrpcStreamingRealtimeTransport } from "./grpcStreaming/grpcStreamingTransport.js";
export {
    RealtimeTransportState,
    RealtimeTransportKind,
    RequiredTransportMethods,
    validateRealtimeTransportContract,
    noopTransportCallback
} from "./realtimeTransportContract.js";

/*
توضیح کلی اسکریپت:
این فایل خروجی مرکزی لایه Transport است.
فایل های دیگر می توانند به جای import مستقیم از مسیرهای داخلی، از همین فایل Transport های موجود و قرارداد Transport را دریافت کنند.
این فایل فقط export انجام می دهد و نباید منطق اجرایی، Auth، Router یا Game Logic داشته باشد.
*/
