// File => src/utils/ids.js 
import { randomUUID } from 'crypto';

function newCorrelationId() { return randomUUID(); }
function newMessageId() { return randomUUID(); }
function newSessionId() { return randomUUID(); }

export { newCorrelationId, newMessageId, newSessionId };
//وظیفه این فایل ساخت IDهای یکتا است.

/* برای ساخت شناسه‌های یکتا در بخش‌های مختلف سرور استفاده می‌شود.

این فایل از تابع randomUUID ماژول داخلی crypto استفاده می‌کند
و سه تابع newCorrelationId، newMessageId و newSessionId را export می‌کند.

هر سه تابع در نسخه فعلی یک UUID جدید برمی‌گردانند،
اما از نظر معنایی برای کاربردهای متفاوت ساخته شده‌اند.

newCorrelationId برای ردیابی requestها و لاگ‌ها،
newMessageId برای شناسه پیام‌ها،
و newSessionId برای شناسه session یا connection استفاده می‌شود.

این فایل باعث می‌شود ساخت IDها در پروژه خواناتر و متمرکزتر باشد،
حتی اگر فعلاً همه آنها از یک الگوریتم مشترک استفاده کنند.

 */