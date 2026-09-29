import grpc from "@grpc/grpc-js";
import { WebSocketServer } from "ws";
import { VoiceRoutingApplication } from "../routing/voiceRoutingApplication.js";
import { createVoiceMediaV2Runtime } from "./voiceMediaV2Runtime.js";
import { acceptVoiceMediaV2WebSocketConnection, isVoiceMediaV2WebSocketRequest } from "./voiceMediaV2WebSocketTransport.js";
import { registerVoiceMediaV2GrpcTransport } from "./voiceMediaV2GrpcTransport.js";

const enabled = String(process.env.VME2_PHASE9_MEDIA_V2_ENABLED ?? "").trim().toLowerCase() === "true";
const globalKey = Symbol.for("network_a.voice.media_v2.phase9.runtime");

if (enabled) {
    const originalSetGateway = VoiceRoutingApplication.prototype.setGateway;
    const originalWebSocketEmit = WebSocketServer.prototype.emit;
    const originalGrpcBindAsync = grpc.Server.prototype.bindAsync;

    //* این تابع بررسی کننده توکن را از زنجیره ثبت اتصال موجود بدون ساخت نمونه تازه پیدا می کند.
    function resolveAccessTokenVerifier(controlGateway) {
        let registration = controlGateway?.connectionRegistrationService ?? null;
        if (registration?.connectionRegistrationService) registration = registration.connectionRegistrationService;
        return registration?.connectionPreparationService?.accessTokenVerifier ?? null;
    }

    //* این تابع هنگام ساخته شدن درگاه کنترل، رانتایم مسیر رسانه را فقط یک بار روی همان سرویس های زنده نصب می کند.
    VoiceRoutingApplication.prototype.setGateway = function setGatewayWithMediaV2(gateway) {
        originalSetGateway.call(this, gateway);
        if (globalThis[globalKey] || gateway?.__voiceMediaV2Composite === true) return;
        const accessTokenVerifier = resolveAccessTokenVerifier(gateway);
        if (!accessTokenVerifier || !this.voiceConnectionRegistry) return;
        const runtime = createVoiceMediaV2Runtime({
            voiceConnectionRegistry: this.voiceConnectionRegistry,
            accessTokenVerifier,
            routingApplication: this,
            controlGateway: gateway,
            logger: console
        });
        globalThis[globalKey] = runtime;
        console.log("VME2_PHASE9_SERVER_RUNTIME=READY");
    };

    //* این تابع فقط اتصال وب سوکت دارای نشانگر مسیر رسانه را پیش از شنونده های قبلی جدا می کند.
    WebSocketServer.prototype.emit = function emitWithMediaV2(eventName, ...args) {
        if (eventName === "connection" && isVoiceMediaV2WebSocketRequest(args[1])) {
            const runtime = globalThis[globalKey];
            if (runtime) {
                acceptVoiceMediaV2WebSocketConnection({ socket: args[0], request: args[1], runtime, logger: console });
                return true;
            }
        }
        return originalWebSocketEmit.call(this, eventName, ...args);
    };

    //* این تابع پیش از بایند سرور اصلی جی آر پی سی، سرویس مستقل مسیر رسانه را روی همان سرور ثبت می کند.
    grpc.Server.prototype.bindAsync = function bindAsyncWithMediaV2(address, credentials, callback) {
        const runtime = globalThis[globalKey];
        if (runtime && this.__voiceMediaV2Registered !== true) {
            registerVoiceMediaV2GrpcTransport({ grpcServer: this, runtime, logger: console });
            Object.defineProperty(this, "__voiceMediaV2Registered", { value: true });
            console.log("VME2_PHASE9_SERVER_GRPC=READY");
        }
        return originalGrpcBindAsync.call(this, address, credentials, callback);
    };
}
