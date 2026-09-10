// مسیر فایل: src/voice/core/voiceConnectionRegistry.js

import {
    VoiceConnectionCloseReason,
    VoiceConnectionState,
    VoiceConnectionStateNameByValue
} from "./voiceConnectionConstants.js";

import {
    VoiceConnectionRecord
} from "./voiceConnectionRecord.js";

class VoiceConnectionRegistry {
    //* این سازنده محل‌های نگهداری و جست‌وجوی اتصال‌های صوتی را آماده می‌کند.
    constructor() {
        this.connectionsById =
            new Map();

        this.connectionIdByClientInstanceId =
            new Map();

        this.connectionIdByUserAvatar =
            new Map();

        this.sessionEligibilityByConnectionId =
            new Map();
    }

    //* این تابع اتصال احراز‌شده را ثبت می‌کند و جلوی ثبت شناسه اتصال یا کاربر تکراری را می‌گیرد.
    registerAuthenticatedConnection(input) {
        const connection =
            new VoiceConnectionRecord(
                input
            );

        if (
            this.connectionIdByClientInstanceId
                .has(
                    connection
                        .clientInstanceId
                )
        ) {
            throw new Error(
                "A Voice connection already exists for this client instance."
            );
        }

        if (
            this.connectionsById.has(
                connection.connectionId
            )
        ) {
            throw new Error(
                "A Voice connection already exists for this connection id."
            );
        }

        const userAvatarKey =
            `${connection.userId}\u0000${connection.avatarId}`;

        if (
            this.connectionIdByUserAvatar
                .has(
                    userAvatarKey
                )
        ) {
            throw new Error(
                "A Voice connection already exists for this user and avatar."
            );
        }

        this.connectionsById.set(
            connection.connectionId,
            connection
        );

        this.connectionIdByClientInstanceId
            .set(
                connection
                    .clientInstanceId,
                connection.connectionId
            );

        this.connectionIdByUserAvatar
            .set(
                userAvatarKey,
                connection.connectionId
            );

        this.sessionEligibilityByConnectionId
            .set(
                connection.connectionId,
                Object.freeze({
                    connectionId:
                        connection.connectionId,

                    eligible:
                        true,

                    initialized:
                        false,

                    changedAtMs:
                        connection.createdAtMs
                })
            );

        return connection;
    }

    //* این تابع اتصال صوتی را با شناسه اتصال پیدا می‌کند.
    getByConnectionId(connectionId) {
        return this.connectionsById.get(
            String(
                connectionId ?? ""
            )
                .trim()
                .toLowerCase()
        ) ?? null;
    }

    //* این تابع اتصال صوتی را با شناسه نمونه کلاینت پیدا می‌کند.
    getByClientInstanceId(
        clientInstanceId
    ) {
        const connectionId =
            this.connectionIdByClientInstanceId
                .get(
                    String(
                        clientInstanceId ??
                        ""
                    )
                        .trim()
                        .toLowerCase()
                );

        if (!connectionId) return null;

        return this.connectionsById.get(
            connectionId
        ) ?? null;
    }

    //* این تابع اتصال صوتی مربوط به یک کاربر و آواتار را پیدا می‌کند.
    getByUserAndAvatar(
        userId,
        avatarId
    ) {
        const key =
            `${String(userId ?? "").trim()}\u0000${String(avatarId ?? "").trim()}`;

        const connectionId =
            this.connectionIdByUserAvatar
                .get(key);

        if (!connectionId) return null;

        return this.connectionsById.get(
            connectionId
        ) ?? null;
    }

    //* این تابع تمام اتصال‌های صوتی یک کاربر را به‌صورت نسخه‌های خواندنی برمی‌گرداند.
    listByUserId(userId) {
        const normalizedUserId =
            String(userId ?? "")
                .trim();

        const connections = [];

        for (
            const connection
            of this.connectionsById
                .values()
        ) {
            if (
                connection.userId ===
                normalizedUserId
            ) {
                connections.push(
                    connection.snapshot()
                );
            }
        }

        return Object.freeze(
            connections
        );
    }


    //* این تابع همه اتصال‌های ثبت‌شده را برای خواندن وضعیت Authority به‌صورت Snapshot مرتب برمی‌گرداند.
    listAll() {
        const connections =
            Array.from(
                this.connectionsById
                    .values(),
                (connection) =>
                    connection.snapshot()
            );

        connections.sort(
            (first, second) =>
                first.connectionId.localeCompare(
                    second.connectionId
                )
        );

        return Object.freeze(
            connections
        );
    }

