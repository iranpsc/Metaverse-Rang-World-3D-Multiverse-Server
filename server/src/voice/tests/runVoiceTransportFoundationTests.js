// مسیر فایل: src/voice/tests/runVoiceTransportFoundationTests.js

await import(
    "./voiceTransportCore.test.js"
);

await import(
    "./voiceWebSocketTransport.test.js"
);

await import(
    "./voiceGrpcTransport.test.js"
);

console.log(
    "VOICE_TRANSPORT_FOUNDATION_ALL_TESTS=OK"
);

/*
توضیح فایل:
این فایل آزمون هسته مشترک، شنونده موقت وب‌سوکت و شنونده موقت جی‌آرپی پایه انتقال صوتی را به‌ترتیب اجرا می‌کند.
*/
