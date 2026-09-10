# قرارداد Sessionهای Voice نسخه ۱

## ساختار Session

هر Session یک ارتباط مستقیم بین دو آواتار است.

شناسه Session را سرور ایجاد می‌کند و کلاینت نمی‌تواند شناسه دلخواه تعیین کند.

هر آواتار می‌تواند هم‌زمان عضو چند Session باشد.

## ارتباط غیرانتقالی

اگر شرایط فاصله چنین باشد:

- فاصله A و B حداکثر ۳ متر
- فاصله B و C حداکثر ۳ متر
- فاصله A و C بیشتر از ۳ متر

دو Session مستقل ایجاد می‌شود:

- Session بین A و B
- Session بین B و C

B هر دو صدا را دریافت می‌کند، اما A و C صدای مستقیم یکدیگر را دریافت نمی‌کنند.

## منبع فاصله

فاصله از Transform تأییدشده Dedicated Server خوانده می‌شود.

## آستانه فاصله

- ورود: فاصله کمتر یا مساوی ۳ متر
- خروج: فاصله بیشتر یا مساوی ۳.۵ متر
- فاصله بین ۳ و ۳.۵ متر محدوده پایداری عضویت است.

ورود و خروج پس از پایدار ماندن وضعیت فاصله تأیید می‌شود.

زمان پایداری بعد از Benchmark تعیین می‌شود.

## وضعیت‌های Session

| مقدار | وضعیت |
|---:|---|
| 1 | CREATED |
| 2 | ACTIVE |
| 3 | SUSPENDED |
| 4 | CLOSING |
| 5 | FINALIZING |
| 6 | CLOSED |

## علت‌های تغییر Session

| مقدار | علت |
|---:|---|
| 0 | NONE |
| 1 | PROXIMITY_ENTER |
| 2 | PROXIMITY_EXIT |
| 3 | ROOM_LEFT |
| 4 | AVATAR_DESPAWNED |
| 5 | DEDICATED_DISCONNECTED |
| 6 | VOICE_DISCONNECTED |
| 7 | RECONNECT_EXPIRED |
| 8 | SESSION_CLOSED |
| 9 | ACCESS_REVOKED |

## Descriptor یک Session

| Offset | Size | Field |
|---:|---:|---|
| 0 | 16 | Session UUID |
| 16 | 1 | Session State |
| 17 | 1 | Reason |
| 18 | 4 | Distance Millimeters |
| 22 | 8 | Effective Timestamp |
| 30 | 16 | Peer User UUID |
| 46 | 2 | Peer Avatar ID Length |
| 48 | Variable | Peer Avatar ID |

فاصله نامشخص با مقدار `0xffffffff` مشخص می‌شود.

## Snapshot

پیام `SESSION_SNAPSHOT` تمام Sessionهای فعلی کاربر را به‌صورت مجموعه‌ای از Descriptorها ارسال می‌کند.

پیام‌های `SESSION_JOINED`، `SESSION_LEFT` و `SESSION_CLOSED` یک Descriptor مربوط به همان Session را حمل می‌کنند.
