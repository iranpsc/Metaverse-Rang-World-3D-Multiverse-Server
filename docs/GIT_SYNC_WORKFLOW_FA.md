# مستند رسمی گردش کار Git سرور متارنگ — ۳۰ اکتبر ۲۰۲۶

## مبنا و محدوده

این سند بر اساس نسخه واقعی فایل‌های `sync-grpc.sh` و `metaverse-git-sync-remote.sh` دریافت‌شده از Clone ویندوز در تاریخ ۳۰ اکتبر ۲۰۲۶ نوشته شده است. این مستند، وضعیت اجرای زنده در سرور یا آزمون اتصال SSH واقعی را تأیید نمی‌کند. هدف، انتشار سورس سرور Production در شاخه `gRPC` پس از بررسی تصویری تغییرات در Fork است؛ **انتشار در GitHub معادل Deploy مجدد روی Production نیست.**

## مسیرهای تأییدشده

| نقش | مسیر |
|---|---|
| سورس فعال Backend روی سرور | `/home/world3d/apps/metaverse-server` |
| مخزن Git سمت سرور | `/home/world3d/repos/metaverse-deploy` |
| مخزن ویندوز (Git Bash) | `/c/Users/LINUX/Desktop/Unity/Ghadiry/Ghadiry/Cloned_Server/Metaverse-Rang-World-3D-Multiverse-Server` |
| مخزن GitHub | `https://github.com/iranpsc/Metaverse-Rang-World-3D-Multiverse-Server.git` |
| شاخه انتشار | `gRPC` |
| آدرس اتصال تعریف‌شده در اسکریپت | `metaverse-server` (نام مستعار SSH ویندوز، باید در سیستم کاربر معتبر باشد) |
| اسکریپت محلی | `sync-grpc.sh` |
| اسکریپت خروجی‌گیر لینوکس | `metaverse-git-sync-remote.sh` |

## فرمان جدید: Review (بدون انتشار)

فرمان زیر را فقط در **Git Bash ویندوز**، در ریشه Clone سرور اجرا کنید:

```bash
./sync-grpc.sh review
```

عملیات واقعی این فرمان: بررسی شاخه `gRPC` و تمیز بودن مخزن محلی، Fetch آخرین `origin/gRPC` و کنترل یکسان بودن HEAD محلی و Remote، اجرای صرفاً `export` از اسکریپت Helper بر بستر SSH بدون نصب یا جایگزینی Helper سرور، دریافت یک آرشیو موقت از سورس Production، کنترل نام فایل‌های حساس و کلید خصوصی و Symlink، بازنویسی پوشه‌های مرجع `server/src`، `server/protos`، `server/scripts`، `server/tools` و `server/docs` در Clone محلی، کپی فایل‌های ریشه لازم، انتقال Game Server اگر واقعاً صادر شده باشد و افزودن تنظیمات غیرمحرمانه زیرساخت. هیچ `git add`، `commit`، `push`، `npm ci`، Build، Deploy یا Restart انجام نمی‌شود.

اگر Clone محلی نسبت به `origin/gRPC` عقب باشد، فرمان با پیام `local gRPC is not identical` متوقف می‌شود. پیش از هر Pull، دلیل اختلاف شاخه را بررسی کنید؛ `git pull` در Clone ویندوز نباید با Deploy سمت سرور اشتباه شود.

## مسیر بررسی با Fork

۱. Fork را باز کنید و Repository سرور را انتخاب کنید.

۲. مطمئن شوید Branch نمایش‌داده‌شده `gRPC` است.

۳. `Local Changes` را باز کنید، فایل‌های جدید (`Untracked`) و فایل‌های تغییرکرده را ببینید، و Diff هر فایل را بررسی کنید؛ فایل‌های `server/src/index.js`، Auth، Voice/WebRTC، فایل‌های `server/package.json` و `server/package-lock.json`، و تغییرات Game Server/Infrastructure را با دقت بیشتری بررسی کنید.

