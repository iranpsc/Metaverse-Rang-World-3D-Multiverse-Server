import assert from "node:assert/strict";
import { installMediaRoomOwnershipReleaseAdapter } from "./mediaRoomOwnershipReleaseAdapter.js";

//* این تابع رجیستری ساختگی را برای بررسی آزادسازی مالکیت روم می سازد.
function createFakeRegistry(initialConnections = []) {
    const records = new Map(initialConnections.map((connection) => [connection.connectionId, { ...connection }]));
    return {
        //* این تابع همه اتصال های باقی مانده را بر می گرداند.
        listAll() {
            return Array.from(records.values(), (connection) => Object.freeze({ ...connection }));
        },

        //* این تابع حذف قطعی اتصال را مانند رجیستری واقعی انجام می دهد.
        removeConnection(connectionId) {
            const record = records.get(connectionId) ?? null;
            if (!record) return null;
            records.delete(connectionId);
            return Object.freeze({ ...record });
        }
    };
}

//* این تابع آزادسازی فقط پس از خروج آخرین اتصال همان روم را بررسی می کند.
function testReleaseAfterLastConnectionRemoval() {
    const registry = createFakeRegistry([
        { connectionId: "connection-a", roomId: "room-a", state: "active" },
        { connectionId: "connection-b", roomId: "room-a", state: "suspended" },
        { connectionId: "connection-c", roomId: "room-b", state: "active" }
    ]);
    const releasedRooms = [];
    const coordinator = {
        releaseRoom(roomId) {
            releasedRooms.push(roomId);
            return true;
        }
    };

    const adapter = installMediaRoomOwnershipReleaseAdapter({ voiceConnectionRegistry: registry, coordinator });

    assert.equal(registry.removeConnection("connection-a")?.roomId, "room-a");
    assert.deepEqual(releasedRooms, []);

    assert.equal(registry.removeConnection("missing"), null);
    assert.deepEqual(releasedRooms, []);

    assert.equal(registry.removeConnection("connection-b")?.roomId, "room-a");
    assert.deepEqual(releasedRooms, ["room-a"]);

    assert.equal(adapter.uninstall(), true);
    assert.equal(adapter.uninstall(), false);

    assert.equal(registry.removeConnection("connection-c")?.roomId, "room-b");
    assert.deepEqual(releasedRooms, ["room-a"]);
}

//* این تابع همه بررسی های آزادسازی مالکیت روم را اجرا می کند.
function run() {
    testReleaseAfterLastConnectionRemoval();
    console.log("VOICE_MEDIA_ROOM_OWNERSHIP_RELEASE_TEST=PASS | suspendedConnectionPreservesOwnership=True | lastConnectionRemovalReleasesRoom=True | missingConnectionIgnored=True | uninstallRestoresRegistry=True");
}

run();
