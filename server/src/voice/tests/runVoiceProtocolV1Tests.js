// مسیر فایل: src/voice/tests/runVoiceProtocolV1Tests.js

await import(
    "./voiceArchitectureConstants.test.js"
);

await import(
    "./voiceBinaryEnvelope.test.js"
);

await import(
    "./voiceMessageContract.test.js"
);

await import(
    "./voiceAuthContract.test.js"
);

await import(
    "./voiceSessionContract.test.js"
);

await import(
    "./voiceReconnectContract.test.js"
);

await import(
    "./voiceProtocolV1Integration.test.js"
);

console.log(
    "VOICE_PROTOCOL_V1_ALL_TESTS=OK"
);

/*
توضیح فایل:
این فایل تمام آزمون‌های قرارداد نسخه یک ارتباط صوتی را به‌ترتیب اجرا می‌کند و پس از موفقیت همه آزمون‌ها نتیجه نهایی را نمایش می‌دهد.
*/
