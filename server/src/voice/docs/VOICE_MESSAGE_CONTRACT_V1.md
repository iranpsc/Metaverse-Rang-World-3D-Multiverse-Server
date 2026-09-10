# قرارداد انواع پیام Voice نسخه ۱

## اتصال و سلامت

| مقدار | پیام |
|---:|---|
| 1 | AUTH_REQUEST |
| 2 | AUTH_RESULT |
| 3 | HEARTBEAT |
| 4 | HEARTBEAT_ACK |
| 5 | DISCONNECT |
| 6 | ACK |

## Session

| مقدار | پیام |
|---:|---|
| 16 | SESSION_SNAPSHOT |
| 17 | SESSION_JOINED |
| 18 | SESSION_LEFT |
| 19 | SESSION_CLOSED |

## صوت

| مقدار | پیام |
|---:|---|
| 32 | PUBLISH_START |
| 33 | VOICE_FRAME |
| 34 | PUBLISH_STOP |

## کنترل

| مقدار | پیام |
|---:|---|
| 48 | LISTENER_MUTE_CHANGED |
| 49 | RECORDING_CONSENT_CHANGED |
| 50 | RECORDING_STATE_CHANGED |

## بازیابی

| مقدار | پیام |
|---:|---|
| 64 | RECONNECT_REQUEST |
| 65 | RECONNECT_RESULT |

## خطا

| مقدار | پیام |
|---:|---|
| 255 | ERROR |

## Flags

| مقدار | Flag | کاربرد |
|---:|---|---|
| 0 | NONE | بدون Flag |
| 1 | ACK_REQUIRED | پیام نیازمند تأیید است |
| 2 | DTX | فریم مربوط به حالت سکوت Opus است |
| 4 | END_OF_STREAM | پایان انتشار صوت |
| 8 | DISCONTINUITY | پیوستگی فریم‌های صوتی قطع شده است |

Payload پیام `VOICE_FRAME` شامل فریم فشرده Opus است.

Payload پیام‌های کنترلی در مراحل بعدی قرارداد، به‌صورت باینری تعریف می‌شود.
