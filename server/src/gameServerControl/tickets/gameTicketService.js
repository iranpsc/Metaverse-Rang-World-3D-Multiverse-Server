// File => src/gameServerControl/tickets/gameTicketService.js

import crypto from "crypto";
import { createGameTicketStore } from "./gameTicketStore.js";

const DEFAULT_TICKET_TTL_SECONDS = 60;
const DEFAULT_SERVICE_SECRET = "change_me";
const SIGNATURE_ALGORITHM = "sha256";

//* این تابع زمان فعلی را به میلی ثانیه برمی گرداند.
function nowMs() {
    return Date.now();
}

//* این تابع بررسی می کند مقدار رشته ای معتبر است یا نه.
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

//* این تابع شناسه امن و کوتاه برای تیکت می سازد.
function createTicketId() {
    if (typeof crypto.randomUUID === "function") return `ticket_${crypto.randomUUID()}`;
    return `ticket_${crypto.randomBytes(16).toString("hex")}`;
}

//* این تابع مقدار عددی را در بازه امن نگه می دارد.
function clampInteger(value, fallbackValue, minValue, maxValue) {
    const parsedValue = Number.parseInt(value, 10);

    if (!Number.isFinite(parsedValue)) return fallbackValue;
    if (parsedValue < minValue) return minValue;
    if (parsedValue > maxValue) return maxValue;

    return parsedValue;
}

//* این تابع پِیلود قابل امضا برای گیم تیکت را می سازد.
function createTicketSignaturePayload(ticket) {
    return [
        ticket.ticketId,
        ticket.userId,
        ticket.roomId,
        ticket.serverId,
        String(ticket.expiresAt)
    ].join("|");
}

//* این تابع با سکرت سرویس، امضای امن برای گیم تیکت می سازد.
function signTicket(ticket, serviceSecret) {
    const payload = createTicketSignaturePayload(ticket);

    return crypto
        .createHmac(SIGNATURE_ALGORITHM, serviceSecret)
        .update(payload)
        .digest("hex");
}

//* این تابع دو رشته را با مقایسه امن بررسی می کند.
function safeStringEquals(a, b) {
    if (!isNonEmptyString(a) || !isNonEmptyString(b)) return false;

    const aBuffer = Buffer.from(a, "utf8");
    const bBuffer = Buffer.from(b, "utf8");

    if (aBuffer.length !== bBuffer.length) return false;

    return crypto.timingSafeEqual(aBuffer, bBuffer);
}

//* این کلاس سرویس ساخت و اعتبارسنجی گیم تیکت را مدیریت می کند.
class GameTicketService {
    constructor(options = {}) {
        this.config = options.config ?? {};
        this.ticketStore = options.ticketStore ?? createGameTicketStore(options.storeOptions ?? {});
        this.serviceSecret = this.config.serviceSecret ?? options.serviceSecret ?? DEFAULT_SERVICE_SECRET;

        this.ticketTtlSeconds = clampInteger(
            this.config.ticketTtlSeconds ?? options.ticketTtlSeconds,
            DEFAULT_TICKET_TTL_SECONDS,
            5,
            3600
        );
    }

    //* این تابع برای یک یوزر و روم، گیم تیکت کوتاه مدت صادر می کند.
    issueTicket(request) {
        this.validateIssueTicketRequest(request);

        const ttlSeconds = clampInteger(
            request.ttlSeconds ?? this.ticketTtlSeconds,
            this.ticketTtlSeconds,
            5,
            3600
        );

        const ticket = {
            ticketId: createTicketId(),
            userId: request.userId.trim(),
            roomId: request.roomId.trim(),
            serverId: request.serverId.trim(),
            expiresAt: nowMs() + ttlSeconds * 1000,
            metadata: request.metadata ?? {}
        };

        ticket.signature = signTicket(ticket, this.serviceSecret);

        const savedTicket = this.ticketStore.saveTicket(ticket);

        return this.toPublicTicket(savedTicket);
    }

    //* این تابع گیم تیکت را بدون مصرف کردن بررسی می کند.
    verifyTicket(request) {
        const validation = this.validateVerifyTicketRequest(request);
        if (!validation.success) return validation;

        const ticket = this.ticketStore.getTicket(request.ticketId);

        if (!ticket) return this.failure("ticket_not_found", "Game ticket was not found.", null);
        if (!this.ticketStore.isTicketRecordValid(ticket)) return this.failure("ticket_not_valid", "Game ticket is not valid.", ticket);
        if (!this.verifyStoredTicketSignature(ticket)) return this.failure("ticket_signature_invalid", "Stored game ticket signature is invalid.", ticket);
        if (!safeStringEquals(ticket.signature, request.signature)) return this.failure("ticket_signature_mismatch", "Game ticket signature does not match.", ticket);

        const expectedValidation = this.validateExpectedTicketFields(ticket, request);
        if (!expectedValidation.success) return expectedValidation;

        return this.success("ticket_valid", "Game ticket is valid.", ticket);
    }

