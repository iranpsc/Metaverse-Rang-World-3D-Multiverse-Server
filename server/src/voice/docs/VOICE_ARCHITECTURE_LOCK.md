# معماری Voice متارنگ

## تصمیم‌های اصلی

- Voice داخل همان پروژه `metaverse-server` ساخته می‌شود.
- فایل‌های سرور Voice داخل `src/voice` قرار می‌گیرند.
- فایل‌های Unity Voice داخل `Assets/Scripts/Network_A/Voice` قرار می‌گیرند.
- WebGL از Opus باینری روی WSS استفاده می‌کند.
- Windows و Quest از Opus باینری روی gRPC Streaming دوطرفه استفاده می‌کنند.
- بایندر جدید نوشته نمی‌شود.
- بایندرهای فعلی با Wrapper استفاده می‌شوند.
- منبع موقعیت Voice، Transform تأییدشده Dedicated Server است.

## مسیر موقت توسعه Unity

در مرحله توسعه، Sceneهای سه‌بعدی فعلی دست‌نخورده باقی می‌مانند.

مقدارهای `normal` و `voice` فقط برای انتخاب مقصد آزمایشی در لابی استفاده می‌شوند.

این جداسازی قانون دائمی معماری نیست.

Sceneهای فعلی:

- `Grpc_Enviroment`
- `WebGL_Enviroment`

Sceneهای آزمایشی Voice:

- `Grpc_Enviromrnt_Voice`
- `WebGL_Enviroment_Voice`

هدف نهایی این است که Sceneهای اصلی سه‌بعدی نیز Voice داشته باشند.

## بایندرهای فعلی

Native:

`DedicatedGameServerRealtimeRoomBinder`

WebGL:

`DedicatedGameServerRealtimeRoomBinderWebGL`

Wrapper منطق Join Room، Ticket، اتصال Dedicated، Auth، Reconnect یا Disconnect را بازنویسی نمی‌کند.

## تنظیمات پایه صوت

- Codec: Opus
- Sample Rate: 48000 Hz
- Channels: Mono
- Frame Duration: 20 ms
- VBR: فعال
- DTX: فعال
- Bitrateهای Benchmark: 28، 32 و 40 kbps

## Reconnect

- اولین تلاش: فوری
- Deadline کلاینت: 180 ثانیه
- نگهداری Session سرور: 210 ثانیه
