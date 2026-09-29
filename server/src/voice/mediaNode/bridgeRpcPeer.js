import {
    VoiceMediaNodeBridgeMessageType,
    decodeVoiceMediaNodeBridgeMessage,
    encodeVoiceMediaNodeBridgeMessage
} from "./internalBridgeProtocol.js";

//* این تابع خطا را به متن کوتاه و پایدار تبدیل می کند.
function safeErrorMessage(error) {
    return String(error?.message ?? error ?? "unknown_error").slice(0, 500);
}

class VoiceMediaNodeBridgeRpcPeer {
    //* این سازنده یک همتای دوطرفه برای درخواست و پاسخ روی وب سوکت آماده می کند.
    constructor({ socket, requestTimeoutMs = 3000, handlers = {}, logger = null } = {}) {
        if (!socket || typeof socket.on !== "function" || typeof socket.send !== "function") throw new TypeError("Bridge socket is invalid.");
        if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 100 || requestTimeoutMs > 30000) throw new RangeError("Bridge request timeout is invalid.");
        this.socket = socket;
        this.requestTimeoutMs = requestTimeoutMs;
        this.handlers = handlers;
        this.logger = logger;
        this.nextRequestId = 1;
        this.pending = new Map();
        this.closed = false;
        this.handleMessage = this.handleMessage.bind(this);
        this.handleClose = this.handleClose.bind(this);
        this.handleError = this.handleError.bind(this);
        socket.on("message", this.handleMessage);
        socket.on("close", this.handleClose);
        socket.on("error", this.handleError);
    }

    //* این تابع یک شناسه درخواست غیر صفر تولید می کند.
    allocateRequestId() {
        const current = this.nextRequestId >>> 0;
        this.nextRequestId = current >= 0xffffffff ? 1 : current + 1;
        return current === 0 ? this.allocateRequestId() : current;
    }

    //* این تابع یک پیام باینری را فقط روی اتصال باز ارسال می کند.
    sendPacket(packet) {
        if (this.closed || this.socket.readyState !== 1) return Promise.reject(new Error("Bridge socket is not open."));
        return new Promise((resolve, reject) => {
            this.socket.send(packet, { binary: true }, (error) => error ? reject(error) : resolve());
        });
    }

    //* این تابع یک درخواست را می فرستد و پاسخ متناظر را با زمان محدود دریافت می کند.
    async request({ type, responseType, metadata = {}, payload = null } = {}) {
        if (!Object.values(VoiceMediaNodeBridgeMessageType).includes(responseType)) throw new RangeError("Bridge response type is invalid.");
        const requestId = this.allocateRequestId();
        const packet = encodeVoiceMediaNodeBridgeMessage({ type, requestId, metadata, payload });
        return await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error("Bridge request timed out."));
            }, this.requestTimeoutMs);
            timeout.unref?.();
            this.pending.set(requestId, { responseType, resolve, reject, timeout });
            this.sendPacket(packet).catch((error) => {
                clearTimeout(timeout);
                this.pending.delete(requestId);
                reject(error);
            });
        });
    }

    //* این تابع پاسخ یک درخواست ورودی را با همان شناسه برمی گرداند.
    async respond({ type, requestId, metadata = {}, payload = null } = {}) {
        await this.sendPacket(encodeVoiceMediaNodeBridgeMessage({ type, requestId, metadata, payload }));
    }

    //* این تابع پیام ورودی را به پاسخ منتظر یا پردازشگر درخواست هدایت می کند.
    async handleMessage(data, isBinary) {
        if (!isBinary) {
            this.logger?.warn?.("VME2_PHASE10_BRIDGE_TEXT_REJECTED");
            return;
        }
        let message;
        try {
            message = decodeVoiceMediaNodeBridgeMessage(data);
        } catch (error) {
            this.logger?.warn?.("VME2_PHASE10_BRIDGE_DECODE=FAIL", { error: safeErrorMessage(error) });
            return;
        }

        const pending = this.pending.get(message.requestId);
        if (pending && (pending.responseType === message.type || message.type === VoiceMediaNodeBridgeMessageType.ERROR)) {
            clearTimeout(pending.timeout);
            this.pending.delete(message.requestId);
            if (message.type === VoiceMediaNodeBridgeMessageType.ERROR) pending.reject(new Error(String(message.metadata?.error ?? "bridge_remote_error")));
            else pending.resolve(message);
            return;
        }

        const handler = this.handlers?.[message.type];
        if (typeof handler !== "function") {
            if (message.requestId !== 0) {
                await this.respond({
                    type: VoiceMediaNodeBridgeMessageType.ERROR,
                    requestId: message.requestId,
                    metadata: { success: false, error: "bridge_handler_missing" }
                }).catch(() => undefined);
            }
            return;
        }

        try {
            await handler(message, this);
        } catch (error) {
            this.logger?.warn?.("VME2_PHASE10_BRIDGE_HANDLER=FAIL", { type: message.type, error: safeErrorMessage(error) });
            if (message.requestId !== 0) {
                await this.respond({
                    type: VoiceMediaNodeBridgeMessageType.ERROR,
                    requestId: message.requestId,
                    metadata: { success: false, error: safeErrorMessage(error) }
                }).catch(() => undefined);
            }
        }
    }

    //* این تابع همه درخواست های منتظر را پس از قطع اتصال رد می کند.
    handleClose() {
        if (this.closed) return;
        this.closed = true;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error("Bridge socket closed."));
        }
        this.pending.clear();
    }

    //* این تابع خطای راه انتقال داخلی را فقط ثبت می کند تا چرخه بسته شدن مالک اتصال تصمیم بگیرد.
    handleError(error) {
        this.logger?.warn?.("VME2_PHASE10_BRIDGE_SOCKET=FAIL", { error: safeErrorMessage(error) });
    }

    //* این تابع اتصال همتا را می بندد و منابع منتظر را آزاد می کند.
    close() {
        if (this.closed) return;
        this.closed = true;
        try { this.socket.close(1000, "voice_media_node_bridge_closed"); } catch { }
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error("Bridge peer closed."));
        }
        this.pending.clear();
    }
}

export {
    VoiceMediaNodeBridgeRpcPeer
};