    //* این تابع گیم تیکت را بررسی و در صورت اعتبار مصرف می کند.
    verifyAndConsumeTicket(request) {
        const verifyResult = this.verifyTicket(request);

        if (!verifyResult.success) return verifyResult;

        const consumeResult = this.ticketStore.consumeTicket(request.ticketId);

        if (!consumeResult.success) {
            return this.failure(consumeResult.reason, "Game ticket could not be consumed.", consumeResult.ticket);
        }

        return this.success("ticket_verified_and_consumed", "Game ticket verified and consumed.", consumeResult.ticket);
    }

    //* این تابع تیکت را با شناسه مستقیم مصرف می کند.
    consumeTicket(ticketId) {
        const result = this.ticketStore.consumeTicket(ticketId);

        if (!result.success) {
            return this.failure(result.reason, "Game ticket could not be consumed.", result.ticket);
        }

        return this.success("ticket_consumed", "Game ticket consumed.", result.ticket);
    }

    //* این تابع تیکت را لغو می کند.
    revokeTicket(ticketId) {
        const revoked = this.ticketStore.revokeTicket(ticketId);

        if (!revoked) return this.failure("ticket_revoke_failed", "Game ticket could not be revoked.", null);

        return this.success("ticket_revoked", "Game ticket revoked.", this.ticketStore.getTicket(ticketId));
    }

    //* این تابع تیکت های منقضی شده را پاکسازی می کند.
    cleanupExpiredTickets() {
        return this.ticketStore.cleanupExpiredTickets();
    }

    //* این تابع آمار سرویس تیکت را برمی گرداند.
    getStats() {
        return this.ticketStore.getStats();
    }

    //* این تابع درخواست صدور تیکت را اعتبارسنجی می کند.
    validateIssueTicketRequest(request) {
        if (!request || typeof request !== "object") {
            throw new Error("[GameTicketService] issueTicket request object is required.");
        }

        if (!isNonEmptyString(request.userId)) {
            throw new Error("[GameTicketService] userId is required.");
        }

        if (!isNonEmptyString(request.roomId)) {
            throw new Error("[GameTicketService] roomId is required.");
        }

        if (!isNonEmptyString(request.serverId)) {
            throw new Error("[GameTicketService] serverId is required.");
        }

        if (!isNonEmptyString(this.serviceSecret) || this.serviceSecret === DEFAULT_SERVICE_SECRET) {
            throw new Error("[GameTicketService] serviceSecret must be configured before issuing tickets.");
        }
    }

    //* این تابع درخواست بررسی تیکت را اعتبارسنجی می کند.
    validateVerifyTicketRequest(request) {
        if (!request || typeof request !== "object") {
            return this.failure("request_required", "Verify ticket request object is required.", null);
        }

        if (!isNonEmptyString(request.ticketId)) {
            return this.failure("ticket_id_required", "ticketId is required.", null);
        }

        if (!isNonEmptyString(request.signature)) {
            return this.failure("ticket_signature_required", "ticket signature is required.", null);
        }

        return { success: true };
    }

    //* این تابع فیلدهای مورد انتظار تیکت را با رکورد ذخیره شده مقایسه می کند.
    validateExpectedTicketFields(ticket, request) {
        if (isNonEmptyString(request.userId) && ticket.userId !== request.userId.trim()) {
            return this.failure("ticket_user_mismatch", "Game ticket userId does not match.", ticket);
        }

        if (isNonEmptyString(request.roomId) && ticket.roomId !== request.roomId.trim()) {
            return this.failure("ticket_room_mismatch", "Game ticket roomId does not match.", ticket);
        }

        if (isNonEmptyString(request.serverId) && ticket.serverId !== request.serverId.trim()) {
            return this.failure("ticket_server_mismatch", "Game ticket serverId does not match.", ticket);
        }

        return { success: true };
    }

    //* این تابع امضای ذخیره شده تیکت را دوباره محاسبه و بررسی می کند.
    verifyStoredTicketSignature(ticket) {
        const expectedSignature = signTicket(ticket, this.serviceSecret);
        return safeStringEquals(expectedSignature, ticket.signature);
    }

    //* این تابع تیکت داخلی را به مدل قابل ارسال تبدیل می کند.
    toPublicTicket(ticket) {
        if (!ticket) return null;

        return {
            ticketId: ticket.ticketId,
            userId: ticket.userId,
            roomId: ticket.roomId,
            serverId: ticket.serverId,
            expiresAt: ticket.expiresAt,
            signature: ticket.signature,
            metadata: ticket.metadata ?? {}
        };
    }

    //* این تابع پاسخ موفق استاندارد برای سرویس تیکت می سازد.
    success(reason, message, ticket) {
        return {
            success: true,
            reason,
            message,
            ticket: this.toPublicTicket(ticket)
        };
    }

    //* این تابع پاسخ خطای استاندارد برای سرویس تیکت می سازد.
    failure(reason, message, ticket) {
        return {
            success: false,
            reason,
            message,
            ticket: this.toPublicTicket(ticket)
        };
    }
}

//* این تابع یک نمونه جدید از سرویس گیم تیکت می سازد.
function createGameTicketService(options = {}) {
    return new GameTicketService(options);
}

export {
    GameTicketService,
    createGameTicketService,
    signTicket
};

// این فایل فقط سرویس مستقل ساخت و بررسی گیم تیکت را می سازد و هنوز هیچ اتصال بیرونی یا تغییر در سرور اصلی ایجاد نمی کند.
