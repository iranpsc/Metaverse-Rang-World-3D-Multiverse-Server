import assert from "node:assert/strict";
import { VoiceConnectionState } from "../core/voiceConnectionConstants.js";
import {
    VoiceMediaV2Codec,
    VoiceMediaV2PacketKind,
    decodeVoiceMediaV2BindResult,
    decodeVoiceMediaV2Packet,
    encodeVoiceMediaV2BindRequest,
    encodeVoiceMediaV2Packet
} from "../mediaV2/voiceMediaV2Protocol.js";
import { createVoiceMediaV2Runtime } from "../mediaV2/voiceMediaV2Runtime.js";
import { createVoiceMediaNodeRuntime } from "../mediaNode/mediaNodeRuntime.js";
import { createVoiceMediaNodeBackendBridgeCore } from "../mediaNode/backendBridgeCore.js";
import { VoiceMediaNodeBridgeMessageType } from "../mediaNode/internalBridgeProtocol.js";
import { createPhase11BackendCore } from "../mediaNode/scaling/mediaClusterBackendCore.js";
import {
    VoiceMediaAuthorizationReason,
    authorizeVoiceMediaBoundControl,
    authorizeVoiceMediaControlBind,
    authorizeVoiceMediaV2Bind
} from "./voiceMediaBindAuthorizationPolicy.js";

const controlConnectionId = "11111111-1111-4111-8111-111111111111";
const streamId = "22222222-2222-4222-8222-222222222222";
const roomId = "room-media-security";
const userId = "media-security-user";

//* این تابع یک بسته اتصال معتبر را برای تغییر کنترل شده هر شرط امنیتی می سازد.
function createValidBindPacket() {
    return decodeVoiceMediaV2Packet(encodeVoiceMediaV2Packet({
        kind: VoiceMediaV2PacketKind.BIND_REQUEST,
        transportSequence: 1,
        streamId,
        payload: encodeVoiceMediaV2BindRequest({ accessToken: "valid-token", roomId, controlConnectionId, platform: 1, clientBuild: "security-test" })
    }));
}

//* این تابع پاسخ دهنده ساختگی را برای بررسی خروجی پل می سازد.
function createResponder() {
    let response = null;
    return Object.freeze({
        respond(value) { response = value; return Promise.resolve(); },
        getResponse() { return response; }
    });
}

//* این تابع سیاست احراز هویت و مجوز روم را با حالت های مثبت و منفی بررسی می کند.
function testAuthorizationPolicy() {
    const packet = createValidBindPacket();
    const request = { controlConnectionId, roomId };
    const tokenResult = { success: true, userId };
    const controlRecord = { connectionId: controlConnectionId, userId, roomId, state: VoiceConnectionState.ACTIVE };
    assert.equal(authorizeVoiceMediaV2Bind({ packet, request, tokenResult, controlRecord }).allowed, true);

    const reconnectPacket = { ...packet, transportSequence: 7, ackTransportSequence: 6, ackMask: 3 };
    assert.equal(authorizeVoiceMediaV2Bind({ packet: reconnectPacket, request, tokenResult, controlRecord }).allowed, true);

    assert.equal(authorizeVoiceMediaControlBind({ controlConnectionId, roomId, tokenResult: { success: false }, controlRecord }).reason, VoiceMediaAuthorizationReason.TOKEN_REJECTED);
    assert.equal(authorizeVoiceMediaControlBind({ controlConnectionId, roomId, tokenResult, controlRecord: null }).reason, VoiceMediaAuthorizationReason.CONTROL_CONNECTION_NOT_FOUND);
    assert.equal(authorizeVoiceMediaControlBind({ controlConnectionId, roomId, tokenResult, controlRecord: { ...controlRecord, connectionId: "33333333-3333-4333-8333-333333333333" } }).reason, VoiceMediaAuthorizationReason.CONTROL_CONNECTION_MISMATCH);
    assert.equal(authorizeVoiceMediaControlBind({ controlConnectionId, roomId, tokenResult, controlRecord: { ...controlRecord, state: VoiceConnectionState.SUSPENDED } }).reason, VoiceMediaAuthorizationReason.CONTROL_CONNECTION_NOT_ACTIVE);
    assert.equal(authorizeVoiceMediaControlBind({ controlConnectionId, roomId, tokenResult: { success: true, userId: "different-user" }, controlRecord }).reason, VoiceMediaAuthorizationReason.USER_MISMATCH);
    assert.equal(authorizeVoiceMediaControlBind({ controlConnectionId, roomId: "different-room", tokenResult, controlRecord }).reason, VoiceMediaAuthorizationReason.ROOM_MISMATCH);

    assert.equal(authorizeVoiceMediaV2Bind({ packet: { ...packet, codec: VoiceMediaV2Codec.OPUS }, request, tokenResult, controlRecord }).reason, VoiceMediaAuthorizationReason.INVALID_BIND_PACKET);
    assert.equal(authorizeVoiceMediaV2Bind({ packet: { ...packet, securityContextId: 7 }, request, tokenResult, controlRecord }).reason, VoiceMediaAuthorizationReason.INVALID_BIND_PACKET);
    assert.equal(authorizeVoiceMediaV2Bind({ packet: { ...packet, transportSequence: 0 }, request, tokenResult, controlRecord }).reason, VoiceMediaAuthorizationReason.INVALID_BIND_PACKET);

    assert.equal(authorizeVoiceMediaBoundControl({ controlConnectionId, userId, roomId, controlRecord }).allowed, true);
    assert.equal(authorizeVoiceMediaBoundControl({ controlConnectionId, userId, roomId, controlRecord: { ...controlRecord, state: VoiceConnectionState.CLOSED } }).reason, VoiceMediaAuthorizationReason.CONTROL_CONNECTION_NOT_ACTIVE);
}

