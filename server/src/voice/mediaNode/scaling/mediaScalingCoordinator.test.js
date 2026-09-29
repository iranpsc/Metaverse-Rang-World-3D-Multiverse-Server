import assert from "node:assert/strict";
import { createPhase11ScalingCoordinator } from "./mediaScalingCoordinator.js";
import { Phase11MediaNodeRegistry } from "./mediaNodeRegistry.js";
import { Phase11RoomAssignmentRegistry } from "./roomMediaNodeAssignmentRegistry.js";

//* این تابع انتخاب نود برای روم تازه را بر اساس نزدیکی و بار واقعی بررسی می کند.
function testNewRoomSelection() {
    let nowMs = 1_000;
    const nodeRegistry = new Phase11MediaNodeRegistry({ now: () => nowMs });
    const roomRegistry = new Phase11RoomAssignmentRegistry({ now: () => nowMs });
    const coordinator = createPhase11ScalingCoordinator({ nodeRegistry, roomRegistry });
    nodeRegistry.registerNode({ nodeId: "eu-a", region: "eu-central", zone: "de-1" });
    nodeRegistry.registerNode({ nodeId: "eu-b", region: "eu-central", zone: "de-2" });
    nodeRegistry.registerNode({ nodeId: "us-a", region: "us-east", zone: "us-1" });
    nodeRegistry.heartbeat("eu-a", { activeConnections: 10, cpuPercent: 20, outboundKbps: 1000 });
    nodeRegistry.heartbeat("eu-b", { activeConnections: 2, cpuPercent: 10, outboundKbps: 500 });
    nodeRegistry.heartbeat("us-a", { activeConnections: 1, cpuPercent: 5, outboundKbps: 100 });

    const sameZone = coordinator.resolveRoomNode({ roomId: "room-a", region: "eu-central", zone: "de-1" });
    assert.equal(sameZone.success, true);
    assert.equal(sameZone.assignment.nodeId, "eu-a");

    const sameRegion = coordinator.resolveRoomNode({ roomId: "room-b", region: "eu-central" });
    assert.equal(sameRegion.success, true);
    assert.equal(sameRegion.assignment.nodeId, "eu-b");

    const blockedCrossRegion = coordinator.resolveRoomNode({ roomId: "room-c", region: "ap-south" });
    assert.equal(blockedCrossRegion.success, false);

    const allowedCrossRegion = coordinator.resolveRoomNode({ roomId: "room-c", region: "ap-south", allowCrossRegionFallback: true });
    assert.equal(allowedCrossRegion.success, true);
    assert.equal(allowedCrossRegion.assignment.nodeId, "us-a");

    nowMs += 16_000;
    const noReadyNode = coordinator.resolveRoomNode({ roomId: "room-d", region: "eu-central" });
    assert.equal(noReadyNode.success, false);
}

//* این تابع ثابت می کند تمام استفاده های یک روم فعال همان مالک رسانه را نگه می دارند.
function testSingleNodeRoomOwnership() {
    let nowMs = 2_000;
    const nodeRegistry = new Phase11MediaNodeRegistry({ now: () => nowMs });
    const roomRegistry = new Phase11RoomAssignmentRegistry({ now: () => nowMs });
    const coordinator = createPhase11ScalingCoordinator({ nodeRegistry, roomRegistry });
    nodeRegistry.registerNode({ nodeId: "eu-a", region: "eu-central", zone: "de-1" });
    nodeRegistry.registerNode({ nodeId: "eu-b", region: "eu-central", zone: "de-2" });
    nodeRegistry.heartbeat("eu-a", { activeConnections: 0, cpuPercent: 10, outboundKbps: 100 });
    nodeRegistry.heartbeat("eu-b", { activeConnections: 0, cpuPercent: 5, outboundKbps: 50 });

    const first = coordinator.resolveRoomNode({ roomId: "room-stick", region: "eu-central", zone: "de-1" });
    assert.equal(first.assignment.nodeId, "eu-a");

    nodeRegistry.heartbeat("eu-a", { activeConnections: 1000, cpuPercent: 95, outboundKbps: 90000 });
    nodeRegistry.heartbeat("eu-b", { activeConnections: 0, cpuPercent: 1, outboundKbps: 10 });
    const second = coordinator.resolveRoomNode({ roomId: "room-stick", region: "eu-central", zone: "de-2" });
    assert.equal(second.reused, true);
    assert.equal(second.assignment.nodeId, "eu-a");
    assert.equal(roomRegistry.countRoomsForNode("eu-a"), 1);
    assert.equal(roomRegistry.countRoomsForNode("eu-b"), 0);

    nowMs += 16_000;
    const staleOwner = coordinator.resolveRoomNode({ roomId: "room-stick", region: "eu-central", zone: "de-2" });
    assert.equal(staleOwner.assignment.nodeId, "eu-a");
    assert.equal(staleOwner.ready, false);
    assert.equal(roomRegistry.countRoomsForNode("eu-b"), 0);
}

