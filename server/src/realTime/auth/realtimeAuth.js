// File => src/realTime/auth/realtimeAuth.js

import { Channels } from "../protocol/channels.js";
import { MessageTypes } from "../protocol/messageTypes.js";
import { makeSystemEnvelope, makeErrorEnvelope, RealtimeErrorCodes } from "../protocol/envelope.js";
import { markRealtimeContextAuthenticated, isRealtimeContextAuthenticated } from "../core/realtimeContext.js";

//* این تابع بررسی می کند که اِنولوپ دریافتی پیام آث ریل تایم است یا نه.
function isRealtimeAuthEnvelope(envelope) {
    return envelope?.ch === Channels.system && envelope?.t === MessageTypes.system.auth;
}

//* این تابع اَکسس توکن را از پِیلود اِنولوپ آث می خواند و حالت های رایج توکن و بِرِر توکن را پشتیبانی می کند.
function readAccessTokenFromAuthEnvelope(envelope) {
    const payload = envelope?.payload ?? {};
    const rawToken = payload.accessToken ?? payload.token ?? payload.authToken ?? payload.authorization ?? "";
    const tokenText = String(rawToken ?? "").trim();
    if (!tokenText) return "";
    return tokenText.toLowerCase().startsWith("bearer ") ? tokenText.slice(7).trim() : tokenText;
}

//* این تابع خروجی وریفای توکن را به مدل یوزر ساده و امن برای کانتکست تبدیل می کند.
function normalizeRealtimeAuthUser(decodedToken) {
    if (!decodedToken || typeof decodedToken !== "object") return null;

    const userId = decodedToken.sub ?? decodedToken.userId ?? decodedToken.id ?? "";
    if (!userId) return null;

    const tokenUserName = String(decodedToken.userName ?? "").trim();
    const tokenEmail = String(decodedToken.email ?? "").trim();
    const resolvedUserName = tokenUserName || tokenEmail || String(userId);

    return {
        id: String(userId),
        userId: String(userId),
        email: tokenEmail,
        userName: resolvedUserName,
        tokenId: decodedToken.jti ?? "",
        issuer: decodedToken.iss ?? "",
        audience: decodedToken.aud ?? ""
    };
}

//* این تابع خطای خام توکن را به اِرور استاندارد آث ریل تایم تبدیل می کند تا خطای توکن منقضی شده اینترنال اِرور نشود.
function normalizeRealtimeAuthError(error) {
    const name = error?.name ?? "";
    const message = error?.message ?? "";
    const code = error?.code ?? "";

    if (code === RealtimeErrorCodes.tokenExpired || name === "TokenExpiredError" || message === "jwt expired") {
        return { code: RealtimeErrorCodes.tokenExpired, message: "Realtime access token expired", details: null };
    }

    if (code === RealtimeErrorCodes.unauthorized || code === RealtimeErrorCodes.invalidToken || name === "JsonWebTokenError" || name === "NotBeforeError") {
        return { code: RealtimeErrorCodes.unauthorized, message: "Realtime access token is invalid", details: null };
    }

    if (error?.code && error?.message) return error;
    return { code: RealtimeErrorCodes.internalError, message: message || "Realtime auth failed", details: null };
}

//* این تابع از توکن سرویس داخل کانتکست استفاده می کند و اَکسس توکن را وریفای می کند.
async function verifyRealtimeAccessToken(ctx, accessToken) {
    if (!ctx?.tokenService || typeof ctx.tokenService.verifyAccessToken !== "function") {
        throw { code: RealtimeErrorCodes.internalError, message: "Realtime token service is not available" };
    }

    if (!accessToken) {
        throw { code: RealtimeErrorCodes.unauthorized, message: "Realtime access token is missing" };
    }

    try {
        const decodedToken = await ctx.tokenService.verifyAccessToken(accessToken);
        const user = normalizeRealtimeAuthUser(decodedToken);
        if (!user) throw { code: RealtimeErrorCodes.unauthorized, message: "Realtime access token is invalid" };
        return user;
    } catch (error) {
        throw normalizeRealtimeAuthError(error);
    }
}

