// File => src/realTime/router/routeRegistry.js
//********************************************************************** */ نکته rotes همان  handler هست
import { RealtimeErrorCodes, makeErrorEnvelope } from "../protocol/envelope.js";

class RealtimeRouteRegistry {
    //* این سازنده رجیستری مسیرها را می سازد تا هر چَنِل و تایپ به هَندلِر درست وصل شود.
    constructor({ logger = null } = {}) {
        this.logger = logger;
        this.routes = new Map();
    }

    //* این تابع کلید داخلی مسیر را از چَنِل و تایپ می سازد تا ثبت و پیدا کردن هَندلِرها یکدست باشد.
    buildRouteKey(channel, type) {
        return `${String(channel ?? "").trim()}/${String(type ?? "").trim()}`;
    }

    //* این تابع یک هَندلِر را برای چَنِل و تایپ مشخص ثبت می کند.
    register(channel, type, handler) {
        if (!channel) throw new Error("Realtime route channel is required");
        if (!type) throw new Error("Realtime route type is required");
        if (typeof handler !== "function") throw new Error("Realtime route handler must be function");
        this.routes.set(this.buildRouteKey(channel, type), handler);
        return this;
    }

    //* این تابع چند مسیر را یکجا ثبت می کند تا فایل های روت بتوانند تمیزتر به رجیستری اضافه شوند.
    registerMany(routeList = []) {
        for (const route of routeList) this.register(route.ch, route.t, route.handler);
        return this;
    }

    //* این تابع بررسی می کند که برای چَنِل و تایپ مشخص، هَندلِر ثبت شده وجود دارد یا نه.
    has(channel, type) {
        return this.routes.has(this.buildRouteKey(channel, type));
    }

    //* این تابع هَندلِر متناظر با چَنِل و تایپ را برمی گرداند.
    get(channel, type) {
        return this.routes.get(this.buildRouteKey(channel, type)) ?? null;
    }

    //* این تابع مسیر ثبت شده را حذف می کند و برای تست یا تغییر مسیرها استفاده می شود.
    remove(channel, type) {
        return this.routes.delete(this.buildRouteKey(channel, type));
    }

    //* این تابع اِنولوپ را بر اساس چَنِل و تایپ به هَندلِر درست تحویل می دهد.
    async dispatch(ctx, envelope, server = null) {
        const handler = this.get(envelope?.ch, envelope?.t);
        if (!handler) return this.handleMissingRoute(ctx, envelope);
        return await handler(ctx, envelope, server);
    }

    //* این تابع وقتی مسیر پیدا نشود، اِرور استاندارد می سازد و برای همان کانکشن می فرستد.
    handleMissingRoute(ctx, envelope) {
        const error = {
            code: RealtimeErrorCodes.invalidMessageType,
            message: `Realtime route not found: ${envelope?.ch}/${envelope?.t}`
        };

        ctx?.realtimeConnection?.sendEnvelope(makeErrorEnvelope(error, { replyTo: envelope?.id ?? "" }));
        this.logger?.warn?.("Realtime route not found", { ch: envelope?.ch, t: envelope?.t, connectionId: ctx?.connectionId });
        return false;
    }

    //* این تابع تعداد و نام مسیرهای ثبت شده را برای لاگ، دیباگ و تست برمی گرداند.
    getSnapshot() {
        return { routeCount: this.routes.size, routes: [...this.routes.keys()] };
    }

    //* این تابع همه مسیرهای ثبت شده را پاک می کند و برای تست یا بازسازی رجیستری استفاده می شود.
    clear() {
        this.routes.clear();
    }
}

//* این تابع رجیستری مسیر جدید می سازد تا ساخت آن در بوت استرپ و تست یکدست باشد.
function createRealtimeRouteRegistry(options = {}) {
    return new RealtimeRouteRegistry(options);
}

/*
توضیح کلی اسکریپت:
این فایل رجیستری مسیرهای ریل تایم را مدیریت می کند.
رجیستری مسیر مشخص می کند هر اِنولوپ با چَنِل و تایپ مشخص باید به کدام هَندلِر برود.
این فایل باعث می شود رُتِر به جای سوییچ های پراکنده، از یک مسیر مرکزی و قابل تست استفاده کند.
اگر مسیر پیدا نشود، همین فایل یک اِنولوپ سیستم اِرور برای همان کانکشن می سازد.
این فایل نباید ترنسپورت خام، آث واقعی، روم مَنِیجِر یا لاجیک بازی سنگین اجرا کند.
وظیفه این فایل فقط ثبت، پیدا کردن و اجرای هَندلِرهای مسیر است.
*/

export { RealtimeRouteRegistry, createRealtimeRouteRegistry };
