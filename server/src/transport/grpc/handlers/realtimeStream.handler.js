// File => src/transport/grpc/handlers/realtimeStream.handler.js

let grpcStreamingTransportInstance = null;

//* این تابع نمونه ترنسپورت جی‌آر‌پی‌سی اِستریم را برای هَندلِر نگه می‌دارد.
function setGrpcStreamingTransport(transport) {
    grpcStreamingTransportInstance = transport;
}

//* این تابع اِستریم بازشده از سمت کلاینت را می‌گیرد و آن را به ترنسپورت جی‌آر‌پی‌سی ریل‌تایم تحویل می‌دهد.
async function openRealtimeStream(call) {
    if (!grpcStreamingTransportInstance) {
        call.destroy(new Error("Grpc streaming transport is not initialized"));
        return;
    }

    return await grpcStreamingTransportInstance.handleStream(call);//ر اینجا اویت باعث می‌شود اجرای این تابع تا پایان پردازش استریم منتظر بماند.
}

//* این تابع آبجکت هَندلِرهای سرویس جی‌آر‌پی‌سی ریل‌تایم را برای ریجستر شدن در سرور برمی‌گرداند.
function createRealtimeStreamHandler() {
    return {
        Open: openRealtimeStream
    };
}

export {
    setGrpcStreamingTransport,
    openRealtimeStream,
    createRealtimeStreamHandler
};

//* توضیح کلی فایل:
//* این فایل هَندلِر سرویس جی‌آر‌پی‌سی اِستریم ریل‌تایم است.
//* وظیفه این فایل اجرای منطق ریل‌تایم نیست.
//* این فایل فقط کال اِستریم را از سرور جی‌آر‌پی‌سی می‌گیرد.
//* سپس همان کال را به ترنسپورت grpcStreamingTransport تحویل می‌دهد.
//* مسیر اصلی پردازش پیام‌ها بعداً داخل ترنسپورت و ریل‌تایم کُر انجام می‌شود.
//* اِنولوپ فعلی، رُتِر فعلی و وب‌سوکت فعلی در این فایل تغییر نمی‌کنند.
