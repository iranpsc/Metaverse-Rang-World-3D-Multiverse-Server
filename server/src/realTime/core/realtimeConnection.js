// File => src/realTime/core/realtimeConnection.js

import { serializeEnvelope } from "../protocol/envelope.js";
import { markRealtimeContextClosing, markRealtimeContextClosed, getRealtimeContextSnapshot } from "./realtimeContext.js";

class RealtimeConnection {
    //* این سازنده یک وَرَپِر امن دور کانکشن خام می سازد تا کُر بدون شناخت ترنسپورت، پیام را ارسال و کانکشن را مدیریت کند.
    constructor({ context, transport }) {
        if (!context) throw new Error("RealtimeConnection requires context");
        if (!transport) throw new Error("RealtimeConnection requires transport");
        this.context = context;
        this.transport = transport;
    }

    //* این بخش شناسه یکتای کانکشن را برمی گرداند تا بخش های دیگر بدون دسترسی مستقیم به کانتکست، کانکشن را ردیابی کنند.
    get id() {
        return this.context.connectionId;
    }

    //* این تابع باز بودن کانکشن را از روی وضعیت کانتکست و کانکشن خام بررسی می کند.
    isOpen() {
        const rawOpen = typeof this.context.connection?.isOpen === "function" ? this.context.connection.isOpen() : true;
        return this.context.state !== "closed" && this.context.state !== "closing" && rawOpen;
    }

    //* این تابع اِنولوپ استاندارد را به متن قابل ارسال تبدیل می کند و آن را از راه ترنسپورت می فرستد.
    sendEnvelope(envelope) {
        if (!this.isOpen()) return false;
        return this.sendRaw(serializeEnvelope(envelope));
    }

    //* این تابع پیام خام را از راه ترنسپورت ارسال می کند و وارد پَرس، رُتِر یا لاجیک بازی نمی شود.
    sendRaw(raw) {
        if (!this.isOpen()) return false;
        return this.transport.sendRaw(this.context.connection, raw);
    }

    //* این تابع کانکشن را با کد و دلیل مشخص می بندد و وضعیت کانتکست را در حالت در حال بسته شدن قرار می دهد.
    close(code = 1000, reason = "realtime_connection_close") {
        if (!this.context) return false;
        markRealtimeContextClosing(this.context);
        const closed = this.transport.closeConnection(this.context.connection, code, reason);
        if (!closed) markRealtimeContextClosed(this.context);
        return closed;
    }

    //* این تابع بعد از بسته شدن واقعی کانکشن فراخوانی می شود و کانتکست را بسته شده علامت می زند.
    markClosed() {
        markRealtimeContextClosed(this.context);
        return this;
    }

    //* این تابع یک اسنپ شات امن از کانکشن برمی گرداند تا برای لاگ، دیباگ و تست استفاده شود.
    getSnapshot() {
        return getRealtimeContextSnapshot(this.context);
    }
}

//* این تابع یک کانکشن زنده جدید از کانتکست و ترنسپورت می سازد تا ساخت وَرَپِر کانکشن در کُر یکدست باشد.
function createRealtimeConnection({ context, transport }) {
    return new RealtimeConnection({ context, transport });
}

/*
توضیح کلی اسکریپت:
این فایل یک وَرَپِر امن دور کانکشن خام می سازد.
هدف این است که کُر ریل تایم و هَندلِرهای پیام، مستقیم با ترنسپورت خام کار نکنند.
ارسال اِنولوپ، ارسال پیام خام، بستن کانکشن و گرفتن اسنپ شات وضعیت کانکشن از این فایل عبور می کند.
این فایل نباید آث، رُتِر، روم مَنِیجِر یا لاجیک بازی انجام دهد.
وظیفه این فایل فقط مدیریت عملیات پایه روی یک کانکشن ریل تایم است.
*/

export { RealtimeConnection, createRealtimeConnection };