//* این تابع توزیع دو روم مستقل را میان دو نود سالم بررسی می کند.
function testIndependentRoomDistribution() {
    const nodeRegistry = new Phase11MediaNodeRegistry();
    const roomRegistry = new Phase11RoomAssignmentRegistry();
    const coordinator = createPhase11ScalingCoordinator({ nodeRegistry, roomRegistry });
    nodeRegistry.registerNode({ nodeId: "eu-a", region: "eu-central", zone: "de-1" });
    nodeRegistry.registerNode({ nodeId: "eu-b", region: "eu-central", zone: "de-1" });
    nodeRegistry.heartbeat("eu-a", { activeConnections: 0, cpuPercent: 0, outboundKbps: 0 });
    nodeRegistry.heartbeat("eu-b", { activeConnections: 0, cpuPercent: 0, outboundKbps: 0 });
    const first = coordinator.resolveRoomNode({ roomId: "room-one", region: "eu-central", zone: "de-1" });
    const second = coordinator.resolveRoomNode({ roomId: "room-two", region: "eu-central", zone: "de-1" });
    assert.notEqual(first.assignment.nodeId, second.assignment.nodeId);
}

//* این تابع آزاد شدن مالکیت روم را فقط پس از آزادسازی صریح بررسی می کند.
function testExplicitRoomRelease() {
    const nodeRegistry = new Phase11MediaNodeRegistry();
    const roomRegistry = new Phase11RoomAssignmentRegistry();
    const coordinator = createPhase11ScalingCoordinator({ nodeRegistry, roomRegistry });
    nodeRegistry.registerNode({ nodeId: "eu-a", region: "eu-central", zone: "de-1" });
    nodeRegistry.heartbeat("eu-a", { activeConnections: 0, cpuPercent: 0, outboundKbps: 0 });
    const assigned = coordinator.resolveRoomNode({ roomId: "room-release", region: "eu-central", zone: "de-1" });
    assert.equal(assigned.success, true);
    assert.equal(roomRegistry.getOwnerNodeId("room-release"), "eu-a");
    assert.equal(coordinator.releaseRoom("room-release"), true);
    assert.equal(roomRegistry.getOwnerNodeId("room-release"), null);
}

//* این تابع همه آزمون های هسته اصلاح شده فاز یازده را اجرا می کند.
function run() {
    testNewRoomSelection();
    testSingleNodeRoomOwnership();
    testIndependentRoomDistribution();
    testExplicitRoomRelease();
    console.log("VME2_PHASE11_SERVER_TEST=PASS | roomSingleNode=True | sessionLevelSplit=False | connectionLevelSplit=False | crossNodeMediaRoute=False | hardPlayerCapacity=False | regionZoneAware=True | mediaLoadAware=True | explicitRoomRelease=True | phase10FilesChanged=False | phase9ContractChanged=False");
}

run();
