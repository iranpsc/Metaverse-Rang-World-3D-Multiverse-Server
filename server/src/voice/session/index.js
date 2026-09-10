// مسیر فایل: src/voice/session/index.js

export {
    VoiceAuthoritativeSessionEventType,
    VoiceAuthoritativeSessionService,
    normalizeVoiceAuthoritativeSessionEvent
} from "./voiceAuthoritativeSessionService.js";

export {
    VoiceSessionRecord,
    normalizeVoiceSessionId,
    normalizeVoiceSessionParticipant
} from "./voiceSessionRecord.js";

export {
    VoiceSessionRegistry
} from "./voiceSessionRegistry.js";

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
} from "./voiceSessionConstants.js";

export {
    decodeVoiceSessionDescriptor,
    decodeVoiceSessionSnapshot,
    encodeVoiceSessionDescriptor,
    encodeVoiceSessionSnapshot
} from "./voiceSessionPayload.js";

export {
    VoiceSessionMembershipPolicy,
    assertVoiceDistanceMeters,
    createCanonicalVoiceParticipantPairKey,
    evaluateVoiceProximityCandidate,
    normalizeVoiceParticipantAvatarId
} from "./voiceSessionPolicy.js";

/*
توضیح فایل:
این فایل قراردادها و هسته اجرایی سشن‌های صوتی را از یک مسیر واحد صادر می‌کند.
*/
