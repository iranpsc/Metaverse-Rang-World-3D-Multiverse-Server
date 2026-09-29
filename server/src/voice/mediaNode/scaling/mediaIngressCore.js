import { VoiceMediaV2PacketKind, decodeVoiceMediaV2BindRequest, decodeVoiceMediaV2Packet } from "../../mediaV2/voiceMediaV2Protocol.js";

const MAX_BUFFERED_MESSAGES = 32;
const MAX_BUFFERED_BYTES = 64 * 1024;

//* این تابع نخستین بسته اتصال رسانه را بررسی و شناسه روم را استخراج می کند.
function inspectPhase11BindPacket(packet) {
    const decoded = decodeVoiceMediaV2Packet(packet);
    if (decoded.kind !== VoiceMediaV2PacketKind.BIND_REQUEST) throw new Error("First media packet must be bind request.");
    const bind = decodeVoiceMediaV2BindRequest(decoded.payload);
    if (!bind.roomId) throw new Error("Media bind room is missing.");
    return Object.freeze({ roomId: bind.roomId, controlConnectionId: bind.controlConnectionId, accessToken: bind.accessToken });
}

//* این تابع صف محدود پیام های اولیه را برای جلوگیری از رشد حافظه می سازد.
function createPendingBuffer() {
    const items = [];
    let totalBytes = 0;

    //* این تابع یک پیام را تا آماده شدن نود مقصد در صف محدود نگه می دارد.
    function push(value) {
        const bytes = Buffer.isBuffer(value) ? value.length : Buffer.byteLength(value?.packet ?? value ?? Buffer.alloc(0));
        if (items.length >= MAX_BUFFERED_MESSAGES || totalBytes + bytes > MAX_BUFFERED_BYTES) throw new Error("Media edge pending buffer exceeded limit.");
        items.push(value);
        totalBytes += bytes;
    }

    //* این تابع همه پیام های نگه داشته شده را به ترتیب برمی گرداند و صف را خالی می کند.
    function drain() {
        const result = items.splice(0, items.length);
        totalBytes = 0;
        return result;
    }

    return Object.freeze({ push, drain });
}

export {
    createPendingBuffer,
    inspectPhase11BindPacket
};
