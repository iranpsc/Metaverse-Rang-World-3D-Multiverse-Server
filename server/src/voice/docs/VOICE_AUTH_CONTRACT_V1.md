# قرارداد احراز هویت Voice نسخه ۱

## درخواست احراز هویت

کلاینت در پیام `AUTH_REQUEST` این اطلاعات را ارسال می‌کند:

- Platform
- Access Token
- Room ID
- Avatar ID
- Client Instance ID
- Client Build

کلاینت `userId` ارسال نمی‌کند.

سرور `userId` را از فیلد `sub` داخل Access Token تأییدشده استخراج می‌کند.

## ساختار باینری AUTH_REQUEST

| Offset | Size | Field |
|---:|---:|---|
| 0 | 1 | Platform |
| 1 | 1 | Reserved |
| 2 | 2 | Access Token Length |
| 4 | 2 | Room ID Length |
| 6 | 2 | Avatar ID Length |
| 8 | 2 | Client Build Length |
| 10 | 16 | Client Instance UUID |
| 26 | Variable | UTF-8 Fields |

ترتیب فیلدهای UTF-8:

1. Access Token
2. Room ID
3. Avatar ID
4. Client Build

## بررسی‌های سرور

سرور باید این موارد را بررسی کند:

1. Access Token با `tokenService.verifyAccessToken`
2. وجود `userId` در فیلد `sub` توکن
3. آماده بودن اتصال Realtime کاربر
4. Join بودن کاربر در Room اعلام‌شده
5. مالکیت Avatar توسط همان کاربر
6. احراز شدن اتصال Dedicated همان کاربر
7. مجاز بودن دسترسی Voice

## نتیجه احراز هویت

سرور پیام `AUTH_RESULT` را ارسال می‌کند.

در حالت موفق، نتیجه شامل این موارد است:

- Voice Connection ID
- User ID تأییدشده
- Result Code
- Message

در حالت ناموفق، کد خطا و قابلیت تلاش مجدد ارسال می‌شود.

## ساختار باینری AUTH_RESULT

| Offset | Size | Field |
|---:|---:|---|
| 0 | 1 | Success |
| 1 | 1 | Retryable |
| 2 | 2 | Result Code |
| 4 | 16 | Voice Connection UUID |
| 20 | 2 | User ID Length |
| 22 | 2 | Message Length |
| 24 | Variable | User ID UTF-8 |
| Variable | Variable | Message UTF-8 |

ترتیب بخش متغیر:

1. User ID
2. Message

`Voice Connection ID` همچنان یک شناسه ۱۶ بایتی است.

`User ID` رشته UTF-8 است و مجبور نیست UUID باشد.

این مقدار بدون تغییر از شناسه تأییدشده توکن و Dedicated استفاده می‌شود و حداکثر ۵۱۲ بایت است.

در نتیجه ناموفق، `User ID` می‌تواند خالی باشد.

## اصل امنیتی

شناسه کاربر فقط از Access Token تأییدشده استخراج می‌شود و مقدار ادعایی کلاینت مبنای احراز هویت قرار نمی‌گیرد.