//* این تابع مرز پیش از اتصال و ابطال مجوز را روی رانتایم مستقیم بررسی می کند.
async function testDirectRuntimeAuthorizationBoundary() {
    const controlRecord = { connectionId: controlConnectionId, userId, roomId, state: VoiceConnectionState.ACTIVE };
    const voiceConnectionRegistry = { getByConnectionId(value) { return String(value ?? "").toLowerCase() === controlConnectionId ? controlRecord : null; } };
    const controlGateway = { getConnectionByConnectionId() { return { sendEnvelope() { return Promise.resolve(); } }; } };
    const routingApplication = { setGateway(gateway) { this.gateway = gateway; }, handleVoiceFrame() { return Promise.resolve({ accepted: true }); } };
    const accessTokenVerifier = { async verify(token) { return token === "valid-token" ? { success: true, userId } : { success: false }; } };
    const runtime = createVoiceMediaV2Runtime({ voiceConnectionRegistry, controlGateway, routingApplication, accessTokenVerifier });

    const prebindOut = [];
    const prebindClosed = [];
    const prebind = runtime.acceptConnection({ transportConnectionKey: "security-prebind", sendPacket(packet) { prebindOut.push(packet); }, closeTransport(reason) { prebindClosed.push(reason); } });
    await prebind.receive(encodeVoiceMediaV2Packet({ kind: VoiceMediaV2PacketKind.PING, transportSequence: 1, payload: Buffer.from([1]) }));
    assert.deepEqual(prebindOut, []);
    assert.deepEqual(prebindClosed, ["media_bind_required"]);

    const boundOut = [];
    const boundClosed = [];
    const bound = runtime.acceptConnection({ transportConnectionKey: "security-bound", sendPacket(packet) { boundOut.push(Buffer.from(packet)); }, closeTransport(reason) { boundClosed.push(reason); } });
    await bound.receive(encodeVoiceMediaV2Packet({
        kind: VoiceMediaV2PacketKind.BIND_REQUEST,
        transportSequence: 1,
        streamId,
        payload: encodeVoiceMediaV2BindRequest({ accessToken: "valid-token", roomId, controlConnectionId, platform: 1 })
    }));
    assert.equal(decodeVoiceMediaV2BindResult(decodeVoiceMediaV2Packet(boundOut[0]).payload).success, true);

    controlRecord.state = VoiceConnectionState.SUSPENDED;
    await bound.receive(encodeVoiceMediaV2Packet({ kind: VoiceMediaV2PacketKind.PING, transportSequence: 2, streamId, payload: Buffer.from([2]) }));
    assert.equal(boundOut.length, 1);
    assert.deepEqual(boundClosed, ["media_authorization_revoked"]);
    assert.equal(runtime.getStats().total, 0);

    controlRecord.state = VoiceConnectionState.ACTIVE;
    const rebindOut = [];
    const rebindClosed = [];
    const rebind = runtime.acceptConnection({ transportConnectionKey: "security-rebind", sendPacket(packet) { rebindOut.push(Buffer.from(packet)); }, closeTransport(reason) { rebindClosed.push(reason); } });
    const bindPacket = encodeVoiceMediaV2Packet({
        kind: VoiceMediaV2PacketKind.BIND_REQUEST,
        transportSequence: 3,
        ackTransportSequence: 1,
        streamId,
        payload: encodeVoiceMediaV2BindRequest({ accessToken: "valid-token", roomId, controlConnectionId, platform: 1 })
    });
    await rebind.receive(bindPacket);
    assert.equal(decodeVoiceMediaV2BindResult(decodeVoiceMediaV2Packet(rebindOut[0]).payload).success, true);
    await rebind.receive(bindPacket);
    assert.equal(rebindOut.length, 1);
    assert.deepEqual(rebindClosed, ["media_rebind_rejected"]);
    assert.equal(runtime.getStats().total, 0);
    await runtime.stop();
}

