// src/utils/logger.js

function ts() {
    return new Date().toISOString();
}

function fmt(level, msg, extra) {
    const base = `[${ts()}] [${level}] ${msg}`;
    if (extra === undefined) return base;

    try {
        return `${base} ${JSON.stringify(extra)}`;
    } catch {
        return `${base} ${String(extra)}`;
    }
}

const logger = {
    info: (msg, extra) => console.log(fmt("INFO", msg, extra)),
    warn: (msg, extra) => console.warn(fmt("WARN", msg, extra)),
    error: (msg, extra) => console.error(fmt("ERROR", msg, extra))
};

export default logger;
/* 
ابزار مشترک لاگ‌گیری در سرور است.

این فایل یک تابع ts برای ساخت timestamp استاندارد دارد
و یک تابع fmt برای ساخت متن نهایی لاگ.

Object اصلی فایل با نام logger سه متد دارد:
info برای پیام‌های عادی، warn برای هشدارها،
و error برای خطاها.

هر لاگ با زمان فعلی، سطح لاگ و پیام اصلی ساخته می‌شود.
اگر اطلاعات اضافه ارسال شود، با JSON.stringify به متن لاگ اضافه می‌شود.

این logger در فایل‌هایی مثل index.js، server.js،
shutdown.js و auth.error.mapper.js استفاده می‌شود
تا پیام‌های runtime، startup، shutdown و خطاها یکدست ثبت شوند.
 */