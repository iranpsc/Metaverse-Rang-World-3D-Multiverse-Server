import { Phase11MediaNodeRegistry } from "./mediaNodeRegistry.js";
import { Phase11RoomAssignmentRegistry } from "./roomMediaNodeAssignmentRegistry.js";

//* این تابع هماهنگ کننده مقیاس پذیری را با مالکیت تک نودی هر روم می سازد.
export function createPhase11ScalingCoordinator({ nodeRegistry = new Phase11MediaNodeRegistry(), roomRegistry = new Phase11RoomAssignmentRegistry() } = {}) {
    //* این تابع برای روم تازه یک نود سالم انتخاب می کند و همان مالک را برای دفعات بعد نگه می دارد.
    function resolveRoomNode({ roomId, region = "", zone = "", allowCrossRegionFallback = false } = {}) {
        const existing = roomRegistry.getAssignment(roomId);
        if (existing) {
            const record = nodeRegistry.getNodeRecord(existing.nodeId);
            return Object.freeze({
                success: true,
                reused: true,
                assignment: existing,
                node: record ? nodeRegistry.snapshotNode(record) : null,
                ready: nodeRegistry.isNodeReady(existing.nodeId)
            });
        }
        const candidates = nodeRegistry.listReadyNodes({ region, zone, allowCrossRegionFallback });
        if (candidates.length === 0) return Object.freeze({ success: false, reused: false, assignment: null, node: null, ready: false, reason: "no_ready_media_node" });
        const ranked = Array.from(candidates);
        ranked.sort((first, second) =>
            first.localityRank - second.localityRank ||
            roomRegistry.countRoomsForNode(first.node.nodeId) - roomRegistry.countRoomsForNode(second.node.nodeId) ||
            first.node.activeConnections - second.node.activeConnections ||
            first.node.cpuPercent - second.node.cpuPercent ||
            first.node.outboundKbps - second.node.outboundKbps ||
            first.node.nodeId.localeCompare(second.node.nodeId)
        );
        const selected = ranked[0].node;
        const assignment = roomRegistry.assignRoom(roomId, selected.nodeId);
        return Object.freeze({ success: true, reused: false, assignment, node: selected, ready: true });
    }

    //* این تابع مالکیت روم پایان یافته را آزاد می کند و هیچ اتصال یا سشن فعالی را جداگانه جابه جا نمی کند.
    function releaseRoom(roomId) {
        return roomRegistry.releaseRoom(roomId);
    }

    //* این تابع وضعیت هماهنگ کننده را برای پایش برمی گرداند.
    function getStats() {
        return Object.freeze({ nodes: nodeRegistry.getStats(), rooms: roomRegistry.getStats() });
    }

    return Object.freeze({ nodeRegistry, roomRegistry, resolveRoomNode, releaseRoom, getStats });
}
