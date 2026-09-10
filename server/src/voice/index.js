// مسیر فایل: src/voice/index.js

export {
    VoiceArchitectureConstants,
    deepFreeze
} from "./config/voiceArchitectureConstants.js";

export {
    VoiceBinaryProtocolConstants
} from "./protocol/voiceBinaryProtocolConstants.js";

export {
    decodeVoiceBinaryEnvelope,
    encodeVoiceBinaryEnvelope,
    voiceBytesToUuid,
    voiceUuidToBytes
} from "./protocol/voiceBinaryEnvelope.js";

export {
    VoiceMessageType,
    VoiceMessageTypeNameByValue,
    assertKnownVoiceMessageType,
    getVoiceMessageTypeName,
    isKnownVoiceMessageType
} from "./protocol/voiceMessageTypes.js";

export {
    VOICE_MESSAGE_KNOWN_FLAG_MASK,
    VoiceMessageFlag,
    assertVoiceMessageFlagsValue,
    hasVoiceMessageFlag
} from "./protocol/voiceMessageFlags.js";

export {
    VoiceMessageDirection,
    VoiceMessageRules,
    VoicePayloadKind,
    getVoiceMessageRule,
    validateVoiceMessageContract
} from "./protocol/voiceMessageRules.js";

export {
    VoiceProtocolV1Manifest
} from "./protocol/voiceProtocolV1Manifest.js";

export {
    VoiceAuthPayloadLimits,
    VoiceAuthRequestLayout,
    VoiceAuthResultCode,
    VoiceAuthResultCodeNameByValue,
    VoiceAuthResultLayout,
    VoiceClientPlatform,
    VoiceClientPlatformNameByValue,
    assertVoiceAuthResultCode,
    assertVoiceClientPlatform
} from "./auth/voiceAuthConstants.js";

export {
    decodeVoiceAuthRequest,
    decodeVoiceAuthResult,
    encodeVoiceAuthRequest,
    encodeVoiceAuthResult
} from "./auth/voiceAuthPayload.js";

export {
    VoiceAuthVerificationPolicy,
    createVoiceAuthenticatedSubject
} from "./auth/voiceAuthPolicy.js";

export {
    VOICE_UNKNOWN_DISTANCE_MILLIMETERS,
    VoiceProximityDecision,
    VoiceProximityDecisionNameByValue,
    VoiceSessionDescriptorLayout,
    VoiceSessionPayloadLimits,
    VoiceSessionReason,
    VoiceSessionReasonNameByValue,
    VoiceSessionSnapshotLayout,
    VoiceSessionState,
    VoiceSessionStateNameByValue,
    assertVoiceProximityDecision,
    assertVoiceSessionReason,
    assertVoiceSessionState
} from "./session/voiceSessionConstants.js";

export {
    VoiceSessionMembershipPolicy,
    assertVoiceDistanceMeters,
    createCanonicalVoiceParticipantPairKey,
    evaluateVoiceProximityCandidate,
    normalizeVoiceParticipantAvatarId
} from "./session/voiceSessionPolicy.js";

export {
    decodeVoiceDistanceMeters,
    decodeVoiceSessionDescriptor,
    decodeVoiceSessionSnapshot,
    encodeVoiceDistanceMillimeters,
    encodeVoiceSessionDescriptor,
    encodeVoiceSessionSnapshot
} from "./session/voiceSessionPayload.js";

export {
    VoiceCleanupAction,
    VoiceCleanupActionNameByValue,
    VoiceReconnectPayloadLimits,
    VoiceReconnectRequestLayout,
    VoiceReconnectResultCode,
    VoiceReconnectResultCodeNameByValue,
    VoiceReconnectResultLayout,
    VoiceReconnectWindowState,
    VoiceReconnectWindowStateNameByValue,
    assertVoiceCleanupAction,
    assertVoiceReconnectResultCode,
    assertVoiceReconnectWindowState
} from "./reconnect/voiceReconnectConstants.js";

export {
    VoiceReconnectPolicy,
    createVoiceReconnectRevalidationPlan,
    evaluateVoiceReconnectWindow,
    normalizeVoiceReconnectTime,
    resolveVoiceCleanupAction
} from "./reconnect/voiceReconnectPolicy.js";

export {
    decodeVoiceReconnectRequest,
    decodeVoiceReconnectResult,
    encodeVoiceReconnectRequest,
    encodeVoiceReconnectResult
} from "./reconnect/voiceReconnectPayload.js";

export {
    VoiceConnectionCloseReason,
    VoiceConnectionCloseReasonNameByValue,
    VoiceConnectionFieldLimits,
    VoiceConnectionState,
    VoiceConnectionStateNameByValue
} from "./core/voiceConnectionConstants.js";

export {
    VoiceConnectionRecord
} from "./core/voiceConnectionRecord.js";

export {
    VoiceConnectionRegistry
} from "./core/voiceConnectionRegistry.js";

/*
توضیح فایل:
این فایل تمام بخش‌های عمومی قرارداد و هسته ارتباط صوتی را از یک مسیر واحد در اختیار بخش‌های دیگر پروژه قرار می‌دهد.
*/
