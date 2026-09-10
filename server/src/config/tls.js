// File => src/config/tls.js


import fs from "fs";
import cfg from "./env.js";

/**
 * readTlsFiles
 * Reads TLS certificate and private key from configured paths
 */
export function readTlsFiles() {
    try {
        const cert = fs.readFileSync(cfg.tls.certPath);
        const key = fs.readFileSync(cfg.tls.keyPath);

        return { cert, key };
    } catch (error) {
        throw new Error(
            `Failed to read TLS files. certPath=${cfg.tls.certPath}, keyPath=${cfg.tls.keyPath}, reason=${error.message}`
        );
    }
}
/* 
برای خواندن فایل‌های TLS از مسیرهای تعریف‌شده در config ساخته شده است.

این فایل تابع readTlsFiles() را export می‌کند
و داخل آن فایل certificate و private key را از مسیرهای cfg.tls.certPath
و cfg.tls.keyPath با fs.readFileSync می‌خواند.

اگر خواندن فایل‌ها موفق باشد، خروجی تابع یک object شامل cert و key است.
اگر مسیرها اشتباه باشند یا فایل‌ها قابل خواندن نباشند،
تابع یک خطای واضح با مسیر certificate، مسیر key و دلیل خطا ایجاد می‌کند.

در نسخه فعلی پروژه، TLS اصلی ورودی توسط Envoy مدیریت می‌شود
و gRPC backend با createInsecure() اجرا شده است.
بنابراین این فایل فعلاً بیشتر نقش ابزار آماده برای استفاده TLS داخلی
یا HTTP / TLS آینده را دارد

 */