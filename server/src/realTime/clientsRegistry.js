// File => src/realTime/clientsRegistry.js

import crypto from "crypto";
import { registerPublicHealthClientsRegistry } from "../health/publicHealthWrapper.js";

//* این تابع شناسه داخلی رجیستری را می سازد تا کانکشن های بدون شناسه هم قابل ردیابی باشند.
function createRegistryConnectionId(prefix = "reg_conn") {
    return `${prefix}_${crypto.randomUUID()}`;
}

//* این تابع شناسه کانکشن را از وَرَپِر، کانتکست یا آبجکت خام می خواند و اگر نبود یک شناسه داخلی می سازد.
function readRegistryConnectionId(connection, fallbackMap = null) {
    if (!connection) return "";
    const directId = connection.id ?? connection.connectionId ?? connection.context?.connectionId ?? connection.socket?.id ?? "";
    if (directId) return String(directId);
    if (typeof connection !== "object") return String(connection);
    if (!fallbackMap) return createRegistryConnectionId();
    if (!fallbackMap.has(connection)) fallbackMap.set(connection, createRegistryConnectionId());
    return fallbackMap.get(connection);
}

//* این تابع شناسه یوزر را از ورودی مستقیم، کانکشن یا کانتکست می خواند تا رجیستری بتواند کانکشن را زیر یوزر درست نگه دارد.
function readRegistryUserId(userId, connection = null) {
    const value = userId ?? connection?.context?.user?.id ?? connection?.context?.user?.userId ?? connection?.user?.id ?? connection?.user?.userId ?? "";
    return String(value ?? "").trim();
}

//* این تابع بررسی می کند که کانکشن هنوز باز است تا رجیستری بتواند کانکشن های بسته شده را پاک کند.
function isRegistryConnectionOpen(connection) {
    if (!connection) return false;
    if (typeof connection.isOpen === "function") return connection.isOpen();
    if (typeof connection.context?.connection?.isOpen === "function") return connection.context.connection.isOpen();
    if (typeof connection.readyState === "number") return connection.readyState === 1;
    if (typeof connection.socket?.readyState === "number") return connection.socket.readyState === 1;
    return true;
}

class ClientsRegistry {
    //* این سازنده نگاشت های اصلی رجیستری را می سازد تا کانکشن ها هم با شناسه کانکشن و هم با شناسه یوزر قابل پیدا شدن باشند.
    constructor() {
        this.byConnectionId = new Map();
        this.byUserId = new Map();
        this.connectionIdByRawObject = new WeakMap();

        //* این رجیستری واقعی را فقط برای خواندن آمار عمومی به ورپر هلت معرفی می کند.
        registerPublicHealthClientsRegistry(this);
    }

    //* این تابع قدیمی برای سازگاری حفظ شده و یک کانکشن را زیر شناسه یوزر ثبت می کند.
    add(userId, connection) {
        return this.addConnection(connection, userId);
    }

    //* این تابع یک کانکشن را در رجیستری ثبت می کند و اگر یوزر داشته باشد آن را زیر همان یوزر هم نگه می دارد.
    addConnection(connection, userId = null) {
        if (!connection) return null;

        const connectionId = readRegistryConnectionId(
            connection,
            this.connectionIdByRawObject
        );

        if (!connectionId) return null;

        const normalizedUserId = readRegistryUserId(
            userId,
            connection
        );

        const existingRecord =
            this.byConnectionId.get(connectionId) ??
            null;

        const previousUserId =
            String(existingRecord?.userId ?? "")
                .trim();

        const updatedAt = Date.now();

        if (
            previousUserId &&
            previousUserId !== normalizedUserId
        ) {
            const previousUserConnections =
                this.byUserId.get(previousUserId);

            if (previousUserConnections) {
                previousUserConnections.delete(
                    connectionId
                );

                if (
                    previousUserConnections.size === 0
                ) {
                    this.byUserId.delete(
                        previousUserId
                    );
                }
            }
        }

        const record =
            existingRecord ?? {
                connectionId,
                userId: "",
                connection,
                addedAt: updatedAt,
                lastSeenAt: updatedAt
            };

        record.userId = normalizedUserId;
        record.connection = connection;
        record.lastSeenAt = updatedAt;

        this.byConnectionId.set(
            connectionId,
            record
        );

        if (normalizedUserId) {
            if (
                !this.byUserId.has(
                    normalizedUserId
                )
            ) {
                this.byUserId.set(
                    normalizedUserId,
                    new Set()
                );
            }

            this.byUserId
                .get(normalizedUserId)
                .add(connectionId);
        }

        return record;
    }

    //* این تابع قدیمی برای سازگاری حفظ شده و اگر کانکشن داده نشود همه کانکشن های آن یوزر را حذف می کند.
    remove(userId, connection = null) {
        if (connection) return this.removeConnection(connection);
        const normalizedUserId = readRegistryUserId(userId);
        const connectionIds = this.byUserId.get(normalizedUserId);
        if (!connectionIds) return false;

        for (const connectionId of [...connectionIds]) this.removeConnectionById(connectionId);
        this.byUserId.delete(normalizedUserId);
        return true;
    }

    //* این تابع یک کانکشن را با خود آبجکت یا شناسه کانکشن از رجیستری حذف می کند.
    removeConnection(connectionOrId) {
        const connectionId = typeof connectionOrId === "string" ? connectionOrId : readRegistryConnectionId(connectionOrId, this.connectionIdByRawObject);
        return this.removeConnectionById(connectionId);
    }

