import WebSocket from "ws";
import { VoiceMediaNodeBridgeMessageType } from "./internalBridgeProtocol.js";
import { VoiceMediaNodeBridgeRpcPeer } from "./bridgeRpcPeer.js";

//* این تابع خطا را به متن کوتاه تبدیل می کند.
function safeErrorMessage(error) {
    return String(error?.message ?? error ?? "unknown_error").slice(0, 500);
}

class VoiceMediaNodeBridgeClient {
    //* این سازنده اتصال پایدار نود رسانه به پل داخلی بک اند را آماده می کند.
    constructor({ url = "ws://127.0.0.1:51003/voice-media-node-bridge", secret, requestTimeoutMs = 3000, reconnectDelayMs = 1000, logger = null } = {}) {
        const safeSecret = String(secret ?? "");
        if (safeSecret.length < 32) throw new Error("Voice media node bridge secret must be at least 32 characters.");
        this.url = String(url);
        this.secret = safeSecret;
        this.requestTimeoutMs = requestTimeoutMs;
        this.reconnectDelayMs = reconnectDelayMs;
        this.logger = logger;
        this.runtime = null;
        this.socket = null;
        this.peer = null;
        this.stopped = false;
        this.connecting = false;
        this.reconnectTimer = null;
    }

    //* این تابع رانتایم نود رسانه را برای دریافت فرمان تحویل و بستن اتصال ثبت می کند.
    setRuntime(runtime) {
        if (!runtime || typeof runtime.deliverMedia !== "function" || typeof runtime.closeMedia !== "function") throw new TypeError("Media node runtime is invalid.");
        this.runtime = runtime;
    }

    //* این تابع تلاش اتصال به بک اند را آغاز و در شکست برای تلاش بعدی زمان بندی می کند.
    connect() {
        if (this.stopped || this.connecting || (this.peer && !this.peer.closed)) return;
        this.connecting = true;
        const socket = new WebSocket(this.url, { headers: { Authorization: `Bearer ${this.secret}` } });
        this.socket = socket;

        socket.once("open", () => {
            this.connecting = false;
            const handlers = {
                [VoiceMediaNodeBridgeMessageType.DELIVER_MEDIA_REQUEST]: this.handleDeliverMedia.bind(this),
                [VoiceMediaNodeBridgeMessageType.CLOSE_MEDIA_REQUEST]: this.handleCloseMedia.bind(this)
            };
            this.peer = new VoiceMediaNodeBridgeRpcPeer({ socket, requestTimeoutMs: this.requestTimeoutMs, handlers, logger: this.logger });
            this.logger?.info?.("VME2_PHASE10_MEDIA_NODE_BRIDGE=CONNECTED");
        });

        socket.once("close", () => {
            this.connecting = false;
            if (this.peer?.socket === socket) this.peer = null;
            if (!this.stopped) this.scheduleReconnect();
        });

        socket.once("error", (error) => {
            this.connecting = false;
            this.logger?.warn?.("VME2_PHASE10_MEDIA_NODE_BRIDGE=FAIL", { error: safeErrorMessage(error) });
        });
    }

    //* این تابع تلاش بعدی اتصال داخلی را با فاصله محدود زمان بندی می کند.
    scheduleReconnect() {
        if (this.stopped || this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, this.reconnectDelayMs);
        this.reconnectTimer.unref?.();
    }

    //* این تابع تا آماده شدن اتصال داخلی یا پایان زمان مشخص صبر می کند.
    async waitUntilReady(timeoutMs = 5000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (this.peer && !this.peer.closed) return true;
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return false;
    }

    //* این تابع اعتبار درخواست بایند را از بک اند مالک مسیر کنترل دریافت می کند.
    async authorizeBind({ accessToken, roomId, controlConnectionId } = {}) {
        const peer = this.peer;
        if (!peer || peer.closed) return Object.freeze({ success: false, error: "backend_bridge_unavailable" });
        const response = await peer.request({
            type: VoiceMediaNodeBridgeMessageType.AUTHORIZE_BIND_REQUEST,
            responseType: VoiceMediaNodeBridgeMessageType.AUTHORIZE_BIND_RESULT,
            metadata: { accessToken, roomId, controlConnectionId }
        });
        return response.metadata;
    }

    //* این تابع یک فریم ورودی را برای تصمیم قطعی مسیریابی و ضبط به بک اند می فرستد.
    async routeFrame({ controlConnectionId, flags, mediaSequence, mediaTimestamp100Ns, streamId, payload } = {}) {
        const peer = this.peer;
        if (!peer || peer.closed) throw new Error("Voice media node backend bridge is unavailable.");
        const response = await peer.request({
            type: VoiceMediaNodeBridgeMessageType.ROUTE_FRAME_REQUEST,
            responseType: VoiceMediaNodeBridgeMessageType.ROUTE_FRAME_RESULT,
            metadata: { controlConnectionId, flags, mediaSequence, mediaTimestamp100Ns: String(mediaTimestamp100Ns), streamId },
            payload
        });
        if (response.metadata?.success !== true) throw new Error(String(response.metadata?.error ?? "media_route_failed"));
        return response.metadata;
    }

    //* این تابع فرمان تحویل رسانه از بک اند را روی اتصال مقصد اجرا و نتیجه را برمی گرداند.
    async handleDeliverMedia(message, responder) {
        if (!this.runtime) throw new Error("Media node runtime is not attached.");
        try {
            await this.runtime.deliverMedia({ ...message.metadata, payload: message.payload });
            await responder.respond({ type: VoiceMediaNodeBridgeMessageType.DELIVER_MEDIA_RESULT, requestId: message.requestId, metadata: { success: true } });
        } catch (error) {
            await responder.respond({ type: VoiceMediaNodeBridgeMessageType.DELIVER_MEDIA_RESULT, requestId: message.requestId, metadata: { success: false, error: safeErrorMessage(error) } });
        }
    }

    //* این تابع فرمان بستن مسیر رسانه مقصد را اجرا و نتیجه را برمی گرداند.
    async handleCloseMedia(message, responder) {
        if (!this.runtime) throw new Error("Media node runtime is not attached.");
        await this.runtime.closeMedia(message.metadata?.listenerConnectionId, message.metadata?.reason);
        await responder.respond({ type: VoiceMediaNodeBridgeMessageType.CLOSE_MEDIA_RESULT, requestId: message.requestId, metadata: { success: true } });
    }

    //* این تابع اتصال داخلی و زمان بند بازیابی را متوقف می کند.
    stop() {
        if (this.stopped) return;
        this.stopped = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.peer?.close();
        this.peer = null;
        try { this.socket?.close(); } catch { }
        this.socket = null;
    }

    //* این تابع وضعیت محدود اتصال داخلی را برای سلامت نود برمی گرداند.
    getStats() {
        return Object.freeze({ connected: Boolean(this.peer && !this.peer.closed), connecting: this.connecting, stopped: this.stopped });
    }
}

export {
    VoiceMediaNodeBridgeClient
};
