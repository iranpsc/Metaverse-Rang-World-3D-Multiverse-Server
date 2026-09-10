// مسیر فایل: src/voice/core/voiceConnectionRecord.js

import {
    VoiceClientPlatformNameByValue
} from "../auth/voiceAuthConstants.js";

import {
    VoiceConnectionCloseReason,
    VoiceConnectionCloseReasonNameByValue,
    VoiceConnectionFieldLimits,
    VoiceConnectionState,
    VoiceConnectionStateNameByValue
} from "./voiceConnectionConstants.js";

const VOICE_UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_SEQUENCE_NUMBER = 0xffffffff;

//* این تابع یک متن ضروری را پاک‌سازی می‌کند و اندازه آن را بررسی می‌کند.
function normalizeRequiredVoiceText(value, fieldName, maximumBytes) {
    if (typeof value !== "string") {
        throw new TypeError(`${fieldName} must be a string.`);
    }

    const normalizedValue = value.trim();

    if (!normalizedValue) {
        throw new Error(`${fieldName} is required.`);
    }

    if (
        Buffer.byteLength(normalizedValue, "utf8") >
        maximumBytes
    ) {
        throw new RangeError(
            `${fieldName} exceeds its maximum UTF-8 byte length.`
        );
    }

    return normalizedValue;
}

//* این تابع یک شناسه یکتا را پاک‌سازی و اعتبارسنجی می‌کند.
function normalizeVoiceUuid(value, fieldName) {
    if (
        typeof value !== "string" ||
        !VOICE_UUID_PATTERN.test(value.trim())
    ) {
        throw new TypeError(
            `${fieldName} must be a valid UUID.`
        );
    }

    return value.trim().toLowerCase();
}

