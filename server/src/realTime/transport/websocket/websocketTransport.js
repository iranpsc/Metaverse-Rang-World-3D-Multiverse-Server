// File => src/realTime/transport/websocket/websocketTransport.js

import { WebSocketServer } from "ws";
import { RealtimeTransportKind, RealtimeTransportState, noopTransportCallback } from "../realtimeTransportContract.js";

//* این تابع بررسی می کند که وب سوکت هنوز باز است و امکان ارسال پیام دارد یا نه.
function isSocketOpen(ws) {
    return ws?.readyState === ws?.OPEN || ws?.readyState === 1;
}

//* این تابع یک آبجکت کانکشن سبک می سازد تا کُر بدون شناخت مستقیم وب سوکت با کانکشن کار کند.
function createWebSocketConnection(ws, req) {
    return {
        kind: RealtimeTransportKind.websocket,
        socket: ws,
        request: req,
        remoteAddress: req?.socket?.remoteAddress ?? "",
        connectedAt: Date.now(),
        isOpen: () => isSocketOpen(ws)
    };
}

class WebSocketRealtimeTransport {
    //* این سازنده تنظیمات پایه وب سوکت ترنسپورت را نگه می دارد و هنوز وب سوکت سرور را اجرا نمی کند.
    constructor({ server, path = "", logger = null } = {}) {
        this.server = server;
        this.path = path;
        this.logger = logger;
        this.wss = null;
        this.state = RealtimeTransportState.stopped;
        this.connections = new Set();
        this.onConnection = noopTransportCallback;
        this.onMessage = noopTransportCallback;
        this.onClose = noopTransportCallback;
        this.onError = noopTransportCallback;
    }

    //* این تابع وب سوکت سرور را به سرور اچ تی تی پی یا تی ال اس وصل می کند و پیام خام را به کُر ریل تایم تحویل می دهد.
    start({ onConnection, onMessage, onClose, onError } = {}) {
        if (this.wss) return this;
        if (!this.server) throw new Error("WebSocketRealtimeTransport requires server");

        this.state = RealtimeTransportState.starting;
        this.onConnection = onConnection ?? noopTransportCallback;
        this.onMessage = onMessage ?? noopTransportCallback;
        this.onClose = onClose ?? noopTransportCallback;
        this.onError = onError ?? noopTransportCallback;

        const options = this.path ? { server: this.server, path: this.path } : { server: this.server };
        this.wss = new WebSocketServer(options);//ساخته شدن وب سوکت سرور

        this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));//*منتظر برای کانکشن یا اتصال*******************  اتصال کلاینت اولین خط اجرا می شود
        this.wss.on("error", (error) => this.handleServerError(error));

        this.state = RealtimeTransportState.running;
        this.logger?.info?.("WebSocket realtime transport started", { path: this.path || "default" });
        return this;
    }

    //* این تابع یک کانکشن وب سوکت جدید را ثبت می کند و ایونت های پیام، بسته شدن و خطا را به کالبک های کُر وصل می کند.
    handleConnection(ws, req) {
        const connection = createWebSocketConnection(ws, req);//ساخت  کانکشن برای کلاینت
        this.connections.add(connection);

        ws.on("message", (raw) => this.onMessage(connection, raw));//هر پیام خام از کلاینت را می‌گیرد - یعنی با آمدن پیام از این کلاینت آن میسیج اجرا می شود در ریل تایم سرور
        ws.on("close", (code, reason) => this.handleConnectionClosed(connection, code, reason));
        ws.on("error", (error) => this.handleConnectionError(connection, error));

        this.onConnection(connection);//اینجا کانکشن خام از ترنسپرت به کُر داده می‌شود.
    }

    //* این تابع پیام خام را روی کانکشن مشخص ارسال می کند و وارد لاجیک اِنولوپ، رُتِر یا بازی نمی شود.
    sendRaw(connection, raw) {
        if (!connection?.socket || !isSocketOpen(connection.socket)) return false;
        connection.socket.send(raw);
        return true;
    }

    //* این تابع یک کانکشن وب سوکت مشخص را با دلیل قابل لاگ می بندد.
    closeConnection(connection, code = 1000, reason = "transport_close") {
        if (!connection?.socket || !isSocketOpen(connection.socket)) return false;
        connection.socket.close(code, reason);
        return true;
    }

    //* این تابع بسته شدن یک کانکشن را مدیریت می کند و آن را از لیست داخلی ترنسپورت حذف می کند.
    handleConnectionClosed(connection, code, reason) {
        this.connections.delete(connection);
        this.onClose(connection, { code, reason: String(reason ?? "") });
    }

    //* این تابع خطای یک کانکشن را به کُر گزارش می دهد و خودش تصمیم آث یا بازی نمی گیرد.
    handleConnectionError(connection, error) {
        this.onError(connection, error);
    }

    //* این تابع خطای خود وب سوکت سرور را لاگ می کند و وضعیت ترنسپورت را فِیلد می گذارد.
    handleServerError(error) {
        this.state = RealtimeTransportState.failed;
        this.logger?.error?.("WebSocket realtime transport error", { error: error?.message ?? String(error) });
    }

    //* این تابع وب سوکت سرور را متوقف می کند و تمام کانکشن های باز را می بندد.
    stop() {
        if (!this.wss) return;

        this.state = RealtimeTransportState.stopping;
        for (const connection of this.connections) this.closeConnection(connection, 1001, "transport_stop");
        this.connections.clear();
        this.wss.close();
        this.wss = null;
        this.state = RealtimeTransportState.stopped;
        this.logger?.info?.("WebSocket realtime transport stopped");
    }

    //* این تابع وضعیت فعلی ترنسپورت را برای لاگ، تست و مانیتورینگ برمی گرداند.
    getState() {
        return this.state;
    }

    //* این تابع تعداد کانکشن های فعلی ترنسپورت را برای تست و مانیتورینگ برمی گرداند.
    getConnectionCount() {
        return this.connections.size;
    }
}

/*
توضیح کلی اسکریپت:
این فایل پیاده سازی پایه وب سوکت ترنسپورت سمت سرور است.
وظیفه این فایل فقط باز کردن وب سوکت سرور، نگه داشتن کانکشن های خام، دریافت پیام خام و ارسال پیام خام است.
این فایل نباید اِنولوپ را پَرس کند.
این فایل نباید آث انجام دهد.
این فایل نباید جوین روم انجام دهد.
این فایل نباید پلیر اِستیت یا لاجیک بازی داشته باشد.
پیام خام از این ترنسپورت به کُر ریل تایم تحویل داده می شود.
کُر ریل تایم در فازهای بعدی پیام را پَرس، وَلیدِیت و روت می کند.
*/

export { WebSocketRealtimeTransport, isSocketOpen, createWebSocketConnection };