    //* این تابع یک کانکشن را با شناسه کانکشن حذف می کند و نگاشت یوزر مربوط به آن را هم پاکسازی می کند.
    removeConnectionById(connectionId) {
        const record = this.byConnectionId.get(connectionId);
        if (!record) return false;

        this.byConnectionId.delete(connectionId);
        if (record.userId && this.byUserId.has(record.userId)) {
            const set = this.byUserId.get(record.userId);
            set.delete(connectionId);
            if (set.size === 0) this.byUserId.delete(record.userId);
        }

        return true;
    }

    //* این تابع قدیمی برای سازگاری حفظ شده و اولین کانکشن فعال یوزر را برمی گرداند.
    get(userId) {
        return this.getFirstConnectionByUserId(userId);
    }

    //* این تابع اولین کانکشن فعال یک یوزر را پیدا می کند و اگر کانکشن بسته شده باشد آن را پاکسازی می کند.
    getFirstConnectionByUserId(userId) {
        const normalizedUserId = readRegistryUserId(userId);
        const connectionIds = this.byUserId.get(normalizedUserId);
        if (!connectionIds) return null;

        for (const connectionId of [...connectionIds]) {
            const record = this.byConnectionId.get(connectionId);
            if (!record) continue;
            if (isRegistryConnectionOpen(record.connection)) return record.connection;
            this.removeConnectionById(connectionId);
        }

        return null;
    }

    //* این تابع همه کانکشن های فعال یک یوزر را برمی گرداند و کانکشن های بسته شده را همزمان پاکسازی می کند.
    getAll(userId) {
        const normalizedUserId = readRegistryUserId(userId);
        const connectionIds = this.byUserId.get(normalizedUserId);
        if (!connectionIds) return [];

        const result = [];
        for (const connectionId of [...connectionIds]) {
            const record = this.byConnectionId.get(connectionId);
            if (!record) continue;
            if (isRegistryConnectionOpen(record.connection)) result.push(record.connection);
            else this.removeConnectionById(connectionId);
        }

        return result;
    }

    //* این تابع قدیمی برای سازگاری حفظ شده و بررسی می کند که یوزر حداقل یک کانکشن فعال دارد یا نه.
    has(userId) {
        return this.getFirstConnectionByUserId(userId) !== null;
    }

    //* این تابع بررسی می کند که کانکشن با شناسه مشخص در رجیستری وجود دارد یا نه.
    hasConnectionId(connectionId) {
        return this.byConnectionId.has(String(connectionId ?? ""));
    }

    //* این تابع کانکشن را با شناسه کانکشن پیدا می کند و در صورت بسته بودن آن را حذف می کند.
    getByConnectionId(connectionId) {
        const record = this.byConnectionId.get(String(connectionId ?? ""));
        if (!record) return null;
        if (isRegistryConnectionOpen(record.connection)) return record.connection;
        this.removeConnectionById(record.connectionId);
        return null;
    }

    //* این تابع رکورد رجیستری را با شناسه کانکشن برمی گرداند تا برای لاگ و مانیتورینگ استفاده شود.
    getRecordByConnectionId(connectionId) {
        return this.byConnectionId.get(String(connectionId ?? "")) ?? null;
    }

    //* این تابع زمان دیده شدن آخر کانکشن را به روز می کند تا بعداً برای مانیتورینگ و کلیناپ استفاده شود.
    touchConnection(connectionOrId) {
        const connectionId = typeof connectionOrId === "string" ? connectionOrId : readRegistryConnectionId(connectionOrId, this.connectionIdByRawObject);
        const record = this.byConnectionId.get(connectionId);
        if (!record) return false;
        record.lastSeenAt = Date.now();
        return true;
    }

    //* این تابع کانکشن های بسته شده را از رجیستری حذف می کند تا حافظه و لیست یوزرها تمیز بماند.
    cleanupClosedConnections() {
        let removed = 0;
        for (const [connectionId, record] of [...this.byConnectionId.entries()]) {
            if (isRegistryConnectionOpen(record.connection)) continue;
            if (this.removeConnectionById(connectionId)) removed++;
        }
        return removed;
    }

    //* این تابع تعداد کل کانکشن های ثبت شده را برمی گرداند.
    count() {
        return this.byConnectionId.size;
    }

    //* این تابع تعداد یوزرهایی را که حداقل یک کانکشن دارند برمی گرداند.
    userCount() {
        return this.byUserId.size;
    }

    //* این تابع یک اسنپ شات امن از وضعیت رجیستری می سازد تا برای لاگ، دیباگ و تست استفاده شود.
    getSnapshot() {
        return {
            connectionCount: this.byConnectionId.size,
            userCount: this.byUserId.size,
            users: [...this.byUserId.entries()].map(([userId, set]) => ({ userId, connectionCount: set.size }))
        };
    }

    //* این تابع کل رجیستری را پاک می کند و برای توقف سرور یا تست استفاده می شود.
    clear() {
        this.byConnectionId.clear();
        this.byUserId.clear();
    }
}

/*
توضیح کلی اسکریپت:
این فایل رجیستری کانکشن های ریل تایم سمت سرور را مدیریت می کند.
رجیستری کمک می کند هر کانکشن با شناسه کانکشن و هر یوزر با شناسه یوزر قابل پیدا شدن باشد.
این فایل از چند کانکشن برای یک یوزر پشتیبانی می کند تا یک یوزر بتواند همزمان از چند دستگاه یا چند تب وصل باشد.
تابع های قدیمی مانند اَد، ریموو، گت و هَز حفظ شده اند تا کدهای قبلی نشکنند.
این فایل نباید آث واقعی، لاجیک روم، رُتِر یا لاجیک بازی انجام دهد.
وظیفه این فایل فقط ثبت، پیدا کردن، حذف و پاکسازی کانکشن های ریل تایم است.
*/

export { ClientsRegistry, createRegistryConnectionId, readRegistryConnectionId, readRegistryUserId, isRegistryConnectionOpen };
