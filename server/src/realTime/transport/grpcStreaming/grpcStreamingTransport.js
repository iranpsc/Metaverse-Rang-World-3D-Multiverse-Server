// File => src/realTime/transport/grpcStreaming/grpcStreamingTransport.js

import { randomUUID } from "crypto";
import { RealtimeTransportKind, RealtimeTransportState } from "../realtimeTransportContract.js";

class GrpcStreamingRealtimeTransport {
    //* این سازنده ترنسپورت جی‌آر‌پی‌سی اِستریمینگ را آماده می‌کند و کال‌بک‌های کُر ریل‌تایم را نگه می‌دارد.
    constructor({ logger = null, onConnection = null, onMessage = null, onClose = null, onError = null } = {}) {
        this.logger = logger;
        this.state = RealtimeTransportState.stopped;
        this.kind = RealtimeTransportKind.grpcStreaming;
        this.connections = new Map();
        this.onConnection = onConnection;
        this.onMessage = onMessage;
        this.onClose = onClose;
        this.onError = onError;
    }

    //* این تابع کال‌بک‌های کُر ریل‌تایم را بعد از ساخته شدن ترنسپورت تنظیم می‌کند.
    setCallbacks({ onConnection = null, onMessage = null, onClose = null, onError = null } = {}) {
        if (onConnection) this.onConnection = onConnection;
        if (onMessage) this.onMessage = onMessage;
        if (onClose) this.onClose = onClose;
        if (onError) this.onError = onError;
        return this;
    }

    //* این تابع ترنسپورت جی‌آر‌پی‌سی اِستریمینگ را آماده دریافت کال‌های اِستریم می‌کند.
    start(callbacks = {}) {
        this.setCallbacks(callbacks);
        this.state = this.readStateValue(["started", "running", "ready"], RealtimeTransportState.stopped);
        this.logger?.info?.("GrpcStreamingRealtimeTransport started");
        return this;
    }

    //* این تابع همه کانکشن‌های باز جی‌آر‌پی‌سی را می‌بندد و ترنسپورت را متوقف می‌کند.
    stop() {
        for (const connection of this.connections.values()) this.closeConnection(connection, "transport_stop");
        this.connections.clear();
        this.state = RealtimeTransportState.stopped;
        this.logger?.info?.("GrpcStreamingRealtimeTransport stopped");
    }

    //* این تابع یک کال جی‌آر‌پی‌سی اِستریم را به یک کانکشن ریل‌تایم تبدیل می‌کند و رویدادهای آن را وصل می‌کند.
    async handleStream(call) {
        const connection = this.createGrpcConnection(call);

        this.connections.set(connection.connectionId, connection);
        this.safeInvoke(this.onConnection, connection);

        call.on("data", async (frame) => { await this.handleIncomingFrame(connection, frame); });
        call.on("end", () => { this.closeConnection(connection, "stream_end"); });
        call.on("close", () => { this.closeConnection(connection, "stream_close"); });
        call.on("error", (error) => { this.handleConnectionError(connection, error); });

        this.logger?.info?.("Grpc streaming connection opened", { connectionId: connection.connectionId, transportKind: connection.kind });

        return connection;
    }

    //* این تابع برای هر کال جی‌آر‌پی‌سی یک کانکشن قابل استفاده توسط کُر ریل‌تایم می‌سازد.
    createGrpcConnection(call) {
        const connectionId = `rt_grpc_${randomUUID()}`;

        return {
            connectionId,
            id: connectionId,
            kind: this.kind,
            call,
            state: "connected",
            connectedAt: Date.now(),
            lastMessageAt: 0,
            closedAt: 0,
            isClosed: false,
            //* این تابع جیسون خام اِنولوپ خروجی را از سمت سرور به کلاینت جی‌آر‌پی‌سی می‌فرستد.
            sendRaw: (rawJson) => this.sendRaw(connectionId, rawJson),
            //* این تابع کانکشن جی‌آر‌پی‌سی همین کلاینت را می‌بندد.
            close: (reason = "connection_close") => this.closeConnection(connectionId, reason)
        };
    }

    //* این تابع فریم ورودی جی‌آر‌پی‌سی را می‌خواند و جیسون خام اِنولوپ را به کُر ریل‌تایم تحویل می‌دهد.
    async handleIncomingFrame(connection, frame) {
        if (!connection || connection.isClosed) return false;

        const rawJson = typeof frame?.rawJson === "string" ? frame.rawJson : "";

        if (!rawJson.trim()) {
            this.logger?.warn?.("Grpc streaming frame ignored because rawJson is empty", { connectionId: connection.connectionId });
            return false;
        }

        connection.lastMessageAt = Date.now();

        try {
            await this.safeInvokeAsync(this.onMessage, connection, rawJson);
            return true;
        } catch (error) {
            this.handleConnectionError(connection, error);
            return false;
        }
    }

