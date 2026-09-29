import { AsyncLocalStorage } from "node:async_hooks";
import { VoiceConnectionState } from "../../core/voiceConnectionConstants.js";
import { VoiceBinaryProtocolConstants } from "../../protocol/voiceBinaryProtocolConstants.js";
import { VoiceMessageType } from "../../protocol/voiceMessageTypes.js";
import { VoiceMediaNodeBridgeMessageType } from "../internalBridgeProtocol.js";
import { createPhase11ScalingCoordinator } from "./mediaScalingCoordinator.js";
import { authorizeVoiceMediaControlBind } from "../../security/voiceMediaBindAuthorizationPolicy.js";

//* این تابع شناسه اتصال را برای مقایسه یکدست می کند.
function normalizeConnectionId(value) {
    return String(value ?? "").trim().toLowerCase();
}

//* این تابع متن اجباری کوتاه را پاکسازی و اعتبارسنجی می کند.
function normalizeRequiredText(value, fieldName, maximumLength = 128) {
    const text = String(value ?? "").trim();
    if (!text || text.length > maximumLength) throw new TypeError(`${fieldName} is invalid.`);
    return text;
}

//* این تابع زمان رسانه را از متن عددی به مقدار صحیح تبدیل می کند.
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

//* این تابع هسته چند نودی را بدون شنونده شبکه و بدون تغییر فایل های فاز قبلی می سازد.
function createPhase11BackendCore({
    routingApplication,
    controlGateway,
    voiceConnectionRegistry,
    accessTokenVerifier = null,
    coordinator = createPhase11ScalingCoordinator()
} = {}) {
    if (!routingApplication || typeof routingApplication.handleVoiceFrame !== "function" || typeof routingApplication.setGateway !== "function") throw new TypeError("Routing application is invalid.");
    if (!controlGateway || typeof controlGateway.getConnectionByConnectionId !== "function") throw new TypeError("Control gateway is invalid.");
    if (!voiceConnectionRegistry || typeof voiceConnectionRegistry.getByConnectionId !== "function") throw new TypeError("Voice connection registry is invalid.");
    if (!coordinator || typeof coordinator.resolveRoomNode !== "function") throw new TypeError("Scaling coordinator is invalid.");
    const verifier = accessTokenVerifier ?? resolveAccessTokenVerifier(controlGateway);
    if (!verifier || typeof verifier.verify !== "function") throw new TypeError("Access token verifier is invalid.");

    const routeContext = new AsyncLocalStorage();
    const nodesById = new Map();

    //* این تابع رکورد زنده نود را در صورت داشتن همتای باز برمی گرداند.
    function getLiveNode(nodeId) {
        const node = nodesById.get(String(nodeId ?? "").trim()) ?? null;
        return node && node.peer && node.peer.closed !== true ? node : null;
    }

    //* این تابع نود مالک روم را فقط در صورت آماده بودن برای مسیر رسانه برمی گرداند.
    function getReadyRoomOwner(roomId) {
        const assignment = coordinator.roomRegistry.getAssignment(roomId);
        if (!assignment) return null;
        if (!coordinator.nodeRegistry.isNodeReady(assignment.nodeId)) return null;
        return getLiveNode(assignment.nodeId);
    }

    const remoteCompositeGateway = Object.freeze({
        __voiceMediaP11Composite: true,

        //* این تابع نمای اتصال را برای مسیر کنترل یا رسانه بر اساس شناسه اتصال برمی گرداند.
        getConnectionByConnectionId(connectionId) {
            const normalizedConnectionId = normalizeConnectionId(connectionId);
            const controlTransport = controlGateway.getConnectionByConnectionId(normalizedConnectionId);
            if (!controlTransport) return null;
            return Object.freeze({
                connectionId: normalizedConnectionId,

                //* این تابع پیام کنترل را روی مسیر قبلی و فریم رسانه را فقط به نود مالک همان روم می فرستد.
                async sendEnvelope(input = {}) {
                    if (input.messageType !== VoiceMessageType.VOICE_FRAME) return await controlTransport.sendEnvelope(input);
                    const context = routeContext.getStore();
                    if (!context) throw new Error("Voice media route context is missing.");
                    const listenerRecord = voiceConnectionRegistry.getByConnectionId(normalizedConnectionId);
                    if (!listenerRecord) throw new Error("Voice listener record is missing.");
                    const owner = getReadyRoomOwner(listenerRecord.roomId);
                    if (!owner) throw new Error("Voice room media owner is unavailable.");
                    if (owner.nodeId !== context.sourceNodeId) throw new Error("Cross-node media route is forbidden for one room.");
                    const publisher = voiceConnectionRegistry.getByConnectionId(input.senderId);
                    if (!publisher) throw new Error("Voice publisher record is missing.");
                    const response = await owner.peer.request({
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

                //* این تابع فقط مسیر رسانه شنونده را روی نود مالک همان روم می بندد.
                async close(input = {}) {
                    const listenerRecord = voiceConnectionRegistry.getByConnectionId(normalizedConnectionId);
                    if (!listenerRecord) return;
                    const owner = getReadyRoomOwner(listenerRecord.roomId);
                    if (!owner) return;
                    await owner.peer.request({
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

    //* این تابع توکن و اتصال کنترل را برای روم درخواستی به صورت مشترک اعتبارسنجی می کند.
    async function authorizeControl({ accessToken, roomId, controlConnectionId } = {}) {
        const safeConnectionId = normalizeConnectionId(controlConnectionId);
        const safeRoomId = String(roomId ?? "").trim();
        const tokenResult = await Promise.resolve(verifier.verify(String(accessToken ?? "").trim()));
        const controlRecord = voiceConnectionRegistry.getByConnectionId(safeConnectionId);
        const authorization = authorizeVoiceMediaControlBind({ controlConnectionId: safeConnectionId, roomId: safeRoomId, tokenResult, controlRecord });
        return Object.freeze({
            success: authorization.allowed,
            controlRecord: authorization.allowed ? authorization.controlRecord : null,
            controlConnectionId: safeConnectionId,
            roomId: safeRoomId,
            reason: authorization.reason
        });
    }

    //* این تابع درخواست بایند را فقط برای نود مالک از پیش انتخاب شده همان روم تایید می کند.
    async function handleAuthorizeBind(nodeId, message, responder) {
        const authorization = await authorizeControl({ accessToken: message.metadata?.accessToken, roomId: message.metadata?.roomId, controlConnectionId: message.metadata?.controlConnectionId });
        const assignment = coordinator.roomRegistry.getAssignment(authorization.roomId);
        const validOwner = assignment?.nodeId === nodeId && coordinator.nodeRegistry.isNodeReady(nodeId) && Boolean(getLiveNode(nodeId));
        const valid = authorization.success && validOwner;
        const controlRecord = authorization.controlRecord;
        await responder.respond({
            type: VoiceMediaNodeBridgeMessageType.AUTHORIZE_BIND_RESULT,
            requestId: message.requestId,
            metadata: valid ? {
                success: true,
                retryable: false,
                controlConnectionId: normalizeConnectionId(controlRecord.connectionId),
                userId: controlRecord.userId,
                roomId: controlRecord.roomId,
                nodeId
            } : {
                success: false,
                retryable: false,
                error: authorization.success ? "media_wrong_room_owner" : "media_bind_rejected"
            }
        });
    }

    //* این تابع فریم ورودی را فقط از نود مالک روم به منطق قطعی مسیریابی موجود تحویل می دهد.
    async function handleRouteFrame(nodeId, message, responder) {
        const controlConnectionId = normalizeConnectionId(message.metadata?.controlConnectionId);
        const controlRecord = voiceConnectionRegistry.getByConnectionId(controlConnectionId);
        const assignment = controlRecord ? coordinator.roomRegistry.getAssignment(controlRecord.roomId) : null;
        const authorizationRevoked = !controlRecord || controlRecord.state !== VoiceConnectionState.ACTIVE;
        if (authorizationRevoked || assignment?.nodeId !== nodeId || !coordinator.nodeRegistry.isNodeReady(nodeId)) {
            const error = authorizationRevoked ? "media_authorization_revoked" : "media_wrong_room_owner";
            await responder.respond({
                type: VoiceMediaNodeBridgeMessageType.ROUTE_FRAME_RESULT,
                requestId: message.requestId,
                metadata: { success: false, accepted: false, dropReason: error, error }
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
            Object.freeze({ sourceNodeId: nodeId, mediaSequence, mediaTimestamp100Ns, streamId }),
            () => routingApplication.handleVoiceFrame(envelope, Object.freeze({ connectionId: controlConnectionId }))
        );
        await responder.respond({
            type: VoiceMediaNodeBridgeMessageType.ROUTE_FRAME_RESULT,
            requestId: message.requestId,
            metadata: { success: true, accepted: result?.accepted !== false, dropReason: result?.dropReason ?? "" }
        });
    }

    //* این تابع پردازشگرهای درخواست داخلی را برای یک نود مشخص می سازد.
    function createHandlers(nodeId) {
        const safeNodeId = normalizeRequiredText(nodeId, "nodeId");
        return Object.freeze({
            [VoiceMediaNodeBridgeMessageType.AUTHORIZE_BIND_REQUEST]: (message, responder) => handleAuthorizeBind(safeNodeId, message, responder),
            [VoiceMediaNodeBridgeMessageType.ROUTE_FRAME_REQUEST]: (message, responder) => handleRouteFrame(safeNodeId, message, responder)
        });
    }

    //* این تابع یک نود رسانه و همتای داخلی آن را در رجیستری چند نودی ثبت می کند.
    function registerNode({ nodeId, region, zone = "", advertiseHost, wsPort, grpcPort, peer } = {}) {
        const safeNodeId = normalizeRequiredText(nodeId, "nodeId");
        if (!peer || typeof peer.request !== "function") throw new TypeError("peer is invalid.");
        const record = Object.freeze({
            nodeId: safeNodeId,
            region: normalizeRequiredText(region, "region", 64),
            zone: String(zone ?? "").trim(),
            advertiseHost: normalizeRequiredText(advertiseHost, "advertiseHost", 255),
            wsPort: Number(wsPort),
            grpcPort: Number(grpcPort),
            peer
        });
        if (!Number.isInteger(record.wsPort) || record.wsPort < 1024 || record.wsPort > 65535) throw new RangeError("wsPort is invalid.");
        if (!Number.isInteger(record.grpcPort) || record.grpcPort < 1024 || record.grpcPort > 65535) throw new RangeError("grpcPort is invalid.");
        nodesById.set(safeNodeId, record);
        coordinator.nodeRegistry.registerNode({ nodeId: safeNodeId, region: record.region, zone: record.zone, peer });
        coordinator.nodeRegistry.heartbeat(safeNodeId, { activeConnections: 0, cpuPercent: 0, outboundKbps: 0 });
        return record;
    }

    //* این تابع تازگی نود ثبت شده را بدون بازنویسی بار گزارش شده به روز می کند.
    function heartbeatNode(nodeId) {
        const node = getLiveNode(nodeId);
        if (!node) return false;
        const current = coordinator.nodeRegistry.getNodeRecord(node.nodeId);
        if (!current) return false;
        coordinator.nodeRegistry.heartbeat(node.nodeId, { activeConnections: current.activeConnections, cpuPercent: current.cpuPercent, outboundKbps: current.outboundKbps });
        return true;
    }

    //* این تابع بار اندازه گیری شده نود زنده را در رجیستری مقیاس پذیری ثبت می کند.
    function updateNodeMetrics(nodeId, metrics = {}) {
        const node = getLiveNode(nodeId);
        if (!node) return null;
        if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) throw new TypeError("metrics is invalid.");
        for (const fieldName of ["activeConnections", "cpuPercent", "outboundKbps"]) {
            if (!Object.prototype.hasOwnProperty.call(metrics, fieldName)) throw new TypeError(`${fieldName} is required.`);
        }
        return coordinator.nodeRegistry.heartbeat(node.nodeId, { activeConnections: metrics.activeConnections, cpuPercent: metrics.cpuPercent, outboundKbps: metrics.outboundKbps });
    }

    //* این تابع نود قطع شده را بدون آزاد کردن خودکار مالکیت روم ها حذف می کند.
    function unregisterNode(nodeId, peer = null) {
        const safeNodeId = String(nodeId ?? "").trim();
        const current = nodesById.get(safeNodeId) ?? null;
        if (!current) return false;
        if (peer && current.peer !== peer) return false;
        nodesById.delete(safeNodeId);
        coordinator.nodeRegistry.unregisterNode(safeNodeId);
        return true;
    }

    //* این تابع نود مناسب روم تازه را انتخاب و نشانی داخلی راه انتقال خواسته شده را برمی گرداند.
    function resolveRoomTargetInternal({ roomId, region = "", zone = "", transport } = {}) {
        const safeRoomId = normalizeRequiredText(roomId, "roomId");
        const safeTransport = String(transport ?? "").trim().toLowerCase();
        if (safeTransport !== "ws" && safeTransport !== "grpc") throw new TypeError("transport is invalid.");
        const result = coordinator.resolveRoomNode({ roomId: safeRoomId, region, zone, allowCrossRegionFallback: false });
        if (!result.success || !result.ready || !result.assignment) return Object.freeze({ success: false, reason: result.reason ?? "room_media_owner_unavailable" });
        const node = getLiveNode(result.assignment.nodeId);
        if (!node) return Object.freeze({ success: false, reason: "room_media_owner_unavailable" });
        return Object.freeze({
            success: true,
            roomId: safeRoomId,
            nodeId: node.nodeId,
            region: node.region,
            zone: node.zone,
            transport: safeTransport,
            host: node.advertiseHost,
            port: safeTransport === "ws" ? node.wsPort : node.grpcPort,
            reused: result.reused === true
        });
    }

    //* این تابع فقط پس از تایید توکن و اتصال کنترل برای روم مقصد نود رسانه انتخاب می کند.
    async function resolveAuthorizedRoomTarget({ accessToken, roomId, controlConnectionId, region = "", zone = "", transport } = {}) {
        const authorization = await authorizeControl({ accessToken, roomId, controlConnectionId });
        if (!authorization.success) return Object.freeze({ success: false, reason: "media_edge_authorization_failed" });
        return resolveRoomTargetInternal({ roomId: authorization.roomId, region, zone, transport });
    }

    //* این تابع وضعیت هسته چند نودی و مالکیت روم ها را برمی گرداند.
    function getStats() {
        return Object.freeze({ connectedNodes: nodesById.size, scaling: coordinator.getStats() });
    }

    routingApplication.setGateway(remoteCompositeGateway);
    return Object.freeze({ coordinator, nodesById, remoteCompositeGateway, createHandlers, registerNode, heartbeatNode, updateNodeMetrics, unregisterNode, resolveAuthorizedRoomTarget, getStats });
}

export {
    createPhase11BackendCore,
    resolveAccessTokenVerifier
};
