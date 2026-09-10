// مسیر فایل: src/voice/session/voiceSessionRecord.js

import {
    VoiceSessionReason,
    VoiceSessionState,
    assertVoiceSessionReason
} from "./voiceSessionConstants.js";

import {
    createCanonicalVoiceParticipantPairKey,
    normalizeVoiceParticipantAvatarId
} from "./voiceSessionPolicy.js";

const VOICE_UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

//* این تابع یک متن ضروری را پاک‌سازی می‌کند و اندازه آن را بررسی می‌کند.
function normalizeRequiredVoiceSessionText(
    value,
    fieldName,
    maximumBytes = 512
) {
    if (typeof value !== "string") {
        throw new TypeError(
            `${fieldName} must be a string.`
        );
    }

    const normalizedValue =
        value.trim();

    if (!normalizedValue) {
        throw new Error(
            `${fieldName} is required.`
        );
    }

    if (
        Buffer.byteLength(
            normalizedValue,
            "utf8"
        ) > maximumBytes
    ) {
        throw new RangeError(
            `${fieldName} exceeds ${maximumBytes} UTF-8 bytes.`
        );
    }

    return normalizedValue;
}

//* این تابع شناسه یکتای سشن را پاک‌سازی و اعتبارسنجی می‌کند.
function normalizeVoiceSessionId(
    value,
    fieldName = "sessionId"
) {
    if (
        typeof value !== "string" ||
        !VOICE_UUID_PATTERN.test(
            value.trim()
        )
    ) {
        throw new TypeError(
            `${fieldName} must be a valid UUID.`
        );
    }

    return value
        .trim()
        .toLowerCase();
}

//* این تابع زمان رویداد سشن را به عدد صحیح نامنفی تبدیل می‌کند.
function normalizeVoiceSessionEventTime(
    value,
    fieldName
) {
    if (
        !Number.isSafeInteger(value) ||
        value < 0
    ) {
        throw new RangeError(
            `${fieldName} must be a non-negative safe integer.`
        );
    }

    return value;
}

//* این تابع فاصله قطعی دو آواتار را بررسی می‌کند.
function normalizeVoiceSessionDistance(
    value
) {
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

//* این تابع اطلاعات یک عضو سشن را پاک‌سازی و قفل می‌کند.
function normalizeVoiceSessionParticipant(
    value,
    fieldName
) {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
    ) {
        throw new TypeError(
            `${fieldName} must be an object.`
        );
    }

    const connectionId =
        normalizeRequiredVoiceSessionText(
            value.connectionId,
            `${fieldName}.connectionId`
        );

    const userId =
        normalizeRequiredVoiceSessionText(
            value.userId,
            `${fieldName}.userId`
        );

    const legacyAvatarId =
        normalizeVoiceParticipantAvatarId(
            value.avatarId,
            `${fieldName}.avatarId`
        );

    if (legacyAvatarId !== userId) {
        throw new Error(
            `${fieldName}.avatarId must equal ${fieldName}.userId.`
        );
    }

    return Object.freeze({
        connectionId,
        userId,
        avatarId:
            userId
    });
}

class VoiceSessionRecord {
    //* این سازنده یک سشن قطعی را از یک Pair اولیه و دو اتصال متفاوت ایجاد می‌کند.
    constructor({
        sessionId,
        roomId,
        serverId,
        firstParticipant,
        secondParticipant,
        distanceMeters,
        reason =
            VoiceSessionReason
                .PROXIMITY_ENTER,
        effectiveAtMs = Date.now()
    } = {}) {
        const first =
            normalizeVoiceSessionParticipant(
                firstParticipant,
                "firstParticipant"
            );

        const second =
            normalizeVoiceSessionParticipant(
                secondParticipant,
                "secondParticipant"
            );

        if (
            first.connectionId ===
            second.connectionId
        ) {
            throw new Error(
                "A Voice session requires two different connections."
            );
        }

        if (
            first.userId ===
                second.userId
        ) {
            throw new Error(
                "A Voice session requires two different userId values."
            );
        }

        this.sessionId =
            normalizeVoiceSessionId(
                sessionId
            );

        this.roomId =
            normalizeRequiredVoiceSessionText(
                roomId,
                "roomId"
            );

        this.serverId =
            normalizeRequiredVoiceSessionText(
                serverId,
                "serverId"
            );

        this.pairKey =
            createCanonicalVoiceParticipantPairKey(
                this.serverId,
                this.roomId,
                first.userId,
                first.connectionId,
                second.userId,
                second.connectionId
            );

        this.participants =
            Object.freeze([
                first,
                second
            ]);

        this.state =
            VoiceSessionState.ACTIVE;

        this.reason =
            assertVoiceSessionReason(
                reason
            );

        this.distanceMeters =
            normalizeVoiceSessionDistance(
                distanceMeters
            );

        this.createdAtMs =
            normalizeVoiceSessionEventTime(
                effectiveAtMs,
                "effectiveAtMs"
            );

        this.effectiveAtMs =
            this.createdAtMs;

        this.closedAtMs = null;

        Object.seal(this);
    }

