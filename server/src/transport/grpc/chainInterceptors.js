// File =>  src\transport\grpc\chainInterceptors.js
/**
 * Node gRPC interceptor chaining (server side) در grpc-js رسمی “مثل middleware” نیست،
 * ولی ما اینجا یک الگوی ساده داریم: داخل handlerها از helperها استفاده می‌کنیم.
 *
 * برای مرحله ۱: این فایل فقط برای ساختار/آینده است.
 */
export function chainInterceptors() {
    return true;
}

/* 
فایل src / transport / grpc / chainInterceptors.js
فعلاً یک فایل ساختاری و آماده برای توسعه آینده است.

این فایل تابعی به نام chainInterceptors export می‌کند،
اما در نسخه فعلی فقط مقدار true برمی‌گرداند.

در مسیر اجرایی فعلی gRPC، زنجیره واقعی interceptorها از این فایل ساخته نمی‌شود
و AuthService مستقیماً با authInterceptor در server.js ثبت شده است.

بنابراین این فایل در حال حاضر نقش عملی در Register، Login یا GetUserData ندارد،
اما برای آینده می‌تواند محل مرکزی چیدن interceptorهایی مثل logging، client info، auth و metrics باشد.

 */