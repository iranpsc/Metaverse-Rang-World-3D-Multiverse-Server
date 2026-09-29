import assert from "node:assert/strict";
import test from "node:test";
import { VoiceMediaFloodDropReason, VoiceMediaFloodProtectionDefaultPolicy, createVoiceMediaFloodProtectionPolicy } from "./voiceMediaFloodProtectionPolicy.js";
import { createVoiceMediaFloodProtectionRuntimeAdapter } from "./voiceMediaFloodProtectionRuntimeAdapter.js";

test("flood policy enforces the locked Media V2 packet, byte, rate and burst limits", () => {
    let currentTime = 0;
    const burstPolicy = createVoiceMediaFloodProtectionPolicy({ now: () => currentTime });
    for (let index = 0; index < 25; index += 1) assert.equal(burstPolicy.inspect(88).accepted, true);
    assert.equal(burstPolicy.inspect(88).reason, VoiceMediaFloodDropReason.BURST);
    currentTime = 100;
    assert.equal(burstPolicy.inspect(88).accepted, true);

    currentTime = 0;
    const ratePolicy = createVoiceMediaFloodProtectionPolicy({ now: () => currentTime });
    for (let index = 0; index < 100; index += 1) {
        currentTime = Math.floor(index / 25) * 100;
        assert.equal(ratePolicy.inspect(88).accepted, true);
    }
    currentTime = 400;
    assert.equal(ratePolicy.inspect(88).reason, VoiceMediaFloodDropReason.PACKET_RATE);

    const bytePolicy = createVoiceMediaFloodProtectionPolicy({ maxBytesPerSecond: 10, maxBurstPackets: 25, now: () => 0 });
    assert.equal(bytePolicy.inspect(6).accepted, true);
    assert.equal(bytePolicy.inspect(6).reason, VoiceMediaFloodDropReason.BYTE_RATE);
    assert.equal(bytePolicy.inspect(0).reason, VoiceMediaFloodDropReason.INVALID_PACKET);
    assert.equal(bytePolicy.inspect(VoiceMediaFloodProtectionDefaultPolicy.maximumPacketBytes + 1).reason, VoiceMediaFloodDropReason.PACKET_TOO_LARGE);
});

test("runtime adapter drops a flood before the protected runtime and cleans connection state", async () => {
    let currentTime = 0;
    let innerReceived = 0;
    let innerClosed = 0;
    const transportCloseReasons = [];
    const runtime = {
        mediaRegistry: {},
        acceptConnection(input) {
            return Object.freeze({
                connection: Object.freeze({ transportConnectionKey: input.transportConnectionKey }),
                async receive() { innerReceived += 1; },
                async closed(reason) {
                    innerClosed += 1;
                    await input.closeTransport(reason);
                }
            });
        },
        async deliverMedia() {},
        async closeMedia() { return false; },
        async stop() {},
        getStats() { return Object.freeze({ bound: 0 }); },
        sampleTelemetry() { return Object.freeze({ activeConnections: 0 }); }
    };
    const adapter = createVoiceMediaFloodProtectionRuntimeAdapter({
        runtime,
        createPolicy: () => createVoiceMediaFloodProtectionPolicy({ now: () => currentTime })
    });
    const accepted = adapter.acceptConnection({
        transportConnectionKey: "flood-test",
        async sendPacket() {},
        async closeTransport(reason) { transportCloseReasons.push(reason); }
    });
    for (let index = 0; index < 25; index += 1) await accepted.receive(Buffer.alloc(88));
    await accepted.receive(Buffer.alloc(88));

    assert.equal(innerReceived, 25);
    assert.equal(innerClosed, 1);
    assert.deepEqual(transportCloseReasons, ["media_flood_burst"]);
    assert.equal(adapter.getStats().floodProtection.activeConnections, 0);
    assert.equal(adapter.getStats().floodProtection.closedFloodConnections, 1);
    assert.equal(adapter.getStats().floodProtection.droppedPacketsByReason.burst, 1);
    assert.equal(typeof adapter.sampleTelemetry, "function");

    currentTime = 1000;
    const fresh = adapter.acceptConnection({ transportConnectionKey: "fresh-test", async sendPacket() {}, async closeTransport() {} });
    await fresh.receive(Buffer.alloc(88));
    assert.equal(innerReceived, 26);
    await fresh.closed("test_complete");
    assert.equal(adapter.getStats().floodProtection.activeConnections, 0);
});

console.log("VME2_PHASE13_FLOOD_PROTECTION_SYNTHETIC=PASS | packetRate=True | byteRate=True | burst=True | mtu=True | preCryptoDrop=True | connectionClosed=True | stateCleanup=True | productionThresholdsLocked=True | productionEnabled=False");
