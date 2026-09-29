//* این تابع آزادسازی مالکیت روم را به حذف قطعی اتصال صوتی متصل می کند.
function installMediaRoomOwnershipReleaseAdapter({
    voiceConnectionRegistry,
    coordinator,
    logger = null
} = {}) {
    if (!voiceConnectionRegistry || typeof voiceConnectionRegistry.removeConnection !== "function" || typeof voiceConnectionRegistry.listAll !== "function") throw new TypeError("voiceConnectionRegistry is invalid.");
    if (!coordinator || typeof coordinator.releaseRoom !== "function") throw new TypeError("coordinator is invalid.");

    const originalRemoveConnection = voiceConnectionRegistry.removeConnection;
    let installed = true;

    //* این تابع پس از حذف قطعی اتصال، مالکیت روم خالی را آزاد می کند.
    function removeConnectionWithRoomOwnershipRelease(...args) {
        const removed = originalRemoveConnection.apply(this, args);
        if (!removed) return removed;

        const roomId = String(removed.roomId ?? "").trim();
        if (!roomId) return removed;

        const roomStillHasConnection = voiceConnectionRegistry
            .listAll()
            .some((connection) => String(connection?.roomId ?? "").trim() === roomId);

        if (!roomStillHasConnection) {
            const released = coordinator.releaseRoom(roomId);
            if (released) logger?.info?.("VOICE_MEDIA_ROOM_OWNERSHIP_RELEASED", { roomId });
        }

        return removed;
    }

    voiceConnectionRegistry.removeConnection = removeConnectionWithRoomOwnershipRelease;

    //* این تابع اتصال افزونه را بدون تغییر رجیستری اصلی باز می گرداند.
    function uninstall() {
        if (!installed) return false;
        installed = false;
        if (voiceConnectionRegistry.removeConnection === removeConnectionWithRoomOwnershipRelease) voiceConnectionRegistry.removeConnection = originalRemoveConnection;
        return true;
    }

    return Object.freeze({ uninstall });
}

export {
    installMediaRoomOwnershipReleaseAdapter
};