//* این تابع مرز پیش از اتصال را روی رانتایم نود مستقل بررسی می کند.
async function testMediaNodePrebindBoundary() {
    let authorizeCalls = 0;
    const bridgeClient = {
        authorizeBind() { authorizeCalls += 1; return Promise.resolve({ success: false }); },
        routeFrame() { return Promise.resolve({ success: true }); }
    };
    const runtime = createVoiceMediaNodeRuntime({ bridgeClient });
    const pingOut = [];
    const pingClosed = [];
    const prebind = runtime.acceptConnection({ transportConnectionKey: "node-prebind", sendPacket(packet) { pingOut.push(packet); }, closeTransport(reason) { pingClosed.push(reason); } });
    await prebind.receive(encodeVoiceMediaV2Packet({ kind: VoiceMediaV2PacketKind.PING, transportSequence: 1, payload: Buffer.from([3]) }));
    assert.deepEqual(pingOut, []);
    assert.deepEqual(pingClosed, ["media_bind_required"]);
    assert.equal(authorizeCalls, 0);

    const invalidOut = [];
    const invalidClosed = [];
    const invalid = runtime.acceptConnection({ transportConnectionKey: "node-invalid-bind", sendPacket(packet) { invalidOut.push(Buffer.from(packet)); }, closeTransport(reason) { invalidClosed.push(reason); } });
    await invalid.receive(encodeVoiceMediaV2Packet({
        kind: VoiceMediaV2PacketKind.BIND_REQUEST,
        codec: VoiceMediaV2Codec.OPUS,
        transportSequence: 1,
        streamId,
        payload: encodeVoiceMediaV2BindRequest({ accessToken: "valid-token", roomId, controlConnectionId, platform: 1 })
    }));
    assert.equal(decodeVoiceMediaV2BindResult(decodeVoiceMediaV2Packet(invalidOut[0]).payload).success, false);
    assert.deepEqual(invalidClosed, ["media_bind_rejected"]);
    assert.equal(authorizeCalls, 0);
    await runtime.stop();
}

