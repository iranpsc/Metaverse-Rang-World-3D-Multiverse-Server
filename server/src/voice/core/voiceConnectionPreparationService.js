// مسیر فایل: src/voice/core/voiceConnectionPreparationService.js

import {
    VoiceAuthResultCode,
    VoiceClientPlatformNameByValue
} from "../auth/voiceAuthConstants.js";

import {
    VoiceConnectionFieldLimits
} from "./voiceConnectionConstants.js";

const VOICE_CLIENT_INSTANCE_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VoiceConnectionPreparationStage = Object.freeze({
    ACCESS_TOKEN: "access_token",
    REQUEST_FIELDS: "request_fields",
    REALTIME_MEMBERSHIP: "realtime_membership",
    DEDICATED_PLAYER: "dedicated_player",
    READY_FOR_REGISTRATION: "ready_for_registration"
});

class VoiceConnectionPreparationService {
    //* این سازنده بررسی‌کننده توکن، عضویت روم و حضور کاربر در سرور اختصاصی را دریافت می‌کند.
    constructor({
        accessTokenVerifier,
        realtimeMembershipAdapter,
        dedicatedPlayerAdapter
    } = {}) {
        if (
            !accessTokenVerifier ||
            typeof accessTokenVerifier.verify !== "function"
        ) {
            throw new TypeError(
                "accessTokenVerifier must provide verify."
            );
        }

        if (
            !realtimeMembershipAdapter ||
            typeof realtimeMembershipAdapter.verify !== "function"
        ) {
            throw new TypeError(
                "realtimeMembershipAdapter must provide verify."
            );
        }

        if (
            !dedicatedPlayerAdapter ||
            typeof dedicatedPlayerAdapter.verify !== "function"
        ) {
            throw new TypeError(
                "dedicatedPlayerAdapter must provide verify."
            );
        }

        this.accessTokenVerifier =
            accessTokenVerifier;

        this.realtimeMembershipAdapter =
            realtimeMembershipAdapter;

        this.dedicatedPlayerAdapter =
            dedicatedPlayerAdapter;

        Object.seal(this);
    }

