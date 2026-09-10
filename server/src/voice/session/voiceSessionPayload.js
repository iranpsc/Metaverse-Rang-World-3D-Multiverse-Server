// File: src/voice/session/voiceSessionPayload.js

import {
    voiceBytesToUuid,
    voiceUuidToBytes
} from "../protocol/voiceBinaryEnvelope.js";

import {
    VOICE_UNKNOWN_DISTANCE_MILLIMETERS,
    VoiceSessionDescriptorLayout,
    VoiceSessionPayloadLimits,
    VoiceSessionReason,
    VoiceSessionSnapshotLayout,
    assertVoiceSessionReason,
    assertVoiceSessionState
} from "./voiceSessionConstants.js";

const MAX_UINT64 = 0xffffffffffffffffn;
const MAX_KNOWN_DISTANCE_MILLIMETERS =
    VOICE_UNKNOWN_DISTANCE_MILLIMETERS - 1;
const VOICE_GROUP_DESCRIPTOR_EXTENSION_BYTES = 20;
const VOICE_GROUP_DESCRIPTOR_EXTENSION_MAGIC = Buffer.from("G5", "ascii");
const VOICE_GROUP_DESCRIPTOR_EXTENSION_VERSION = 1;

//* این تابع ورودی باینری را به Buffer تبدیل می‌کند.
function normalizeVoiceSessionBinary(value) {
    if (Buffer.isBuffer(value)) return value;

    if (value instanceof Uint8Array) {
        return Buffer.from(
            value.buffer,
            value.byteOffset,
            value.byteLength
        );
    }

    if (value instanceof ArrayBuffer) {
        return Buffer.from(value);
    }

    throw new TypeError(
        "Voice session payload must be Buffer, Uint8Array or ArrayBuffer."
    );
}

//* این تابع زمان Session را به عدد صحیح ۶۴ بیتی تبدیل می‌کند.
function normalizeVoiceSessionTimestamp(value) {
    if (typeof value === "bigint") {
        if (value < 0n || value > MAX_UINT64) {
            throw new RangeError(
                "effectiveAtMs is outside the unsigned 64-bit range."
            );
        }

        return value;
    }

    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(
            "effectiveAtMs must be a non-negative safe integer or bigint."
        );
    }

    return BigInt(value);
}

//* این تابع شناسه متنی آواتار را به UTF-8 تبدیل و اندازه آن را بررسی می‌کند.
function encodeVoicePeerAvatarId(value) {
    if (typeof value !== "string") {
        throw new TypeError("peerAvatarId must be a string.");
    }

    const normalizedValue = value.trim();

    if (!normalizedValue) {
        throw new Error("peerAvatarId is required.");
    }

    const bytes = Buffer.from(normalizedValue, "utf8");

    if (
        bytes.length >
        VoiceSessionPayloadLimits.peerAvatarIdBytes
    ) {
        throw new RangeError(
            "peerAvatarId exceeds its maximum UTF-8 byte length."
        );
    }

    return bytes;
}

//* این تابع فاصله بر حسب متر را به مقدار میلی‌متری پروتکل تبدیل می‌کند.
function encodeVoiceDistanceMillimeters(distanceMeters) {
    if (distanceMeters === null || distanceMeters === undefined) {
        return VOICE_UNKNOWN_DISTANCE_MILLIMETERS;
    }

    if (
        typeof distanceMeters !== "number" ||
        !Number.isFinite(distanceMeters) ||
        distanceMeters < 0
    ) {
        throw new RangeError(
            "distanceMeters must be null or a finite non-negative number."
        );
    }

    const distanceMillimeters = Math.round(distanceMeters * 1000);

    if (
        distanceMillimeters >
        MAX_KNOWN_DISTANCE_MILLIMETERS
    ) {
        throw new RangeError(
            "distanceMeters exceeds the Voice protocol range."
        );
    }

    return distanceMillimeters;
}

//* این تابع مقدار میلی‌متری پروتکل را به فاصله بر حسب متر تبدیل می‌کند.
function decodeVoiceDistanceMeters(distanceMillimeters) {
    if (
        distanceMillimeters ===
        VOICE_UNKNOWN_DISTANCE_MILLIMETERS
    ) {
        return null;
    }

    return distanceMillimeters / 1000;
}