    //* این تابع مشخص می‌کند اتصال داده‌شده عضو این سشن است یا نه.
    hasConnection(
        connectionId
    ) {
        const normalizedConnectionId =
            String(
                connectionId ?? ""
            ).trim();

        return this.participants.some(
            (participant) =>
                participant.connectionId ===
                normalizedConnectionId
        );
    }

    //* این تابع عضویت دقیق یک ترکیب userId و connectionId را بدون اتکا به ترتیب اعضا بررسی می‌کند.
    hasParticipant(
        participant
    ) {
        const normalizedParticipant =
            normalizeVoiceSessionParticipant(
                participant,
                "participant"
            );

        return this.participants.some(
            (currentParticipant) =>
                currentParticipant.userId ===
                    normalizedParticipant.userId &&
                currentParticipant.connectionId ===
                    normalizedParticipant.connectionId
        );
    }

    //* این تابع عضو تازه را بدون تغییر SessionId به سشن فعال اضافه می‌کند و از هویت تکراری جلوگیری می‌کند.
    addParticipant({
        participant,
        effectiveAtMs = Date.now()
    } = {}) {
        if (
            this.state !==
            VoiceSessionState.ACTIVE
        ) {
            throw new Error(
                "Only an active Voice session can add a participant."
            );
        }

        const normalizedParticipant =
            normalizeVoiceSessionParticipant(
                participant,
                "participant"
            );

        const existingIdentity =
            this.participants.find(
                (currentParticipant) =>
                    currentParticipant.userId ===
                        normalizedParticipant.userId ||
                    currentParticipant.connectionId ===
                        normalizedParticipant.connectionId
            ) ?? null;

        if (existingIdentity) {
            if (
                existingIdentity.userId ===
                    normalizedParticipant.userId &&
                existingIdentity.connectionId ===
                    normalizedParticipant.connectionId
            ) {
                return this.snapshot();
            }

            throw new Error(
                "A Voice session cannot contain duplicate userId or connectionId identities."
            );
        }

        this.participants =
            Object.freeze([
                ...this.participants,
                normalizedParticipant
            ]);

        this.reason =
            VoiceSessionReason.PROXIMITY_ENTER;

        this.effectiveAtMs =
            normalizeVoiceSessionEventTime(
                effectiveAtMs,
                "effectiveAtMs"
            );

        return this.snapshot();
    }

    //* این تابع یک عضو تعیین‌شده را از سشن گروهی فعال حذف و شناسه پایدار سشن را حفظ می‌کند.
    removeParticipant({
        participant,
        reason,
        effectiveAtMs = Date.now()
    } = {}) {
        if (
            this.state !==
            VoiceSessionState.ACTIVE
        ) {
            throw new Error(
                "Only an active Voice session can remove a participant."
            );
        }

        if (
            this.participants.length <= 2
        ) {
            throw new Error(
                "A two-member Voice session must be closed instead of removing one participant."
            );
        }

        const normalizedParticipant =
            normalizeVoiceSessionParticipant(
                participant,
                "participant"
            );

        const participantIndex =
            this.participants.findIndex(
                (currentParticipant) =>
                    currentParticipant.userId ===
                        normalizedParticipant.userId &&
                    currentParticipant.connectionId ===
                        normalizedParticipant.connectionId
            );

        if (
            participantIndex < 0
        ) {
            return this.snapshot();
        }

        const normalizedReason =
            assertVoiceSessionReason(
                reason
            );

        if (
            normalizedReason ===
            VoiceSessionReason.NONE
        ) {
            throw new Error(
                "Removing a Voice group member requires a leave reason."
            );
        }

        const remainingParticipants =
            this.participants.filter(
                (_currentParticipant, index) =>
                    index !== participantIndex
            );

        this.participants =
            Object.freeze(
                remainingParticipants
            );

        this.pairKey =
            createCanonicalVoiceParticipantPairKey(
                this.serverId,
                this.roomId,
                remainingParticipants[0].userId,
                remainingParticipants[0].connectionId,
                remainingParticipants[1].userId,
                remainingParticipants[1].connectionId
            );

        this.reason =
            normalizedReason;

        this.effectiveAtMs =
            normalizeVoiceSessionEventTime(
                effectiveAtMs,
                "effectiveAtMs"
            );

        return this.snapshot();
    }

