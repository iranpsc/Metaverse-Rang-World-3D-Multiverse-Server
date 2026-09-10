// مسیر فایل: src/voice/adapters/voiceDedicatedPlayerAdapter.js

import {
    VoiceAuthResultCode
} from "../auth/voiceAuthConstants.js";

class VoiceDedicatedPlayerAdapter {
    //* این سازنده ثبت‌کننده نشست‌های سرور اختصاصی را دریافت می‌کند.
    constructor({
        sessionRegistry
    } = {}) {
        if (
            !sessionRegistry ||
            typeof sessionRegistry
                .findSessionByRoom !== "function" ||
            typeof sessionRegistry
                .isPublicSessionOpen !== "function"
        ) {
            throw new TypeError(
                "sessionRegistry does not provide the required interface."
            );
        }

        this.sessionRegistry =
            sessionRegistry;

        Object.seal(this);
    }

    //* این تابع همان شناسه کاربر را داخل نشست همان روم در سرور اختصاصی پیدا می‌کند.
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
                sessionId: "",
                serverId: "",
                connectionId: "",
                playerId: ""
            });
        }

        const session =
            this.sessionRegistry
                .findSessionByRoom(
                    normalizedRoomId
                );

        if (
            !session ||
            this.sessionRegistry
                .isPublicSessionOpen(
                    session
                ) !== true
        ) {
            return Object.freeze({
                success: false,
                retryable: true,
                code:
                    VoiceAuthResultCode
                        .DEDICATED_NOT_AUTHENTICATED,
                userId: normalizedUserId,
                roomId: normalizedRoomId,
                sessionId: "",
                serverId: "",
                connectionId: "",
                playerId: ""
            });
        }

        const players =
            Array.isArray(session.players)
                ? session.players
                : [];

        const player =
            players.find(
                (candidate) =>
                    String(
                        candidate?.userId ??
                        ""
                    ).trim() ===
                        normalizedUserId &&
                    candidate?.isReady === true
            ) ?? null;

        if (!player) {
            return Object.freeze({
                success: false,
                retryable: true,
                code:
                    VoiceAuthResultCode
                        .DEDICATED_NOT_AUTHENTICATED,
                userId: normalizedUserId,
                roomId: normalizedRoomId,
                sessionId:
                    String(
                        session.sessionId ??
                        ""
                    ).trim(),
                serverId:
                    String(
                        session.serverId ??
                        ""
                    ).trim(),
                connectionId: "",
                playerId: ""
            });
        }

        return Object.freeze({
            success: true,
            retryable: false,
            code:
                VoiceAuthResultCode
                    .AUTHENTICATED,
            userId:
                String(
                    player.userId ?? ""
                ).trim(),
            roomId:
                String(
                    session.roomId ?? ""
                ).trim(),
            sessionId:
                String(
                    session.sessionId ?? ""
                ).trim(),
            serverId:
                String(
                    session.serverId ?? ""
                ).trim(),
            connectionId:
                String(
                    player.connectionId ?? ""
                ).trim(),
            playerId:
                String(
                    player.playerId ?? ""
                ).trim()
        });
    }
}

export {
    VoiceDedicatedPlayerAdapter
};

/*
توضیح فایل:
این فایل شناسه کاربر فرستنده صوت را فقط داخل نشست همان روم در سرور اختصاصی جست‌وجو می‌کند. اگر همان کاربر داخل نشست باشد و وضعیت آماده داشته باشد، حضور او تأیید می‌شود.
*/
