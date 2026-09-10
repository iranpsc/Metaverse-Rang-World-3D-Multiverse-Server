# قرارداد باینری Voice نسخه ۱

## ترتیب بایت

تمام مقادیر چندبایتی با ترتیب Big Endian نوشته می‌شوند.

## Header ثابت

اندازه Header نسخه ۱ برابر ۶۰ بایت است.

| Offset | Size | Field |
|---:|---:|---|
| 0 | 4 | Magic برابر MVVC |
| 4 | 1 | Protocol Version |
| 5 | 1 | Message Type |
| 6 | 2 | Flags |
| 8 | 2 | Header Length |
| 10 | 2 | Reserved |
| 12 | 4 | Payload Length |
| 16 | 4 | Sequence Number |
| 20 | 8 | Timestamp Milliseconds |
| 28 | 16 | Session UUID |
| 44 | 16 | Sender UUID |
| 60 | Variable | Payload |

## شناسه‌ها

Session ID و Sender ID به‌صورت UUID شانزده‌بایتی ذخیره می‌شوند.

مقدار UUID صفر برای پیام‌هایی استفاده می‌شود که هنوز Session یا Sender آن‌ها تعیین نشده است:

`00000000-0000-0000-0000-000000000000`

## Payload

Payload همیشه باینری است.

در پیام Voice Frame، Payload شامل فریم فشرده Opus خواهد بود.

معنای عددهای Message Type و Flags در مرحله V1.3 تعریف می‌شود.
