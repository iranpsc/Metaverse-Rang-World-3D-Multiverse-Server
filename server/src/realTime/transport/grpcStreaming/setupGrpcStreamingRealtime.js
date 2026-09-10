// File => src/realTime/transport/grpcStreaming/setupGrpcStreamingRealtime.js

import path from "path";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import { attachGrpcStreamingRealtime } from "./attachGrpcStreamingRealtime.js";
import { registerRealtimeStreamService } from "../../../transport/grpc/registrars/realtimeStream.registrar.js";

const DEFAULT_REALTIME_STREAM_PROTO_PATH = "protos/realtime/realtime_stream.proto";

//* این تابع مسیر کامل فایل پروتو ریل‌تایم اِستریم را از روی مسیر پروژه می‌سازد.
function resolveProtoPath(protoPath = DEFAULT_REALTIME_STREAM_PROTO_PATH) {
    if (path.isAbsolute(protoPath)) return protoPath;
    return path.join(process.cwd(), protoPath);
}

//* این تابع مسیرهای ایمپورت پروتو را برای لودر جی‌آر‌پی‌سی آماده می‌کند.
function resolveProtoIncludeDirs(includeDirs = ["protos"]) {
    return includeDirs.map((dir) => path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir));
}

//* این تابع فایل پروتو ریل‌تایم اِستریم را لود می‌کند و پکیج قابل ریجستر شدن جی‌آر‌پی‌سی را برمی‌گرداند.
function loadRealtimeStreamProto({
    protoPath = DEFAULT_REALTIME_STREAM_PROTO_PATH,
    includeDirs = ["protos"]
} = {}) {
    const absoluteProtoPath = resolveProtoPath(protoPath);
    const absoluteIncludeDirs = resolveProtoIncludeDirs(includeDirs);

    const packageDefinition = protoLoader.loadSync(absoluteProtoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs: absoluteIncludeDirs
    });

    return grpc.loadPackageDefinition(packageDefinition);
}

//* این تابع ورودی‌های لازم برای راه‌اندازی جی‌آر‌پی‌سی ریل‌تایم را کنترل می‌کند.
function assertSetupInputs({ grpcServer = null, realtimeCallbacks = null } = {}) {
    if (!grpcServer || typeof grpcServer.addService !== "function") {
        throw new Error("Invalid grpcServer: addService function is required");
    }

    if (!realtimeCallbacks || typeof realtimeCallbacks !== "object") {
        throw new Error("Invalid realtimeCallbacks: realtime core callbacks object is required");
    }
}

//* این تابع ترنسپورت جی‌آر‌پی‌سی ریل‌تایم را به کُر وصل می‌کند و سرویس اِستریم را روی سرور جی‌آر‌پی‌سی ریجستر می‌کند.
function setupGrpcStreamingRealtime({
    grpcServer = null,
    logger = null,
    realtimeCallbacks = null,
    protoPath = DEFAULT_REALTIME_STREAM_PROTO_PATH,
    includeDirs = ["protos"]
} = {}) {
    assertSetupInputs({ grpcServer, realtimeCallbacks });

    const grpcStreamingTransport = attachGrpcStreamingRealtime({
        logger,
        onConnection: realtimeCallbacks.onConnection,
        onMessage: realtimeCallbacks.onMessage,
        onClose: realtimeCallbacks.onClose,
        onError: realtimeCallbacks.onError
    });

    const protoRoot = loadRealtimeStreamProto({ protoPath, includeDirs });
    const registration = registerRealtimeStreamService({ grpcServer, protoRoot, logger });

    logger?.info?.("Grpc streaming realtime setup completed", {
        protoPath,
        serviceName: registration.serviceName
    });

    return {
        grpcStreamingTransport,
        protoRoot,
        registration
    };
}

//* توضیح کلی فایل:
//* این فایل راه‌انداز مستقل جی‌آر‌پی‌سی ریل‌تایم است.
//* فایل پروتو realtime_stream.proto را لود می‌کند.
//* ترنسپورت GrpcStreamingRealtimeTransport را به کال‌بک‌های کُر ریل‌تایم وصل می‌کند.
//* سرویس RealtimeStreamService را روی grpcServer ریجستر می‌کند.
//* خروجی این فایل شامل ترنسپورت ساخته‌شده، پکیج پروتو و نتیجه ریجستر سرویس است.
//* این فایل نقش راه‌اندازی مسیر جی‌آر‌پی‌سی را دارد و منطق اِنولوپ، رُتِر، روم، پرزنس، اَک و گیم‌پلی در مسیرهای فعلی ریل‌تایم باقی می‌ماند.

export {
    setupGrpcStreamingRealtime,
    loadRealtimeStreamProto,
    resolveProtoPath,
    resolveProtoIncludeDirs
};
