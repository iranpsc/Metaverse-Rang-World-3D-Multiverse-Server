import assert from "node:assert/strict";
import { VoiceCapacityController } from "../capacity/voiceCapacityController.js";
import { VoiceOperationalMetrics } from "../observability/voiceOperationalMetrics.js";
import { VoiceSecurityAuditLogger } from "../security/voiceSecurityAuditLogger.js";

let clock = 1000;
const metrics = new VoiceOperationalMetrics({ now: () => clock });
metrics.increment("accepted_frames", 25);
metrics.increment("dropped_frames", 2);
metrics.setGauge("active_sessions", 7);
metrics.observeRouteLatency(8);
metrics.observeRouteLatency(700);
clock += 500;
const snapshot = metrics.getSnapshot();
assert.equal(snapshot.counters.accepted_frames, 25);
assert.equal(snapshot.gauges.active_sessions, 7);
assert.equal(snapshot.routeLatencyMs.buckets[10], 1);
assert.equal(snapshot.routeLatencyMs.buckets[1000], 1);

const written = [];
const audit = new VoiceSecurityAuditLogger({
    logger: { info: (label, entry) => written.push({ label, entry }) }
});
const safe = audit.write({
    event: "auth",
    success: true,
    userId: "user-v7",
    accessToken: "must-not-be-logged",
    payload: Buffer.from([1, 2, 3])
});
assert.equal(safe.accessToken, undefined);
assert.equal(safe.payload, undefined);
assert.equal(audit.getStats().rejectedFields, 2);
assert.equal(written.length, 1);

const capacity = new VoiceCapacityController({
    policy: { maximumConnections: 3 }
});
assert.equal(capacity.evaluate({ totalConnections: 2 }).allowed, true);
assert.equal(capacity.evaluate({ totalConnections: 3 }).allowed, false);

console.log("VOICE_V7_OPERATIONAL_METRICS=PASS");
console.log("VOICE_V7_SECURITY_AUDIT_REDACTION=PASS");
console.log("VOICE_V7_CAPACITY_LIMITS=PASS");
console.log("VOICE_V7_ALL_TESTS=PASS");

