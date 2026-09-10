// File => src/transport/grpc/registrars/realtimeStream.registrar.js

import { createRealtimeStreamHandler } from "../handlers/realtimeStream.handler.js";

const REALTIME_STREAM_SERVICE_NAME = "RealtimeStreamService";

//* این تابع سرویس جی‌آر‌پی‌سی اِستریم ریل‌تایم را روی سرور جی‌آر‌پی‌سی ریجستر می‌کند.
function registerRealtimeStreamService({ grpcServer = null, protoRoot = null, logger = null } = {}) {
    assertRegisterInputs(grpcServer, protoRoot);

    const serviceDefinition = resolveRealtimeStreamServiceDefinition(protoRoot);
    const serviceImplementation = createRealtimeStreamHandler();

    grpcServer.addService(serviceDefinition, serviceImplementation);

    logger?.info?.("Realtime gRPC stream service registered", {
        serviceName: REALTIME_STREAM_SERVICE_NAME
    });

    return {
        ok: true,
        serviceName: REALTIME_STREAM_SERVICE_NAME
    };
}

//* این تابع ورودی‌های لازم برای ریجستر کردن سرویس جی‌آر‌پی‌سی را کنترل می‌کند.
function assertRegisterInputs(grpcServer, protoRoot) {
    if (!grpcServer || typeof grpcServer.addService !== "function") {
        throw new Error("Invalid grpcServer: addService function is required");
    }

    if (!protoRoot) {
        throw new Error("Invalid protoRoot: loaded realtime stream proto package is required");
    }
}

//* این تابع تعریف سرویس RealtimeStreamService را از پکیج لودشده پروتو پیدا می‌کند.
function resolveRealtimeStreamServiceDefinition(protoRoot) {
    const service = protoRoot?.metaverse?.v1?.realtime?.RealtimeStreamService;
    const serviceDefinition = service?.service ?? service;

    if (!serviceDefinition) {
        throw new Error("RealtimeStreamService definition was not found in loaded proto package");
    }

    return serviceDefinition;
}

//* توضیح کلی فایل:
//* این فایل فقط ریجسترکننده سرویس جی‌آر‌پی‌سی اِستریم ریل‌تایم است.
//* این فایل هَندلِر Open را از realtimeStream.handler.js می‌گیرد.
//* سپس آن را با grpcServer.addService روی سرور جی‌آر‌پی‌سی ثبت می‌کند.
//* سرویس ثبت‌شده بعداً کال Open را دریافت می‌کند و آن کال به ترنسپورت جی‌آر‌پی‌سی ریل‌تایم تحویل داده می‌شود.
//* این فایل نقش ریجستر کردن سرویس را دارد و منطق اِنولوپ، رُتِر، روم، پرزنس، اَک و گیم‌پلی داخل مسیرهای فعلی ریل‌تایم باقی می‌ماند.

export {
    registerRealtimeStreamService,
    resolveRealtimeStreamServiceDefinition
};
