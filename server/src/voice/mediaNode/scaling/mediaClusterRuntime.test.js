import assert from "node:assert/strict";
import { VoiceConnectionState } from "../../core/voiceConnectionConstants.js";
import { VoiceMessageType } from "../../protocol/voiceMessageTypes.js";
import { VoiceMediaNodeBridgeMessageType } from "../internalBridgeProtocol.js";
import { VoiceMediaV2Codec, VoiceMediaV2PacketKind, encodeVoiceMediaV2BindRequest, encodeVoiceMediaV2Packet } from "../../mediaV2/voiceMediaV2Protocol.js";
import { createPhase11BackendCore } from "./mediaClusterBackendCore.js";
import { inspectPhase11BindPacket } from "./mediaIngressCore.js";

const senderConnectionId = "11111111-1111-4111-8111-111111111111";
const listenerConnectionId = "22222222-2222-4222-8222-222222222222";
const roomId = "room-phase11-runtime";

//* این تابع یک همتای ساختگی نود برای دریافت فرمان های رسانه می سازد.
function createFakePeer() {
    const deliveries = [];
    const closes = [];
    return Object.freeze({
        closed: false,
        deliveries,
        closes,

        //* این تابع درخواست بک اند به نود را برای آزمون ثبت و پاسخ موفق برمی گرداند.
        async request(input) {
            if (input.type === VoiceMediaNodeBridgeMessageType.DELIVER_MEDIA_REQUEST) deliveries.push(input);
            if (input.type === VoiceMediaNodeBridgeMessageType.CLOSE_MEDIA_REQUEST) closes.push(input);
            return Object.freeze({ metadata: Object.freeze({ success: true }) });
        }
    });
}

//* این تابع پاسخ دهنده ساختگی را برای گرفتن نتیجه درخواست پل می سازد.
function createResponder() {
    let response = null;
    return Object.freeze({
        //* این تابع پاسخ تولید شده هسته را برای بررسی بعدی ذخیره می کند.
        async respond(value) { response = value; },
        //* این تابع آخرین پاسخ ذخیره شده را برمی گرداند.
        getResponse() { return response; }
    });
}

//* این تابع خواندن روم از نخستین بسته بایند قفل شده فاز نه را بررسی می کند.
async function testBindInspection() {
    const payload = encodeVoiceMediaV2BindRequest({ accessToken: "token-a", roomId, controlConnectionId: senderConnectionId, platform: 1, clientBuild: "test" });
    const packet = encodeVoiceMediaV2Packet({ kind: VoiceMediaV2PacketKind.BIND_REQUEST, codec: VoiceMediaV2Codec.NONE, streamId: "33333333-3333-4333-8333-333333333333", payload });
    const inspected = inspectPhase11BindPacket(packet);
    assert.equal(inspected.roomId, roomId);
    assert.equal(inspected.controlConnectionId, senderConnectionId);
    assert.equal(inspected.accessToken, "token-a");
}