    //* این تابع جیسون خام اِنولوپ خروجی را روی کال جی‌آر‌پی‌سی همان کانکشن می‌نویسد.
    sendRaw(connectionOrId, rawJson) {
        const connection = this.resolveConnection(connectionOrId);

        if (!connection || connection.isClosed || !connection.call?.write) return false;
        if (typeof rawJson !== "string" || !rawJson.trim()) return false;

        try {
            connection.call.write({ rawJson });
            return true;
        } catch (error) {
            this.handleConnectionError(connection, error);
            return false;
        }
    }

    //* این تابع کانکشن جی‌آر‌پی‌سی را با شناسه یا آبجکت کانکشن پیدا می‌کند.
    resolveConnection(connectionOrId) {
        if (!connectionOrId) return null;
        if (typeof connectionOrId === "string") return this.connections.get(connectionOrId) ?? null;
        if (connectionOrId.connectionId && this.connections.has(connectionOrId.connectionId)) return this.connections.get(connectionOrId.connectionId);
        return connectionOrId;
    }

    //* این تابع کانکشن جی‌آر‌پی‌سی را می‌بندد و رویداد بسته شدن را به کُر ریل‌تایم اطلاع می‌دهد.
    closeConnection(connectionOrId, reason = "connection_close") {
        const connection = this.resolveConnection(connectionOrId);

        if (!connection || connection.isClosed) return false;

        connection.isClosed = true;
        connection.state = "closed";
        connection.closedAt = Date.now();

        this.connections.delete(connection.connectionId);

        try {
            connection.call?.end?.();
        } catch (error) {
            this.logger?.warn?.("Grpc streaming call end failed", { connectionId: connection.connectionId, reason, error: error?.message });
        }

        this.safeInvoke(this.onClose, connection, reason);
        this.logger?.info?.("Grpc streaming connection closed", { connectionId: connection.connectionId, reason });

        return true;
    }

    //* این تابع خطای کانکشن جی‌آر‌پی‌سی را ثبت می‌کند و کانکشن را به شکل کنترل‌شده می‌بندد.
    handleConnectionError(connectionOrId, error) {
        const connection = this.resolveConnection(connectionOrId);

        this.safeInvoke(this.onError, connection, error);
        this.logger?.error?.("Grpc streaming connection error", { connectionId: connection?.connectionId ?? "", error: error?.message ?? String(error) });

        if (connection) this.closeConnection(connection, "stream_error");
    }

    //* این تابع وضعیت فعلی ترنسپورت جی‌آر‌پی‌سی اِستریمینگ را برمی‌گرداند.
    getState() {
        return this.state;
    }

    //* این تابع مشخص می‌کند که ترنسپورت جی‌آر‌پی‌سی اِستریمینگ اکنون پیاده‌سازی عملیاتی پایه دارد.
    isImplemented() {
        return true;
    }

    //* این تابع مقدار مناسب وضعیت ترنسپورت را از قرارداد فعلی پروژه می‌خواند.
    readStateValue(keys, fallback) {
        for (const key of keys) {
            if (RealtimeTransportState?.[key]) return RealtimeTransportState[key];
        }

        return fallback;
    }

    //* این تابع یک کال‌بک همزمان را بدون شکستن جریان اصلی اجرا می‌کند.
    safeInvoke(callback, ...args) {
        if (typeof callback !== "function") return null;

        try {
            return callback(...args);
        } catch (error) {
            this.logger?.error?.("Grpc streaming callback failed", { error: error?.message ?? String(error) });
            return null;
        }
    }

    //* این تابع یک کال‌بک اَسینک را بدون شکستن جریان اصلی اجرا می‌کند.
    async safeInvokeAsync(callback, ...args) {
        if (typeof callback !== "function") return null;

        try {
            return await callback(...args);
        } catch (error) {
            this.logger?.error?.("Grpc streaming async callback failed", { error: error?.message ?? String(error) });
            throw error;
        }
    }
}

//* توضیح کلی اسکریپت:
//* این فایل ترنسپورت جی‌آر‌پی‌سی اِستریمینگ سمت سرور را برای ریل‌تایم پیاده‌سازی می‌کند.
//* هر کال جی‌آر‌پی‌سی اِستریم به یک کانکشن ریل‌تایم تبدیل می‌شود.
//* پیام ورودی فقط از فیلد rawJson خوانده می‌شود و همان جیسون خام اِنولوپ فعلی به کُر ریل‌تایم تحویل داده می‌شود.
//* پاسخ خروجی کُر ریل‌تایم هم با call.write و داخل فیلد rawJson به کلاینت نیتیو برگردانده می‌شود.
//* این فایل نقش ترنسپورت دارد و منطق رُتِر، روم، پرزنس، اَک و گیم‌پلی داخل همان مسیرهای فعلی ریل‌تایم باقی می‌ماند.

export { GrpcStreamingRealtimeTransport };
