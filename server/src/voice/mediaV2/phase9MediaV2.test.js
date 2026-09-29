import assert from "node:assert/strict";
import { VoiceConnectionState } from "../core/voiceConnectionConstants.js";
import { VoiceMessageType } from "../protocol/voiceMessageTypes.js";
import {
    VoiceMediaV2Codec,
    VoiceMediaV2Constants,
    VoiceMediaV2PacketKind,
    decodeVoiceMediaV2BindResult,
    decodeVoiceMediaV2Packet,
    encodeVoiceMediaV2BindRequest,
    encodeVoiceMediaV2Packet
} from "./voiceMediaV2Protocol.js";
import { createVoiceMediaV2Runtime } from "./voiceMediaV2Runtime.js";

const senderConnectionId = "11111111-1111-4111-8111-111111111111";
const listenerConnectionId = "22222222-2222-4222-8222-222222222222";
const senderStreamId = "33333333-3333-4333-8333-333333333333";
const listenerStreamId = "44444444-4444-4444-8444-444444444444";
const sessionId = "55555555-5555-4555-8555-555555555555";
const roomId = "room_public_lobby_main";

//* این تابع یک رجیستری کنترل کوچک برای آزمون جداسازی مسیر کنترل و رسانه می سازد.
function createControlRegistry() {
    const records = new Map([
        [senderConnectionId, { connectionId: senderConnectionId, userId: "sender-user", roomId, state: VoiceConnectionState.ACTIVE, clientInstanceId: senderStreamId }],
        [listenerConnectionId, { connectionId: listenerConnectionId, userId: "listener-user", roomId, state: VoiceConnectionState.ACTIVE, clientInstanceId: listenerStreamId }]
    ]);
    return { getByConnectionId(connectionId) { return records.get(String(connectionId).toLowerCase()) ?? null; } };
}

//* این تابع آزمون کامل مسیر رسانه را با احراز، ورود فریم و خروج جدا از مسیر کنترل اجرا می کند.
async function run() {
    const voiceConnectionRegistry = createControlRegistry();
    const controlSent = [];
    const controlGateway = {
        getConnectionByConnectionId(connectionId) {
            if (!voiceConnectionRegistry.getByConnectionId(connectionId)) return null;
            return {
                sendEnvelope(input) { controlSent.push({ connectionId, input }); return Promise.resolve(); }
            };
        }
    };
    const routingApplication = {
        gateway: controlGateway,
        setGateway(gateway) { this.gateway = gateway; },
        async handleVoiceFrame(envelope, transportConnection) {
            assert.equal(transportConnection.connectionId, senderConnectionId);
            const listener = this.gateway.getConnectionByConnectionId(listenerConnectionId);
            await listener.sendEnvelope({
                messageType: VoiceMessageType.VOICE_FRAME,
                flags: envelope.flags,
                sessionId,
                senderId: senderConnectionId,
                payload: envelope.payload
            });
        }
    };
    const accessTokenVerifier = {
        verify(token) {
            if (token === "sender-token") return { success: true, userId: "sender-user" };
            if (token === "listener-token") return { success: true, userId: "listener-user" };
            return { success: false, userId: "" };
        }
    };
    const runtime = createVoiceMediaV2Runtime({ voiceConnectionRegistry, accessTokenVerifier, routingApplication, controlGateway });
    const senderOut = [];
    const listenerOut = [];
    const sender = runtime.acceptConnection({ transportConnectionKey: "sender-media", sendPacket(packet) { senderOut.push(Buffer.from(packet)); }, closeTransport() {} });
    const listener = runtime.acceptConnection({ transportConnectionKey: "listener-media", sendPacket(packet) { listenerOut.push(Buffer.from(packet)); }, closeTransport() {} });

    await sender.receive(encodeVoiceMediaV2Packet({
        kind: VoiceMediaV2PacketKind.BIND_REQUEST,
        transportSequence: 1,
        streamId: senderStreamId,
        payload: encodeVoiceMediaV2BindRequest({ accessToken: "sender-token", roomId, controlConnectionId: senderConnectionId, platform: 1 })
    }));
    await listener.receive(encodeVoiceMediaV2Packet({
        kind: VoiceMediaV2PacketKind.BIND_REQUEST,
        transportSequence: 1,
        streamId: listenerStreamId,
        payload: encodeVoiceMediaV2BindRequest({ accessToken: "listener-token", roomId, controlConnectionId: listenerConnectionId, platform: 1 })
    }));

    assert.equal(decodeVoiceMediaV2BindResult(decodeVoiceMediaV2Packet(senderOut[0]).payload).success, true);
    assert.equal(decodeVoiceMediaV2BindResult(decodeVoiceMediaV2Packet(listenerOut[0]).payload).success, true);

    const opus = Buffer.from([1, 2, 3, 4, 5, 6]);
    await sender.receive(encodeVoiceMediaV2Packet({
        kind: VoiceMediaV2PacketKind.MEDIA,
        codec: VoiceMediaV2Codec.OPUS,
        transportSequence: 2,
        mediaSequence: 77,
        mediaTimestamp100Ns: 15400000n,
        streamId: senderStreamId,
        payload: opus
    }));

    assert.equal(listenerOut.length, 2);
    const routed = decodeVoiceMediaV2Packet(listenerOut[1]);
    assert.equal(routed.kind, VoiceMediaV2PacketKind.MEDIA);
    assert.equal(routed.codec, VoiceMediaV2Codec.OPUS);
    assert.equal(routed.mediaSequence, 77);
    assert.equal(routed.mediaTimestamp100Ns, 15400000n);
    assert.equal(routed.sessionId, sessionId);
    assert.equal(routed.streamId, senderStreamId);
    assert.equal(routed.senderId, senderConnectionId);
    assert.deepEqual(routed.payload, opus);

    const listenerFacade = routingApplication.gateway.getConnectionByConnectionId(listenerConnectionId);
    await listenerFacade.sendEnvelope({ messageType: VoiceMessageType.ACK, payload: Buffer.from([9]) });
    assert.equal(controlSent.length, 1);
    assert.equal(controlSent[0].input.messageType, VoiceMessageType.ACK);

    assert.throws(() => encodeVoiceMediaV2Packet({ kind: VoiceMediaV2PacketKind.MEDIA, codec: VoiceMediaV2Codec.OPUS, payload: Buffer.alloc(VoiceMediaV2Constants.maximumPayloadBytes + 1) }));
    assert.equal(runtime.getStats().bound, 2);
    await runtime.stop();
    console.log("VME2_PHASE9_SERVER_TEST=PASS | controlMediaSeparated=True | mtuEnforced=True | routedSequence=77 | routedTimestamp100Ns=15400000");
}

await run();