//* این تابع Descriptor باینری یک Session را می‌سازد.
function encodeVoiceSessionDescriptor({
    sessionId,
    state,
    reason = VoiceSessionReason.NONE,
    distanceMeters = null,
    effectiveAtMs = Date.now(),
    peerUserId,
    peerAvatarId,
    peerConnectionId = null
} = {}) {
    assertVoiceSessionState(state);
    assertVoiceSessionReason(reason);

    const sessionIdBytes = voiceUuidToBytes(sessionId);
    const peerUserIdBytes = voiceUuidToBytes(peerUserId);
    const peerAvatarIdBytes = encodeVoicePeerAvatarId(peerAvatarId);
    const hasPeerConnectionId =
        typeof peerConnectionId === "string" &&
        peerConnectionId.trim().length > 0;
    const peerConnectionIdBytes = hasPeerConnectionId
        ? voiceUuidToBytes(peerConnectionId)
        : null;
    const distanceMillimeters =
        encodeVoiceDistanceMillimeters(distanceMeters);
    const timestamp = normalizeVoiceSessionTimestamp(effectiveAtMs);
    const layout = VoiceSessionDescriptorLayout;

    const payload = Buffer.alloc(
        layout.fixedBytes +
        peerAvatarIdBytes.length +
        (hasPeerConnectionId
            ? VOICE_GROUP_DESCRIPTOR_EXTENSION_BYTES
            : 0)
    );

    sessionIdBytes.copy(
        payload,
        layout.offsets.sessionId
    );

    payload.writeUInt8(
        state,
        layout.offsets.state
    );

    payload.writeUInt8(
        reason,
        layout.offsets.reason
    );

    payload.writeUInt32BE(
        distanceMillimeters,
        layout.offsets.distanceMillimeters
    );

    payload.writeBigUInt64BE(
        timestamp,
        layout.offsets.effectiveAtMs
    );

    peerUserIdBytes.copy(
        payload,
        layout.offsets.peerUserId
    );

    payload.writeUInt16BE(
        peerAvatarIdBytes.length,
        layout.offsets.peerAvatarIdLength
    );

    peerAvatarIdBytes.copy(
        payload,
        layout.fixedBytes
    );

    if (hasPeerConnectionId) {
        const extensionOffset =
            layout.fixedBytes + peerAvatarIdBytes.length;

        VOICE_GROUP_DESCRIPTOR_EXTENSION_MAGIC.copy(
            payload,
            extensionOffset
        );

        payload.writeUInt8(
            VOICE_GROUP_DESCRIPTOR_EXTENSION_VERSION,
            extensionOffset + 2
        );

        payload.writeUInt8(
            0,
            extensionOffset + 3
        );

        peerConnectionIdBytes.copy(
            payload,
            extensionOffset + 4
        );
    }

    return payload;
}

//* این تابع Descriptor باینری یک Session را می‌خواند.
function decodeVoiceSessionDescriptor(input) {
    const payload = normalizeVoiceSessionBinary(input);
    const layout = VoiceSessionDescriptorLayout;

    if (payload.length < layout.fixedBytes) {
        throw new RangeError(
            `Voice session descriptor must contain at least ${layout.fixedBytes} bytes.`
        );
    }

    const sessionId = voiceBytesToUuid(
        payload.subarray(
            layout.offsets.sessionId,
            layout.offsets.sessionId + 16
        )
    );

    const state = payload.readUInt8(
        layout.offsets.state
    );

    const reason = payload.readUInt8(
        layout.offsets.reason
    );

    assertVoiceSessionState(state);
    assertVoiceSessionReason(reason);

    const distanceMillimeters = payload.readUInt32BE(
        layout.offsets.distanceMillimeters
    );

    const effectiveAtMs = payload.readBigUInt64BE(
        layout.offsets.effectiveAtMs
    );

    const peerUserId = voiceBytesToUuid(
        payload.subarray(
            layout.offsets.peerUserId,
            layout.offsets.peerUserId + 16
        )
    );

    const peerAvatarIdLength = payload.readUInt16BE(
        layout.offsets.peerAvatarIdLength
    );

    if (
        peerAvatarIdLength >
        VoiceSessionPayloadLimits.peerAvatarIdBytes
    ) {
        throw new RangeError(
            "peerAvatarId exceeds its maximum UTF-8 byte length."
        );
    }

    const legacyExpectedLength =
        layout.fixedBytes + peerAvatarIdLength;

    const extendedExpectedLength =
        legacyExpectedLength +
        VOICE_GROUP_DESCRIPTOR_EXTENSION_BYTES;

    if (
        payload.length !== legacyExpectedLength &&
        payload.length !== extendedExpectedLength
    ) {
        throw new RangeError(
            `Voice session descriptor length mismatch. Expected ${legacyExpectedLength} or ${extendedExpectedLength}, received ${payload.length}.`
        );
    }

    const peerAvatarId = payload
        .subarray(layout.fixedBytes, legacyExpectedLength)
        .toString("utf8")
        .trim();

    if (!peerAvatarId) {
        throw new Error(
            "Voice session descriptor peerAvatarId is required."
        );
    }

    let peerConnectionId = null;

    if (payload.length === extendedExpectedLength) {
        if (
            !payload
                .subarray(
                    legacyExpectedLength,
                    legacyExpectedLength + 2
                )
                .equals(
                    VOICE_GROUP_DESCRIPTOR_EXTENSION_MAGIC
                ) ||
            payload.readUInt8(legacyExpectedLength + 2) !==
                VOICE_GROUP_DESCRIPTOR_EXTENSION_VERSION ||
            payload.readUInt8(legacyExpectedLength + 3) !== 0
        ) {
            throw new Error(
                "Voice group descriptor extension header is invalid."
            );
        }

        peerConnectionId = voiceBytesToUuid(
            payload.subarray(
                legacyExpectedLength + 4,
                extendedExpectedLength
            )
        );
    }

    return {
        sessionId,
        state,
        reason,
        distanceMeters:
            decodeVoiceDistanceMeters(distanceMillimeters),
        effectiveAtMs,
        peerUserId,
        peerAvatarId,
        peerConnectionId
    };
}

