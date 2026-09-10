import {
    VoiceListenerMuteKind
} from "../routing/voiceRoutingControlPayload.js";

class VoiceMuteRegistry {
    //* این سازنده وضعیت مستقل هر شنونده و مسیرهای قطع‌شده او را آماده می‌کند.
    constructor() {
        this.statesByListenerConnectionId = new Map();
    }

    //* این تابع یک تغییر معتبر را فقط روی همان شنونده اعمال می‌کند.
    applyChange({
        listenerConnectionId,
        kind,
        muted,
        targetConnectionId = ""
    } = {}) {
        const listenerId = String(
            listenerConnectionId ?? ""
        ).trim().toLowerCase();

        if (!listenerId) {
            throw new TypeError("listenerConnectionId is required.");
        }

        if (!Object.values(VoiceListenerMuteKind).includes(kind)) {
            throw new RangeError("Unknown Voice listener mute kind.");
        }

        if (typeof muted !== "boolean") {
            throw new TypeError("muted must be a boolean.");
        }

        let state = this.statesByListenerConnectionId.get(listenerId);

        if (!state) {
            state = {
                speakerOff: false,
                muteAll: false,
                mutedPublisherConnectionIds: new Set()
            };

            this.statesByListenerConnectionId.set(listenerId, state);
        }

        if (kind === VoiceListenerMuteKind.SPEAKER_OFF) {
            state.speakerOff = muted;
        } else if (kind === VoiceListenerMuteKind.MUTE_ALL) {
            state.muteAll = muted;
        } else {
            const publisherId = String(
                targetConnectionId ?? ""
            ).trim().toLowerCase();

            if (!publisherId || publisherId === listenerId) {
                throw new Error(
                    "Per-user mute requires another publisher connection id."
                );
            }

            if (muted) {
                state.mutedPublisherConnectionIds.add(publisherId);
            } else {
                state.mutedPublisherConnectionIds.delete(publisherId);
            }
        }

        return this.getSnapshot(listenerId);
    }

    //* این تابع اجازه مسیر یک فرستنده به یک شنونده را بدون اثر روی مسیر برگشت بررسی می‌کند.
    isRouteAllowed(
        listenerConnectionId,
        publisherConnectionId
    ) {
        const listenerId = String(
            listenerConnectionId ?? ""
        ).trim().toLowerCase();

        const publisherId = String(
            publisherConnectionId ?? ""
        ).trim().toLowerCase();

        if (!listenerId || !publisherId || listenerId === publisherId) {
            return false;
        }

        const state = this.statesByListenerConnectionId.get(listenerId);
        if (!state) return true;

        return !state.speakerOff &&
            !state.muteAll &&
            !state.mutedPublisherConnectionIds.has(publisherId);
    }

    //* این تابع وضعیت یک اتصال حذف‌شده را هم به‌عنوان شنونده و هم هدف قطع مسیر پاک می‌کند.
    removeConnection(connectionId) {
        const normalizedConnectionId = String(
            connectionId ?? ""
        ).trim().toLowerCase();

        if (!normalizedConnectionId) return false;

        const removed = this.statesByListenerConnectionId.delete(
            normalizedConnectionId
        );

        for (const state of this.statesByListenerConnectionId.values()) {
            state.mutedPublisherConnectionIds.delete(normalizedConnectionId);
        }

        return removed;
    }

    //* این تابع نسخه خواندنی وضعیت یک شنونده را برمی‌گرداند.
    getSnapshot(listenerConnectionId) {
        const listenerId = String(
            listenerConnectionId ?? ""
        ).trim().toLowerCase();

        const state = this.statesByListenerConnectionId.get(listenerId);

        return Object.freeze({
            listenerConnectionId: listenerId,
            speakerOff: state?.speakerOff === true,
            muteAll: state?.muteAll === true,
            mutedPublisherConnectionIds: Object.freeze(
                Array.from(
                    state?.mutedPublisherConnectionIds ?? []
                ).sort()
            )
        });
    }

    //* این تابع آمار محدود وضعیت‌های شنونده را برای پایش برمی‌گرداند.
    getStats() {
        let speakerOff = 0;
        let muteAll = 0;
        let perUserMuteRoutes = 0;

        for (const state of this.statesByListenerConnectionId.values()) {
            if (state.speakerOff) speakerOff += 1;
            if (state.muteAll) muteAll += 1;
            perUserMuteRoutes += state.mutedPublisherConnectionIds.size;
        }

        return Object.freeze({
            listenersWithState: this.statesByListenerConnectionId.size,
            speakerOff,
            muteAll,
            perUserMuteRoutes
        });
    }
}

export {
    VoiceMuteRegistry
};

/*
توضیح فایل:
این فایل وضعیت بلندگو، قطع همه صداها و قطع یک‌طرفه صدای یک فرستنده را برای هر شنونده جدا نگه می‌دارد و حذف اتصال را از تمام نمایه‌های قطع صدا پاک می‌کند.
*/
