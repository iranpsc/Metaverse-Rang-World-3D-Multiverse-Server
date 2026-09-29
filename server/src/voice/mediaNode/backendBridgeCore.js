import { AsyncLocalStorage } from "node:async_hooks";
import { VoiceConnectionState } from "../core/voiceConnectionConstants.js";
import { VoiceBinaryProtocolConstants } from "../protocol/voiceBinaryProtocolConstants.js";
import { VoiceMessageType } from "../protocol/voiceMessageTypes.js";
import { VoiceMediaNodeBridgeMessageType } from "./internalBridgeProtocol.js";
import { authorizeVoiceMediaControlBind } from "../security/voiceMediaBindAuthorizationPolicy.js";

//* این تابع مقدار ورودی را برای مقایسه شناسه اتصال یکدست می کند.
function normalizeConnectionId(value) {
    return String(value ?? "").trim().toLowerCase();
}

//* این تابع مقدار عددی رشته ای را به زمان رسانه تبدیل می کند.
function parseMediaTimestamp(value) {
    const text = String(value ?? "0").trim();
    if (!/^\d+$/.test(text)) throw new TypeError("Media timestamp is invalid.");
    return BigInt(text);
}

//* این تابع بررسی کننده توکن را از زنجیره ثبت اتصال موجود پیدا می کند.
function resolveAccessTokenVerifier(controlGateway) {
    let registration = controlGateway?.connectionRegistrationService ?? null;
    if (registration?.connectionRegistrationService) registration = registration.connectionRegistrationService;
    return registration?.connectionPreparationService?.accessTokenVerifier ?? null;
}

