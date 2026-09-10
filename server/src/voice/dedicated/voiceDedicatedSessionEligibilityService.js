// مسیر فایل: src/voice/dedicated/voiceDedicatedSessionEligibilityService.js

import {
    VoiceConnectionState
} from "../core/voiceConnectionConstants.js";

//* این تابع شناسه اتصال را برای مقایسه بین Dedicated و Voice Registry یکسان می‌کند.
function canonicalizeVoiceEligibilityConnectionId(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replaceAll("-", "");
}

//* این تابع یک متن ضروری را برای درخواست Snapshot اعتبارسنجی می‌کند.
function normalizeVoiceEligibilityRequiredText(
    value,
    fieldName
) {
    if (typeof value !== "string") {
        throw new TypeError(`${fieldName} must be a string.`);
    }

    const normalized = value.trim();

    if (!normalized) {
        throw new Error(`${fieldName} is required.`);
    }

    if (Buffer.byteLength(normalized, "utf8") > 512) {
        throw new RangeError(`${fieldName} exceeds 512 UTF-8 bytes.`);
    }

    return normalized;
}

class VoiceDedicatedSessionEligibilityService {
    //* این سازنده فقط منابع خواندنی لازم برای Snapshot شرط Mic/Speaker را دریافت می‌کند.
    constructor({
        dedicatedServerHandler,
        gameServerRegistry,
        gameSessionRegistry,
        voiceConnectionRegistry,
        now = () => Date.now()
    } = {}) {
        if (
            !dedicatedServerHandler ||
            typeof dedicatedServerHandler.verifyDedicatedServerToken !== "function"
        ) {
            throw new TypeError(
                "dedicatedServerHandler must provide verifyDedicatedServerToken."
            );
        }

        if (
            !gameServerRegistry ||
            typeof gameServerRegistry.hasServer !== "function"
        ) {
            throw new TypeError(
                "gameServerRegistry must provide hasServer."
            );
        }

        if (
            !gameSessionRegistry ||
            typeof gameSessionRegistry.findSessionByRoom !== "function" ||
            typeof gameSessionRegistry.isPublicSessionOpen !== "function"
        ) {
            throw new TypeError(
                "gameSessionRegistry does not provide the required session lookup interface."
            );
        }

        if (
            !voiceConnectionRegistry ||
            typeof voiceConnectionRegistry.listAll !== "function" ||
            typeof voiceConnectionRegistry.getSessionEligibility !== "function"
        ) {
            throw new TypeError(
                "voiceConnectionRegistry must provide listAll and getSessionEligibility."
            );
        }

        if (typeof now !== "function") {
            throw new TypeError("now must be a function.");
        }

        this.dedicatedServerHandler = dedicatedServerHandler;
        this.gameServerRegistry = gameServerRegistry;
        this.gameSessionRegistry = gameSessionRegistry;
        this.voiceConnectionRegistry = voiceConnectionRegistry;
        this.now = now;
        this.stopped = false;
    }

    //* این تابع Snapshot فقط-خواندنی کاربرانی را می‌دهد که روی همین Dedicated Server اتصال Voice فعال دارند.
    getSnapshot(
        ctx = {},
        request = {}
    ) {
        if (this.stopped) {
            return Object.freeze({
                success: false,
                reason: "voice_session_eligibility_service_stopped",
                message: "Voice session eligibility service is stopped.",
                data: {},
                ts: this.now(),
                httpStatusCode: 503
            });
        }

        let serverId;

        try {
            serverId = normalizeVoiceEligibilityRequiredText(
                request?.serverId,
                "serverId"
            );
        } catch (error) {
            return Object.freeze({
                success: false,
                reason: "voice_session_eligibility_request_invalid",
                message: error?.message ?? String(error),
                data: {},
                ts: this.now(),
                httpStatusCode: 400
            });
        }

        const authResult =
            this.dedicatedServerHandler.verifyDedicatedServerToken(
                ctx,
                request,
                { serverId }
            );

        if (authResult?.success !== true) {
            return Object.freeze({
                ...authResult,
                httpStatusCode: 401
            });
        }

        if (!this.gameServerRegistry.hasServer(serverId)) {
            return Object.freeze({
                success: false,
                reason: "voice_session_eligibility_server_not_registered",
                message: "Dedicated server is not registered.",
                data: { serverId },
                ts: this.now(),
                httpStatusCode: 409
            });
        }

        const participants = [];
        const connections = this.voiceConnectionRegistry.listAll();

        for (const connection of connections) {
            if (
                connection?.state !== VoiceConnectionState.ACTIVE &&
                connection?.state !== VoiceConnectionState.SUSPENDED
            ) {
                continue;
            }

            const gameSession =
                this.gameSessionRegistry.findSessionByRoom(
                    connection.roomId
                );

            if (
                !gameSession ||
                this.gameSessionRegistry.isPublicSessionOpen(gameSession) !== true ||
                String(gameSession.serverId ?? "").trim() !== serverId
            ) {
                continue;
            }

            const canonicalVoiceConnectionId =
                canonicalizeVoiceEligibilityConnectionId(
                    connection.connectionId
                );

            const hasMatchingPlayer =
                Array.isArray(gameSession.players) &&
                gameSession.players.some((player) =>
                    String(player?.userId ?? "").trim() === connection.userId &&
                    canonicalizeVoiceEligibilityConnectionId(
                        player?.connectionId
                    ) === canonicalVoiceConnectionId
                );

            if (!hasMatchingPlayer) continue;

            const eligibility =
                this.voiceConnectionRegistry.getSessionEligibility(
                    connection.connectionId
                );

            if (eligibility?.initialized !== true) continue;

            participants.push(
                Object.freeze({
                    userId: connection.userId,
                    connectionId: connection.connectionId,
                    roomId: connection.roomId,
                    eligible: eligibility?.eligible !== false,
                    changedAtMs:
                        Number.isSafeInteger(eligibility?.changedAtMs)
                            ? eligibility.changedAtMs
                            : connection.createdAtMs
                })
            );
        }

        participants.sort((first, second) => {
            const roomCompare = first.roomId.localeCompare(second.roomId);
            if (roomCompare !== 0) return roomCompare;

            const userCompare = first.userId.localeCompare(second.userId);
            if (userCompare !== 0) return userCompare;

            return first.connectionId.localeCompare(second.connectionId);
        });

        return Object.freeze({
            success: true,
            reason: "voice_session_eligibility_snapshot_ready",
            message: "Voice session eligibility snapshot is ready.",
            data: Object.freeze({
                serverId,
                participants: Object.freeze(participants)
            }),
            ts: this.now(),
            httpStatusCode: 200
        });
    }

    //* این تابع سرویس فقط-خواندنی را متوقف می‌کند.
    stop() {
        this.stopped = true;
    }
}

export {
    VoiceDedicatedSessionEligibilityService,
    canonicalizeVoiceEligibilityConnectionId
};

/*
توضیح فایل:
این فایل نتیجه مستقل شرط Mic/Speaker را از Voice Connection Registry برای همان Dedicated Server به شکل Snapshot فقط-خواندنی ارائه می‌کند و هیچ Session را مستقیماً ایجاد یا حذف نمی‌کند.
*/
