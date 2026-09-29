//* این تابع شناسه روم را پاکسازی و اعتبارسنجی می کند.
function normalizeRoomId(value) {
    const text = String(value ?? "").trim().toLowerCase();
    if (!text || text.length > 128) throw new TypeError("roomId is invalid.");
    return text;
}

//* این تابع شناسه نود را پاکسازی و اعتبارسنجی می کند.
function normalizeNodeId(value) {
    const text = String(value ?? "").trim();
    if (!text || text.length > 128) throw new TypeError("nodeId is invalid.");
    return text;
}

//* این کلاس مالکیت رسانه هر روم را فقط به یک نود نگه می دارد.
export class Phase11RoomAssignmentRegistry {
    //* این سازنده زمان سنج و فهرست مالکیت روم ها را آماده می کند.
    constructor({ now = Date.now } = {}) {
        if (typeof now !== "function") throw new TypeError("now is invalid.");
        this.now = now;
        this.assignmentsByRoomId = new Map();
        this.roomIdsByNodeId = new Map();
    }

    //* این تابع یک روم تازه را فقط در صورت نداشتن مالک به یک نود اختصاص می دهد.
    assignRoom(roomId, nodeId) {
        const normalizedRoomId = normalizeRoomId(roomId);
        const normalizedNodeId = normalizeNodeId(nodeId);
        const previous = this.assignmentsByRoomId.get(normalizedRoomId) ?? null;
        if (previous) return Object.freeze({ ...previous, reused: true });
        const assignment = Object.freeze({ roomId: normalizedRoomId, nodeId: normalizedNodeId, assignedAtMs: this.now() });
        this.assignmentsByRoomId.set(normalizedRoomId, assignment);
        let rooms = this.roomIdsByNodeId.get(normalizedNodeId);
        if (!rooms) {
            rooms = new Set();
            this.roomIdsByNodeId.set(normalizedNodeId, rooms);
        }
        rooms.add(normalizedRoomId);
        return Object.freeze({ ...assignment, reused: false });
    }

    //* این تابع مالک فعلی روم را بدون تغییر در فهرست برمی گرداند.
    getAssignment(roomId) {
        return this.assignmentsByRoomId.get(normalizeRoomId(roomId)) ?? null;
    }

    //* این تابع شناسه نود مالک فعلی روم را برمی گرداند.
    getOwnerNodeId(roomId) {
        return this.getAssignment(roomId)?.nodeId ?? null;
    }

    //* این تابع مالکیت یک روم را فقط در زمان آزادسازی صریح همان روم حذف می کند.
    releaseRoom(roomId) {
        const normalizedRoomId = normalizeRoomId(roomId);
        const assignment = this.assignmentsByRoomId.get(normalizedRoomId) ?? null;
        if (!assignment) return false;
        this.assignmentsByRoomId.delete(normalizedRoomId);
        const rooms = this.roomIdsByNodeId.get(assignment.nodeId);
        rooms?.delete(normalizedRoomId);
        if (rooms?.size === 0) this.roomIdsByNodeId.delete(assignment.nodeId);
        return true;
    }

    //* این تابع تعداد روم های اختصاص داده شده به یک نود را برمی گرداند.
    countRoomsForNode(nodeId) {
        return this.roomIdsByNodeId.get(normalizeNodeId(nodeId))?.size ?? 0;
    }

    //* این تابع فهرست روم های یک نود را برای پایش برمی گرداند.
    listRoomsForNode(nodeId) {
        return Object.freeze(Array.from(this.roomIdsByNodeId.get(normalizeNodeId(nodeId)) ?? []).sort());
    }

    //* این تابع آمار مالکیت روم ها را برای پایش برمی گرداند.
    getStats() {
        const byNode = {};
        for (const [nodeId, rooms] of this.roomIdsByNodeId.entries()) byNode[nodeId] = rooms.size;
        return Object.freeze({ totalRooms: this.assignmentsByRoomId.size, byNode: Object.freeze(byNode) });
    }
}
