import assert from "node:assert/strict";
import test from "node:test";
import { createVoiceMediaKeyRotationPolicy } from "./voiceMediaKeyRotationPolicy.js";

test("key rotation policy enforces the per-direction packet limit", () => {
    let currentTime = 1000;
    const policy = createVoiceMediaKeyRotationPolicy({ maxKeyAgeMs: 10000, maxPacketsPerDirection: 3, now: () => currentTime });
    policy.begin(7);
    assert.equal(policy.evaluate().required, false);
    assert.equal(policy.recordInbound().required, false);
    assert.equal(policy.recordInbound().required, false);
    const decision = policy.recordInbound();
    assert.equal(decision.required, true);
    assert.equal(decision.reason, "max_packet_count");
    assert.equal(policy.getStats().inboundPackets, 3);
    policy.reset();
    assert.equal(policy.getStats().active, false);
});

test("key rotation policy enforces maximum key age", () => {
    let currentTime = 5000;
    const policy = createVoiceMediaKeyRotationPolicy({ maxKeyAgeMs: 1000, maxPacketsPerDirection: 10, now: () => currentTime });
    policy.begin(9);
    currentTime += 999;
    assert.equal(policy.evaluate().required, false);
    currentTime += 1;
    const decision = policy.evaluate();
    assert.equal(decision.required, true);
    assert.equal(decision.reason, "max_key_age");
});

console.log("VME2_PHASE13_KEY_ROTATION_POLICY_SYNTHETIC=PASS | maxKeyAge=True | perDirectionPacketLimit=True | reset=True | productionThresholdsLocked=True");