//* این تابع اِنولوپ موفقیت آث را می سازد تا کلاینت بداند کانکشن آثنتیکیتد شده است.
function makeRealtimeAuthOkEnvelope(ctx, sourceEnvelope) {
    return makeSystemEnvelope(MessageTypes.system.authOk, {
        ok: true,
        connectionId: ctx?.connectionId ?? "",
        userId: ctx?.user?.id ?? ctx?.user?.userId ?? "",
        userName: ctx?.user?.userName ?? ""
    }, { replyTo: sourceEnvelope?.id ?? "" });
}

//* این تابع اِنولوپ شکست آث را می سازد تا کلاینت دلیل رد شدن آث را استاندارد دریافت کند.
function makeRealtimeAuthFailedEnvelope(error, sourceEnvelope) {
    const envelope = makeErrorEnvelope(error, { replyTo: sourceEnvelope?.id ?? "" });
    envelope.t = MessageTypes.system.authFailed;
    return envelope;
}

//* این تابع پیام آث را کامل پردازش می کند، توکن را وریفای می کند، یوزر را روی کانتکست ذخیره می کند و پاسخ مناسب می فرستد.
async function handleRealtimeAuthEnvelope(
    ctx,
    envelope
) {
    if (!isRealtimeAuthEnvelope(envelope)) {
        return false;
    }

    try {
        const accessToken =
            readAccessTokenFromAuthEnvelope(
                envelope
            );

        const user =
            await verifyRealtimeAccessToken(
                ctx,
                accessToken
            );

        const userId =
            String(
                user?.id ??
                user?.userId ??
                ""
            ).trim();

        ctx?.registry
            ?.addConnection
            ?.(
                ctx?.realtimeConnection,
                userId
            );

        markRealtimeContextAuthenticated(
            ctx,
            user
        );

        ctx?.realtimeConnection
            ?.sendEnvelope(
                makeRealtimeAuthOkEnvelope(
                    ctx,
                    envelope
                )
            );

        return true;
    } catch (error) {
        ctx?.realtimeConnection
            ?.sendEnvelope(
                makeRealtimeAuthFailedEnvelope(
                    error,
                    envelope
                )
            );

        return false;
    }
}

//* این تابع بررسی می کند که کانکشن برای پیام های غیر آث مجاز است یا نه.
function requireRealtimeAuthenticated(ctx) {
    if (isRealtimeContextAuthenticated(ctx)) return true;
    throw { code: RealtimeErrorCodes.notAuthenticated, message: "Realtime connection is not authenticated" };
}

/*
توضیح کلی اسکریپت:
این فایل آث ریل تایم سمت سرور را مدیریت می کند.
کلاینت بعد از وصل شدن، یک اِنولوپ سیستم آث می فرستد و اَکسس توکن را داخل پِیلود قرار می دهد.
این فایل اَکسس توکن را از پِیلود می خواند، با توکن سرویس وریفای می کند و یوزر معتبر را روی کانتکست ذخیره می کند.
اگر آث موفق باشد، پیام سیستم آث اوکی برای همان کانکشن ارسال می شود.
اگر آث شکست بخورد، پیام سیستم آث فِیلد برای همان کانکشن ارسال می شود.
خطاهای توکن مثل منقضی شدن یا نامعتبر بودن، قبل از ارسال به کلاینت به کد استاندارد ریل تایم تبدیل می شوند.
این فایل نباید لاگین انجام دهد، نباید رفرش توکن بسازد، نباید روم را مدیریت کند و نباید لاجیک بازی داشته باشد.
وظیفه این فایل فقط آث کردن کانکشن ریل تایم با اَکسس توکن آماده است.
*/

export {
    isRealtimeAuthEnvelope,
    readAccessTokenFromAuthEnvelope,
    normalizeRealtimeAuthUser,
    normalizeRealtimeAuthError,
    verifyRealtimeAccessToken,
    makeRealtimeAuthOkEnvelope,
    makeRealtimeAuthFailedEnvelope,
    handleRealtimeAuthEnvelope,
    requireRealtimeAuthenticated
};
