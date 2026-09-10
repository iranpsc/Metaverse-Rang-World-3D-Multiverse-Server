# Realtime WebSocket Smoke Test

این فایل راهنمای اجرای دودتست ریل تایم است.

## هدف

این تست بررسی می کند که مسیر زیر بعد از اجرای سرور کار می کند:

```text
WebSocket Client
→ WebSocketRealtimeTransport
→ RealtimeServer
→ RealtimeRouter
→ system/game routes
```

## اجرای تست بدون آث

اگر توکن نداشته باشید، فقط اتصال و پینگ تست می شود:

```bash
node src/realTime/test/realtimeWebSocketSmoke.js
```

## اجرای تست کامل با آث

ابتدا از مسیر لاگین پروژه یک اَکسس توکن تازه بگیرید، سپس:

```bash
REALTIME_TEST_ACCESS_TOKEN="YOUR_ACCESS_TOKEN" node src/realTime/test/realtimeWebSocketSmoke.js
```

در ویندوز پاورشل:

```powershell
$env:REALTIME_TEST_ACCESS_TOKEN="YOUR_ACCESS_TOKEN"
node src/realTime/test/realtimeWebSocketSmoke.js
```

## تست کنترل شده توکن منقضی یا نامعتبر

اگر می خواهید مطمئن شوید خطای آث با کد درست برمی گردد، تست را در حالت خطای مورد انتظار اجرا کنید.

نمونه برای توکن منقضی:

```powershell
$env:REALTIME_TEST_ACCESS_TOKEN="EXPIRED_ACCESS_TOKEN"
$env:REALTIME_TEST_EXPECT_AUTH_FAILURE="true"
$env:REALTIME_TEST_EXPECT_AUTH_FAILURE_CODE="token_expired"
node src/realTime/test/realtimeWebSocketSmoke.js
```

در این حالت دریافت `auth_failed` شکست تست نیست؛ موفقیت تست است، به شرطی که کد خطا همان مقدار مورد انتظار باشد.

بعد از تست منفی، برای برگشت به حالت عادی در پاورشل:

```powershell
Remove-Item Env:REALTIME_TEST_EXPECT_AUTH_FAILURE
Remove-Item Env:REALTIME_TEST_EXPECT_AUTH_FAILURE_CODE
```

## تنظیم آدرس وب سوکت

پیش فرض:

```text
ws://127.0.0.1:8080
```

برای تغییر:

```bash
REALTIME_WS_URL="ws://127.0.0.1:8080" node src/realTime/test/realtimeWebSocketSmoke.js
```

## تنظیم روم تست

از فاز S9.5 به بعد اگر روم دستی تنظیم نشود، تست برای هر اجرا یک روم یکتا می سازد:

```text
smoke_room_<runId>
```

اگر خواستید روم ثابت بدهید:

```powershell
$env:REALTIME_TEST_ROOM="smoke_room_01"
node src/realTime/test/realtimeWebSocketSmoke.js
```

## سناریوهای تست

```text
connect
system/ping
system/auth
game/join_room
game/player_action
game/leave_room
disconnect
```

اگر توکن داده نشود، فقط `connect` و `system/ping` اجرا می شوند.

اگر `REALTIME_TEST_EXPECT_AUTH_FAILURE` فعال باشد، بعد از `system/auth` تست تمام می شود و وارد سناریوهای بازی نمی شود.