//* این تابع یک زمان را به عدد صحیح نامنفی تبدیل می‌کند.
function normalizeVoiceConnectionTime(value, fieldName) {
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

//* این تابع شماره ترتیب بسته صوتی را در محدوده مجاز بررسی می‌کند.
function normalizeVoiceSequenceNumber(value, fieldName) {
    if (
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > MAX_SEQUENCE_NUMBER
    ) {
        throw new RangeError(
            `${fieldName} must be an unsigned 32-bit integer.`
        );
    }

    return value;
}

class VoiceConnectionRecord {
    //* این سازنده اطلاعات اتصال احراز‌شده را ثبت و وضعیت اولیه آن را ایجاد می‌کند.
    constructor({
        connectionId = null,
        userId,
        avatarId,
        roomId,
        platform,
        clientInstanceId,
        transportName,
        transportConnectionKey,
        createdAtMs = Date.now()
    } = {}) {
        if (
            !Number.isInteger(platform) ||
            !Object.hasOwn(
                VoiceClientPlatformNameByValue,
                platform
            )
        ) {
            throw new RangeError(
                `Unknown Voice client platform: ${String(platform)}.`
            );
        }

        const normalizedClientInstanceId =
            normalizeVoiceUuid(
                clientInstanceId,
                "clientInstanceId"
            );

        this.connectionId =
            normalizeVoiceUuid(
                connectionId ??
                    normalizedClientInstanceId,
                "connectionId"
            );

        if (
            typeof userId !== "string" ||
            !userId.trim()
        ) {
            throw new TypeError(
                "userId must be a non-empty string."
            );
        }

        const normalizedUserId =
            userId.trim();

        if (
            Buffer.byteLength(
                normalizedUserId,
                "utf8"
            ) > 512
        ) {
            throw new RangeError(
                "userId exceeds 512 UTF-8 bytes."
            );
        }

        this.userId =
            normalizedUserId;

        const normalizedAvatarId =
            normalizeRequiredVoiceText(
                avatarId,
                "avatarId",
                VoiceConnectionFieldLimits.avatarIdBytes
            );

        if (
            normalizedAvatarId !==
            normalizedUserId
        ) {
            throw new Error(
                "avatarId must equal the authenticated userId."
            );
        }

        this.avatarId =
            normalizedAvatarId;

        this.roomId =
            normalizeRequiredVoiceText(
                roomId,
                "roomId",
                VoiceConnectionFieldLimits.roomIdBytes
            );

        this.platform = platform;

        this.clientInstanceId =
            normalizedClientInstanceId;

        this.transportName =
            normalizeRequiredVoiceText(
                transportName,
                "transportName",
                VoiceConnectionFieldLimits.transportNameBytes
            );

        this.transportConnectionKey =
            normalizeRequiredVoiceText(
                transportConnectionKey,
                "transportConnectionKey",
                VoiceConnectionFieldLimits
                    .transportConnectionKeyBytes
            );

        this.state =
            VoiceConnectionState.AUTHENTICATED;

        this.createdAtMs =
            normalizeVoiceConnectionTime(
                createdAtMs,
                "createdAtMs"
            );

        this.activatedAtMs = null;
        this.disconnectedAtMs = null;
        this.resumedAtMs = null;
        this.closedAtMs = null;

        this.lastReceivedSequence = 0;
        this.lastPublishedSequence = 0;

        this.closeReason =
            VoiceConnectionCloseReason.NONE;

        Object.seal(this);
    }

    //* این تابع اتصال احراز‌شده را وارد وضعیت فعال می‌کند.
    activate(nowMs = Date.now()) {
        if (
            this.state !==
            VoiceConnectionState.AUTHENTICATED
        ) {
            throw new Error(
                "Only an authenticated Voice connection can be activated."
            );
        }

        this.activatedAtMs =
            normalizeVoiceConnectionTime(
                nowMs,
                "nowMs"
            );

        this.state =
            VoiceConnectionState.ACTIVE;

        return this.snapshot();
    }

    //* این تابع اتصال فعال را برای بازیابی بعدی به حالت تعلیق می‌برد.
    suspend(disconnectedAtMs = Date.now()) {
        if (
            this.state !==
                VoiceConnectionState.ACTIVE &&
            this.state !==
                VoiceConnectionState.AUTHENTICATED
        ) {
            throw new Error(
                "Only an active or authenticated Voice connection can be suspended."
            );
        }

        this.disconnectedAtMs =
            normalizeVoiceConnectionTime(
                disconnectedAtMs,
                "disconnectedAtMs"
            );

        this.state =
            VoiceConnectionState.SUSPENDED;

        return this.snapshot();
    }

    //* این تابع اتصال معلق را با راه انتقال جدید دوباره فعال می‌کند.
    resume({
        transportName,
        transportConnectionKey,
        resumedAtMs = Date.now()
    } = {}) {
        if (
            this.state !==
            VoiceConnectionState.SUSPENDED
        ) {
            throw new Error(
                "Only a suspended Voice connection can be resumed."
            );
        }

        this.transportName =
            normalizeRequiredVoiceText(
                transportName,
                "transportName",
                VoiceConnectionFieldLimits.transportNameBytes
            );

        this.transportConnectionKey =
            normalizeRequiredVoiceText(
                transportConnectionKey,
                "transportConnectionKey",
                VoiceConnectionFieldLimits
                    .transportConnectionKeyBytes
            );

        this.resumedAtMs =
            normalizeVoiceConnectionTime(
                resumedAtMs,
                "resumedAtMs"
            );

        this.disconnectedAtMs = null;

        this.state =
            VoiceConnectionState.ACTIVE;

        return this.snapshot();
    }

    //* این تابع آخرین شماره‌های دریافت و انتشار صوت را به‌روزرسانی می‌کند.
    updateSequences({
        lastReceivedSequence,
        lastPublishedSequence
    } = {}) {
        if (
            lastReceivedSequence !== undefined
        ) {
            const normalizedReceived =
                normalizeVoiceSequenceNumber(
                    lastReceivedSequence,
                    "lastReceivedSequence"
                );

            if (
                normalizedReceived <
                this.lastReceivedSequence
            ) {
                throw new RangeError(
                    "lastReceivedSequence cannot move backwards."
                );
            }

            this.lastReceivedSequence =
                normalizedReceived;
        }

        if (
            lastPublishedSequence !== undefined
        ) {
            const normalizedPublished =
                normalizeVoiceSequenceNumber(
                    lastPublishedSequence,
                    "lastPublishedSequence"
                );

            if (
                normalizedPublished <
                this.lastPublishedSequence
            ) {
                throw new RangeError(
                    "lastPublishedSequence cannot move backwards."
                );
            }

            this.lastPublishedSequence =
                normalizedPublished;
        }

        return this.snapshot();
    }

    //* این تابع اتصال صوتی را با علت مشخص می‌بندد.
    close({
        reason,
        closedAtMs = Date.now()
    } = {}) {
        if (
            !Number.isInteger(reason) ||
            !Object.hasOwn(
                VoiceConnectionCloseReasonNameByValue,
                reason
            )
        ) {
            throw new RangeError(
                `Unknown Voice connection close reason: ${String(reason)}.`
            );
        }

        if (
            reason ===
            VoiceConnectionCloseReason.NONE
        ) {
            throw new Error(
                "Closing a Voice connection requires a close reason."
            );
        }

        if (
            this.state ===
            VoiceConnectionState.CLOSED
        ) {
            return this.snapshot();
        }

        this.state =
            VoiceConnectionState.CLOSING;

        this.closeReason = reason;

        this.closedAtMs =
            normalizeVoiceConnectionTime(
                closedAtMs,
                "closedAtMs"
            );

        this.state =
            VoiceConnectionState.CLOSED;

        return this.snapshot();
    }

    //* این تابع یک نسخه خواندنی و قفل‌شده از وضعیت اتصال صوتی برمی‌گرداند.
    snapshot() {
        return Object.freeze({
            connectionId: this.connectionId,
            userId: this.userId,
            avatarId: this.avatarId,
            roomId: this.roomId,
            platform: this.platform,
            transportName: this.transportName,
            transportConnectionKey:
                this.transportConnectionKey,
            clientInstanceId:
                this.clientInstanceId,
            state: this.state,
            stateName:
                VoiceConnectionStateNameByValue[
                    this.state
                ],
            createdAtMs: this.createdAtMs,
            activatedAtMs: this.activatedAtMs,
            disconnectedAtMs:
                this.disconnectedAtMs,
            resumedAtMs: this.resumedAtMs,
            closedAtMs: this.closedAtMs,
            lastReceivedSequence:
                this.lastReceivedSequence,
            lastPublishedSequence:
                this.lastPublishedSequence,
            closeReason: this.closeReason,
            closeReasonName:
                VoiceConnectionCloseReasonNameByValue[
                    this.closeReason
                ]
        });
    }
}

export {
    VoiceConnectionRecord
};

/*
توضیح فایل:
این فایل اطلاعات هر اتصال صوتی را نگه می‌دارد و تغییر وضعیت آن از احراز اولیه تا فعال‌شدن، تعلیق، ادامه اتصال و بسته‌شدن را مدیریت می‌کند.
شناسه اتصال صوتی از شناسه اتصال تأییدشده همان بازیکن در سرور اختصاصی گرفته می‌شود و شناسه تصادفی دیگری ساخته نمی‌شود.
*/