//* این تابع Snapshot باینری Sessionهای فعال یک کاربر را می‌سازد.
function encodeVoiceSessionSnapshot({
    sessions = []
} = {}) {
    if (!Array.isArray(sessions)) {
        throw new TypeError("sessions must be an array.");
    }

    if (
        sessions.length >
        VoiceSessionPayloadLimits.snapshotEntries
    ) {
        throw new RangeError(
            "Voice session snapshot contains too many entries."
        );
    }

    const encodedEntries = sessions.map((session) =>
        encodeVoiceSessionDescriptor(session)
    );

    let totalBytes = VoiceSessionSnapshotLayout.fixedBytes;

    for (const entry of encodedEntries) {
        if (entry.length > 0xffff) {
            throw new RangeError(
                "Voice session snapshot entry exceeds 65535 bytes."
            );
        }

        totalBytes += 2 + entry.length;
    }

    if (
        totalBytes >
        VoiceSessionPayloadLimits.snapshotBytes
    ) {
        throw new RangeError(
            "Voice session snapshot exceeds its maximum byte length."
        );
    }

    const payload = Buffer.alloc(totalBytes);

    payload.writeUInt16BE(
        encodedEntries.length,
        VoiceSessionSnapshotLayout.offsets.entryCount
    );

    payload.writeUInt16BE(
        0,
        VoiceSessionSnapshotLayout.offsets.reserved
    );

    let cursor = VoiceSessionSnapshotLayout.fixedBytes;

    for (const entry of encodedEntries) {
        payload.writeUInt16BE(entry.length, cursor);
        cursor += 2;

        entry.copy(payload, cursor);
        cursor += entry.length;
    }

    return payload;
}

//* این تابع Snapshot باینری Sessionهای یک کاربر را می‌خواند.
function decodeVoiceSessionSnapshot(input) {
    const payload = normalizeVoiceSessionBinary(input);
    const layout = VoiceSessionSnapshotLayout;

    if (payload.length < layout.fixedBytes) {
        throw new RangeError(
            `Voice session snapshot must contain at least ${layout.fixedBytes} bytes.`
        );
    }

    if (
        payload.length >
        VoiceSessionPayloadLimits.snapshotBytes
    ) {
        throw new RangeError(
            "Voice session snapshot exceeds its maximum byte length."
        );
    }

    const entryCount = payload.readUInt16BE(
        layout.offsets.entryCount
    );

    const reserved = payload.readUInt16BE(
        layout.offsets.reserved
    );

    if (reserved !== 0) {
        throw new Error(
            "Voice session snapshot reserved field must be zero."
        );
    }

    if (
        entryCount >
        VoiceSessionPayloadLimits.snapshotEntries
    ) {
        throw new RangeError(
            "Voice session snapshot contains too many entries."
        );
    }

    const sessions = [];
    let cursor = layout.fixedBytes;

    for (let index = 0; index < entryCount; index += 1) {
        if (cursor + 2 > payload.length) {
            throw new RangeError(
                "Voice session snapshot entry length is missing."
            );
        }

        const entryLength = payload.readUInt16BE(cursor);
        cursor += 2;

        if (
            entryLength <
            VoiceSessionDescriptorLayout.fixedBytes
        ) {
            throw new RangeError(
                "Voice session snapshot entry is too short."
            );
        }

        const entryEnd = cursor + entryLength;

        if (entryEnd > payload.length) {
            throw new RangeError(
                "Voice session snapshot entry exceeds the payload length."
            );
        }

        sessions.push(
            decodeVoiceSessionDescriptor(
                payload.subarray(cursor, entryEnd)
            )
        );

        cursor = entryEnd;
    }

    if (cursor !== payload.length) {
        throw new RangeError(
            "Voice session snapshot contains trailing bytes."
        );
    }

    return {
        entryCount,
        sessions
    };
}

export {
    decodeVoiceDistanceMeters,
    decodeVoiceSessionDescriptor,
    decodeVoiceSessionSnapshot,
    encodeVoiceDistanceMillimeters,
    encodeVoiceSessionDescriptor,
    encodeVoiceSessionSnapshot
};
