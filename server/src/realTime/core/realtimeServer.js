// File => src/realTime/core/realtimeServer.js

import { parseEnvelope, makeErrorEnvelope, serializeEnvelope, RealtimeErrorCodes } from "../protocol/envelope.js";
import { validateRealtimeTransportContract } from "../transport/realtimeTransportContract.js";
import { createRealtimeContext, touchRealtimeContextMessage, touchRealtimeContextError, markRealtimeContextClosed, getRealtimeContextSnapshot } from "./realtimeContext.js";
import { createRealtimeConnection } from "./realtimeConnection.js";

class RealtimeServer {
    //* این سازنده ترنسپورت، رُتِر، وابستگی های مشترک کُر و هوک های چرخه عمر را می گیرد و هنوز سرور را استارت نمی کند.
    constructor({ transport, router = null, logger = null, tokenService = null, registry = null, rooms = null, hooks = null } = {}) {
        validateRealtimeTransportContract(transport);
        this.transport = transport;
        this.router = router;
        this.logger = logger;
        this.tokenService = tokenService;
        this.registry = registry;
        this.rooms = rooms;
        this.hooks = hooks ?? {};
        this.connectionsById = new Map();
        this.contextByRawConnection = new WeakMap();
        this.started = false;
    }

    //* این تابع کُر ریل تایم را به ترنسپورت وصل می کند تا کانکشن، پیام، بسته شدن و خطا از ترنسپورت وارد کُر شوند.
    start() {
        if (this.started) return this;

        this.transport.start({
            onConnection: (connection) => this.handleTransportConnection(connection),//هر وقت آن کانکشن در ترنسپرت فراخوانی شداین تابع را اجرا کن
            onMessage: (connection, raw) => this.handleTransportMessage(connection, raw),
            onClose: (connection, closeInfo) => this.handleTransportClose(connection, closeInfo),
            onError: (connection, error) => this.handleTransportError(connection, error)
        });

        this.started = true;
        this.logger?.info?.("Realtime core started");
        return this;
    }

    //* این تابع کُر ریل تایم و ترنسپورت را متوقف می کند و لیست کانکشن های فعال را پاک می کند.
    stop() {
        if (!this.started) return;
        this.safeCallHook("onStop", this);
        this.transport.stop();
        this.connectionsById.clear();
        this.started = false;
        this.logger?.info?.("Realtime core stopped");
    }

    //* این تابع هنگام کانکشن جدید از ترنسپورت اجرا می شود و برای آن کانتکست و کانکشن ریل تایم می سازد.
    handleTransportConnection(connection) {
        const context = createRealtimeContext({
            connection,
            transportKind: connection?.kind,
            logger: this.logger,
            tokenService: this.tokenService,
            registry: this.registry,
            rooms: this.rooms
        });

        const realtimeConnection =
            createRealtimeConnection({
                context,
                transport: this.transport
            });

        context.realtimeConnection =
            realtimeConnection;

        this.connectionsById.set(
            context.connectionId,
            realtimeConnection
        );

        this.contextByRawConnection.set(
            connection,
            context
        );

        this.registry
            ?.addConnection
            ?.(realtimeConnection);

        this.safeCallHook(
            "onConnection",
            context,
            realtimeConnection,
            this
        );

        this.logger?.info?.(
            "Realtime connection opened",
            getRealtimeContextSnapshot(context)
        );

        return realtimeConnection;
    }

    //* این تابع پیام خام ترنسپورت را می گیرد، اِنولوپ را پَرس می کند و پیام معتبر را به رُتِر تحویل می دهد.
    async handleTransportMessage(connection, raw) {
        const context = this.getContextByRawConnection(connection);// پیدا کردن کانتکست از روی کانکشن 
        if (!context) return;

        touchRealtimeContextMessage(context);
        if (this.safeCallHook("beforeMessage", context, raw, this) === false) return;

        let envelope;
        try {
            envelope = parseEnvelope(raw);
        } catch (error) {
            touchRealtimeContextError(context);
            this.logger?.warn?.("Invalid realtime envelope", { connectionId: context.connectionId, error: error?.message ?? String(error) });
            this.sendErrorToContext(context, error, { code: RealtimeErrorCodes.invalidEnvelope });
            return;
        }

        if (this.safeCallHook("afterEnvelope", context, envelope, this) === false) return;

        try {
            await this.dispatchEnvelope(context, envelope);
        } catch (error) {
            touchRealtimeContextError(context);
            this.logger?.error?.("Realtime dispatch failed", { connectionId: context.connectionId, error: error?.message ?? String(error) });
            this.sendErrorToContext(context, error, { code: RealtimeErrorCodes.internalError, replyTo: envelope.id });
        }
    }