    //* این تابع توکن، عضویت روم و حضور همان کاربر در سرور اختصاصی را بررسی و اطلاعات ثبت اتصال صوتی را آماده می‌کند.
    prepare({
        accessToken,
        roomId,
        avatarId,
        platform,
        clientInstanceId,
        transportName,
        transportConnectionKey,
        createdAtMs = Date.now()
    } = {}) {
        const tokenResult =
            this.accessTokenVerifier.verify(
                accessToken
            );

        if (tokenResult?.success !== true) {
            return Object.freeze({
                ready: false,
                retryable:
                    tokenResult?.retryable === true,
                code:
                    tokenResult?.code ??
                    VoiceAuthResultCode
                        .ACCESS_TOKEN_INVALID,
                stage:
                    VoiceConnectionPreparationStage
                        .ACCESS_TOKEN,
                userId: "",
                roomId: "",
                realtimeConnectionId: "",
                dedicatedSessionId: "",
                dedicatedServerId: "",
                dedicatedConnectionId: "",
                dedicatedPlayerId: "",
                realtimeConnection: null,
                registrationInput: null
            });
        }

        const normalizedRoomId =
            String(roomId ?? "").trim();

        const normalizedTokenUserId =
            String(
                tokenResult.userId ??
                ""
            ).trim();

        const normalizedAvatarId =
            String(avatarId ?? "").trim();

        const normalizedClientInstanceId =
            String(
                clientInstanceId ?? ""
            )
                .trim()
                .toLowerCase();

        const normalizedTransportName =
            String(transportName ?? "").trim();

        const normalizedTransportConnectionKey =
            String(
                transportConnectionKey ?? ""
            ).trim();

        if (
            !normalizedRoomId ||
            !normalizedTokenUserId ||
            !normalizedAvatarId ||
            normalizedAvatarId !==
                normalizedTokenUserId ||
            !normalizedTransportName ||
            !normalizedTransportConnectionKey ||
            !Number.isInteger(platform) ||
            !Object.hasOwn(
                VoiceClientPlatformNameByValue,
                platform
            ) ||
            !VOICE_CLIENT_INSTANCE_ID_PATTERN.test(
                normalizedClientInstanceId
            ) ||
            !Number.isSafeInteger(createdAtMs) ||
            createdAtMs < 0 ||
            Buffer.byteLength(
                normalizedRoomId,
                "utf8"
            ) >
                VoiceConnectionFieldLimits
                    .roomIdBytes ||
            Buffer.byteLength(
                normalizedAvatarId,
                "utf8"
            ) >
                VoiceConnectionFieldLimits
                    .avatarIdBytes ||
            Buffer.byteLength(
                normalizedTransportName,
                "utf8"
            ) >
                VoiceConnectionFieldLimits
                    .transportNameBytes ||
            Buffer.byteLength(
                normalizedTransportConnectionKey,
                "utf8"
            ) >
                VoiceConnectionFieldLimits
                    .transportConnectionKeyBytes
        ) {
            return Object.freeze({
                ready: false,
                retryable: false,
                code:
                    VoiceAuthResultCode
                        .INVALID_PAYLOAD,
                stage:
                    VoiceConnectionPreparationStage
                        .REQUEST_FIELDS,
                userId:
                    String(
                        tokenResult.userId ?? ""
                    ).trim(),
                roomId: normalizedRoomId,
                realtimeConnectionId: "",
                dedicatedSessionId: "",
                dedicatedServerId: "",
                dedicatedConnectionId: "",
                dedicatedPlayerId: "",
                realtimeConnection: null,
                registrationInput: null
            });
        }

        const membershipResult =
            this.realtimeMembershipAdapter.verify({
                userId:
                    tokenResult.userId,
                roomId:
                    normalizedRoomId
            });

        if (
            membershipResult?.success !== true
        ) {
            return Object.freeze({
                ready: false,
                retryable:
                    membershipResult?.retryable ===
                    true,
                code:
                    membershipResult?.code ??
                    VoiceAuthResultCode
                        .REALTIME_NOT_READY,
                stage:
                    VoiceConnectionPreparationStage
                        .REALTIME_MEMBERSHIP,
                userId:
                    String(
                        tokenResult.userId ?? ""
                    ).trim(),
                roomId: normalizedRoomId,
                realtimeConnectionId: "",
                dedicatedSessionId: "",
                dedicatedServerId: "",
                dedicatedConnectionId: "",
                dedicatedPlayerId: "",
                realtimeConnection: null,
                registrationInput: null
            });
        }

        const dedicatedResult =
            this.dedicatedPlayerAdapter.verify({
                userId:
                    tokenResult.userId,
                roomId:
                    normalizedRoomId
            });

        if (
            dedicatedResult?.success !== true
        ) {
            return Object.freeze({
                ready: false,
                retryable:
                    dedicatedResult?.retryable === true,
                code:
                    dedicatedResult?.code ??
                    VoiceAuthResultCode
                        .DEDICATED_NOT_AUTHENTICATED,
                stage:
                    VoiceConnectionPreparationStage
                        .DEDICATED_PLAYER,
                userId:
                    String(
                        tokenResult.userId ?? ""
                    ).trim(),
                roomId: normalizedRoomId,
                realtimeConnectionId:
                    String(
                        membershipResult
                            .realtimeConnectionId ??
                        ""
                    ).trim(),
                dedicatedSessionId: "",
                dedicatedServerId: "",
                dedicatedConnectionId: "",
                dedicatedPlayerId: "",
                realtimeConnection:
                    membershipResult
                        .realtimeConnection,
                registrationInput: null
            });
        }

        const dedicatedConnectionIdHex =
            String(
                dedicatedResult.connectionId ??
                ""
            )
                .trim()
                .toLowerCase()
                .replaceAll("-", "");

        if (
            !/^[0-9a-f]{32}$/.test(
                dedicatedConnectionIdHex
            )
        ) {
            return Object.freeze({
                ready: false,
                retryable: true,
                code:
                    VoiceAuthResultCode
                        .DEDICATED_NOT_AUTHENTICATED,
                stage:
                    VoiceConnectionPreparationStage
                        .DEDICATED_PLAYER,
                userId:
                    String(
                        dedicatedResult.userId ??
                        tokenResult.userId ??
                        ""
                    ).trim(),
                roomId:
                    normalizedRoomId,
                realtimeConnectionId:
                    String(
                        membershipResult
                            .realtimeConnectionId ??
                        ""
                    ).trim(),
                dedicatedSessionId:
                    String(
                        dedicatedResult.sessionId ??
                        ""
                    ).trim(),
                dedicatedServerId:
                    String(
                        dedicatedResult.serverId ??
                        ""
                    ).trim(),
                dedicatedConnectionId:
                    String(
                        dedicatedResult.connectionId ??
                        ""
                    ).trim(),
                dedicatedPlayerId:
                    String(
                        dedicatedResult.playerId ??
                        ""
                    ).trim(),
                realtimeConnection:
                    membershipResult
                        .realtimeConnection,
                registrationInput: null
            });
        }

        const voiceConnectionId =
            dedicatedConnectionIdHex.slice(0, 8) +
            "-" +
            dedicatedConnectionIdHex.slice(8, 12) +
            "-" +
            dedicatedConnectionIdHex.slice(12, 16) +
            "-" +
            dedicatedConnectionIdHex.slice(16, 20) +
            "-" +
            dedicatedConnectionIdHex.slice(20);

        const registrationInput =
            Object.freeze({
                connectionId:
                    voiceConnectionId,

                userId:
                    String(
                        dedicatedResult.userId
                    ).trim(),

                avatarId:
                    normalizedTokenUserId,

                roomId:
                    String(
                        dedicatedResult.roomId
                    ).trim(),

                platform,

                clientInstanceId:
                    normalizedClientInstanceId,

                transportName:
                    normalizedTransportName,

                transportConnectionKey:
                    normalizedTransportConnectionKey,

                createdAtMs
            });

        return Object.freeze({
            ready: true,
            retryable: false,
            code:
                VoiceAuthResultCode.AUTHENTICATED,
            stage:
                VoiceConnectionPreparationStage
                    .READY_FOR_REGISTRATION,
            userId:
                registrationInput.userId,
            roomId:
                registrationInput.roomId,
            realtimeConnectionId:
                String(
                    membershipResult
                        .realtimeConnectionId ??
                    ""
                ).trim(),
            dedicatedSessionId:
                String(
                    dedicatedResult.sessionId ??
                    ""
                ).trim(),
            dedicatedServerId:
                String(
                    dedicatedResult.serverId ??
                    ""
                ).trim(),
            dedicatedConnectionId:
                String(
                    dedicatedResult.connectionId ??
                    ""
                ).trim(),
            dedicatedPlayerId:
                String(
                    dedicatedResult.playerId ??
                    ""
                ).trim(),
            realtimeConnection:
                membershipResult
                    .realtimeConnection,
            registrationInput
        });
    }
}

export {
    VoiceConnectionPreparationService,
    VoiceConnectionPreparationStage
};

/*
توضیح فایل:
این فایل توکن کاربر، حضور او در روم ریل‌تایم و حضور همان شناسه کاربر در سرور اختصاصی همان روم را بررسی می‌کند. پس از موفقیت هر سه بررسی، اطلاعات لازم برای ثبت اتصال صوتی آماده می‌شوند.
*/