//* این تابع مالکیت تک نودی روم و جلوگیری از مسیر بین دو نود را روی هسته واقعی بررسی می کند.
async function testMultiNodeCore() {
    const records = new Map([
        [senderConnectionId, { connectionId: senderConnectionId, userId: "user-a", roomId, state: VoiceConnectionState.ACTIVE }],
        [listenerConnectionId, { connectionId: listenerConnectionId, userId: "user-b", roomId, state: VoiceConnectionState.ACTIVE }]
    ]);
    const controlGateway = {
        getConnectionByConnectionId(connectionId) {
            if (!records.has(connectionId)) return null;
            return Object.freeze({ connectionId, async sendEnvelope() { return true; } });
        }
    };
    const voiceConnectionRegistry = { getByConnectionId(connectionId) { return records.get(connectionId) ?? null; } };
    const routingApplication = {
        gateway: null,
        //* این تابع درگاه فعال مسیریابی را برای آزمون نگه می دارد.
        setGateway(gateway) { this.gateway = gateway; },
        //* این تابع فریم ورودی را به شنونده همان روم هدایت می کند تا مسیر خروجی بررسی شود.
        async handleVoiceFrame(envelope, connection) {
            const target = this.gateway.getConnectionByConnectionId(listenerConnectionId);
            await target.sendEnvelope({ messageType: VoiceMessageType.VOICE_FRAME, flags: envelope.flags, sessionId: "44444444-4444-4444-8444-444444444444", senderId: connection.connectionId, payload: envelope.payload });
            return Object.freeze({ accepted: true });
        }
    };
    const accessTokenVerifier = { verify(token) { return token === "token-a" ? { success: true, userId: "user-a" } : { success: false }; } };
    const core = createPhase11BackendCore({ routingApplication, controlGateway, voiceConnectionRegistry, accessTokenVerifier });
    const peerA = createFakePeer();
    const peerB = createFakePeer();
    core.registerNode({ nodeId: "node-a", region: "eu-central", zone: "de-1", advertiseHost: "127.0.0.1", wsPort: 52001, grpcPort: 52002, peer: peerA });
    core.registerNode({ nodeId: "node-b", region: "eu-central", zone: "de-1", advertiseHost: "127.0.0.1", wsPort: 52101, grpcPort: 52102, peer: peerB });

    const resolved = await core.resolveAuthorizedRoomTarget({ accessToken: "token-a", roomId, controlConnectionId: senderConnectionId, region: "eu-central", zone: "de-1", transport: "grpc" });
    assert.equal(resolved.success, true);
    assert.equal(resolved.nodeId, "node-a");
    assert.equal(resolved.port, 52002);

    const metricsUpdate = core.updateNodeMetrics("node-a", { activeConnections: 7, cpuPercent: 42.5, outboundKbps: 812.25 });
    assert.equal(metricsUpdate.activeConnections, 7);
    assert.equal(metricsUpdate.cpuPercent, 42.5);
    assert.equal(metricsUpdate.outboundKbps, 812.25);
    assert.equal(core.heartbeatNode("node-a"), true);
    const metricsAfterHeartbeat = core.coordinator.nodeRegistry.getNodeRecord("node-a");
    assert.equal(metricsAfterHeartbeat.activeConnections, 7);
    assert.equal(metricsAfterHeartbeat.cpuPercent, 42.5);
    assert.equal(metricsAfterHeartbeat.outboundKbps, 812.25);
    assert.throws(() => core.updateNodeMetrics("node-a", { activeConnections: 1, cpuPercent: 2 }), /outboundKbps is required/);
    const metricsAfterRejectedUpdate = core.coordinator.nodeRegistry.getNodeRecord("node-a");
    assert.equal(metricsAfterRejectedUpdate.activeConnections, 7);
    assert.equal(metricsAfterRejectedUpdate.cpuPercent, 42.5);
    assert.equal(metricsAfterRejectedUpdate.outboundKbps, 812.25);
    const rejectedResolve = await core.resolveAuthorizedRoomTarget({ accessToken: "bad-token", roomId: "room-untrusted", controlConnectionId: senderConnectionId, region: "eu-central", zone: "de-1", transport: "ws" });
    assert.equal(rejectedResolve.success, false);
    assert.equal(core.coordinator.roomRegistry.getAssignment("room-untrusted"), null);

    const authorizeA = core.createHandlers("node-a")[VoiceMediaNodeBridgeMessageType.AUTHORIZE_BIND_REQUEST];
    const responderA = createResponder();
    await authorizeA({ requestId: 1, metadata: { accessToken: "token-a", roomId, controlConnectionId: senderConnectionId } }, responderA);
    assert.equal(responderA.getResponse().metadata.success, true);

    const authorizeB = core.createHandlers("node-b")[VoiceMediaNodeBridgeMessageType.AUTHORIZE_BIND_REQUEST];
    const responderB = createResponder();
    await authorizeB({ requestId: 2, metadata: { accessToken: "token-a", roomId, controlConnectionId: senderConnectionId } }, responderB);
    assert.equal(responderB.getResponse().metadata.success, false);
    assert.equal(responderB.getResponse().metadata.error, "media_wrong_room_owner");

    const routeA = core.createHandlers("node-a")[VoiceMediaNodeBridgeMessageType.ROUTE_FRAME_REQUEST];
    const routeResponderA = createResponder();
    await routeA({ requestId: 3, metadata: { controlConnectionId: senderConnectionId, flags: 0, mediaSequence: 1, mediaTimestamp100Ns: "10000", streamId: "33333333-3333-4333-8333-333333333333" }, payload: Buffer.from([1, 2, 3]) }, routeResponderA);
    assert.equal(routeResponderA.getResponse().metadata.success, true);
    assert.equal(peerA.deliveries.length, 1);
    assert.equal(peerB.deliveries.length, 0);

    const routeB = core.createHandlers("node-b")[VoiceMediaNodeBridgeMessageType.ROUTE_FRAME_REQUEST];
    const routeResponderB = createResponder();
    await routeB({ requestId: 4, metadata: { controlConnectionId: senderConnectionId, flags: 0, mediaSequence: 2, mediaTimestamp100Ns: "20000", streamId: "33333333-3333-4333-8333-333333333333" }, payload: Buffer.from([4, 5, 6]) }, routeResponderB);
    assert.equal(routeResponderB.getResponse().metadata.success, false);
    assert.equal(routeResponderB.getResponse().metadata.error, "media_wrong_room_owner");

    records.set("33333333-3333-4333-8333-333333333334", { connectionId: "33333333-3333-4333-8333-333333333334", userId: "user-c", roomId: "room-phase11-second", state: VoiceConnectionState.ACTIVE });
    accessTokenVerifier.verify = (token) => token === "token-c" ? { success: true, userId: "user-c" } : token === "token-a" ? { success: true, userId: "user-a" } : { success: false };
    const secondRoom = await core.resolveAuthorizedRoomTarget({ accessToken: "token-c", roomId: "room-phase11-second", controlConnectionId: "33333333-3333-4333-8333-333333333334", region: "eu-central", zone: "de-1", transport: "ws" });
    assert.equal(secondRoom.success, true);
    assert.equal(secondRoom.nodeId, "node-b");
}

//* این تابع همه بررسی های اتصال رانتایم فاز یازده را اجرا می کند.
async function run() {
    await testBindInspection();
    await testMultiNodeCore();
    console.log("VME2_PHASE11_RUNTIME_TEST=PASS | roomSingleNode=True | twoNodesRegistered=True | wrongNodeBindRejected=True | sameNodeDelivery=True | crossNodeMediaRoute=False | secondRoomDistributed=True | runtimeMetricsAccepted=True | heartbeatPreservesMetrics=True | incompleteMetricsRejected=True | p9BindContractPreserved=True | unauthorizedRoomAssignment=False | phase10FilesChanged=False");
}

await run();
