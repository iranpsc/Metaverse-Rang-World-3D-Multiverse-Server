import assert from "node:assert/strict";
import { test } from "node:test";
import { createVoiceMediaBurstSafeRuntimeAdapter } from "./voiceMediaBurstSafeRuntimeAdapter.js";

function createHarness() {
    let nowMs = 0;
    const registry = new Map();
    const frames = [];
    const closeReasons = [];
    let stopped = false;
    const baseRuntime = {
        mediaRegistry: registry,
        acceptConnection({ transportConnectionKey, closeTransport }) {
            const connection = { transportConnectionKey, active: true, closed: false };
            registry.set(transportConnectionKey, connection);
            return {
                connection,
                async receive(packet) { frames.push(packet); },
                async closed(reason) {
                    if (connection.closed) return;
                    connection.closed = true;
                    registry.delete(transportConnectionKey);
                    closeReasons.push(reason);
                    await closeTransport(reason);
                }
            };
        },
        async deliverMedia({ listenerConnectionId }) {
            const connection = registry.get(listenerConnectionId);
            if (!connection || connection.closed || !connection.active) throw new Error("Voice media plane is not bound for the listener.");
            return true;
        },
        async closeMedia(id) { registry.delete(id); },
        async stop() { stopped = true; registry.clear(); },
        getStats() { return { stopped, activeBindings: registry.size }; }
    };
    const logs = [];
    const runtime = createVoiceMediaBurstSafeRuntimeAdapter({
        runtime: baseRuntime,
        now: () => nowMs,
        logger: { warn(marker, data) { logs.push({ marker, ...data }); } }
    });
    function connect(key = "user-a") {
        const transportCloses = [];
        const accepted = runtime.acceptConnection({
            transportConnectionKey: key,
            sendPacket: async () => {},
            closeTransport: (reason) => transportCloses.push(reason)
        });
        return { accepted, transportCloses };
    }
    return { runtime, frames, closeReasons, logs, connect, setTime: (v) => { nowMs = v; }, registry, isStopped: () => stopped };
}

test("isolated burst is dropped, media binding and delivery remain valid", async () => {
    const h = createHarness();
    const { accepted, transportCloses } = h.connect();
    for (let i = 0; i < 26; i++) await accepted.receive(Buffer.alloc(200));
    assert.equal(h.frames.length, 25);
    assert.equal(h.runtime.getStats().floodProtection.burstPacketsDroppedWithoutClosing, 1);
    assert.equal(h.runtime.getStats().floodProtection.activeConnections, 1);
    assert.deepEqual(transportCloses, []);
    assert.equal(await h.runtime.deliverMedia({ listenerConnectionId: "user-a" }), true);
    h.setTime(120);
    await accepted.receive(Buffer.alloc(200));
    assert.equal(h.frames.length, 26);
    await accepted.closed("client_closed");
    assert.equal(h.runtime.getStats().floodProtection.activeConnections, 0);
});

test("raw packet limit includes burst drops and closes sustained flooding", async () => {
    const h = createHarness();
    const { accepted, transportCloses } = h.connect();
    for (let i = 0; i < 101; i++) await accepted.receive(Buffer.alloc(200));
    assert.equal(h.frames.length, 25);
    assert.deepEqual(transportCloses, ["media_flood_packet_rate"]);
    assert.equal(h.runtime.getStats().floodProtection.activeConnections, 0);
    assert.equal(h.runtime.getStats().floodProtection.closedFloodConnections, 1);
    assert.equal(h.runtime.getStats().floodProtection.droppedPacketsByReason.packet_rate, 1);
    assert.equal(h.runtime.getStats().floodProtection.droppedPacketsByReason.burst, 75);
});

test("oversized packet still closes media connection", async () => {
    const h = createHarness();
    const { accepted, transportCloses } = h.connect();
    await accepted.receive(Buffer.alloc(1201));
    assert.deepEqual(transportCloses, ["media_flood_packet_too_large"]);
    assert.equal(h.runtime.getStats().floodProtection.activeConnections, 0);
});