//* این تابع توقف مسیر رسانه را پس از غیرفعال شدن اتصال کنترل در پل بک اند بررسی می کند.
async function testBackendBridgeRevocation() {
    const suspendedRecord = { connectionId: controlConnectionId, userId, roomId, state: VoiceConnectionState.SUSPENDED };
    const voiceConnectionRegistry = { getByConnectionId() { return suspendedRecord; } };
    const controlGateway = { getConnectionByConnectionId() { return { sendEnvelope() { return Promise.resolve(); } }; } };
    const routingApplication = { setGateway(gateway) { this.gateway = gateway; }, handleVoiceFrame() { throw new Error("Revoked media reached routing."); } };
    const accessTokenVerifier = { verify() { return { success: true, userId }; } };
    const backendCore = createVoiceMediaNodeBackendBridgeCore({ routingApplication, controlGateway, voiceConnectionRegistry, accessTokenVerifier });
    const responder = createResponder();
    await backendCore.handlers[VoiceMediaNodeBridgeMessageType.ROUTE_FRAME_REQUEST]({
        requestId: 13,
        metadata: { controlConnectionId, flags: 0, mediaSequence: 1, mediaTimestamp100Ns: "10000", streamId },
        payload: Buffer.from([1, 2, 3])
    }, responder);
    assert.equal(responder.getResponse().metadata.success, false);
    assert.equal(responder.getResponse().metadata.accepted, false);
    assert.equal(responder.getResponse().metadata.error, "media_authorization_revoked");
    backendCore.stop();
}

//* این تابع ابطال مجوز را در هسته خوشه چندنودی بررسی می کند.
async function testClusterBackendRevocation() {
    const controlRecord = { connectionId: controlConnectionId, userId, roomId, state: VoiceConnectionState.ACTIVE };
    const voiceConnectionRegistry = { getByConnectionId(value) { return String(value ?? "").toLowerCase() === controlConnectionId ? controlRecord : null; } };
    const controlGateway = { getConnectionByConnectionId() { return { sendEnvelope() { return Promise.resolve(); } }; } };
    let routedFrames = 0;
    const routingApplication = { setGateway(gateway) { this.gateway = gateway; }, handleVoiceFrame() { routedFrames += 1; return Promise.resolve({ accepted: true }); } };
    const accessTokenVerifier = { verify(token) { return token === "valid-token" ? { success: true, userId } : { success: false }; } };
    const core = createPhase11BackendCore({ routingApplication, controlGateway, voiceConnectionRegistry, accessTokenVerifier });
    const peer = Object.freeze({ closed: false, request() { return Promise.resolve({ metadata: { success: true } }); } });
    core.registerNode({ nodeId: "node-security", region: "eu-central", zone: "de-1", advertiseHost: "127.0.0.1", wsPort: 52001, grpcPort: 52002, peer });
    const resolved = await core.resolveAuthorizedRoomTarget({ accessToken: "valid-token", roomId, controlConnectionId, region: "eu-central", zone: "de-1", transport: "grpc" });
    assert.equal(resolved.success, true);

    controlRecord.state = VoiceConnectionState.SUSPENDED;
    const responder = createResponder();
    const route = core.createHandlers("node-security")[VoiceMediaNodeBridgeMessageType.ROUTE_FRAME_REQUEST];
    await route({
        requestId: 14,
        metadata: { controlConnectionId, flags: 0, mediaSequence: 1, mediaTimestamp100Ns: "10000", streamId },
        payload: Buffer.from([4, 5, 6])
    }, responder);
    assert.equal(responder.getResponse().metadata.success, false);
    assert.equal(responder.getResponse().metadata.error, "media_authorization_revoked");
    assert.equal(routedFrames, 0);
}

//* این تابع همه آزمون های سیاست امنیت رسانه را اجرا می کند.
async function run() {
    testAuthorizationPolicy();
    await testDirectRuntimeAuthorizationBoundary();
    await testMediaNodePrebindBoundary();
    await testBackendBridgeRevocation();
    await testClusterBackendRevocation();
    console.log("VME2_PHASE13_MEDIA_AUTHORIZATION=PASS | tokenBinding=True | userBinding=True | roomAuthorization=True | controlStateRequired=True | reconnectBindAccepted=True | prebindPingRejected=True | rebindRejected=True | reauthorizationOnTraffic=True | dedicatedMediaNodeCovered=True | clusterBackendCovered=True | productionCryptoChanged=False");
}

await run();

/*
توضیح فایل:
این فایل آزمون های مثبت و منفی احراز هویت، مجوز روم و مرز اتصال رسانه را اجرا می کند.
*/
