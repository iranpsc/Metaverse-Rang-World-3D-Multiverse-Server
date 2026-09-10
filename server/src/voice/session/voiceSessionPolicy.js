// File: src/voice/session/voiceSessionPolicy.js

import {
    VoiceProximityDecision,
    VoiceSessionReason
} from "./voiceSessionConstants.js";

//* این ثابت قوانین پایه ایجاد و نگهداری Sessionهای فاصله‌ای Voice را مشخص می‌کند.
const VoiceSessionMembershipPolicy = Object.freeze({
    topology: "authoritative_pair_edge",
    nonTransitiveAudibility: true,
    maxParticipantsPerSession: 2,
    participantCanJoinMultipleSessions: true,

    sessionIdAuthority: "server",
    clientCanChooseSessionId: false,
    reuseClosedSessionId: false,

    distanceSource: "dedicated_authoritative_transform",
    enterDistanceMeters: 3,
    exitDistanceMeters: 3.5,

    stabilityConfirmationRequired: true,
    stabilityDelayMs: null,
    stabilityDelaySelection: "benchmark_required"
});

//* این تابع یک بخش متنی هویت عضو را برای استفاده در قرارداد سشن بررسی می‌کند.
function normalizeVoiceParticipantIdentityText(value, fieldName) {
    if (typeof value !== "string") {
        throw new TypeError(`${fieldName} must be a string.`);
    }

    const normalizedValue = value.trim();

    if (!normalizedValue) {
        throw new Error(`${fieldName} is required.`);
    }

    if (Buffer.byteLength(normalizedValue, "utf8") > 512) {
        throw new RangeError(`${fieldName} exceeds 512 UTF-8 bytes.`);
    }

    return normalizedValue;
}

//* این تابع نام قدیمی فیلد قرارداد باینری را نگه می‌دارد و مقدار آن را مانند متن هویت بررسی می‌کند.
function normalizeVoiceParticipantAvatarId(value, fieldName) {
    return normalizeVoiceParticipantIdentityText(
        value,
        fieldName
    );
}

//* این تابع برای دو اتصال کاربر در همان سرور و روم یک کلید ثابت و مستقل از ترتیب ورودی می‌سازد.
function createCanonicalVoiceParticipantPairKey(
    serverId,
    roomId,
    firstUserId,
    firstConnectionId,
    secondUserId,
    secondConnectionId
) {
    const normalizedServerId =
        normalizeVoiceParticipantIdentityText(
            serverId,
            "serverId"
        );

    const normalizedRoomId =
        normalizeVoiceParticipantIdentityText(
            roomId,
            "roomId"
        );

    const first = Object.freeze([
        normalizeVoiceParticipantIdentityText(
            firstUserId,
            "firstUserId"
        ),
        normalizeVoiceParticipantIdentityText(
            firstConnectionId,
            "firstConnectionId"
        )
    ]);

    const second = Object.freeze([
        normalizeVoiceParticipantIdentityText(
            secondUserId,
            "secondUserId"
        ),
        normalizeVoiceParticipantIdentityText(
            secondConnectionId,
            "secondConnectionId"
        )
    ]);

    if (first[0] === second[0]) {
        throw new Error(
            "A Voice session requires two different userId values."
        );
    }

    if (first[1] === second[1]) {
        throw new Error(
            "A Voice session requires two different connectionId values."
        );
    }

    const firstBytes =
        Buffer.from(
            JSON.stringify(first),
            "utf8"
        );

    const secondBytes =
        Buffer.from(
            JSON.stringify(second),
            "utf8"
        );

    const orderedPair =
        Buffer.compare(
            firstBytes,
            secondBytes
        ) <= 0
            ? [first, second]
            : [second, first];

    return JSON.stringify([
        normalizedServerId,
        normalizedRoomId,
        orderedPair[0],
        orderedPair[1]
    ]);
}

//* این تابع فاصله معتبر بین دو آواتار را بررسی می‌کند.
function assertVoiceDistanceMeters(value) {
    if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0
    ) {
        throw new RangeError(
            "distanceMeters must be a finite non-negative number."
        );
    }

    return value;
}

//* این تابع با استفاده از فاصله authoritative، نامزد ورود یا خروج از Session را مشخص می‌کند.
function evaluateVoiceProximityCandidate({
    isCurrentlyMember,
    distanceMeters
} = {}) {
    if (typeof isCurrentlyMember !== "boolean") {
        throw new TypeError("isCurrentlyMember must be a boolean.");
    }

    const distance = assertVoiceDistanceMeters(distanceMeters);

    if (
        !isCurrentlyMember &&
        distance <= VoiceSessionMembershipPolicy.enterDistanceMeters
    ) {
        return Object.freeze({
            decision: VoiceProximityDecision.ENTER_CANDIDATE,
            reason: VoiceSessionReason.PROXIMITY_ENTER,
            distanceMeters: distance,
            requiresStabilityConfirmation: true
        });
    }

    if (
        isCurrentlyMember &&
        distance >= VoiceSessionMembershipPolicy.exitDistanceMeters
    ) {
        return Object.freeze({
            decision: VoiceProximityDecision.EXIT_CANDIDATE,
            reason: VoiceSessionReason.PROXIMITY_EXIT,
            distanceMeters: distance,
            requiresStabilityConfirmation: true
        });
    }

    return Object.freeze({
        decision: VoiceProximityDecision.KEEP_CURRENT_STATE,
        reason: VoiceSessionReason.NONE,
        distanceMeters: distance,
        requiresStabilityConfirmation: false
    });
}

export {
    VoiceSessionMembershipPolicy,
    assertVoiceDistanceMeters,
    createCanonicalVoiceParticipantPairKey,
    evaluateVoiceProximityCandidate,
    normalizeVoiceParticipantAvatarId
};
