import assert from "node:assert/strict";
import { Phase11MediaNodeRegistry } from "../mediaNode/scaling/mediaNodeRegistry.js";
import { Phase11RoomAssignmentRegistry } from "../mediaNode/scaling/roomMediaNodeAssignmentRegistry.js";
import { createPhase11ScalingCoordinator } from "../mediaNode/scaling/mediaScalingCoordinator.js";

let nowMs = 1_800_000_000_000;
const now = () => nowMs;

function heartbeat(registry, nodeId, activeConnections = 0, cpuPercent = 0, outboundKbps = 0) {
    const result = registry.heartbeat(nodeId, { activeConnections, cpuPercent, outboundKbps });
    assert.ok(result, `Heartbeat failed for ${nodeId}.`);
    return result;
}

function pass(stage, fields = {}) {
    const details = Object.entries(fields).map(([key, value]) => `${key}=${value}`).join(" | ");
    console.log(`VOICE_MEDIA_MULTI_REGION_STAGE=PASS | stage=${stage}${details ? ` | ${details}` : ""}`);
}

const nodeRegistry = new Phase11MediaNodeRegistry({ now, heartbeatTimeoutMs: 15_000 });
const roomRegistry = new Phase11RoomAssignmentRegistry({ now });
const coordinator = createPhase11ScalingCoordinator({ nodeRegistry, roomRegistry });

for (const node of [
    { nodeId: "eu-a1", region: "eu-central", zone: "de-1" },
    { nodeId: "eu-a2", region: "eu-central", zone: "de-2" },
    { nodeId: "us-a1", region: "us-east", zone: "us-1" },
    { nodeId: "us-a2", region: "us-east", zone: "us-2" },
    { nodeId: "ap-a1", region: "ap-south", zone: "ap-1" }
]) {
    nodeRegistry.registerNode(node);
}

heartbeat(nodeRegistry, "eu-a1", 4, 20, 400);
heartbeat(nodeRegistry, "eu-a2", 1, 10, 100);
heartbeat(nodeRegistry, "us-a1", 3, 25, 300);
heartbeat(nodeRegistry, "us-a2", 2, 15, 200);
heartbeat(nodeRegistry, "ap-a1", 1, 5, 80);

// 1) Exact zone must win even if another node in the same region is lighter.
{
    const result = coordinator.resolveRoomNode({ roomId: "room-exact-zone", region: "eu-central", zone: "de-1" });
    assert.equal(result.success, true);
    assert.equal(result.assignment.nodeId, "eu-a1");
    assert.equal(result.node.region, "eu-central");
    assert.equal(result.node.zone, "de-1");
    pass("exact_zone_preference", { nodeId: result.assignment.nodeId, region: result.node.region, zone: result.node.zone });
}

// 2) Unknown zone inside an existing region must stay in-region and choose the lighter same-region node.
{
    const result = coordinator.resolveRoomNode({ roomId: "room-same-region", region: "eu-central", zone: "de-x" });
    assert.equal(result.success, true);
    assert.equal(result.assignment.nodeId, "eu-a2");
    assert.equal(result.node.region, "eu-central");
    pass("same_region_fallback", { nodeId: result.assignment.nodeId, region: result.node.region });
}

// 3) A US request must never select an EU/AP node.
{
    const result = coordinator.resolveRoomNode({ roomId: "room-us", region: "us-east", zone: "us-1" });
    assert.equal(result.success, true);
    assert.equal(result.assignment.nodeId, "us-a1");
    assert.equal(result.node.region, "us-east");
    pass("region_isolation", { nodeId: result.assignment.nodeId, region: result.node.region });
}

// 4) Default cross-region fallback is forbidden.
{
    const result = coordinator.resolveRoomNode({ roomId: "room-missing-region", region: "me-west", zone: "me-1" });
    assert.equal(result.success, false);
    assert.equal(result.reason, "no_ready_media_node");
    pass("cross_region_default_blocked", { reason: result.reason });
}

// 5) The coordinator only crosses regions when explicitly requested by a caller.
{
    const result = coordinator.resolveRoomNode({
        roomId: "room-explicit-fallback",
        region: "me-west",
        zone: "me-1",
        allowCrossRegionFallback: true
    });
    assert.equal(result.success, true);
    assert.ok(["eu-a1", "eu-a2", "us-a1", "us-a2", "ap-a1"].includes(result.assignment.nodeId));
    pass("explicit_cross_region_fallback", { nodeId: result.assignment.nodeId, allowed: true });
}

// 6) Ownership is sticky even if a later edge asks from another region.
let stickyNodeId;
{
    const first = coordinator.resolveRoomNode({ roomId: "room-sticky", region: "eu-central", zone: "de-1" });
    assert.equal(first.success, true);
    stickyNodeId = first.assignment.nodeId;
    assert.equal(stickyNodeId, "eu-a1");

    const second = coordinator.resolveRoomNode({ roomId: "room-sticky", region: "us-east", zone: "us-2" });
    assert.equal(second.success, true);
    assert.equal(second.reused, true);
    assert.equal(second.assignment.nodeId, stickyNodeId);
    assert.equal(second.node.region, "eu-central");
    pass("sticky_owner_across_edge_region_change", { nodeId: second.assignment.nodeId, ready: second.ready });
}

