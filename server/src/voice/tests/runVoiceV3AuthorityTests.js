await import("./voiceAuthoritativeSessionCore.test.js");
await import("./voiceConnectionRegistry.test.js");
await import("./voiceConnectionRegistrationService.test.js");
await import("./voiceConnectionExternalUserId.test.js");
await import("./voiceDedicatedConnectionIdentity.test.js");
await import("./voiceDedicatedPlayerAdapter.test.js");
await import("./voiceDedicatedSessionDeltaRuntime.test.js");
await import("./voiceRuntimeServices.test.js");

console.log("VOICE_V3_NODE_AUTHORITY_ALL_TESTS=PASS");

/*
توضیح فایل:
این فایل همه تست‌های مستقیم هویت، اتصال، Session و Runtime Delta فاز V3 را برای Runner نهایی یکجا اجرا می‌کند.
*/
