// File => src/realTime/transport/realtimeTransportContract.js

const RealtimeTransportState = Object.freeze({
    stopped: "stopped",
    starting: "starting",
    running: "running",
    stopping: "stopping",
    failed: "failed"
});

const RealtimeTransportKind = Object.freeze({
    websocket: "websocket",
    grpcStreaming: "grpcStreaming"
});

const RequiredTransportMethods = Object.freeze([
    "start",
    "stop",
    "sendRaw",
    "closeConnection",
    "getState"
]);

//* این تابع بررسی می کند که ترنسپورت ساخته شده، متدهای پایه مورد نیاز کُر ریل تایم را داشته باشد.
function validateRealtimeTransportContract(transport) {
    if (!transport || typeof transport !== "object") throw new Error("Realtime transport is empty");

    for (const methodName of RequiredTransportMethods) {
        if (typeof transport[methodName] !== "function") {
            throw new Error(`Realtime transport missing method: ${methodName}`);
        }
    }

    return true;
}

//* این تابع یک کالبک خالی و امن برمی گرداند تا اگر کُر هنوز کالبک نداده باشد، ترنسپورت کرش نکند.
function noopTransportCallback() { }

/*
توضیح کلی اسکریپت:
این فایل قرارداد پایه ترنسپورت سمت سرور را مشخص می کند.
در جاوااسکریپت اینترفیس واقعی مثل سی شارپ نداریم.
برای همین این فایل با وضعیت ثابت، نوع ثابت و تابع بررسی قرارداد، نقش اینترفیس را اجرا می کند.
هر ترنسپورت واقعی مثل وب سوکت ترنسپورت یا جی آر پی سی استریمینگ ترنسپورت باید متدهای پایه را داشته باشد.
متدهای پایه شامل استارت، استاپ، ارسال پیام خام، بستن کانکشن و گرفتن وضعیت هستند.
این فایل نباید لاجیک وب سوکت، جی آر پی سی، آث، روم یا بازی داشته باشد.
وظیفه این فایل فقط مشخص کردن قرارداد مشترک بین کُر ریل تایم و ترنسپورت ها است.
*/

export {
    RealtimeTransportState,
    RealtimeTransportKind,
    RequiredTransportMethods,
    validateRealtimeTransportContract,
    noopTransportCallback
};