    //* این تابع نتیجه مستقل شرط Mic/Speaker را برای همان Voice Connection ذخیره می‌کند.
    setSessionEligibility(
        connectionId,
        eligible,
        changedAtMs = Date.now()
    ) {
        const connection =
            this.getByConnectionId(
                connectionId
            );

        if (!connection) return null;

        if (typeof eligible !== "boolean") {
            throw new TypeError(
                "eligible must be a boolean."
            );
        }

        if (
            !Number.isSafeInteger(
                changedAtMs
            ) ||
            changedAtMs < 0
        ) {
            throw new RangeError(
                "changedAtMs must be a non-negative safe integer."
            );
        }

        const previous =
            this.sessionEligibilityByConnectionId
                .get(
                    connection.connectionId
                ) ??
            null;

        if (
            previous &&
            previous.initialized ===
                true &&
            previous.eligible ===
                eligible
        ) {
            return Object.freeze({
                ...previous,
                changed: false
            });
        }

        const snapshot =
            Object.freeze({
                connectionId:
                    connection.connectionId,

                eligible,

                initialized:
                    true,

                changedAtMs
            });

        this.sessionEligibilityByConnectionId
            .set(
                connection.connectionId,
                snapshot
            );

        return Object.freeze({
            ...snapshot,
            changed: true
        });
    }

    //* این تابع آخرین نتیجه شرط Mic/Speaker یک Voice Connection را بدون تغییر State برمی‌گرداند.
    getSessionEligibility(
        connectionId
    ) {
        const connection =
            this.getByConnectionId(
                connectionId
            );

        if (!connection) return null;

        const snapshot =
            this.sessionEligibilityByConnectionId
                .get(
                    connection.connectionId
                );

        return snapshot ??
            Object.freeze({
                connectionId:
                    connection.connectionId,

                eligible:
                    true,

                initialized:
                    false,

                changedAtMs:
                    connection.createdAtMs
            });
    }

    //* این تابع اتصال فعال را بدون حذف نمایه‌های هویتی برای بازیابی بعدی معلق می‌کند.
    suspendConnection(
        connectionId,
        disconnectedAtMs = Date.now()
    ) {
        const connection =
            this.getByConnectionId(
                connectionId
            );

        if (!connection) return null;

        if (
            connection.state ===
            VoiceConnectionState.SUSPENDED
        ) {
            return connection.snapshot();
        }

        return connection.suspend(
            disconnectedAtMs
        );
    }

    //* این تابع اتصال معلق را پس از احراز دوباره روی راه انتقال جدید فعال می‌کند.
    resumeConnection(
        connectionId,
        {
            transportName,
            transportConnectionKey,
            resumedAtMs = Date.now()
        } = {}
    ) {
        const connection =
            this.getByConnectionId(
                connectionId
            );

        if (!connection) return null;

        return connection.resume({
            transportName,
            transportConnectionKey,
            resumedAtMs
        });
    }

    //* این تابع اتصال صوتی را می‌بندد و از تمام محل‌های نگهداری حذف می‌کند.
    removeConnection(
        connectionId,
        {
            reason =
                VoiceConnectionCloseReason
                    .SERVER_SHUTDOWN,

            closedAtMs =
                Date.now()
        } = {}
    ) {
        const connection =
            this.getByConnectionId(
                connectionId
            );

        if (!connection) return null;

        const snapshot =
            connection.close({
                reason,
                closedAtMs
            });

        const userAvatarKey =
            `${connection.userId}\u0000${connection.avatarId}`;

        this.connectionsById.delete(
            connection.connectionId
        );

        this.connectionIdByClientInstanceId
            .delete(
                connection
                    .clientInstanceId
            );

        this.connectionIdByUserAvatar
            .delete(
                userAvatarKey
            );

        this.sessionEligibilityByConnectionId
            .delete(
                connection.connectionId
            );

        return snapshot;
    }

    //* این تابع آمار اتصال‌های صوتی ثبت‌شده را بر اساس وضعیت آن‌ها برمی‌گرداند.
    getStats() {
        const byState = {};

        for (
            const stateName
            of Object.values(
                VoiceConnectionStateNameByValue
            )
        ) {
            byState[stateName] = 0;
        }

        for (
            const connection
            of this.connectionsById
                .values()
        ) {
            byState[
                VoiceConnectionStateNameByValue[
                    connection.state
                ]
            ] += 1;
        }

        return Object.freeze({
            total:
                this.connectionsById.size,

            active:
                byState[
                    VoiceConnectionStateNameByValue[
                        VoiceConnectionState
                            .ACTIVE
                    ]
                ],

            suspended:
                byState[
                    VoiceConnectionStateNameByValue[
                        VoiceConnectionState
                            .SUSPENDED
                    ]
                ],

            byState:
                Object.freeze(
                    byState
                )
        });
    }
}

export {
    VoiceConnectionRegistry
};

/*
توضیح فایل:
این فایل اتصال‌های صوتی را با شناسه اتصال بازیکن داخل سرور اختصاصی ثبت می‌کند. از ثبت دوباره همان شناسه اتصال، همان نمونه کلاینت یا همان کاربر و آواتار جلوگیری می‌شود. اتصال بسته‌شده نیز از تمام فهرست‌ها حذف می‌شود.
*/
