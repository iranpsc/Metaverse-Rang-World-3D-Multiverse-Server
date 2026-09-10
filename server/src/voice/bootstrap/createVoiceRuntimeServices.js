// مسیر فایل: src/voice/bootstrap/createVoiceRuntimeServices.js

import {
    VoiceDedicatedPlayerAdapter
} from "../adapters/voiceDedicatedPlayerAdapter.js";

import {
    VoiceRealtimeMembershipAdapter
} from "../adapters/voiceRealtimeMembershipAdapter.js";

import {
    VoiceConnectionPreparationService
} from "../core/voiceConnectionPreparationService.js";

import {
    VoiceConnectionRegistrationService
} from "../core/voiceConnectionRegistrationService.js";

import {
    VoiceConnectionRegistry
} from "../core/voiceConnectionRegistry.js";

import {
    sharedVoiceAccessTokenVerifier
} from "./sharedVoiceAccessTokenVerifier.js";

//* این تابع نمونه‌های زنده ریل‌تایم و سرور اختصاصی را به سرویس‌های ارتباط صوتی متصل می‌کند.
function createVoiceRuntimeServices({
    realtimeRuntime,
    gameServerControlRuntime,

    accessTokenVerifier =
        sharedVoiceAccessTokenVerifier,

    voiceConnectionRegistry =
        new VoiceConnectionRegistry()
} = {}) {
    if (
        !realtimeRuntime ||
        typeof realtimeRuntime !==
            "object"
    ) {
        throw new TypeError(
            "realtimeRuntime must be an object."
        );
    }

    if (
        !realtimeRuntime.registry ||
        typeof realtimeRuntime
            .registry
            .getAll !== "function"
    ) {
        throw new TypeError(
            "realtimeRuntime.registry must provide getAll."
        );
    }

    if (
        !realtimeRuntime.rooms ||
        typeof realtimeRuntime
            .rooms
            .hasConnection !==
            "function"
    ) {
        throw new TypeError(
            "realtimeRuntime.rooms must provide hasConnection."
        );
    }

    if (
        !gameServerControlRuntime ||
        typeof gameServerControlRuntime !==
            "object" ||
        !gameServerControlRuntime
            .sessionRegistry
    ) {
        throw new TypeError(
            "gameServerControlRuntime.sessionRegistry is required."
        );
    }

    if (
        !voiceConnectionRegistry ||
        typeof voiceConnectionRegistry
            .registerAuthenticatedConnection !==
            "function" ||
        typeof voiceConnectionRegistry
            .getByConnectionId !==
            "function" ||
        typeof voiceConnectionRegistry
            .getStats !==
            "function"
    ) {
        throw new TypeError(
            "voiceConnectionRegistry does not provide the required interface."
        );
    }

    const realtimeMembershipAdapter =
        new VoiceRealtimeMembershipAdapter({
            registry:
                realtimeRuntime.registry,

            rooms:
                realtimeRuntime.rooms
        });

    const dedicatedPlayerAdapter =
        new VoiceDedicatedPlayerAdapter({
            sessionRegistry:
                gameServerControlRuntime
                    .sessionRegistry
        });

    const connectionPreparationService =
        new VoiceConnectionPreparationService({
            accessTokenVerifier,
            realtimeMembershipAdapter,
            dedicatedPlayerAdapter
        });

    const connectionRegistrationService =
        new VoiceConnectionRegistrationService({
            connectionPreparationService,
            voiceConnectionRegistry
        });

    return Object.freeze({
        accessTokenVerifier,

        realtimeRegistry:
            realtimeRuntime.registry,

        realtimeRooms:
            realtimeRuntime.rooms,

        gameSessionRegistry:
            gameServerControlRuntime
                .sessionRegistry,

        realtimeMembershipAdapter,

        dedicatedPlayerAdapter,

        connectionPreparationService,

        connectionRegistrationService,

        voiceConnectionRegistry
    });
}

export {
    createVoiceRuntimeServices
};

/*
توضیح فایل:
این فایل نمونه‌های زنده ریل‌تایم و سرور اختصاصی را به سرویس صوت متصل می‌کند. سرویس ثبت اتصال نیز از همین نمونه‌های زنده استفاده می‌کند و رجیستری جداگانه‌ای برای گیم‌سرور نمی‌سازد.
*/
