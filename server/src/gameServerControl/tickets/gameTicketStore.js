// File => src/gameServerControl/tickets/gameTicketStore.js

const DEFAULT_MAX_TICKETS = 10000;

//* این تابع زمان فعلی را به میلی ثانیه برمی گرداند.
function nowMs() {
    return Date.now();
}

//* این تابع بررسی می کند مقدار رشته ای معتبر است یا نه.
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

//* این تابع از داده خام تیکت یک رکورد داخلی امن می سازد.
function createTicketRecord(ticket) {
    const createdAt = nowMs();

    return {
        ticketId: ticket.ticketId,
        userId: ticket.userId,
        roomId: ticket.roomId,
        serverId: ticket.serverId,
        signature: ticket.signature,
        expiresAt: ticket.expiresAt,
        createdAt,
        consumedAt: null,
        revokedAt: null,
        metadata: ticket.metadata ?? {}
    };
}

//* این کلاس استور درون حافظه ای گیم تیکت ها را مدیریت می کند.
class GameTicketStore {
    constructor(options = {}) {
        this.maxTickets = Number.isInteger(options.maxTickets) ? options.maxTickets : DEFAULT_MAX_TICKETS;
        this.ticketsById = new Map();
    }

    //* این تابع تیکت جدید را در استور ثبت می کند.
    saveTicket(ticket) {
        this.validateTicketForSave(ticket);
        this.cleanupExpiredTickets();

        if (this.ticketsById.size >= this.maxTickets) {
            throw new Error("[GameTicketStore] Max ticket capacity reached.");
        }

        const record = createTicketRecord(ticket);
        this.ticketsById.set(record.ticketId, record);

        return { ...record };
    }

    //* این تابع تیکت را بدون مصرف کردن از استور می خواند.
    getTicket(ticketId) {
        if (!isNonEmptyString(ticketId)) return null;

        const record = this.ticketsById.get(ticketId);
        if (!record) return null;

        return { ...record };
    }

    //* این تابع بررسی می کند تیکت وجود دارد و هنوز معتبر است یا نه.
    hasValidTicket(ticketId) {
        const record = this.ticketsById.get(ticketId);
        if (!record) return false;

        return this.isTicketRecordValid(record);
    }

    //* این تابع تیکت را فقط یک بار مصرف می کند.
    consumeTicket(ticketId) {
        if (!isNonEmptyString(ticketId)) {
            return { success: false, reason: "ticket_id_required", ticket: null };
        }

        const record = this.ticketsById.get(ticketId);

        if (!record) {
            return { success: false, reason: "ticket_not_found", ticket: null };
        }

        if (record.revokedAt !== null) {
            return { success: false, reason: "ticket_revoked", ticket: { ...record } };
        }

        if (record.consumedAt !== null) {
            return { success: false, reason: "ticket_already_consumed", ticket: { ...record } };
        }

        if (this.isTicketExpired(record)) {
            this.ticketsById.delete(ticketId);
            return { success: false, reason: "ticket_expired", ticket: { ...record } };
        }

        record.consumedAt = nowMs();
        this.ticketsById.set(ticketId, record);

        return { success: true, reason: "ticket_consumed", ticket: { ...record } };
    }

    //* این تابع تیکت را لغو می کند تا دیگر قابل مصرف نباشد.
    revokeTicket(ticketId) {
        if (!isNonEmptyString(ticketId)) return false;

        const record = this.ticketsById.get(ticketId);
        if (!record) return false;

        record.revokedAt = nowMs();
        this.ticketsById.set(ticketId, record);

        return true;
    }

    //* این تابع تیکت را کامل از استور حذف می کند.
    deleteTicket(ticketId) {
        if (!isNonEmptyString(ticketId)) return false;
        return this.ticketsById.delete(ticketId);
    }

    //* این تابع تیکت های منقضی شده را پاکسازی می کند.
    cleanupExpiredTickets() {
        let removedCount = 0;

        for (const [ticketId, record] of this.ticketsById.entries()) {
            if (!this.isTicketExpired(record)) continue;

            this.ticketsById.delete(ticketId);
            removedCount++;
        }

        return removedCount;
    }

    //* این تابع کل تیکت ها را پاک می کند و فقط برای تست یا شات داون استفاده می شود.
    clear() {
        const count = this.ticketsById.size;
        this.ticketsById.clear();
        return count;
    }

    //* این تابع تعداد تیکت های فعلی را برمی گرداند.
    countTickets() {
        return this.ticketsById.size;
    }

    //* این تابع آمار سبک استور تیکت را برای لاگ و دیباگ می سازد.
    getStats() {
        let active = 0;
        let consumed = 0;
        let revoked = 0;
        let expired = 0;

        for (const record of this.ticketsById.values()) {
            if (record.revokedAt !== null) {
                revoked++;
                continue;
            }

            if (record.consumedAt !== null) {
                consumed++;
                continue;
            }

            if (this.isTicketExpired(record)) {
                expired++;
                continue;
            }

            active++;
        }

        return {
            total: this.ticketsById.size,
            active,
            consumed,
            revoked,
            expired,
            maxTickets: this.maxTickets
        };
    }

    //* این تابع رکورد تیکت را از نظر زمان و مصرف و لغو بررسی می کند.
    isTicketRecordValid(record) {
        if (!record) return false;
        if (record.revokedAt !== null) return false;
        if (record.consumedAt !== null) return false;
        if (this.isTicketExpired(record)) return false;

        return true;
    }

    //* این تابع بررسی می کند تیکت منقضی شده یا نه.
    isTicketExpired(record) {
        if (!record || !Number.isFinite(record.expiresAt)) return true;
        return nowMs() >= record.expiresAt;
    }

    //* این تابع داده تیکت را قبل از ذخیره اعتبارسنجی می کند.
    validateTicketForSave(ticket) {
        if (!ticket || typeof ticket !== "object") {
            throw new Error("[GameTicketStore] Ticket object is required.");
        }

        if (!isNonEmptyString(ticket.ticketId)) {
            throw new Error("[GameTicketStore] ticketId is required.");
        }

        if (!isNonEmptyString(ticket.userId)) {
            throw new Error("[GameTicketStore] userId is required.");
        }

        if (!isNonEmptyString(ticket.roomId)) {
            throw new Error("[GameTicketStore] roomId is required.");
        }

        if (!isNonEmptyString(ticket.serverId)) {
            throw new Error("[GameTicketStore] serverId is required.");
        }

        if (!isNonEmptyString(ticket.signature)) {
            throw new Error("[GameTicketStore] signature is required.");
        }

        if (!Number.isFinite(ticket.expiresAt)) {
            throw new Error("[GameTicketStore] expiresAt must be a unix timestamp in milliseconds.");
        }

        if (ticket.expiresAt <= nowMs()) {
            throw new Error("[GameTicketStore] expiresAt must be in the future.");
        }

        if (this.ticketsById.has(ticket.ticketId)) {
            throw new Error("[GameTicketStore] Duplicate ticketId.");
        }
    }
}

//* این تابع یک نمونه جدید از استور گیم تیکت می سازد.
function createGameTicketStore(options = {}) {
    return new GameTicketStore(options);
}

export {
    GameTicketStore,
    createGameTicketStore
};

// این فایل فقط حافظه داخلی گیم تیکت ها را مدیریت می کند و هنوز هیچ اتصال بیرونی یا تغییر در سرور اصلی ایجاد نمی کند.
