// File => src/realTime/transport/grpcStreaming/attachGrpcStreamingRealtime.js

import { GrpcStreamingRealtimeTransport } from "./grpcStreamingTransport.js";
import { setGrpcStreamingTransport } from "../../../transport/grpc/handlers/realtimeStream.handler.js";

//* این تابع کال‌بک‌های کُر ریل‌تایم را به ترنسپورت جی‌آر‌پی‌سی اِستریمینگ وصل می‌کند.
function attachGrpcStreamingRealtime({
    logger = null,
    onConnection = null,
    onMessage = null,
    onClose = null,
    onError = null
} = {}) {
    const grpcStreamingTransport = new GrpcStreamingRealtimeTransport({
        logger,
        onConnection,
        onMessage,
        onClose,
        onError
    });

    grpcStreamingTransport.start({
        onConnection,
        onMessage,
        onClose,
        onError
    });

    setGrpcStreamingTransport(grpcStreamingTransport);

    logger?.info?.("Grpc streaming realtime transport attached to realtime core");

    return grpcStreamingTransport;
}

//* توضیح کلی فایل:
//* این فایل ترنسپورت جی‌آر‌پی‌سی اِستریمینگ را به کال‌بک‌های کُر ریل‌تایم وصل می‌کند.
//* کُر ریل‌تایم همان کال‌بک‌های اتصال، پیام، بسته شدن و خطا را به این فایل می‌دهد.
//* این فایل یک نمونه از GrpcStreamingRealtimeTransport می‌سازد و آن را فعال می‌کند.
//* سپس همان نمونه را به هَندلِر realtimeStream.handler.js معرفی می‌کند.
//* بعد از این اتصال، هر کال اِستریم ورودی از سرویس جی‌آر‌پی‌سی به همین ترنسپورت تحویل داده می‌شود.

export { attachGrpcStreamingRealtime };
