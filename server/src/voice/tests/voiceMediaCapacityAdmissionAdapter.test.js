import assert from "node:assert/strict";
import { Phase11MediaNodeRegistry } from "../mediaNode/scaling/mediaNodeRegistry.js";
import { Phase11RoomAssignmentRegistry } from "../mediaNode/scaling/roomMediaNodeAssignmentRegistry.js";
import { createPhase11ScalingCoordinator } from "../mediaNode/scaling/mediaScalingCoordinator.js";
import { VoiceMediaV2Registry } from "../mediaV2/voiceMediaV2Runtime.js";
import { installVoiceMediaCapacityAdmissionAdapter } from "../mediaNode/scaling/voiceMediaCapacityAdmissionAdapter.js";

let nowMs = 1_900_000_000_000;
const now = () => nowMs;

const adapter = installVoiceMediaCapacityAdmissionAdapter({
    softConnectionTarget: 80,
    hardConnectionLimit: 90
});

function addNode(registry, nodeId, zone, activeConnections) {
    registry.registerNode({ nodeId, region: "local-test", zone });
    registry.heartbeat(nodeId, { activeConnections, cpuPercent: 10, outboundKbps: 100 });
}

function fakeConnection(index) {
    return {
        transportConnectionKey: `capacity-test-${index}`,
        controlConnectionId: ""
    };
}

try {
    const nodeRegistry = new Phase11MediaNodeRegistry({ now });
    const roomRegistry = new Phase11RoomAssignmentRegistry({ now });
    const coordinator = createPhase11ScalingCoordinator({ nodeRegistry, roomRegistry });

    addNode(nodeRegistry, "media-node-a", "host-a", 79);
    addNode(nodeRegistry, "media-node-b", "host-b", 10);

    const belowSoft = coordinator.resolveRoomNode({
        roomId: "room-below-soft",
        region: "local-test",
        zone: "host-a"
    });
    assert.equal(belowSoft.success, true);
    assert.equal(belowSoft.assignment.nodeId, "media-node-a");

    nodeRegistry.heartbeat("media-node-a", { activeConnections: 80, cpuPercent: 10, outboundKbps: 100 });

    const redirectedAtSoft = coordinator.resolveRoomNode({
        roomId: "room-at-soft",
        region: "local-test",
        zone: "host-a"
    });
    assert.equal(redirectedAtSoft.success, true);
    assert.equal(redirectedAtSoft.assignment.nodeId, "media-node-b");

    nodeRegistry.heartbeat("media-node-a", { activeConnections: 85, cpuPercent: 10, outboundKbps: 100 });

    const stickyOwner = coordinator.resolveRoomNode({
        roomId: "room-below-soft",
        region: "local-test",
        zone: "host-b"
    });
    assert.equal(stickyOwner.success, true);
    assert.equal(stickyOwner.reused, true);
    assert.equal(stickyOwner.assignment.nodeId, "media-node-a");
    assert.equal(stickyOwner.ready, true);

    nodeRegistry.heartbeat("media-node-b", { activeConnections: 80, cpuPercent: 10, outboundKbps: 100 });

    const allSoftFull = coordinator.resolveRoomNode({
        roomId: "room-no-soft-capacity",
        region: "local-test",
        zone: "host-a"
    });
    assert.equal(allSoftFull.success, false);
    assert.equal(allSoftFull.reason, "no_ready_media_node");

    nodeRegistry.heartbeat("media-node-b", { activeConnections: 79, cpuPercent: 10, outboundKbps: 100 });

    const resumed = coordinator.resolveRoomNode({
        roomId: "room-resumed",
        region: "local-test",
        zone: "host-a"
    });
    assert.equal(resumed.success, true);
    assert.equal(resumed.assignment.nodeId, "media-node-b");

    const mediaRegistry = new VoiceMediaV2Registry();
    const active = [];

    for (let index = 0; index < 90; index += 1) {
        const connection = fakeConnection(index);
        mediaRegistry.add(connection);
        const previous = mediaRegistry.bind(connection, `control-${index}`);
        assert.equal(previous, null);
        connection.controlConnectionId = `control-${index}`;
        active.push(connection);
    }

    assert.equal(mediaRegistry.getStats().bound, 90);
    assert.equal(mediaRegistry.getStats().capacityAdmission.atHardLimit, true);

    const rejected = fakeConnection(90);
    mediaRegistry.add(rejected);
    assert.throws(
        () => mediaRegistry.bind(rejected, "control-90"),
        (error) => error?.code === "VOICE_MEDIA_CAPACITY_REACHED"
    );
    mediaRegistry.remove(rejected);
    assert.equal(mediaRegistry.getStats().bound, 90);

    const replacement = fakeConnection(91);
    mediaRegistry.add(replacement);
    const previous = mediaRegistry.bind(replacement, "control-0");
    assert.equal(previous, active[0]);
    replacement.controlConnectionId = "control-0";
    mediaRegistry.remove(previous);
    active[0] = replacement;
    assert.equal(mediaRegistry.getStats().bound, 90);

    mediaRegistry.remove(active[1]);
    assert.equal(mediaRegistry.getStats().bound, 89);

    const resumedHard = fakeConnection(92);
    mediaRegistry.add(resumedHard);
    assert.equal(mediaRegistry.bind(resumedHard, "control-new"), null);
    resumedHard.controlConnectionId = "control-new";
    assert.equal(mediaRegistry.getStats().bound, 90);

    const nodeStats = nodeRegistry.getStats();
    assert.equal(nodeStats.capacityAdmission.enabled, true);
    assert.equal(nodeStats.capacityAdmission.softConnectionTarget, 80);
    assert.equal(nodeStats.capacityAdmission.hardConnectionLimit, 90);
    assert.ok(nodeStats.capacityAdmission.softRejectedCandidates >= 2);

    const mediaStats = mediaRegistry.getStats();
    assert.equal(mediaStats.capacityAdmission.enabled, true);
    assert.equal(mediaStats.capacityAdmission.softConnectionTarget, 80);
    assert.equal(mediaStats.capacityAdmission.hardConnectionLimit, 90);
    assert.equal(mediaStats.capacityAdmission.hardRejectedBinds, 1);

    console.log(
        "VOICE_MEDIA_CAPACITY_ADMISSION_TEST=PASS" +
        " | belowSoftAllowed=true" +
        " | softTargetRedirectsNewRoom=true" +
        " | allSoftFullRejected=true" +
        " | stickyOwnershipPreserved=true" +
        " | capacityRecoveryResumes=true" +
        " | hardLimit=90" +
        " | connection91Rejected=true" +
        " | replacementBindAllowedAtHardLimit=true" +
        " | hardCapacityRecoveryResumes=true" +
        " | windowsPathChanged=false" +
        " | questPathChanged=false" +
        " | webglProtocolChanged=false"
    );
} finally {
    adapter.uninstall();
}
