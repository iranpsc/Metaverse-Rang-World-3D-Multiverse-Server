// File => src/domain/auth/passwordService.js
import bcrypt from "bcryptjs";

/**
 * هش کردن رمز عبور کاربر
 * @param {string} password 
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
    return bcrypt.hash(password, 10);
}

/**
 * بررسی صحت رمز عبور با هش ذخیره شده
 * @param {string} password 
 * @param {string} hash 
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
}
/* فایل src / domain / auth / passwordService.js مسئول عملیات رمز عبور در سیستم Auth است.این فایل از پکیج bcryptjs استفاده می‌کند و دو تابع اصلی دارد: تابع hashPassword برای تبدیل پسورد خام کاربر به hash امن هنگام ثبت‌نام، و تابع verifyPassword برای مقایسه پسورد واردشده با hash ذخیره‌شده هنگام ورود.

در مسیر Register، بعد از اینکه مشخص شد کاربر از قبل وجود ندارد، authService.register تابع hashPassword(password) را صدا می‌زند و خروجی آن یعنی passwordHash را برای ذخیره کاربر به repository می‌دهد.در مسیر Login، authService.login تابع verifyPassword(password, user.passwordHash) را صدا می‌زند تا مشخص شود پسورد واردشده با hash ذخیره‌شده در دیتابیس مطابقت دارد یا نه.
 */