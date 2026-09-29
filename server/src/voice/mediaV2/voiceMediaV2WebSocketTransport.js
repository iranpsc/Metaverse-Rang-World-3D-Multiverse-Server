import { randomUUID } from "node:crypto";

//* این تابع مشخص می کند درخواست وب سوکت برای مسیر رسانه نسل دوم است یا نه.
function isVoiceMediaV2WebSocketRequest(request) {
    const parsed = new URL(String(request?.url ?? "/"), "http://127.0.0.1");
    return parsed.searchParams.get("transport") === "voice-media-v2";
}

//* این تابع یک اتصال وب سوکت باینری را به رانتایم مسیر رسانه نسل دوم متصل می کند.
function acceptVoiceMediaV2WebSocketConnection({ socket, request, runtime, logger = null } = {}) {
    if (!socket || typeof socket.on !== "function" || typeof socket.send !== "function" || typeof socket.close !== "function") throw new TypeError("socket is invalid.");
    if (!runtime || typeof runtime.acceptConnection !== "function") throw new TypeError("runtime is invalid.");
    if (!isVoiceMediaV2WebSocketRequest(request)) return false;

    const transportConnectionKey = `voice-media-v2-ws:${randomUUID()}`;
    const accepted = runtime.acceptConnection({
        transportConnectionKey,
        sendPacket(packet) {
            return new Promise((resolve, reject) => {
                socket.send(packet, { binary: true }, (error) => error ? reject(error) : resolve());
            });
        },
        closeTransport(reason) {
            try { socket.close(1000, String(reason ?? "media_closed").slice(0, 120)); } catch { }
        }
    });

    //* این تابع داده باینری دریافتی را به اتصال مسیر رسانه تحویل می دهد.
    function handleMessage(data, isBinary) {
        if (!isBinary) {
            void accepted.closed("media_binary_required");
            return;
        }
        void accepted.receive(data).catch((error) => {
            logger?.warn?.("VME2_PHASE9_MEDIA_WS_RECEIVE=FAIL", { error: error?.message ?? String(error) });
            void accepted.closed("media_protocol_error");
        });
    }

    //* این تابع بسته شدن وب سوکت را به رانتایم مسیر رسانه اعلام می کند.
    function handleClose() {
        void accepted.closed("media_websocket_closed");
    }

    //* این تابع خطای وب سوکت را ثبت می کند و اتصال مسیر رسانه را می بندد.
    function handleError(error) {
        logger?.warn?.("VME2_PHASE9_MEDIA_WS_ERROR", { error: error?.message ?? String(error) });
        void accepted.closed("media_websocket_error");
    }

    socket.on("message", handleMessage);
    socket.on("close", handleClose);
    socket.on("error", handleError);
    return true;
}

export {
    acceptVoiceMediaV2WebSocketConnection,
    isVoiceMediaV2WebSocketRequest
};