//* این تابع هسته پل داخلی بک اند را بدون باز کردن پورت می سازد.
function createVoiceMediaNodeBackendBridgeCore({ routingApplication, controlGateway, voiceConnectionRegistry, accessTokenVerifier = null } = {}) {
    if (!routingApplication || typeof routingApplication.handleVoiceFrame !== "function" || typeof routingApplication.setGateway !== "function") throw new TypeError("Routing application is invalid.");
    if (!controlGateway || typeof controlGateway.getConnectionByConnectionId !== "function") throw new TypeError("Control gateway is invalid.");
    if (!voiceConnectionRegistry || typeof voiceConnectionRegistry.getByConnectionId !== "function") throw new TypeError("Voice connection registry is invalid.");
    const verifier = accessTokenVerifier ?? resolveAccessTokenVerifier(controlGateway);
    if (!verifier || typeof verifier.verify !== "function") throw new TypeError("Access token verifier is invalid.");

    const routeContext = new AsyncLocalStorage();
    let peer = null;

    //* این تابع همتای زنده نود رسانه را برای درخواست های دوطرفه ثبت می کند.
    function setPeer(nextPeer) {
        peer = nextPeer ?? null;
    }

    //* این تابع همتای زنده نود رسانه را در صورت آماده بودن برمی گرداند.
    function getPeer() {
        return peer && !peer.closed ? peer : null;
    }

    const remoteCompositeGateway = Object.freeze({
        __voiceMediaNodeRemoteComposite: true,

        //* این تابع نمای اتصال را برای مسیر کنترل یا رسانه بر اساس شناسه اتصال برمی گرداند.
        getConnectionByConnectionId(connectionId) {
            const normalizedConnectionId = normalizeConnectionId(connectionId);
            const controlTransport = controlGateway.getConnectionByConnectionId(normalizedConnectionId);
            if (!controlTransport) return null;

            return Object.freeze({
                connectionId: normalizedConnectionId,

                //* این تابع پیام های کنترل را به مسیر قبلی و فریم رسانه را به نود مستقل تحویل می دهد.
                async sendEnvelope(input = {}) {
                    if (input.messageType !== VoiceMessageType.VOICE_FRAME) return await controlTransport.sendEnvelope(input);
                    const context = routeContext.getStore();
                    if (!context) throw new Error("Voice media node route context is missing.");
                    const activePeer = getPeer();
                    if (!activePeer) throw new Error("Voice media node bridge is not connected.");
                    const publisher = voiceConnectionRegistry.getByConnectionId(input.senderId);
                    if (!publisher) throw new Error("Voice publisher record is missing.");
                    const response = await activePeer.request({
                        type: VoiceMediaNodeBridgeMessageType.DELIVER_MEDIA_REQUEST,
                        responseType: VoiceMediaNodeBridgeMessageType.DELIVER_MEDIA_RESULT,
                        metadata: {
                            listenerConnectionId: normalizedConnectionId,
                            flags: Number(input.flags ?? 0) & 0xff,
                            mediaSequence: Number(context.mediaSequence ?? 0) >>> 0,
                            mediaTimestamp100Ns: String(context.mediaTimestamp100Ns ?? 0n),
                            sessionId: String(input.sessionId ?? ""),
                            streamId: String(context.streamId ?? ""),
                            senderId: String(input.senderId ?? "")
                        },
                        payload: input.payload
                    });
                    if (response.metadata?.success !== true) throw new Error(String(response.metadata?.error ?? "media_delivery_failed"));
                    return true;
                },

                //* این تابع فقط مسیر رسانه همان شنونده را در نود مستقل می بندد.
                async close(input = {}) {
                    const activePeer = getPeer();
                    if (!activePeer) return;
                    await activePeer.request({
                        type: VoiceMediaNodeBridgeMessageType.CLOSE_MEDIA_REQUEST,
                        responseType: VoiceMediaNodeBridgeMessageType.CLOSE_MEDIA_RESULT,
                        metadata: {
                            listenerConnectionId: normalizedConnectionId,
                            reason: String(input?.closeMessage ?? "media_route_failure").slice(0, 120)
                        }
                    }).catch(() => undefined);
                }
            });
        }
    });

    //* این تابع درخواست بایند نود رسانه را فقط با وضعیت زنده مسیر کنترل تایید می کند.
    async function handleAuthorizeBind(message, responder) {
        const controlConnectionId = normalizeConnectionId(message.metadata?.controlConnectionId);
        const roomId = String(message.metadata?.roomId ?? "").trim();
        const accessToken = String(message.metadata?.accessToken ?? "").trim();
        const tokenResult = await Promise.resolve(verifier.verify(accessToken));
        const controlRecord = voiceConnectionRegistry.getByConnectionId(controlConnectionId);
        const authorization = authorizeVoiceMediaControlBind({ controlConnectionId, roomId, tokenResult, controlRecord });
        await responder.respond({
            type: VoiceMediaNodeBridgeMessageType.AUTHORIZE_BIND_RESULT,
            requestId: message.requestId,
            metadata: authorization.allowed ? {
                success: true,
                retryable: false,
                controlConnectionId: authorization.controlConnectionId,
                userId: authorization.userId,
                roomId: authorization.roomId
            } : {
                success: false,
                retryable: false,
                error: "media_bind_rejected"
            }
        });
    }

    //* این تابع یک فریم ورودی نود رسانه را در همان منطق قطعی مسیریابی و ضبط موجود پردازش می کند.
    async function handleRouteFrame(message, responder) {
        const controlConnectionId = normalizeConnectionId(message.metadata?.controlConnectionId);
        const controlRecord = voiceConnectionRegistry.getByConnectionId(controlConnectionId);
        if (!controlRecord || controlRecord.state !== VoiceConnectionState.ACTIVE) {
            await responder.respond({
                type: VoiceMediaNodeBridgeMessageType.ROUTE_FRAME_RESULT,
                requestId: message.requestId,
                metadata: { success: false, accepted: false, dropReason: "media_authorization_revoked", error: "media_authorization_revoked" }
            });
            return;
        }
        const mediaSequence = Number(message.metadata?.mediaSequence ?? 0) >>> 0;
        const mediaTimestamp100Ns = parseMediaTimestamp(message.metadata?.mediaTimestamp100Ns);
        const streamId = String(message.metadata?.streamId ?? "").trim();
        const flags = Number(message.metadata?.flags ?? 0) & 0xff;
        const envelope = Object.freeze({
            messageType: VoiceMessageType.VOICE_FRAME,
            flags,
            sequence: mediaSequence,
            timestampMs: Number(mediaTimestamp100Ns / 10000n),
            sessionId: VoiceBinaryProtocolConstants.emptyUuid,
            senderId: VoiceBinaryProtocolConstants.emptyUuid,
            payloadLength: message.payload.length,
            payload: message.payload
        });
        const result = await routeContext.run(
            Object.freeze({ mediaSequence, mediaTimestamp100Ns, streamId }),
            () => routingApplication.handleVoiceFrame(envelope, Object.freeze({ connectionId: controlConnectionId }))
        );
        await responder.respond({
            type: VoiceMediaNodeBridgeMessageType.ROUTE_FRAME_RESULT,
            requestId: message.requestId,
            metadata: { success: true, accepted: result?.accepted !== false, dropReason: result?.dropReason ?? "" }
        });
    }

    const handlers = Object.freeze({
        [VoiceMediaNodeBridgeMessageType.AUTHORIZE_BIND_REQUEST]: handleAuthorizeBind,
        [VoiceMediaNodeBridgeMessageType.ROUTE_FRAME_REQUEST]: handleRouteFrame
    });

    routingApplication.setGateway(remoteCompositeGateway);

    //* این تابع درگاه اصلی کنترل را هنگام توقف پل دوباره به مسیریاب برمی گرداند.
    function stop() {
        setPeer(null);
        routingApplication.setGateway(controlGateway);
    }

    return Object.freeze({ handlers, remoteCompositeGateway, setPeer, getPeer, stop });
}

export {
    createVoiceMediaNodeBackendBridgeCore,
    resolveAccessTokenVerifier
};