    //* این تابع عضو مقابل یک اتصال را در سشن زوجی برمی‌گرداند.
    getPeerByConnectionId(
        connectionId
    ) {
        const normalizedConnectionId =
            String(
                connectionId ?? ""
            ).trim();

        if (
            !this.hasConnection(
                normalizedConnectionId
            )
        ) {
            return null;
        }

        return this.participants.find(
            (participant) =>
                participant.connectionId !==
                normalizedConnectionId
        ) ?? null;
    }

    //* این تابع فاصله قطعی تازه سشن را بدون تغییر شناسه و اعضا ثبت می‌کند.
    updateDistance({
        distanceMeters,
        effectiveAtMs = Date.now()
    } = {}) {
        if (
            this.state !==
            VoiceSessionState.ACTIVE
        ) {
            throw new Error(
                "Only an active Voice session can update its distance."
            );
        }

        this.distanceMeters =
            normalizeVoiceSessionDistance(
                distanceMeters
            );

        this.effectiveAtMs =
            normalizeVoiceSessionEventTime(
                effectiveAtMs,
                "effectiveAtMs"
            );

        return this.snapshot();
    }

    //* این تابع سشن فعال را با علت قطعی می‌بندد و شناسه آن را غیرقابل استفاده دوباره می‌کند.
    close({
        reason,
        effectiveAtMs = Date.now()
    } = {}) {
        const normalizedReason =
            assertVoiceSessionReason(
                reason
            );

        if (
            normalizedReason ===
            VoiceSessionReason.NONE
        ) {
            throw new Error(
                "Closing a Voice session requires a close reason."
            );
        }

        if (
            this.state ===
            VoiceSessionState.CLOSED
        ) {
            return this.snapshot();
        }

        this.reason =
            normalizedReason;

        this.effectiveAtMs =
            normalizeVoiceSessionEventTime(
                effectiveAtMs,
                "effectiveAtMs"
            );

        this.closedAtMs =
            this.effectiveAtMs;

        this.state =
            VoiceSessionState.CLOSED;

        return this.snapshot();
    }

    //* این تابع توصیف سشن را از دید یک اتصال برای پیام عضویت آماده می‌کند.
    toDescriptorForConnection(
        connectionId
    ) {
        const peer =
            this.getPeerByConnectionId(
                connectionId
            );

        if (!peer) {
            throw new Error(
                "The requested connection is not a member of this Voice session."
            );
        }

        return Object.freeze({
            sessionId:
                this.sessionId,

            state:
                this.state,

            reason:
                this.reason,

            distanceMeters:
                this.distanceMeters,

            effectiveAtMs:
                this.effectiveAtMs,

            peerUserId:
                peer.userId,

            peerAvatarId:
                peer.userId
        });
    }

    //* این تابع نسخه خواندنی و قفل‌شده وضعیت کامل سشن را برمی‌گرداند.
    snapshot() {
        return Object.freeze({
            sessionId:
                this.sessionId,

            roomId:
                this.roomId,

            serverId:
                this.serverId,

            pairKey:
                this.pairKey,

            participants:
                this.participants,

            state:
                this.state,

            reason:
                this.reason,

            distanceMeters:
                this.distanceMeters,

            createdAtMs:
                this.createdAtMs,

            effectiveAtMs:
                this.effectiveAtMs,

            closedAtMs:
                this.closedAtMs
        });
    }
}

export {
    VoiceSessionRecord,
    normalizeVoiceSessionId,
    normalizeVoiceSessionParticipant
};

/*
توضیح فایل:
این فایل یک سشن صوتی را از Pair اولیه می‌سازد و عضویت پویا را با SessionId پایدار نگه می‌دارد. سشن فعال هرگز کمتر از دو عضو ندارد و شناسه بسته‌شده دوباره فعال نمی‌شود.
*/