    //* این تابع بسته شدن کانکشن از سمت ترنسپورت را می گیرد و کانتکست و لیست داخلی کُر را کلیناپ می کند.
    handleTransportClose(
        connection,
        closeInfo = {}
    ) {
        const context =
            this.getContextByRawConnection(
                connection
            );

        if (!context) return;

        this.safeCallHook(
            "onClose",
            context,
            closeInfo,
            this
        );

        this.registry
            ?.removeConnectionById
            ?.(context.connectionId);

        markRealtimeContextClosed(context);

        this.connectionsById.delete(
            context.connectionId
        );

        this.logger?.info?.(
            "Realtime connection closed",
            {
                ...getRealtimeContextSnapshot(
                    context
                ),
                closeInfo
            }
        );
    }

    //* این تابع خطای کانکشن خام را از ترنسپورت می گیرد و آن را روی کانتکست ثبت و لاگ می کند.
    handleTransportError(connection, error) {
        const context = this.getContextByRawConnection(connection);
        if (!context) return;

        touchRealtimeContextError(context);
        this.safeCallHook("onError", context, error, this);
        this.logger?.error?.("Realtime connection transport error", { connectionId: context.connectionId, error: error?.message ?? String(error) });
    }

    //* این تابع اِنولوپ معتبر را به رُتِر وصل شده به کُر تحویل می دهد.
    async dispatchEnvelope(context, envelope) {
        if (typeof this.router !== "function") return;
        return await this.router(context, envelope, this);
    }

    //* این تابع یک خطا را به اِنولوپ استاندارد سیستم ارور تبدیل می کند و برای همان کانکشن می فرستد.
    sendErrorToContext(context, error, options = {}) {
        try {
            const envelope = makeErrorEnvelope(error, { replyTo: options.replyTo ?? "" });
            if (options.code && envelope.payload) envelope.payload.code = options.code;
            return context?.realtimeConnection?.sendRaw(serializeEnvelope(envelope)) ?? false;
        } catch (sendError) {
            this.logger?.error?.("Failed to send realtime error envelope", { error: sendError?.message ?? String(sendError) });
            return false;
        }
    }

    //* این تابع کانتکست متناظر با کانکشن خام ترنسپورت را برمی گرداند.
    getContextByRawConnection(connection) {
        return this.contextByRawConnection.get(connection) ?? null;
    }

    //* این تابع کانکشن ریل تایم را با شناسه کانکشن پیدا می کند تا در فازهای بعدی برای ارسال مستقیم استفاده شود.
    getConnectionById(connectionId) {
        return this.connectionsById.get(connectionId) ?? null;
    }

    //* این تابع تعداد کانکشن ها و وضعیت ترنسپورت را برای تست، لاگ و مانیتورینگ برمی گرداند.
    getStats() {
        return {
            started: this.started,
            transportState: this.transport.getState(),
            connectionCount: this.connectionsById.size
        };
    }

    //* این تابع هوک های اختیاری کُر را امن اجرا می کند تا خطای یک هوک مسیر اصلی ریل تایم را کرش نکند.
    safeCallHook(hookName, ...args) {
        try {
            const hook = this.hooks?.[hookName];
            return typeof hook === "function" ? hook(...args) : undefined;
        } catch (error) {
            this.logger?.error?.("Realtime lifecycle hook failed", { hookName, error: error?.message ?? String(error) });
            return undefined;
        }
    }
}

//* این تابع یک سرور ریل تایم جدید می سازد تا ساخت کُر در فایل های بوت استرپ ساده و یکدست باشد.
function createRealtimeServer(options) {
    return new RealtimeServer(options);
}

/*
توضیح کلی اسکریپت:
این فایل کُر اصلی ریل تایم سمت سرور را می سازد.
RealtimeServer بین ترنسپورت و رُتِر قرار می گیرد.
ترنسپورت پیام خام را به این فایل تحویل می دهد.
این فایل پیام را پَرس و وَلیدِیت می کند، کانتکست کانکشن را مدیریت می کند و اِنولوپ معتبر را به رُتِر می فرستد.
در فاز اتصال، هوک های چرخه عمر هم اضافه شده اند تا هارت بیت، فلاد پروتکشن، اَک ترَکِر و کلیناپ دیسکانکت بدون قاطی شدن با لاجیک اصلی کُر وصل شوند.
این فایل نباید وب سوکت سرور خام بسازد.
این فایل نباید جی آر پی سی استریمینگ خام را اجرا کند.
این فایل نباید لاگین انجام دهد و نباید لاجیک بازی داشته باشد.
هدف این فایل جدا کردن لاجیک کُر از ترنسپورت است تا در آینده وب سوکت و جی آر پی سی استریمینگ هر دو به همین کُر وصل شوند.
*/

export { RealtimeServer, createRealtimeServer };
