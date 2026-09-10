// مسیر فایل: src/voice/transport/grpc/registerVoiceGrpcTransport.js

import {
    fileURLToPath
} from "node:url";

import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

import {
    createVoiceGrpcStreamHandler
} from "./createVoiceGrpcStreamHandler.js";

const VOICE_GRPC_RUNTIME_PROTO_PATH =
    fileURLToPath(
        new URL(
            "./voiceTransport.proto",
            import.meta.url
        )
    );

//* این تابع قرارداد سرویس جی‌آرپی صوت را از فایل پروتو رسمی بارگذاری می‌کند.
function loadVoiceGrpcRuntimeDefinition() {
    const packageDefinition =
        protoLoader.loadSync(
            VOICE_GRPC_RUNTIME_PROTO_PATH,
            {
                keepCase: true,
                longs: String,
                enums: String,
                defaults: true,
                oneofs: true
            }
        );

    const loaded =
        grpc.loadPackageDefinition(
            packageDefinition
        );

    const servicePackage =
        loaded?.metaverse?.voice
            ?.transport?.v1;

    if (
        !servicePackage ||
        !servicePackage
            .VoiceTransport
            ?.service
    ) {
        throw new Error(
            "Voice gRPC runtime definition could not be loaded."
        );
    }

    return servicePackage;
}

//* این تابع سرویس جی‌آرپی صوت را روی یک سرور تزریق‌شده ثبت می‌کند و خودش سرور را بایند یا شروع نمی‌کند.
function registerVoiceGrpcTransport({
    grpcServer,
    gateway,
    logger = null
} = {}) {
    if (
        !grpcServer ||
        typeof grpcServer
            .addService !==
            "function"
    ) {
        throw new TypeError(
            "grpcServer must provide addService."
        );
    }

    if (
        !gateway ||
        typeof gateway
            .acceptConnection !==
            "function" ||
        !gateway.policy
    ) {
        throw new TypeError(
            "gateway does not provide the required Voice transport interface."
        );
    }

    const servicePackage =
        loadVoiceGrpcRuntimeDefinition();

    const connectHandler =
        createVoiceGrpcStreamHandler({
            gateway,
            logger
        });

    grpcServer.addService(
        servicePackage
            .VoiceTransport
            .service,
        {
            connect:
                connectHandler
        }
    );

    return Object.freeze({
        registered: true,

        serviceName:
            "metaverse.voice.transport.v1.VoiceTransport",

        serviceDefinition:
            servicePackage
                .VoiceTransport
                .service,

        connectHandler,

        gateway
    });
}

export {
    VOICE_GRPC_RUNTIME_PROTO_PATH,
    loadVoiceGrpcRuntimeDefinition,
    registerVoiceGrpcTransport
};

/*
توضیح فایل:
این فایل سرویس صوت را روی یک سرور جی‌آرپی تزریق‌شده ثبت می‌کند و هیچ عملیات بایند، شروع یا انتخاب پورت انجام نمی‌دهد.
*/
