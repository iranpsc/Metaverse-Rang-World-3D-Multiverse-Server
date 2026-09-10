// مسیر فایل: src/voice/adapters/voiceRealtimeMembershipAdapter.js

import {
    RealtimeContextState
} from "../../realTime/core/realtimeContext.js";

import {
    VoiceAuthResultCode
} from "../auth/voiceAuthConstants.js";

class VoiceRealtimeMembershipAdapter {
    //* این سازنده رجیستری اتصال‌ها و مدیر روم فعلی پروژه را دریافت می‌کند.
    constructor({
        registry,
        rooms
    } = {}) {
        if (
            !registry ||
            typeof registry.getAll !== "function"
        ) {
            throw new TypeError(
                "registry must provide getAll."
            );
        }

        if (
            !rooms ||
            typeof rooms.hasConnection !== "function"
        ) {
            throw new TypeError(
                "rooms must provide hasConnection."
            );
        }

        this.registry = registry;
        this.rooms = rooms;

        Object.seal(this);
    }

    //* این تابع اتصال فعال و احراز‌شده کاربر را در روم درخواستی پیدا می‌کند.
    verify({
        userId,
        roomId
    } = {}) {
        const normalizedUserId =
            String(userId ?? "").trim();

        const normalizedRoomId =
            String(roomId ?? "").trim();

        if (
            !normalizedUserId ||
            !normalizedRoomId
        ) {
            return Object.freeze({
                success: false,
                retryable: false,
                code:
                    VoiceAuthResultCode
                        .INVALID_PAYLOAD,
                userId: normalizedUserId,
                roomId: normalizedRoomId,
                realtimeConnectionId: "",
                transportKind: "",
                realtimeConnection: null
            });
        }

        const realtimeConnections =
            this.registry.getAll(
                normalizedUserId
            );

        if (!Array.isArray(realtimeConnections)) {
            return Object.freeze({
                success: false,
                retryable: true,
                code:
                    VoiceAuthResultCode
                        .INTERNAL_ERROR,
                userId: normalizedUserId,
                roomId: normalizedRoomId,
                realtimeConnectionId: "",
                transportKind: "",
                realtimeConnection: null
            });
        }

        if (realtimeConnections.length === 0) {
            return Object.freeze({
                success: false,
                retryable: true,
                code:
                    VoiceAuthResultCode
                        .REALTIME_NOT_READY,
                userId: normalizedUserId,
                roomId: normalizedRoomId,
                realtimeConnectionId: "",
                transportKind: "",
                realtimeConnection: null
            });
        }

        let authenticatedConnectionCount = 0;
        let matchedConnection = null;

        for (
            const connection
            of realtimeConnections
        ) {
            const context =
                connection?.context ??
                connection
                    ?.realtimeConnection
                    ?.context ??
                null;

            const contextUserId =
                String(
                    context?.user?.id ??
                    context?.user?.userId ??
                    ""
                ).trim();

            if (
                contextUserId !==
                normalizedUserId
            ) {
                continue;
            }

            if (
                context?.state !==
                RealtimeContextState.authenticated
            ) {
                continue;
            }

            authenticatedConnectionCount += 1;

            if (
                this.rooms.hasConnection(
                    normalizedRoomId,
                    connection
                ) !== true
            ) {
                continue;
            }

            matchedConnection = connection;
            break;
        }

        if (!matchedConnection) {
            return Object.freeze({
                success: false,
                retryable: true,
                code:
                    authenticatedConnectionCount === 0
                        ? VoiceAuthResultCode
                            .REALTIME_NOT_READY
                        : VoiceAuthResultCode
                            .ROOM_NOT_JOINED,
                userId: normalizedUserId,
                roomId: normalizedRoomId,
                realtimeConnectionId: "",
                transportKind: "",
                realtimeConnection: null
            });
        }

        const matchedContext =
            matchedConnection?.context ??
            matchedConnection
                ?.realtimeConnection
                ?.context ??
            null;

        const realtimeConnectionId =
            String(
                matchedConnection?.id ??
                matchedConnection?.connectionId ??
                matchedContext?.connectionId ??
                ""
            ).trim();

        return Object.freeze({
            success: true,
            retryable: false,
            code:
                VoiceAuthResultCode
                    .AUTHENTICATED,
            userId: normalizedUserId,
            roomId: normalizedRoomId,
            realtimeConnectionId,
            transportKind:
                String(
                    matchedContext
                        ?.transportKind ??
                    ""
                ).trim(),
            realtimeConnection:
                matchedConnection
        });
    }
}

export {
    VoiceRealtimeMembershipAdapter
};

/*
توضیح فایل:
این فایل اتصال‌های فعال یک کاربر تأییدشده را از رجیستری فعلی پروژه دریافت می‌کند و فقط اتصالی را معتبر می‌داند که احراز شده و واقعاً عضو روم درخواستی باشد.
*/
