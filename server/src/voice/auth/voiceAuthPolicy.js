// File: src/voice/auth/voiceAuthPolicy.js

import {
    assertVoiceClientPlatform
} from "./voiceAuthConstants.js";

//* این ثابت قوانین اعتبارسنجی اتصال Voice را مشخص می‌کند.
const VoiceAuthVerificationPolicy = Object.freeze({
    accessTokenVerifier: "tokenService.verifyAccessToken",
    userIdClaim: "sub",
    acceptClientProvidedUserId: false,

    requiredChecks: Object.freeze([
        "access_token_valid",
        "user_id_present_in_verified_token",
        "realtime_connection_ready",
        "room_joined_by_verified_user",
        "avatar_owned_by_verified_user",
        "dedicated_connection_authenticated",
        "voice_access_allowed"
    ])
});

//* این تابع هویت تأییدشده Voice را از توکن معتبر و درخواست کلاینت می‌سازد.
function createVoiceAuthenticatedSubject({
    verifiedTokenPayload,
    request
} = {}) {
    if (
        !verifiedTokenPayload ||
        typeof verifiedTokenPayload !== "object"
    ) {
        throw new TypeError("verifiedTokenPayload must be an object.");
    }

    const userId = String(
        verifiedTokenPayload[
            VoiceAuthVerificationPolicy.userIdClaim
        ] ?? ""
    ).trim();

    if (!userId) {
        throw new Error("Verified access token does not contain a user identifier.");
    }

    if (!request || typeof request !== "object") {
        throw new TypeError("Voice authentication request must be an object.");
    }

    assertVoiceClientPlatform(request.platform);

    const roomId = String(request.roomId ?? "").trim();
    const avatarId = String(request.avatarId ?? "").trim();
    const clientInstanceId = String(request.clientInstanceId ?? "").trim();
    const clientBuild = String(request.clientBuild ?? "").trim();

    if (!roomId) {
        throw new Error("Voice authentication request does not contain roomId.");
    }

    if (!avatarId) {
        throw new Error("Voice authentication request does not contain avatarId.");
    }

    if (avatarId !== userId) {
        throw new Error("Voice authentication avatarId must equal the verified userId.");
    }

    if (!clientInstanceId) {
        throw new Error("Voice authentication request does not contain clientInstanceId.");
    }

    return Object.freeze({
        userId,
        roomId,
        avatarId,
        platform: request.platform,
        clientInstanceId,
        clientBuild
    });
}

export {
    VoiceAuthVerificationPolicy,
    createVoiceAuthenticatedSubject
};
