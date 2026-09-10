const VoiceCapacityDefaultPolicy = Object.freeze({
    maximumConnections: 5000,
    maximumActiveSessions: 10000,
    maximumPublishers: 2500,
    maximumConnectionsPerRoom: 200,
    maximumSessionsPerRoom: 400
});

class VoiceCapacityController {
    //* این سازنده محدودیت‌های سراسری و هر Room را دریافت می‌کند.
    constructor({ policy = {} } = {}) {
        this.policy = Object.freeze({ ...VoiceCapacityDefaultPolicy, ...policy });
        for (const [name, value] of Object.entries(this.policy)) {
            if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} is invalid.`);
        }
    }

    //* این تابع Snapshot رجیستری‌ها را پیش از پذیرش اتصال، Session یا Publisher بررسی می‌کند.
    evaluate({
        totalConnections = 0,
        totalSessions = 0,
        totalPublishers = 0,
        roomConnections = 0,
        roomSessions = 0
    } = {}) {
        const checks = [
            ["maximum_connections", totalConnections, this.policy.maximumConnections],
            ["maximum_sessions", totalSessions, this.policy.maximumActiveSessions],
            ["maximum_publishers", totalPublishers, this.policy.maximumPublishers],
            ["maximum_room_connections", roomConnections, this.policy.maximumConnectionsPerRoom],
            ["maximum_room_sessions", roomSessions, this.policy.maximumSessionsPerRoom]
        ];

        for (const [reason, current, maximum] of checks) {
            if (!Number.isSafeInteger(current) || current < 0) throw new RangeError("Voice capacity count is invalid.");
            if (current >= maximum) return Object.freeze({ allowed: false, reason, current, maximum });
        }

        return Object.freeze({ allowed: true, reason: "", current: 0, maximum: 0 });
    }
}

export { VoiceCapacityController, VoiceCapacityDefaultPolicy };

/*
توضیح فایل:
این فایل سقف اتصال، Session، Publisher و ظرفیت هر Room را پیش از پذیرش عملیات جدید بررسی می‌کند.
*/
