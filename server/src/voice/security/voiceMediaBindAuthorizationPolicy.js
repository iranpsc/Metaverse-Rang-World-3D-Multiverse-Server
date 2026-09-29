import { VoiceConnectionState } from "../core/voiceConnectionConstants.js";
import {
    VoiceMediaV2Codec,
    VoiceMediaV2Constants,
    VoiceMediaV2Flag,
    VoiceMediaV2PacketKind
} from "../mediaV2/voiceMediaV2Protocol.js";

const VoiceMediaAuthorizationReason = Object.freeze({
    AUTHORIZED: "authorized",
    INVALID_BIND_PACKET: "invalid_bind_packet",
    INVALID_CONTROL_CONNECTION_ID: "invalid_control_connection_id",
    TOKEN_REJECTED: "token_rejected",
    CONTROL_CONNECTION_NOT_FOUND: "control_connection_not_found",
    CONTROL_CONNECTION_MISMATCH: "control_connection_mismatch",
    CONTROL_CONNECTION_NOT_ACTIVE: "control_connection_not_active",
    USER_MISMATCH: "user_mismatch",
    ROOM_MISMATCH: "room_mismatch"
});

//* این تابع شناسه اتصال کنترل را برای مقایسه قطعی یکدست می کند.
function normalizeVoiceMediaControlConnectionId(value) {
    return String(value ?? "").trim().toLowerCase();
}

//* این تابع نتیجه رد داخلی را بدون افشای جزئیات امنیتی به کلاینت می سازد.
function deny(reason) {
    return Object.freeze({ allowed: false, reason, controlRecord: null, controlConnectionId: "", userId: "", roomId: "" });
}

//* این تابع ارتباط توکن، کاربر، روم و اتصال کنترل زنده را در یک سیاست مشترک بررسی می کند.
function authorizeVoiceMediaControlBind({ controlConnectionId, roomId, tokenResult, controlRecord } = {}) {
    const safeControlConnectionId = normalizeVoiceMediaControlConnectionId(controlConnectionId);
    const safeRoomId = String(roomId ?? "").trim();
    if (!safeControlConnectionId) return deny(VoiceMediaAuthorizationReason.INVALID_CONTROL_CONNECTION_ID);
    if (tokenResult?.success !== true) return deny(VoiceMediaAuthorizationReason.TOKEN_REJECTED);
    if (!controlRecord) return deny(VoiceMediaAuthorizationReason.CONTROL_CONNECTION_NOT_FOUND);
    if (normalizeVoiceMediaControlConnectionId(controlRecord.connectionId) !== safeControlConnectionId) return deny(VoiceMediaAuthorizationReason.CONTROL_CONNECTION_MISMATCH);
    if (controlRecord.state !== VoiceConnectionState.ACTIVE) return deny(VoiceMediaAuthorizationReason.CONTROL_CONNECTION_NOT_ACTIVE);

    const tokenUserId = String(tokenResult.userId ?? "").trim();
    const controlUserId = String(controlRecord.userId ?? "").trim();
    if (!tokenUserId || controlUserId !== tokenUserId) return deny(VoiceMediaAuthorizationReason.USER_MISMATCH);
    if (!safeRoomId || String(controlRecord.roomId ?? "").trim() !== safeRoomId) return deny(VoiceMediaAuthorizationReason.ROOM_MISMATCH);

    return Object.freeze({
        allowed: true,
        reason: VoiceMediaAuthorizationReason.AUTHORIZED,
        controlRecord,
        controlConnectionId: safeControlConnectionId,
        userId: controlUserId,
        roomId: safeRoomId
    });
}

//* این تابع شکل بسته اتصال رسانه را پیش از مصرف توکن بررسی می کند.
function authorizeVoiceMediaV2BindPacket(packet) {
    const valid = packet &&
        packet.kind === VoiceMediaV2PacketKind.BIND_REQUEST &&
        packet.codec === VoiceMediaV2Codec.NONE &&
        packet.flags === VoiceMediaV2Flag.NONE &&
        packet.transportSequence !== 0 &&
        packet.mediaSequence === 0 &&
        packet.mediaTimestamp100Ns === 0n &&
        packet.sessionId === VoiceMediaV2Constants.emptyUuid &&
        packet.streamId !== VoiceMediaV2Constants.emptyUuid &&
        packet.senderId === VoiceMediaV2Constants.emptyUuid &&
        packet.securityContextId === 0 &&
        packet.payload?.length > 0;
    return valid ? Object.freeze({ allowed: true, reason: VoiceMediaAuthorizationReason.AUTHORIZED }) : deny(VoiceMediaAuthorizationReason.INVALID_BIND_PACKET);
}

//* این تابع اعتبار بسته اتصال و مجوز اتصال کنترل را در یک نتیجه قطعی ترکیب می کند.
function authorizeVoiceMediaV2Bind({ packet, request, tokenResult, controlRecord } = {}) {
    const packetAuthorization = authorizeVoiceMediaV2BindPacket(packet);
    if (!packetAuthorization.allowed) return packetAuthorization;
    return authorizeVoiceMediaControlBind({
        controlConnectionId: request?.controlConnectionId,
        roomId: request?.roomId,
        tokenResult,
        controlRecord
    });
}

//* این تابع زنده ماندن همان کاربر و همان روم را پس از اتصال دوباره بررسی می کند.
function authorizeVoiceMediaBoundControl({ controlConnectionId, userId, roomId, controlRecord } = {}) {
    const safeControlConnectionId = normalizeVoiceMediaControlConnectionId(controlConnectionId);
    if (!safeControlConnectionId) return deny(VoiceMediaAuthorizationReason.INVALID_CONTROL_CONNECTION_ID);
    if (!controlRecord) return deny(VoiceMediaAuthorizationReason.CONTROL_CONNECTION_NOT_FOUND);
    if (normalizeVoiceMediaControlConnectionId(controlRecord.connectionId) !== safeControlConnectionId) return deny(VoiceMediaAuthorizationReason.CONTROL_CONNECTION_MISMATCH);
    if (controlRecord.state !== VoiceConnectionState.ACTIVE) return deny(VoiceMediaAuthorizationReason.CONTROL_CONNECTION_NOT_ACTIVE);
    if (String(controlRecord.userId ?? "").trim() !== String(userId ?? "").trim()) return deny(VoiceMediaAuthorizationReason.USER_MISMATCH);
    if (String(controlRecord.roomId ?? "").trim() !== String(roomId ?? "").trim()) return deny(VoiceMediaAuthorizationReason.ROOM_MISMATCH);
    return Object.freeze({
        allowed: true,
        reason: VoiceMediaAuthorizationReason.AUTHORIZED,
        controlRecord,
        controlConnectionId: safeControlConnectionId,
        userId: String(userId ?? "").trim(),
        roomId: String(roomId ?? "").trim()
    });
}

export {
    VoiceMediaAuthorizationReason,
    authorizeVoiceMediaBoundControl,
    authorizeVoiceMediaControlBind,
    authorizeVoiceMediaV2Bind,
    authorizeVoiceMediaV2BindPacket,
    normalizeVoiceMediaControlConnectionId
};

/*
توضیح فایل:
این فایل سیاست مشترک احراز هویت و مجوز روم مسیر رسانه را مستقل از راه انتقال نگه می دارد.
*/