۴. فایل‌های حساس و Runtime را بررسی کنید: `.env`، `.env.*` به‌جز نمونه‌های مجاز، `.pem`، `.key`، `.p12`، `.pfx`، فایل‌های ضبط و لاگ، `node_modules`، داده‌های کاربران، آرشیوها و Backups نباید Stage یا Commit شوند. وجود `.env.example` مجاز است، ولی مقدار واقعی Secret در آن مجاز نیست. تست‌های خودکار همه نوع Secret را تضمین نمی‌کنند.

۵. پس از بازبینی و تأیید، **در خود Fork** فقط فایل‌های انتخاب‌شده را Stage، سپس Commit و Push به Branch `gRPC` کنید. این مرحله نباید تا قبل از بررسی Diff انجام شود.

۶. پس از انتشار، در Git Bash دستور زیر را اجرا کنید:

```bash
git status --short --branch && git fetch origin gRPC && git rev-list --left-right --count HEAD...origin/gRPC
```

اگر نتیجه اختلاف `0 0` باشد و `git status` Clean باشد، Clone محلی و GitHub برای همین Branch هماهنگ‌اند. این کنترل، سلامت Runtime سرور را اثبات نمی‌کند.

## دستورات قدیمی (حفظ‌شده، نه جایگزین Review)

| فرمان | رفتار در نسخه اصلی |
|---|---|
| `./sync-grpc.sh push "message"` | Export سرور، جایگزینی سورس Clone، سپس Stage و Commit و Push خودکار؛ **برای Review استفاده نشود** |
| `./sync-grpc.sh pull` | Backup و Pull و Deploy و Restart روی Production؛ بدون برنامه Deploy اجرا نشود |
| `./sync-grpc.sh rollback` | بازیابی Backup قبل از Pull و Restart؛ فقط برای بازیابی تأییدشده |
| `./sync-grpc.sh backups` | نمایش Backupهای قبلی؛ برای مشاهده تاریخچه |

در نسخه فعلی، فرمان جدید `review` از مسیر و رفتار فرمان قدیمی `push` جدا شده است. هیچ تابع موجود حذف یا تغییرنام داده نشده است. اجرای `review` تغییری در تنظیمات Nginx یا `src/index.js` روی Production ایجاد نمی‌کند.

## اقدامات امنیتی نسخه Review

- در سمت سرور Export از گواهی‌های خصوصی Envoy/JWT جدا شد؛ فقط فایل‌های YAML مستقیماً داخل پوشه Envoy صادر می‌شوند.
- فایل‌های `.env`، کلیدها، گواهی‌های حساس، ضبط صوت، لاگ‌ها، آرشیوها و Backups از Export پوشه‌های Backend و Game Server کنار گذاشته می‌شوند.
- کنترل محتوای `PRIVATE KEY` اصلاح شد؛ استفاده از `grep --` برای جلوگیری از تفسیر الگو به‌عنوان گزینه.
- قبل از ورود فایل‌ها به Clone ویندوز، نام فایل ممنوع، وجود Symlink و ساختار آرشیو بررسی می‌شود.
- Helper روی سرور به‌صورت موقت از ورودی SSH اجرا می‌شود و فایل Helper عملیاتی موجود در `/home/world3d/bin` دست‌نخورده می‌ماند.
- اسکریپت‌های محلی و راهنما در `.git/info/exclude` مخزن محلی ثبت می‌شوند؛ این فایل محلی است و در GitHub Commit نمی‌شود.

**محدودیت:** این کنترل‌ها جایگزین بازبینی محتوای Source و Secret Scanning سازمانی نیستند. Game Server و زیرساخت در صورت نبودن Source واقعی یا نداشتن مجوز کافی ممکن است کامل Export نشوند؛ خروجی باید بررسی شود. امکان وجود Symlink قانونی در Game Server هست که در این صورت Export برای امنیت متوقف می‌شود.