// 7) A stale owner must remain the owner; silent migration is forbidden.
{
    nowMs += 16_000;

    // Keep every node except the sticky owner fresh.
    heartbeat(nodeRegistry, "eu-a2", 1, 10, 100);
    heartbeat(nodeRegistry, "us-a1", 3, 25, 300);
    heartbeat(nodeRegistry, "us-a2", 2, 15, 200);
    heartbeat(nodeRegistry, "ap-a1", 1, 5, 80);

    const result = coordinator.resolveRoomNode({ roomId: "room-sticky", region: "us-east", zone: "us-2" });
    assert.equal(result.success, true);
    assert.equal(result.reused, true);
    assert.equal(result.assignment.nodeId, stickyNodeId);
    assert.equal(result.ready, false);
    assert.equal(roomRegistry.countRoomsForNode("us-a1"), 1); // Only room-us lives here.
    pass("stale_owner_no_silent_migration", { nodeId: result.assignment.nodeId, ready: result.ready });
}

// 8) After explicit release, the same room can be assigned according to the new region.
{
    assert.equal(coordinator.releaseRoom("room-sticky"), true);
    const result = coordinator.resolveRoomNode({ roomId: "room-sticky", region: "us-east", zone: "us-2" });
    assert.equal(result.success, true);
    assert.equal(result.node.region, "us-east");
    assert.notEqual(result.assignment.nodeId, stickyNodeId);
    pass("explicit_release_allows_region_reselection", { nodeId: result.assignment.nodeId, region: result.node.region });
}

// 9) New rooms must ignore a stale node and remain in the requested region.
{
    const result = coordinator.resolveRoomNode({ roomId: "room-eu-after-stale", region: "eu-central", zone: "de-1" });
    assert.equal(result.success, true);
    assert.equal(result.assignment.nodeId, "eu-a2");
    assert.equal(result.node.region, "eu-central");
    pass("stale_node_excluded_for_new_room", { nodeId: result.assignment.nodeId });
}

// 10) Load-aware selection is verified independently with equal room counts.
{
    const loadNodeRegistry = new Phase11MediaNodeRegistry({ now, heartbeatTimeoutMs: 15_000 });
    const loadRoomRegistry = new Phase11RoomAssignmentRegistry({ now });
    const loadCoordinator = createPhase11ScalingCoordinator({ nodeRegistry: loadNodeRegistry, roomRegistry: loadRoomRegistry });

    loadNodeRegistry.registerNode({ nodeId: "load-a", region: "load-region", zone: "z1" });
    loadNodeRegistry.registerNode({ nodeId: "load-b", region: "load-region", zone: "z1" });
    heartbeat(loadNodeRegistry, "load-a", 20, 80, 5000);
    heartbeat(loadNodeRegistry, "load-b", 2, 20, 500);

    const result = loadCoordinator.resolveRoomNode({ roomId: "room-load-aware", region: "load-region", zone: "z1" });
    assert.equal(result.success, true);
    assert.equal(result.assignment.nodeId, "load-b");
    pass("load_aware_selection", { nodeId: result.assignment.nodeId });
}

// 11) Room-count balancing must distribute two equal rooms across two equal nodes.
{
    const balanceNodeRegistry = new Phase11MediaNodeRegistry({ now, heartbeatTimeoutMs: 15_000 });
    const balanceRoomRegistry = new Phase11RoomAssignmentRegistry({ now });
    const balanceCoordinator = createPhase11ScalingCoordinator({ nodeRegistry: balanceNodeRegistry, roomRegistry: balanceRoomRegistry });

    balanceNodeRegistry.registerNode({ nodeId: "bal-a", region: "balance-region", zone: "z1" });
    balanceNodeRegistry.registerNode({ nodeId: "bal-b", region: "balance-region", zone: "z1" });
    heartbeat(balanceNodeRegistry, "bal-a", 0, 0, 0);
    heartbeat(balanceNodeRegistry, "bal-b", 0, 0, 0);

    const first = balanceCoordinator.resolveRoomNode({ roomId: "room-bal-1", region: "balance-region", zone: "z1" });
    const second = balanceCoordinator.resolveRoomNode({ roomId: "room-bal-2", region: "balance-region", zone: "z1" });

    assert.notEqual(first.assignment.nodeId, second.assignment.nodeId);
    assert.equal(balanceRoomRegistry.countRoomsForNode("bal-a"), 1);
    assert.equal(balanceRoomRegistry.countRoomsForNode("bal-b"), 1);
    pass("room_count_balancing", { first: first.assignment.nodeId, second: second.assignment.nodeId });
}

const stats = coordinator.getStats();
assert.equal(stats.nodes.totalNodes, 5);
assert.equal(stats.rooms.totalRooms, 6);

console.log(
    "VOICE_MEDIA_MULTI_REGION=PASS" +
    " | logicalRegions=3" +
    " | logicalZones=5" +
    " | exactZonePreference=True" +
    " | sameRegionFallback=True" +
    " | crossRegionDefaultBlocked=True" +
    " | explicitCrossRegionFallback=True" +
    " | stickyOwnership=True" +
    " | staleOwnerNoMigration=True" +
    " | explicitReleaseReselection=True" +
    " | staleNodeExcluded=True" +
    " | loadAware=True" +
    " | roomCountBalanced=True" +
    " | finalRoomCount=6" +
    " | physicalMultiRegion=False" +
    " | productionProcessesChanged=False"
);