test("invalid packets still close media connection", async () => {
    const h = createHarness();
    const { accepted, transportCloses } = h.connect();
    await accepted.receive(Buffer.alloc(0));
    assert.deepEqual(transportCloses, ["media_flood_invalid_packet"]);
});

test("burst accounting is independent per connection and shutdown clears state", async () => {
    const h = createHarness();
    const a = h.connect("a").accepted;
    const b = h.connect("b").accepted;
    for (let i = 0; i < 26; i++) await a.receive(Buffer.alloc(200));
    await b.receive(Buffer.alloc(200));
    assert.equal(h.frames.length, 26);
    assert.equal(h.runtime.getStats().floodProtection.activeConnections, 2);
    await h.runtime.stop();
    assert.equal(h.runtime.getStats().floodProtection.activeConnections, 0);
    assert.equal(h.isStopped(), true);
});

test("clock regression closes media connection rather than disabling checks", async () => {
    const h = createHarness();
    const { accepted, transportCloses } = h.connect();
    h.setTime(200);
    await accepted.receive(Buffer.alloc(100));
    h.setTime(100);
    await accepted.receive(Buffer.alloc(100));
    assert.deepEqual(transportCloses, ["media_flood_invalid_clock"]);
});

test("real media node retains listener binding and sends after isolated burst", async () => {
    const { createVoiceMediaNodeRuntime } = await import("../mediaNode/mediaNodeRuntime.js");
    const {
        VoiceMediaV2PacketKind,
        VoiceMediaV2Codec,
        encodeVoiceMediaV2Packet,
        encodeVoiceMediaV2BindRequest,
        decodeVoiceMediaV2Packet
    } = await import("../mediaV2/voiceMediaV2Protocol.js");
    const connectionId = "11111111-1111-4111-8111-111111111111";
    const streamId = "22222222-2222-4222-8222-222222222222";
    const sessionId = "33333333-3333-4333-8333-333333333333";
    const senderId = "44444444-4444-4444-8444-444444444444";
    const sent = [];
    const transportCloses = [];
    let nowMs = 0;
    const core = createVoiceMediaNodeRuntime({
        bridgeClient: {
            async authorizeBind() { return { success: true, controlConnectionId: connectionId, userId: "u1", roomId: "r1" }; },
            async routeFrame() { return { success: true }; }
        }
    });
    const runtime = createVoiceMediaBurstSafeRuntimeAdapter({ runtime: core, now: () => nowMs });
    const accepted = runtime.acceptConnection({
        transportConnectionKey: "live-equivalent-transport",
        sendPacket(packet) { sent.push(Buffer.from(packet)); },
        closeTransport(reason) { transportCloses.push(reason); }
    });
    await accepted.receive(encodeVoiceMediaV2Packet({
        kind: VoiceMediaV2PacketKind.BIND_REQUEST,
        streamId,
        transportSequence: 1,
        payload: encodeVoiceMediaV2BindRequest({ accessToken: "test-token", roomId: "r1", controlConnectionId: connectionId, platform: 1 })
    }));
    assert.equal(accepted.connection.active, true);
    for (let i = 0; i < 25; i++) {
        await accepted.receive(encodeVoiceMediaV2Packet({
            kind: VoiceMediaV2PacketKind.PING,
            streamId,
            transportSequence: i + 2,
            payload: Buffer.from([i])
        }));
    }
    assert.equal(runtime.getStats().floodProtection.burstPacketsDroppedWithoutClosing, 1);
    assert.deepEqual(transportCloses, []);
    assert.equal(runtime.mediaRegistry.getByControlConnectionId(connectionId)?.active, true);
    nowMs = 120;
    await runtime.deliverMedia({
        listenerConnectionId: connectionId,
        sessionId,
        streamId,
        senderId,
        payload: Buffer.from([12, 13, 14]),
        mediaSequence: 7,
        mediaTimestamp100Ns: "200000"
    });
    const finalPacket = decodeVoiceMediaV2Packet(sent.at(-1));
    assert.equal(finalPacket.kind, VoiceMediaV2PacketKind.MEDIA);
    assert.deepEqual(finalPacket.payload, Buffer.from([12, 13, 14]));
    await accepted.closed("test_complete");
    assert.equal(runtime.getStats().floodProtection.activeConnections, 0);
});