## سوابق این اجرای خاص

- Commit پایه GitHub `gRPC` در تاریخ ۳۰ اکتبر: `559f9c3`، با اختلاف `0 0` در بررسی سرور.
- در Worktree بررسی سمت سرور، ۹۳ فایل در وضعیت Staged قرار داشتند؛ این فایل‌ها **هنوز** Commit یا Push نشده بودند و فقط Backend را پوشش می‌دادند.
- مسیر آن Worktree: `/home/world3d/metaverse-github-sync-review-20261030`.
- روش Review ویندوز مستقل از Worktree مذکور است؛ برای جلوگیری از انتشار تکراری یا ناقص، بعد از هر Commit باید بررسی شود کدام مسیر واقعاً منتشر شده است.

## تست انجام‌شده و تست باقی‌مانده

تست‌های محلی شبیه‌سازی‌شده روی ZIP و اسکریپت‌های اصلاحی: `bash -n`، شبیه‌سازی Clone و Fetch و Export/Copy و مشاهده Git Diff، رد فایل `.env`، رد کلید خصوصی و رد Symlink، و تأیید عدم Commit/Push در مسیر `review`. **اتصال واقعی به سرور، خروجی واقعی Production، سازگاری با Git Bash ویندوز و نمایش نهایی در Fork هنوز باید بررسی شوند.**

## نحوه نصب نسخه اصلاحی

ابتدا از دو اسکریپت ویندوز خارج از مخزن نسخه پشتیبان بگیرید؛ سپس فایل‌های ZIP اصلاحی را در ریشه Clone استخراج کنید. راهنما در `docs/GIT_SYNC_WORKFLOW_FA.md` داخل مخزن قرار می‌گیرد. اسکریپت `review` را اجرا کنید و پس از تأیید Diff، با Fork Stage/Commit/Push انجام دهید.


## رخداد ۳۰ اکتبر ۲۰۲۶ — اصلاح Export Stage Trap

- بعد از رفع BOM فایل `~/.ssh/config` در Git Bash، اتصال SSH با `REMOTE_SSH=PASS` تأیید شد.
- مسیر `/home/world3d/git-exports` در ابتدا `root:root:755` بود؛ با تأیید مالکیت و دسترسی، به `world3d:world3d:700` تغییر یافت و `EXPORT_PERMISSION=PASS` گزارش شد.
- اجرای `./sync-grpc.sh review` پیام `EXPORT_GUARD=PASS` و سپس `stage: unbound variable` تولید کرد.
- علت از خود تابع `do_export()` در `metaverse-git-sync-remote.sh`: تله خروج `trap 'rm -rf "$stage"' EXIT` به متغیر محلی `stage` بعد از خروج تابع مراجعه می‌کرد و با `set -u` شکست می‌خورد.
- اصلاح حداقلی: `trap "$(printf 'rm -rf -- %q' "$stage")" EXIT` تا فرمان پاک‌سازی با مسیر معتبر هنگام تعریف Trap ساخته شود.
- تست مستقل شبیه‌سازی: اسکریپت قبلی پس از چاپ `EXPORT_PATH` با خطای `stage` و کد خروج ۱ شکست خورد؛ نسخه اصلاحی با کد ۰ پایان یافت، آرشیو خروجی ایجاد شد و پوشه موقت Stage پاک شد.
- در این اصلاح فقط فایل `metaverse-git-sync-remote.sh` تغییر کرده است؛ `sync-grpc.sh` و Production تغییر نکرده‌اند. پس از جایگزینی Helper در ویندوز، اجرای `./sync-grpc.sh review` باید روی محیط واقعی تکرار و خروجی آن بررسی شود.
- آرشیوهای خروجی قبلی و Stage باقی‌مانده احتمالی از تلاش شکست‌خورده نباید بدون ممیزی پاک شوند.
- هنوز Commit، Push، Build، Deploy یا Restart انجام نشده است.
