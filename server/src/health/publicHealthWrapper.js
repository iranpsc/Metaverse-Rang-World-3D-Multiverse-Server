// File => src/health/publicHealthWrapper.js

import fs from "fs";
import os from "os";

import { UserModel } from "../infra/mongo/models/user.model.js";

//#region Public Health Constants

const PUBLIC_HEALTH_PATH = "/health";
const CPU_SAMPLE_INTERVAL_MS = 5000;
const REGISTERED_USERS_CACHE_MS = 30000;
const REGISTERED_USERS_TIMEOUT_MS = 2500;
const STORED_ROOMS_CACHE_MS = 30000;
const STORED_ROOMS_TIMEOUT_MS = 2500;
const HEALTH_SNAPSHOT_CACHE_MS = 2000;
const HEALTH_DASHBOARD_REFRESH_SECONDS = 10;

//#region Phase 7.L - Public Lobby Health Monitoring

const PUBLIC_LOBBY_ROOM_ID = "room_public_lobby_main";
const PUBLIC_LOBBY_ROOM_NAME = "Main Public Lobby";

//#endregion Phase 7.L - Public Lobby Health Monitoring

//#endregion Public Health Constants

//#region Public Health Runtime State

let clientsRegistry = null;
let roomManager = null;

let cpuSampleTimer = null;
let previousMachineCpuSnapshot = null;
let previousProcessCpuSnapshot = null;
let previousCpuSampleAt = 0;

let machineCpuUsagePercent = 0;
let processCpuUsagePercent = 0;

let registeredUsersCache = {
    available: false,
    value: null,
    updatedAt: 0,
    error: "not_loaded"
};

let registeredUsersReadPromise = null;

let storedRoomsCache = {
    available: false,
    value: null,
    updatedAt: 0,
    error: "not_loaded",
    modelName: ""
};

let storedRoomsReadPromise = null;

//#region Phase 7.L - Stored Room Display Names

let storedRoomDisplayNamesCache = {
    key: "",
    values: {},
    updatedAt: 0
};

let storedRoomDisplayNamesReadPromise = null;

//#endregion Phase 7.L - Stored Room Display Names

let healthSnapshotCache = null;
let healthSnapshotCacheAt = 0;
let healthSnapshotBuildPromise = null;

//#endregion Public Health Runtime State

//#region Public Health Utility Functions

//* این تابع زمان فعلی سرور را به میلی ثانیه برمی گرداند تا برای کش، تایم اوت و زمان پاسخ استفاده شود.
function nowMs() {
    return Date.now();
}

//* این تابع درصد ورودی را به بازه صفر تا صد محدود می کند و عدد را با دو رقم اعشار برمی گرداند.
function clampPercent(value) {
    const numberValue = Number(value);

    if (!Number.isFinite(numberValue)) {
        return 0;
    }

    return Math.max(
        0,
        Math.min(
            100,
            Number(numberValue.toFixed(2))
        )
    );
}

//* این تابع مقدار بایت را به مگابایت تبدیل می کند تا خروجی مصرف حافظه برای انسان خوانا باشد.
function toMegabytes(bytes) {
    const numberValue = Number(bytes);

    if (!Number.isFinite(numberValue) || numberValue < 0) {
        return 0;
    }

    return Number(
        (numberValue / 1024 / 1024).toFixed(2)
    );
}

//* این تابع مسیر درخواست اچ تی تی پی را بدون کوئری می خواند تا فقط مسیر دقیق هلت پردازش شود.
function readRequestPath(req = {}) {
    const host = req.headers?.host || "localhost";
    const rawUrl = req.url || "/";

    try {
        return new URL(
            rawUrl,
            `http://${host}`
        ).pathname;
    } catch {
        return String(rawUrl).split("?")[0] || "/";
    }
}

//* این تابع پاسخ جیسون استاندارد را روی پاسخ خام نود می نویسد و هدرهای لازم را تنظیم می کند.
function sendJson(
    res,
    statusCode,
    payload,
    method = "GET",
    extraHeaders = {}
) {
    const body = JSON.stringify(payload);

    const isHeadRequest =
        String(method).toUpperCase() === "HEAD";

    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Vary": "Accept",
        "Content-Length": Buffer.byteLength(body),
        ...extraHeaders
    });

    res.end(isHeadRequest ? "" : body);
}


//* این تابع فرمت صریح json یا html را از کوئری درخواست می خواند.
function readRequestFormat(req = {}) {
    const host = req.headers?.host || "localhost";
    const rawUrl = req.url || "/";

    try {
        const url = new URL(rawUrl, `http://${host}`);

        return String(
            url.searchParams.get("format") || ""
        ).trim().toLowerCase();
    } catch {
        return "";
    }
}

//* این تابع خروجی HTML را فقط برای مرورگر یا format=html فعال می کند.
function shouldRenderHealthHtml(req = {}) {
    const format = readRequestFormat(req);

    if (format === "json") return false;
    if (format === "html") return true;

    return String(
        req.headers?.accept || ""
    )
        .toLowerCase()
        .includes("text/html");
}

//* این تابع مقدارهای پویا را قبل از قرار گرفتن در HTML ایمن می کند.
function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

//* این تابع نام فیلدهای Health را برای نمایش فارسی آماده می کند.
function formatHealthLabel(key) {
    const labels = {
        success: "موفقیت پاسخ",
        status: "وضعیت سرویس",
        timestamp: "زمان ثبت وضعیت",
        uptimeSeconds: "زمان فعالیت",
        responseTimeMs: "زمان آماده سازی پاسخ",
        registeredTotal: "کل کاربران ثبت شده",
        realtimeOnline: "کاربران آنلاین Realtime",
        realtimeConnections: "اتصال های Realtime",
        insideRealtimeRooms: "کاربران داخل روم های Realtime",
        insideGameServers: "کاربران داخل Game Server",
        total: "کل",
        activeRealtime: "روم های فعال Realtime",
        assignedToGameServers: "روم های Assigned به Game Server",
        totalSource: "منبع تعداد کل",
        totalCapacity: "ظرفیت کل",
        reservedPlayers: "ظرفیت رزرو شده",
        availableReservedSlots: "ظرفیت رزرو آزاد",
        sessions: "کل Sessionها",
        activeSessions: "Sessionهای فعال",
        sessionPlayers: "بازیکنان داخل Sessionها",
        cpuCores: "تعداد هسته CPU",
        cpuUsagePercent: "مصرف CPU",
        loadAverage1m: "Load Average یک دقیقه",
        loadAverage5m: "Load Average پنج دقیقه",
        loadAverage15m: "Load Average پانزده دقیقه",
        memoryTotalMb: "حافظه کل",
        memoryUsedMb: "حافظه مصرف شده",
        memoryAvailableMb: "حافظه در دسترس",
        memoryFreeMb: "حافظه آزاد",
        memoryUsagePercent: "درصد مصرف حافظه",
        pid: "Process ID",
        nodeVersion: "نسخه Node.js",
        memoryRssMb: "حافظه RSS",
        heapTotalMb: "Heap کل",
        heapUsedMb: "Heap مصرف شده",
        externalMemoryMb: "حافظه External",
        registeredUsersAvailable: "دسترسی به کاربران ثبت شده",
        storedRoomsAvailable: "دسترسی به روم های ذخیره شده",
        storedRoomsUpdatedAt: "آخرین بروزرسانی روم ها",
        roomModelName: "مدل MongoDB روم",
        realtimeAvailable: "دسترسی به Realtime",
        gameServersAvailable: "دسترسی به Game Serverها",
        registeredUsersUpdatedAt: "آخرین بروزرسانی کاربران",

        //#region Phase 7.L - Public Lobby Health Monitoring

        registeredRealtime: "روم های ثبت شده در Realtime",
        permanentRealtime: "روم های دائمی Realtime",
        monitored: "روم های داخل فهرست مانیتورینگ",

        //#region Phase 7.L - Correct Live Room Total

        storedTotal: "کل رکوردهای روم در دیتابیس",
        storedTotalSource: "منبع رکوردهای ذخیره شده",

        //#endregion Phase 7.L - Correct Live Room Total
        roomId: "شناسه روم",
        roomName: "نام روم",
        roomType: "نوع روم",
        ready: "آماده ورود",
        healthStatus: "وضعیت زنده روم",
        isPermanent: "روم دائمی",
        realtimeRegistered: "ثبت شده در Realtime",
        realtimeActive: "دارای عضو فعال Realtime",
        realtimeUsers: "کاربران داخل Realtime",
        realtimeConnections: "اتصال های داخل Realtime",
        dedicatedAssigned: "اختصاص یافته به Dedicated",
        dedicatedReported: "گزارش شده توسط Heartbeat",
        sessionActive: "Session فعال",
        sessionPlayers: "بازیکنان Session",
        capacity: "ظرفیت روم",
        serverId: "شناسه Dedicated Server",
        region: "منطقه",
        zone: "ناحیه"

        //#endregion Phase 7.L - Public Lobby Health Monitoring
    };

    return labels[key] ??
        String(key)
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .replaceAll("_", " ");
}

//* این تابع ثانیه را به مدت زمان خوانا تبدیل می کند.
function formatHealthDuration(seconds) {
    let remaining = Math.max(
        0,
        Math.floor(Number(seconds) || 0)
    );

    const days = Math.floor(remaining / 86400);
    remaining %= 86400;

    const hours = Math.floor(remaining / 3600);
    remaining %= 3600;

    const minutes = Math.floor(remaining / 60);
    const parts = [];

    if (days) parts.push(`${days} روز`);
    if (hours || days) parts.push(`${hours} ساعت`);
    if (minutes || hours || days) {
        parts.push(`${minutes} دقیقه`);
    }

    parts.push(`${remaining % 60} ثانیه`);

    return parts.join(" و ");
}

//* این تابع مقدار هر فیلد Health را برای نمایش خوانا قالب بندی می کند.
function formatHealthValue(key, value) {
    if (value === null || value === undefined) {
        return "نامشخص";
    }

    if (typeof value === "boolean") {
        return value ? "بله" : "خیر";
    }

    if (
        key === "timestamp" ||
        key.endsWith("UpdatedAt")
    ) {
        const timestamp = Number(value);

        return Number.isFinite(timestamp)
            ? new Date(timestamp)
                .toISOString()
                .replace("T", " ")
                .replace(".000Z", " UTC")
            : String(value);
    }

    if (key === "uptimeSeconds") {
        return formatHealthDuration(value);
    }

    if (typeof value === "number") {
        const suffix =
            key.endsWith("Percent")
                ? "%"
                : key.endsWith("Mb")
                    ? " MB"
                    : key.endsWith("Ms")
                        ? " ms"
                        : "";

        return `${value.toLocaleString("en-US")}${suffix}`;
    }

    return String(value);
}

//* این تابع ردیف های یک بخش عمودی داشبورد را می سازد.
function buildHealthRows(data = {}) {
    return Object.entries(data)
        .map(([key, value]) => {
            const statusClass =
                key === "status"
                    ? String(value).toLowerCase() === "healthy"
                        ? "ok"
                        : String(value).toLowerCase() === "degraded"
                            ? "warn"
                            : "error"
                    : "";

            return `
                <div class="row">
                    <div class="label">${escapeHtml(formatHealthLabel(key))}</div>
                    <div class="value ${statusClass}">${escapeHtml(formatHealthValue(key, value))}</div>
                </div>
            `;
        })
        .join("");
}

//* این تابع یک بخش کامل داشبورد را می سازد.
function buildHealthSection(title, data) {
    const normalizedData =
        Array.isArray(data)
            ? data.length > 0
                ? Object.fromEntries(
                    data.map(
                        (value, index) => [
                            `مورد ${index + 1}`,
                            value
                        ]
                    )
                )
                : {
                    وضعیت:
                        "موردی ثبت نشده است."
                }
            : data ?? {};

    return `
        <section>
            <h2>${escapeHtml(title)}</h2>
            ${buildHealthRows(normalizedData)}
        </section>
    `;
}

//#region Phase 7.L - Public Lobby Health Monitoring

//* این تابع متن فارسی وضعیت فنی یک روم را برای داشبورد آماده می کند.
function formatRoomMonitoringStatus(status) {
    const statuses = {
        ready: "آماده و زنده",
        active: "فعال و دارای بازیکن",
        waiting_dedicated: "در انتظار Dedicated",
        session_inactive: "Session غیرفعال",
        realtime_only: "فقط Realtime",
        dedicated_only: "فقط Dedicated",
        registered: "ثبت شده و خالی",
        missing_realtime: "در Realtime ثبت نشده",
        offline: "آفلاین",
        unknown: "نامشخص"
    };

    return statuses[String(status || "").trim()] ?? String(status || "unknown");
}

//* این تابع کلاس نمایشی مناسب را بر اساس وضعیت هر روم انتخاب می کند.
function resolveRoomMonitoringStatusClass(status) {
    const normalizedStatus = String(status || "").trim();

    if (normalizedStatus === "ready" || normalizedStatus === "active") return "ok";
    if (normalizedStatus === "waiting_dedicated" || normalizedStatus === "registered" || normalizedStatus === "realtime_only") return "warn";

    return "error";
}

//#region Phase 7.L - Compact Room List

//* این تابع یک جدول کوچک از نام همه روم ها و تعداد کاربران آن ها برای مشاهده سریع می سازد.
function buildCompactRoomListSection(roomItems = []) {
    const rooms = Array.isArray(roomItems)
        ? [...roomItems]
        : [];

    rooms.sort((left, right) => {
        if (left?.isPublicLobby !== right?.isPublicLobby)
            return left?.isPublicLobby === true ? -1 : 1;

        return String(left?.roomName ?? left?.roomId ?? "")
            .localeCompare(String(right?.roomName ?? right?.roomId ?? ""));
    });

    const rows = rooms.map((room) => {
        const sessionPlayers = Math.max(0, Number(room?.sessionPlayers ?? 0));
        const realtimeUsers = Math.max(0, Number(room?.realtimeUsers ?? 0));

        //* وقتی Session فعال است عدد Dedicated ملاک است؛ در غیر این صورت عدد Realtime نمایش داده می شود.
        const users = room?.sessionActive === true
            ? sessionPlayers
            : realtimeUsers;

        const lobbyLabel = room?.isPublicLobby === true
            ? '<span class="compact-room-lobby-badge">لابی عمومی</span>'
            : "";

        return `
            <tr>
                <td>
                    <div class="compact-room-name">
                        <span>${escapeHtml(room?.roomName || room?.roomId || "Unknown Room")}</span>
                        ${lobbyLabel}
                    </div>
                </td>

                <td class="compact-room-users">
                    ${escapeHtml(users)}
                </td>
            </tr>
        `;
    }).join("");

    return `
        <section id="compact-room-list">
            <h2>نمای سریع همه روم ها</h2>

            <div class="compact-room-table-wrapper">
                <table class="compact-room-table">
                    <thead>
                        <tr>
                            <th>نام روم</th>
                            <th>تعداد کاربران</th>
                        </tr>
                    </thead>

                    <tbody>
                        ${rows || `
                            <tr>
                                <td>هیچ رومی ثبت نشده است.</td>
                                <td class="compact-room-users">0</td>
                            </tr>
                        `}
                    </tbody>
                </table>
            </div>
        </section>
    `;
}

//#endregion Phase 7.L - Compact Room List

//* این تابع فهرست زنده روم ها را به صورت کارت های جداگانه داخل داشبورد Health نمایش می دهد.
function buildRoomMonitoringSection(roomItems = []) {
    const rooms = Array.isArray(roomItems) ? roomItems : [];

    if (rooms.length === 0) {
        return buildHealthSection(
            "فهرست زنده روم ها",
            {
                status: "هیچ روم زنده ای ثبت نشده است."
            }
        );
    }

    const cards = rooms.map((room) => {
        const healthStatus = String(room?.healthStatus || "unknown");
        const statusClass = resolveRoomMonitoringStatusClass(healthStatus);
        const publicLobbyBadge = room?.isPublicLobby === true
            ? '<span class="room-badge">لابی عمومی دائمی</span>'
            : "";

        return `
            <article class="room-card">
                <div class="room-card-header">
                    <div>
                        <strong>${escapeHtml(room?.roomName || room?.roomId || "Unknown Room")}</strong>
                        <small>${escapeHtml(room?.roomId || "")}</small>
                    </div>

                    <div class="room-card-status ${statusClass}">
                        ${escapeHtml(formatRoomMonitoringStatus(healthStatus))}
                    </div>

                    ${publicLobbyBadge}
                </div>

                <div class="room-grid">
                    <div>
                        <span>نوع روم</span>
                        <strong>${escapeHtml(room?.roomType || "standard")}</strong>
                    </div>

                    <div>
                        <span>دائمی</span>
                        <strong>${room?.isPermanent === true ? "بله" : "خیر"}</strong>
                    </div>

                    <div>
                        <span>کاربران Realtime</span>
                        <strong>${escapeHtml(room?.realtimeUsers ?? 0)}</strong>
                    </div>

                    <div>
                        <span>اتصال های Realtime</span>
                        <strong>${escapeHtml(room?.realtimeConnections ?? 0)}</strong>
                    </div>

                    <div>
                        <span>بازیکنان Dedicated</span>
                        <strong>${escapeHtml(room?.sessionPlayers ?? 0)}</strong>
                    </div>

                    <div>
                        <span>ظرفیت</span>
                        <strong>${escapeHtml(room?.capacity ?? 0)}</strong>
                    </div>

                    <div>
                        <span>Realtime</span>
                        <strong>${room?.realtimeRegistered === true ? "ثبت شده" : "ثبت نشده"}</strong>
                    </div>

                    <div>
                        <span>Session</span>
                        <strong>${room?.sessionActive === true ? "فعال" : "غیرفعال"}</strong>
                    </div>

                    <div>
                        <span>Dedicated</span>
                        <strong>${room?.dedicatedAssigned === true ? "اختصاص یافته" : "اختصاص نیافته"}</strong>
                    </div>

                    <div>
                        <span>Heartbeat روم</span>
                        <strong>${room?.dedicatedReported === true ? "دریافت شده" : "هنوز گزارش نشده"}</strong>
                    </div>

                    <div>
                        <span>Dedicated Server</span>
                        <strong>${escapeHtml(room?.serverId || "-")}</strong>
                    </div>

                    <div>
                        <span>منطقه</span>
                        <strong>${escapeHtml(
                            [room?.region, room?.zone]
                                .filter(Boolean)
                                .join(" / ") || "-"
                        )}</strong>
                    </div>
                </div>
            </article>
        `;
    }).join("");

    return `
        <section>
            <h2>فهرست زنده روم ها</h2>
            <div class="room-list">
                ${cards}
            </div>
        </section>
    `;
}

//#endregion Phase 7.L - Public Lobby Health Monitoring

//* این تابع صفحه HTML مرتب Health را از همان Snapshot رسمی می سازد.
function buildPublicHealthDashboardHtml(snapshot = {}) {
    const overview = {
        success: snapshot.success,
        status: snapshot.status,
        timestamp: snapshot.timestamp,
        uptimeSeconds: snapshot.uptimeSeconds,
        responseTimeMs: snapshot.responseTimeMs
    };

    //#region Phase 7.L - Public Lobby Health Monitoring

    const roomSummary = {
        ...(snapshot.rooms ?? {})
    };

    delete roomSummary.list;

    //#endregion Phase 7.L - Public Lobby Health Monitoring

    const sections = [
        buildHealthSection("وضعیت کلی", overview),
        buildHealthSection("کاربران", snapshot.users),
        buildHealthSection("روم ها", roomSummary),

        //#region Phase 7.L - Public Lobby Health Monitoring

        buildHealthSection(
            "لابی عمومی سه بعدی",
            snapshot.publicLobby
        ),

        //#region Phase 7.L - Compact Room List

        buildCompactRoomListSection(
            snapshot.rooms?.list
        ),

        //#endregion Phase 7.L - Compact Room List

        buildRoomMonitoringSection(
            snapshot.rooms?.list
        ),

        //#endregion Phase 7.L - Public Lobby Health Monitoring

        buildHealthSection(
            "Game Serverها",
            snapshot.gameServers
        ),
        buildHealthSection(
            "ماشین سرور",
            snapshot.machine
        ),
        buildHealthSection(
            "پردازش Node.js",
            snapshot.process
        ),
        buildHealthSection(
            "منابع داده",
            snapshot.sources
        ),
        buildHealthSection(
            "دلایل کاهش کیفیت",
            snapshot.degradedReasons
        )
    ];

    return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="utf-8">
    <meta
        name="viewport"
        content="width=device-width, initial-scale=1"
    >
    <meta
        http-equiv="refresh"
        content="${HEALTH_DASHBOARD_REFRESH_SECONDS}"
    >
    <title>وضعیت سلامت سرور متاورس</title>
    <style>
        :root {
            font-family: Tahoma, Arial, sans-serif;
            color: #172033;
            background: #f3f5f7;
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            background: #f3f5f7;
            line-height: 1.7;
        }

        main {
            width: min(920px, calc(100% - 32px));
            margin: 0 auto;
            padding: 32px 0 48px;
        }

        header,
        section {
            background: #fff;
            border: 1px solid #dfe5ec;
            border-radius: 14px;
            margin-bottom: 18px;
            overflow: hidden;
            box-shadow: 0 4px 18px rgba(23, 32, 51, .05);
        }

        header {
            padding: 24px;
        }

        h1 {
            margin: 0 0 10px;
            font-size: 26px;
        }

        header p {
            margin: 0;
            color: #5d6878;
        }

        nav {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            margin-top: 16px;
        }

        a {
            padding: 8px 14px;
            border: 1px solid #ccd5df;
            border-radius: 8px;
            color: #1d4f91;
            text-decoration: none;
        }

        h2 {
            margin: 0;
            padding: 16px 20px;
            font-size: 19px;
            background: #f8fafc;
            border-bottom: 1px solid #e5eaf0;
        }

        .row {
            display: grid;
            grid-template-columns: minmax(220px, 42%) 1fr;
            gap: 16px;
            padding: 13px 20px;
            border-bottom: 1px solid #eef1f4;
        }

        .row:last-child {
            border-bottom: 0;
        }

        .label {
            color: #5d6878;
        }

        .value {
            direction: ltr;
            text-align: left;
            font-weight: 700;
            overflow-wrap: anywhere;
        }

        .ok {
            color: #087a3f;
        }

        .warn {
            color: #ad6500;
        }

        .error {
            color: #b42318;
        }

        //#region Phase 7.L - Compact Room List

        .compact-room-table-wrapper {
            overflow-x: auto;
            max-height: 420px;
            overflow-y: auto;
            padding: 12px 16px 16px;
        }

        .compact-room-table {
            width: 100%;
            border-collapse: collapse;
            background: #fff;
        }

        .compact-room-table th,
        .compact-room-table td {
            padding: 9px 12px;
            border-bottom: 1px solid #e7ebf0;
        }

        .compact-room-table th {
            position: sticky;
            top: 0;
            z-index: 1;
            background: #f4f7fa;
            text-align: right;
        }

        .compact-room-table tr:hover td {
            background: #f8fafc;
        }

        .compact-room-name {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }

        .compact-room-users {
            width: 140px;
            text-align: center;
            direction: ltr;
            font-weight: 800;
            font-size: 16px;
        }

        .compact-room-lobby-badge {
            padding: 3px 8px;
            border-radius: 999px;
            background: #e8f1ff;
            color: #175ca8;
            font-size: 11px;
            font-weight: 700;
        }

        //#endregion Phase 7.L - Compact Room List

        .room-list {
            display: grid;
            gap: 14px;
            padding: 16px;
        }

        .room-card {
            border: 1px solid #dfe5ec;
            border-radius: 12px;
            overflow: hidden;
            background: #fff;
        }

        .room-card-header {
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
            padding: 14px 16px;
            background: #f8fafc;
            border-bottom: 1px solid #e5eaf0;
        }

        .room-card-header > div:first-child {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-width: 220px;
        }

        .room-card-header small {
            direction: ltr;
            text-align: left;
            color: #6b7584;
            overflow-wrap: anywhere;
        }

        .room-card-status {
            padding: 5px 10px;
            border-radius: 999px;
            background: #eef1f4;
            font-weight: 700;
        }

        .room-badge {
            padding: 5px 10px;
            border-radius: 999px;
            background: #e8f1ff;
            color: #175ca8;
            font-weight: 700;
        }

        .room-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .room-grid > div {
            display: flex;
            flex-direction: column;
            gap: 3px;
            padding: 12px 16px;
            border-left: 1px solid #eef1f4;
            border-bottom: 1px solid #eef1f4;
        }

        .room-grid span {
            color: #6b7584;
            font-size: 13px;
        }

        .room-grid strong {
            direction: ltr;
            text-align: left;
            overflow-wrap: anywhere;
        }

        footer {
            text-align: center;
            color: #6b7584;
            font-size: 13px;
        }

        @media (max-width: 640px) {
            main {
                width: min(100% - 20px, 920px);
                padding-top: 18px;
            }

            header {
                padding: 18px;
            }

            .row {
                grid-template-columns: 1fr;
                gap: 4px;
                padding: 12px 16px;
            }

            .value {
                direction: rtl;
                text-align: right;
            }

            .room-grid {
                grid-template-columns: 1fr;
            }

            .room-grid strong {
                direction: rtl;
                text-align: right;
            }
        }
    </style>
</head>
<body>
    <main>
        <header>
            <h1>وضعیت سلامت سرور متاورس</h1>
            <p>
                داده ها از Snapshot رسمی Health خوانده می شوند
                و صفحه هر ${HEALTH_DASHBOARD_REFRESH_SECONDS} ثانیه بروزرسانی می شود.
            </p>
            <nav>
                <a href="/health">بروزرسانی اکنون</a>
                <a href="/health?format=json">مشاهده JSON</a>
            </nav>
        </header>

        ${sections.join("")}

        <footer>
            Public Health &amp; Server Monitoring
        </footer>
    </main>
</body>
</html>`;
}

//* این تابع پاسخ HTML امن و بدون کش را ارسال می کند.
function sendHtml(
    res,
    statusCode,
    html,
    method = "GET"
) {
    const body = String(html || "");
    const isHeadRequest =
        String(method).toUpperCase() === "HEAD";

    res.writeHead(statusCode, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "Vary": "Accept",
        "Content-Length": Buffer.byteLength(body)
    });

    res.end(isHeadRequest ? "" : body);
}

//#endregion Public Health Utility Functions

//#region Public Health Runtime Registration

//* این تابع رجیستری واقعی کانکشن های ریل تایم را داخل ورپر ثبت می کند تا تعداد کاربران آنلاین از همان منبع اصلی خوانده شود.
function registerPublicHealthClientsRegistry(registry) {
    if (
        !registry ||
        typeof registry.getSnapshot !== "function"
    ) {
        return false;
    }

    clientsRegistry = registry;

    ensureCpuSamplerStarted();

    return true;
}

//* این تابع روم منیجر واقعی ریل تایم را داخل ورپر ثبت می کند تا تعداد روم ها و اعضای روم از همان منبع اصلی خوانده شود.
function registerPublicHealthRoomManager(manager) {
    if (
        !manager ||
        typeof manager.getSnapshot !== "function"
    ) {
        return false;
    }

    roomManager = manager;

    ensureCpuSamplerStarted();

    return true;
}

//#endregion Public Health Runtime Registration

//#region Public Health CPU And Memory Sampling

//* این تابع مجموع زمان های پردازنده را از همه هسته ها می خواند تا درصد مصرف ماشین بین دو نمونه محاسبه شود.
function readMachineCpuTimesSnapshot() {
    const cpus = os.cpus();

    let idle = 0;
    let total = 0;

    for (const cpu of cpus) {
        const times = cpu?.times ?? {};

        const user = Number(times.user ?? 0);
        const nice = Number(times.nice ?? 0);
        const sys = Number(times.sys ?? 0);
        const idleTime = Number(times.idle ?? 0);
        const irq = Number(times.irq ?? 0);

        idle += idleTime;

        total +=
            user +
            nice +
            sys +
            idleTime +
            irq;
    }

    return {
        idle,
        total,
        cores: cpus.length
    };
}

//* این تابع اختلاف دو نمونه پردازنده ماشین را محاسبه می کند و درصد مصرف واقعی کل ماشین را برمی گرداند.
function calculateMachineCpuUsagePercent(
    previousSnapshot,
    currentSnapshot
) {
    if (!previousSnapshot || !currentSnapshot) {
        return 0;
    }

    const idleDelta =
        currentSnapshot.idle -
        previousSnapshot.idle;

    const totalDelta =
        currentSnapshot.total -
        previousSnapshot.total;

    if (
        !Number.isFinite(totalDelta) ||
        totalDelta <= 0
    ) {
        return 0;
    }

    return clampPercent(
        (1 - idleDelta / totalDelta) * 100
    );
}

//* این تابع اختلاف مصرف پردازنده پردازش نود را بین دو نمونه محاسبه می کند و نتیجه را نسبت به تعداد هسته ها نرمال می کند.
function calculateProcessCpuUsagePercent(
    previousSnapshot,
    currentSnapshot,
    elapsedMs,
    cpuCores
) {
    if (
        !previousSnapshot ||
        !currentSnapshot ||
        !Number.isFinite(elapsedMs) ||
        elapsedMs <= 0
    ) {
        return 0;
    }

    const userDeltaMicros =
        Number(currentSnapshot.user ?? 0) -
        Number(previousSnapshot.user ?? 0);

    const systemDeltaMicros =
        Number(currentSnapshot.system ?? 0) -
        Number(previousSnapshot.system ?? 0);

    const processCpuMs =
        (userDeltaMicros + systemDeltaMicros) / 1000;

    const safeCoreCount =
        Math.max(
            1,
            Number(cpuCores) || 1
        );

    return clampPercent(
        (
            processCpuMs /
            elapsedMs /
            safeCoreCount
        ) * 100
    );
}

//* این تابع حافظه واقعاً در دسترس لینوکس را از فایل مم اینفو می خواند تا کش سیستم عامل اشتباهاً مصرف شده حساب نشود.
function readLinuxAvailableMemoryBytes() {
    if (process.platform !== "linux") {
        return null;
    }

    try {
        const content = fs.readFileSync(
            "/proc/meminfo",
            "utf8"
        );

        const match = content.match(
            /^MemAvailable:\s+(\d+)\s+kB$/m
        );

        if (!match) {
            return null;
        }

        return Number(match[1]) * 1024;
    } catch {
        return null;
    }
}

//* این تابع وضعیت حافظه کل ماشین را می خواند و مقدار کل، مصرف شده، آزاد و در دسترس را آماده می کند.
function readMachineMemorySnapshot() {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();

    const availableBytes =
        readLinuxAvailableMemoryBytes() ??
        freeBytes;

    const usedBytes =
        Math.max(
            0,
            totalBytes - availableBytes
        );

    return {
        totalBytes,
        freeBytes,
        availableBytes,
        usedBytes,

        usagePercent:
            totalBytes > 0
                ? clampPercent(
                    (usedBytes / totalBytes) * 100
                )
                : 0
    };
}

//* این تابع یک نمونه جدید از مصرف پردازنده ماشین و پردازش نود می گیرد و مقدارهای کش شده را به روز می کند.
function sampleCpuUsage() {
    const sampledAt = nowMs();

    const currentMachineSnapshot =
        readMachineCpuTimesSnapshot();

    const currentProcessSnapshot =
        process.cpuUsage();

    const elapsedMs =
        sampledAt - previousCpuSampleAt;

    machineCpuUsagePercent =
        calculateMachineCpuUsagePercent(
            previousMachineCpuSnapshot,
            currentMachineSnapshot
        );

    processCpuUsagePercent =
        calculateProcessCpuUsagePercent(
            previousProcessCpuSnapshot,
            currentProcessSnapshot,
            elapsedMs,
            currentMachineSnapshot.cores
        );

    previousMachineCpuSnapshot =
        currentMachineSnapshot;

    previousProcessCpuSnapshot =
        currentProcessSnapshot;

    previousCpuSampleAt =
        sampledAt;
}

//* این تابع تایمر نمونه برداری پردازنده را فقط یک بار فعال می کند و اجازه نمی دهد تایمر تکراری ساخته شود.
function ensureCpuSamplerStarted() {
    if (cpuSampleTimer) {
        return false;
    }

    previousMachineCpuSnapshot =
        readMachineCpuTimesSnapshot();

    previousProcessCpuSnapshot =
        process.cpuUsage();

    previousCpuSampleAt =
        nowMs();

    cpuSampleTimer = setInterval(
        sampleCpuUsage,
        CPU_SAMPLE_INTERVAL_MS
    );

    cpuSampleTimer.unref?.();

    return true;
}

//#endregion Public Health CPU And Memory Sampling

//#region Public Health Data Readers

//* این تابع تعداد کل کاربران ثبت شده را از مونگو می خواند و با کش و تایم اوت جلوی فشار یا انتظار طولانی را می گیرد.
async function readRegisteredUsersSnapshot() {
    const currentTime = nowMs();

    if (
        registeredUsersCache.available === true &&
        currentTime - registeredUsersCache.updatedAt <
            REGISTERED_USERS_CACHE_MS
    ) {
        return registeredUsersCache;
    }

    if (registeredUsersReadPromise) {
        return registeredUsersReadPromise;
    }

    registeredUsersReadPromise = (async () => {
        let timeoutHandle = null;

        try {
            const timeoutPromise =
                new Promise((_, reject) => {
                    timeoutHandle = setTimeout(
                        () => {
                            reject(
                                new Error(
                                    "registered_users_timeout"
                                )
                            );
                        },
                        REGISTERED_USERS_TIMEOUT_MS
                    );

                    timeoutHandle.unref?.();
                });

            const count = await Promise.race([
                UserModel.countDocuments({}),
                timeoutPromise
            ]);

            registeredUsersCache = {
                available: true,
                value: Math.max(
                    0,
                    Number(count) || 0
                ),
                updatedAt: nowMs(),
                error: ""
            };
        } catch (error) {
            console.warn(
                "[PublicHealth] registered users read failed",
                {
                    error:
                        error?.message ??
                        String(error)
                }
            );

            registeredUsersCache = {
                available: false,
                value: registeredUsersCache.value,
                updatedAt:
                    registeredUsersCache.updatedAt,
                error:
                    error?.message ??
                    String(error)
            };
        } finally {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
        }

        return registeredUsersCache;
    })();

    try {
        return await registeredUsersReadPromise;
    } finally {
        registeredUsersReadPromise = null;
    }
}

//* این تابع مدل واقعی روم را از مدل های ثبت شده همان اتصال MongoDB پیدا می کند.
//* مدل فقط زمانی پذیرفته می شود که فیلدهای اصلی روم یعنی roomId، roomName و maxPlayers را داشته باشد.
function resolveRegisteredRoomModel() {
    const modelContainers = [
        UserModel?.db?.models,
        UserModel?.base?.models
    ];

    const visitedModels = new Set();

    for (const models of modelContainers) {
        if (!models || typeof models !== "object") {
            continue;
        }

        for (const model of Object.values(models)) {
            if (
                !model ||
                visitedModels.has(model) ||
                typeof model.countDocuments !== "function"
            ) {
                continue;
            }

            visitedModels.add(model);

            const schema = model.schema;

            const hasRoomId =
                Boolean(schema?.path?.("roomId"));

            const hasRoomName =
                Boolean(schema?.path?.("roomName"));

            const hasMaxPlayers =
                Boolean(schema?.path?.("maxPlayers"));

            if (
                hasRoomId &&
                hasRoomName &&
                hasMaxPlayers
            ) {
                return model;
            }
        }
    }

    return null;
}

//* این تابع تعداد کل اسناد روم موجود در MongoDB را می خواند.
//* نتیجه سی ثانیه کش می شود و تایم اوت دارد تا درخواست عمومی Health باعث فشار یا انتظار طولانی نشود.
async function readStoredRoomsSnapshot() {
    const currentTime = nowMs();

    if (
        storedRoomsCache.available === true &&
        currentTime - storedRoomsCache.updatedAt <
            STORED_ROOMS_CACHE_MS
    ) {
        return storedRoomsCache;
    }

    if (storedRoomsReadPromise) {
        return storedRoomsReadPromise;
    }

    storedRoomsReadPromise = (async () => {
        let timeoutHandle = null;

        try {
            const roomModel =
                resolveRegisteredRoomModel();

            if (!roomModel) {
                throw new Error(
                    "registered_room_model_not_found"
                );
            }

            const timeoutPromise =
                new Promise((_, reject) => {
                    timeoutHandle = setTimeout(
                        () => {
                            reject(
                                new Error(
                                    "stored_rooms_timeout"
                                )
                            );
                        },
                        STORED_ROOMS_TIMEOUT_MS
                    );

                    timeoutHandle.unref?.();
                });

            const count = await Promise.race([
                roomModel.countDocuments({}),
                timeoutPromise
            ]);

            storedRoomsCache = {
                available: true,
                value: Math.max(
                    0,
                    Number(count) || 0
                ),
                updatedAt: nowMs(),
                error: "",
                modelName:
                    roomModel.modelName || ""
            };
        } catch (error) {
            console.warn(
                "[PublicHealth] stored rooms read failed",
                {
                    error:
                        error?.message ??
                        String(error)
                }
            );

            storedRoomsCache = {
                available: false,
                value: storedRoomsCache.value,
                updatedAt:
                    storedRoomsCache.updatedAt,
                error:
                    error?.message ??
                    String(error),
                modelName:
                    storedRoomsCache.modelName
            };
        } finally {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
        }

        return storedRoomsCache;
    })();

    try {
        return await storedRoomsReadPromise;
    } finally {
        storedRoomsReadPromise = null;
    }
}

//* این تابع اسنپ شات رجیستری و روم منیجر را می خواند و تعداد کاربران آنلاین، کانکشن ها و روم های فعال را محاسبه می کند.
function readRealtimeSnapshot() {
    clientsRegistry
        ?.cleanupClosedConnections
        ?.();

    const registrySnapshot =
        clientsRegistry
            ?.getSnapshot
            ?.() ?? null;

    const roomsSnapshot =
        roomManager
            ?.getSnapshot
            ?.() ?? null;

    const roomItems =
        Array.isArray(roomsSnapshot?.rooms)
            ? roomsSnapshot.rooms
            : [];

    const normalizedRooms = roomItems
        .map((room) => {
            const roomId = String(
                room?.roomId ?? ""
            ).trim();

            if (!roomId) return null;

            return {
                roomId,
                roomName:
                    String(
                        room?.roomName ??
                        roomId
                    ).trim() || roomId,

                roomType:
                    String(
                        room?.roomType ??
                        "standard"
                    ).trim() || "standard",

                isPublic:
                    room?.isPublic === true,

                isPermanent:
                    room?.isPermanent === true,

                autoCleanup:
                    room?.autoCleanup !== false,

                maxPlayers:
                    Math.max(
                        0,
                        Number(
                            room?.maxPlayers ??
                            0
                        )
                    ),

                connectionCount:
                    Math.max(
                        0,
                        Number(
                            room?.connectionCount ??
                            0
                        )
                    ),

                userCount:
                    Math.max(
                        0,
                        Number(
                            room?.userCount ??
                            0
                        )
                    )
            };
        })
        .filter(Boolean);

    return {
        available:
            Boolean(
                registrySnapshot &&
                roomsSnapshot
            ),

        connectionCount:
            Math.max(
                0,
                Number(
                    registrySnapshot
                        ?.connectionCount ??
                    0
                )
            ),

        uniqueOnlineUsers:
            Math.max(
                0,
                Number(
                    registrySnapshot
                        ?.userCount ??
                    0
                )
            ),

        activeRooms:
            Math.max(
                0,
                Number(
                    roomsSnapshot
                        ?.roomCount ??
                    normalizedRooms.filter(
                        (room) =>
                            room.connectionCount > 0
                    ).length
                )
            ),

        registeredRooms:
            Math.max(
                0,
                Number(
                    roomsSnapshot
                        ?.registeredRoomCount ??
                    normalizedRooms.length
                )
            ),

        permanentRooms:
            Math.max(
                0,
                Number(
                    roomsSnapshot
                        ?.permanentRoomCount ??
                    normalizedRooms.filter(
                        (room) =>
                            room.isPermanent
                    ).length
                )
            ),

        usersInsideRealtimeRooms:
            normalizedRooms.reduce(
                (sum, room) => {
                    return (
                        sum +
                        room.userCount
                    );
                },
                0
            ),

        rooms:
            normalizedRooms
    };
}

//* این تابع وضعیت کنترل گیم سرور را می خواند و فقط آمار عمومی و غیر حساس ددیکیتد سرورها را استخراج می کند.
function readGameServerSnapshot(
    getGameServerControl
) {
    let status = null;

    try {
        const control =
            typeof getGameServerControl ===
            "function"
                ? getGameServerControl()
                : null;

        status =
            control?.getStatus?.() ??
            null;
    } catch (error) {
        console.warn(
            "[PublicHealth] game server status read failed",
            {
                error:
                    error?.message ??
                    String(error)
            }
        );
    }

    const data =
        status?.success === true
            ? status.data ?? {}
            : {};

    const registry =
        data.registry ?? {};

    const health =
        data.health ?? {};

    const sessions =
        data.sessions ?? {};

    const registryRoomsByRoom =
        registry?.rooms?.byRoom &&
        typeof registry.rooms.byRoom === "object"
            ? registry.rooms.byRoom
            : {};

    const sessionsByRoom =
        sessions?.byRoom &&
        typeof sessions.byRoom === "object"
            ? sessions.byRoom
            : {};

    const roomIds = new Set([
        ...Object.keys(
            registryRoomsByRoom
        ),

        ...Object.keys(
            sessionsByRoom
        )
    ]);

    const rooms = [...roomIds].map((roomId) => {
        const registryRoom =
            registryRoomsByRoom[roomId] ??
            {};

        const sessionRoom =
            sessionsByRoom[roomId] ??
            {};

        const statusCounts =
            sessionRoom?.statusCounts &&
            typeof sessionRoom.statusCounts === "object"
                ? sessionRoom.statusCounts
                : {};

        const sessionCount =
            Math.max(
                0,
                Number(
                    sessionRoom.sessions ??
                    0
                )
            );

        const sessionActive =
            Number(statusCounts.creating ?? 0) > 0 ||
            Number(statusCounts.active ?? 0) > 0;

        return {
            roomId,

            roomName:
                String(
                    sessionRoom.roomName ??
                    registryRoom.roomName ??
                    registryRoom.displayName ??
                    roomId
                ).trim() || roomId,

            // Phase 7.L - Health Room Display Name Priority

            serverId:
                String(
                    sessionRoom.serverId ??
                    registryRoom.serverId ??
                    ""
                ).trim(),

            region:
                String(
                    sessionRoom.region ??
                    ""
                ).trim(),

            zone:
                String(
                    sessionRoom.zone ??
                    ""
                ).trim(),

            dedicatedAssigned:
                sessionCount > 0,

            dedicatedReported:
                Boolean(
                    registryRoomsByRoom[
                        roomId
                    ]
                ),

            sessionCount,

            sessionActive,

            sessionPlayers:
                Math.max(
                    0,
                    Number(
                        sessionRoom.players ??
                        0
                    )
                ),

            registryPlayers:
                Math.max(
                    0,
                    Number(
                        registryRoom
                            .currentPlayers ??
                        0
                    )
                ),

            capacity:
                Math.max(
                    0,
                    Number(
                        sessionRoom.capacity ??
                        0
                    )
                ),

            statusCounts: {
                ...statusCounts
            }
        };
    });

    return {
        available:
            status?.success === true,

        insideGameServers:
            Math.max(
                0,
                Number(
                    registry.totalPlayers ??
                    0
                )
            ),

        assignedRooms:
            Math.max(
                0,
                Number(
                    registry.assignedRooms ??
                    registry.rooms?.total ??
                    0
                )
            ),

        total:
            Math.max(
                0,
                Number(registry.total ?? 0)
            ),

        online:
            Math.max(
                0,
                Number(registry.online ?? 0)
            ),

        warm:
            Math.max(
                0,
                Number(registry.warm ?? 0)
            ),

        full:
            Math.max(
                0,
                Number(registry.full ?? 0)
            ),

        busy:
            Math.max(
                0,
                Number(registry.busy ?? 0)
            ),

        starting:
            Math.max(
                0,
                Number(registry.starting ?? 0)
            ),

        draining:
            Math.max(
                0,
                Number(registry.draining ?? 0)
            ),

        offline:
            Math.max(
                0,
                Number(registry.offline ?? 0)
            ),

        unhealthy:
            Math.max(
                0,
                Number(registry.unhealthy ?? 0)
            ),

        healthy:
            Math.max(
                0,
                Number(health.healthy ?? 0)
            ),

        warning:
            Math.max(
                0,
                Number(health.warning ?? 0)
            ),

        timeout:
            Math.max(
                0,
                Number(health.timeout ?? 0)
            ),

        totalCapacity:
            Math.max(
                0,
                Number(
                    registry.totalCapacity ??
                    0
                )
            ),

        reservedPlayers:
            Math.max(
                0,
                Number(
                    registry.reservedPlayers ??
                    0
                )
            ),

        availableReservedSlots:
            Math.max(
                0,
                Number(
                    registry
                        .availableReservedSlots ??
                    0
                )
            ),

        sessionCount:
            Math.max(
                0,
                Number(sessions.total ?? 0)
            ),

        activeSessions:
            Math.max(
                0,
                Number(sessions.active ?? 0)
            ),

        sessionPlayers:
            Math.max(
                0,
                Number(
                    sessions.totalPlayers ??
                    0
                )
            ),

        rooms
    };
}

//#region Phase 7.L - Public Lobby Health Monitoring

//* این تابع داده روم های Realtime و Dedicated را ادغام می کند و یک فهرست زنده و بدون اطلاعات حساس می سازد.
function buildRoomMonitoringSnapshot(
    realtime,
    gameServers
) {
    const roomsById = new Map();

    const ensureRoom = (
        roomId,
        roomName = ""
    ) => {
        const normalizedRoomId =
            String(roomId ?? "").trim();

        if (!normalizedRoomId)
            return null;

        if (!roomsById.has(normalizedRoomId)) {
            roomsById.set(
                normalizedRoomId,
                {
                    roomId:
                        normalizedRoomId,

                    roomName:
                        String(
                            roomName ??
                            normalizedRoomId
                        ).trim() ||
                        normalizedRoomId,

                    roomType:
                        "standard",

                    isPublicLobby:
                        normalizedRoomId ===
                        PUBLIC_LOBBY_ROOM_ID,

                    isPermanent:
                        normalizedRoomId ===
                        PUBLIC_LOBBY_ROOM_ID,

                    realtimeRegistered:
                        false,

                    realtimeActive:
                        false,

                    realtimeUsers:
                        0,

                    realtimeConnections:
                        0,

                    dedicatedAssigned:
                        false,

                    dedicatedReported:
                        false,

                    sessionActive:
                        false,

                    sessionPlayers:
                        0,

                    registryPlayers:
                        0,

                    capacity:
                        0,

                    serverId:
                        "",

                    region:
                        "",

                    zone:
                        "",

                    healthStatus:
                        "unknown",

                    ready:
                        false
                }
            );
        }

        return roomsById.get(
            normalizedRoomId
        );
    };

    for (const realtimeRoom of realtime?.rooms ?? []) {
        const room = ensureRoom(
            realtimeRoom.roomId,
            realtimeRoom.roomName
        );

        if (!room) continue;

        room.roomName =
            realtimeRoom.roomName ||
            room.roomName;

        room.roomType =
            realtimeRoom.roomType ||
            room.roomType;

        room.isPermanent =
            realtimeRoom.isPermanent === true ||
            room.isPermanent;

        room.realtimeRegistered =
            true;

        room.realtimeConnections =
            Math.max(
                0,
                Number(
                    realtimeRoom
                        .connectionCount ??
                    0
                )
            );

        room.realtimeUsers =
            Math.max(
                0,
                Number(
                    realtimeRoom.userCount ??
                    0
                )
            );

        room.realtimeActive =
            room.realtimeConnections > 0;

        room.capacity =
            Math.max(
                room.capacity,
                Number(
                    realtimeRoom.maxPlayers ??
                    0
                )
            );
    }

    for (const dedicatedRoom of gameServers?.rooms ?? []) {
        const room = ensureRoom(
            dedicatedRoom.roomId,
            dedicatedRoom.roomName
        );

        if (!room) continue;

        /*
         * نامی که از Realtime آمده در اولویت است.
         * اگر Realtime فقط شناسه داخلی را داشته باشد،
         * نام واقعی Session یا Dedicated جایگزین می شود.
         */
        const realtimeHasDisplayName =
            room.realtimeRegistered === true &&
            room.roomName &&
            room.roomName !== room.roomId;

        const dedicatedDisplayName =
            String(
                dedicatedRoom.roomName ?? ""
            ).trim();

        if (
            !realtimeHasDisplayName &&
            dedicatedDisplayName
        ) {
            room.roomName =
                dedicatedDisplayName;
        }

        room.dedicatedAssigned =
            dedicatedRoom
                .dedicatedAssigned === true;

        room.dedicatedReported =
            dedicatedRoom
                .dedicatedReported === true;

        room.sessionActive =
            dedicatedRoom
                .sessionActive === true;

        room.sessionPlayers =
            Math.max(
                0,
                Number(
                    dedicatedRoom
                        .sessionPlayers ??
                    0
                )
            );

        room.registryPlayers =
            Math.max(
                0,
                Number(
                    dedicatedRoom
                        .registryPlayers ??
                    0
                )
            );

        room.capacity =
            Math.max(
                room.capacity,
                Number(
                    dedicatedRoom.capacity ??
                    0
                )
            );

        room.serverId =
            dedicatedRoom.serverId ||
            room.serverId;

        room.region =
            dedicatedRoom.region ||
            room.region;

        room.zone =
            dedicatedRoom.zone ||
            room.zone;
    }

    const publicLobby = ensureRoom(
        PUBLIC_LOBBY_ROOM_ID,
        PUBLIC_LOBBY_ROOM_NAME
    );

    publicLobby.roomName =
        PUBLIC_LOBBY_ROOM_NAME;

    publicLobby.roomType =
        "public_lobby";

    publicLobby.isPublicLobby =
        true;

    publicLobby.isPermanent =
        true;

    if (publicLobby.capacity <= 0)
        publicLobby.capacity = 100;

    for (const room of roomsById.values()) {
        if (room.isPublicLobby) {
            if (!room.realtimeRegistered) {
                room.healthStatus =
                    "missing_realtime";
            } else if (
                !room.dedicatedAssigned
            ) {
                room.healthStatus =
                    "waiting_dedicated";
            } else if (
                !room.sessionActive
            ) {
                room.healthStatus =
                    "session_inactive";
            } else {
                room.healthStatus =
                    "ready";
            }
        } else if (
            room.sessionActive &&
            (
                room.sessionPlayers > 0 ||
                room.realtimeActive
            )
        ) {
            room.healthStatus =
                "active";
        } else if (room.sessionActive) {
            room.healthStatus =
                "ready";
        } else if (
            room.realtimeActive
        ) {
            room.healthStatus =
                "realtime_only";
        } else if (
            room.dedicatedAssigned ||
            room.dedicatedReported
        ) {
            room.healthStatus =
                "dedicated_only";
        } else if (
            room.realtimeRegistered
        ) {
            room.healthStatus =
                "registered";
        } else {
            room.healthStatus =
                "offline";
        }

        room.ready =
            room.healthStatus ===
                "ready" ||
            room.healthStatus ===
                "active";
    }

    return [...roomsById.values()]
        .sort((left, right) => {
            if (
                left.isPublicLobby !==
                right.isPublicLobby
            ) {
                return left.isPublicLobby
                    ? -1
                    : 1;
            }

            if (
                left.ready !==
                right.ready
            ) {
                return left.ready
                    ? -1
                    : 1;
            }

            return left.roomName.localeCompare(
                right.roomName
            );
        });
}

//#endregion Phase 7.L - Public Lobby Health Monitoring

//#endregion Public Health Data Readers

//#region Public Health Snapshot Builder

//* این تابع همه منابع مانیتورینگ را کنار هم قرار می دهد و خروجی عمومی و بدون اطلاعات حساس هلت را می سازد.
//#region Phase 7.L - Stored Room Display Names

//* این تابع نام قابل نمایش روم ها را بر اساس roomId از MongoDB می خواند تا شناسه فنی در Health نمایش داده نشود.
async function readStoredRoomDisplayNames(roomIds = []) {
    const normalizedRoomIds = [
        ...new Set(
            (Array.isArray(roomIds) ? roomIds : [])
                .map((roomId) => String(roomId ?? "").trim())
                .filter(Boolean)
        )
    ].sort();

    if (normalizedRoomIds.length === 0)
        return {};

    const cacheKey =
        normalizedRoomIds.join("|");

    const cacheIsFresh =
        storedRoomDisplayNamesCache.key === cacheKey &&
        nowMs() - storedRoomDisplayNamesCache.updatedAt <
            STORED_ROOMS_CACHE_MS;

    if (cacheIsFresh)
        return {
            ...storedRoomDisplayNamesCache.values
        };

    if (storedRoomDisplayNamesReadPromise)
        return storedRoomDisplayNamesReadPromise;

    storedRoomDisplayNamesReadPromise =
        (async () => {
            try {
                const module =
                    await import(
                        "../infra/mongo/models/room.model.js"
                    );

                const RoomModel =
                    module.RoomModel;

                if (!RoomModel)
                    throw new Error(
                        "RoomModel export was not found."
                    );

                const documents =
                    await RoomModel.find(
                        {
                            roomId: {
                                $in: normalizedRoomIds
                            }
                        },
                        {
                            _id: 0,
                            roomId: 1,
                            roomName: 1
                        }
                    )
                    .lean()
                    .maxTimeMS(
                        STORED_ROOMS_TIMEOUT_MS
                    );

                const values = {};

                for (const document of documents) {
                    const roomId =
                        String(
                            document?.roomId ?? ""
                        ).trim();

                    const roomName =
                        String(
                            document?.roomName ?? ""
                        ).trim();

                    if (!roomId || !roomName)
                        continue;

                    values[roomId] =
                        roomName;
                }

                storedRoomDisplayNamesCache = {
                    key: cacheKey,
                    values,
                    updatedAt: nowMs()
                };

                return {
                    ...values
                };
            } catch (error) {
                console.warn(
                    "[PublicHealth] MongoDB room display-name read failed.",
                    {
                        error:
                            error?.message ??
                            String(error)
                    }
                );

                return {
                    ...storedRoomDisplayNamesCache.values
                };
            } finally {
                storedRoomDisplayNamesReadPromise =
                    null;
            }
        })();

    return storedRoomDisplayNamesReadPromise;
}

//#endregion Phase 7.L - Stored Room Display Names

async function buildPublicHealthSnapshot(
    getGameServerControl
) {
    const startedAt = nowMs();

    const registeredUsers =
        await readRegisteredUsersSnapshot();

    const storedRooms =
        await readStoredRoomsSnapshot();

    const realtime =
        readRealtimeSnapshot();

    const gameServers =
        readGameServerSnapshot(
            getGameServerControl
        );

    //#region Phase 7.L - Public Lobby Health Monitoring

    const monitoredRooms =
        buildRoomMonitoringSnapshot(
            realtime,
            gameServers
        );

    //#region Phase 7.L - Stored Room Display Names

    /*
     * نام ذخیره شده در MongoDB همان نامی است که کاربر در لیست روم می بیند.
     * roomId فقط برای ارتباط داخلی سرور باقی می ماند.
     */
    const storedRoomDisplayNames =
        await readStoredRoomDisplayNames(
            monitoredRooms.map(
                (room) => room.roomId
            )
        );

    for (const room of monitoredRooms) {
        const storedRoomName =
            String(
                storedRoomDisplayNames[
                    room.roomId
                ] ?? ""
            ).trim();

        if (storedRoomName)
            room.roomName =
                storedRoomName;
    }

    //#endregion Phase 7.L - Stored Room Display Names

    const publicLobby =
        monitoredRooms.find(
            (room) =>
                room.roomId ===
                PUBLIC_LOBBY_ROOM_ID
        ) ?? {
            roomId:
                PUBLIC_LOBBY_ROOM_ID,

            roomName:
                PUBLIC_LOBBY_ROOM_NAME,

            roomType:
                "public_lobby",

            ready:
                false,

            healthStatus:
                "missing_realtime",

            isPermanent:
                true
        };

    //#endregion Phase 7.L - Public Lobby Health Monitoring

    const machineMemory =
        readMachineMemorySnapshot();

    const processMemory =
        process.memoryUsage();

    const loadAverage =
        os.loadavg();

    const degradedReasons = [];

    if (!registeredUsers.available) {
        degradedReasons.push(
            "registered_users_unavailable"
        );
    }

    if (!storedRooms.available) {
        degradedReasons.push(
            "stored_rooms_unavailable"
        );
    }

    if (!realtime.available) {
        degradedReasons.push(
            "realtime_stats_unavailable"
        );
    }

    if (!gameServers.available) {
        degradedReasons.push(
            "game_server_stats_unavailable"
        );
    }

    return {
        success: true,

        status:
            degradedReasons.length === 0
                ? "healthy"
                : "degraded",

        timestamp: nowMs(),

        uptimeSeconds:
            Math.floor(process.uptime()),

        users: {
            registeredTotal:
                registeredUsers.value,

            realtimeOnline:
                realtime.uniqueOnlineUsers,

            realtimeConnections:
                realtime.connectionCount,

            insideRealtimeRooms:
                realtime
                    .usersInsideRealtimeRooms,

            insideGameServers:
                gameServers
                    .insideGameServers
        },

        rooms: {
            /*
             * total تعداد کل اسناد روم در MongoDB است.
             * registeredRealtime شامل روم دائمی خالی نیز می شود.
             * activeRealtime فقط روم های دارای عضو فعال Realtime را می شمارد.
             */
            //#region Phase 7.L - Correct Live Room Total

            /*
             * عدد کل در این بخش فقط روم های زنده موجود در فهرست مانیتورینگ را نشان می دهد.
             * تعداد رکوردهای تاریخی MongoDB جداگانه در storedTotal نگه داری می شود.
             */
            total:
                monitoredRooms.length,

            storedTotal:
                storedRooms.available
                    ? storedRooms.value
                    : null,

            storedTotalSource:
                "mongodb_room_collection",

            //#endregion Phase 7.L - Correct Live Room Total

            registeredRealtime:
                realtime.registeredRooms,

            activeRealtime:
                realtime.activeRooms,

            permanentRealtime:
                realtime.permanentRooms,

            assignedToGameServers:
                gameServers.assignedRooms,

            monitored:
                monitoredRooms.length,

            list:
                monitoredRooms,

            totalSource:
                "live_room_monitoring"
        },

        publicLobby: {
            roomId:
                publicLobby.roomId,

            roomName:
                publicLobby.roomName,

            roomType:
                publicLobby.roomType,

            ready:
                publicLobby.ready === true,

            healthStatus:
                publicLobby.healthStatus,

            isPermanent:
                publicLobby.isPermanent === true,

            realtimeRegistered:
                publicLobby
                    .realtimeRegistered ===
                true,

            realtimeActive:
                publicLobby
                    .realtimeActive ===
                true,

            realtimeUsers:
                publicLobby
                    .realtimeUsers ??
                0,

            realtimeConnections:
                publicLobby
                    .realtimeConnections ??
                0,

            dedicatedAssigned:
                publicLobby
                    .dedicatedAssigned ===
                true,

            dedicatedReported:
                publicLobby
                    .dedicatedReported ===
                true,

            sessionActive:
                publicLobby
                    .sessionActive ===
                true,

            sessionPlayers:
                publicLobby
                    .sessionPlayers ??
                0,

            capacity:
                publicLobby.capacity ??
                100,

            serverId:
                publicLobby.serverId ??
                "",

            region:
                publicLobby.region ??
                "",

            zone:
                publicLobby.zone ??
                ""
        },

        gameServers: {
            total:
                gameServers.total,

            online:
                gameServers.online,

            warm:
                gameServers.warm,

            full:
                gameServers.full,

            busy:
                gameServers.busy,

            starting:
                gameServers.starting,

            draining:
                gameServers.draining,

            offline:
                gameServers.offline,

            unhealthy:
                gameServers.unhealthy,

            healthy:
                gameServers.healthy,

            warning:
                gameServers.warning,

            timeout:
                gameServers.timeout,

            totalCapacity:
                gameServers.totalCapacity,

            reservedPlayers:
                gameServers.reservedPlayers,

            availableReservedSlots:
                gameServers
                    .availableReservedSlots,

            sessions:
                gameServers.sessionCount,

            activeSessions:
                gameServers.activeSessions,

            sessionPlayers:
                gameServers.sessionPlayers
        },

        machine: {
            cpuCores:
                os.cpus().length,

            cpuUsagePercent:
                machineCpuUsagePercent,

            loadAverage1m:
                Number(
                    (loadAverage[0] ?? 0)
                        .toFixed(2)
                ),

            loadAverage5m:
                Number(
                    (loadAverage[1] ?? 0)
                        .toFixed(2)
                ),

            loadAverage15m:
                Number(
                    (loadAverage[2] ?? 0)
                        .toFixed(2)
                ),

            memoryTotalMb:
                toMegabytes(
                    machineMemory.totalBytes
                ),

            memoryUsedMb:
                toMegabytes(
                    machineMemory.usedBytes
                ),

            memoryAvailableMb:
                toMegabytes(
                    machineMemory
                        .availableBytes
                ),

            memoryFreeMb:
                toMegabytes(
                    machineMemory.freeBytes
                ),

            memoryUsagePercent:
                machineMemory
                    .usagePercent,

            uptimeSeconds:
                Math.floor(os.uptime())
        },

        process: {
            pid:
                process.pid,

            nodeVersion:
                process.version,

            cpuUsagePercent:
                processCpuUsagePercent,

            memoryRssMb:
                toMegabytes(
                    processMemory.rss
                ),

            heapTotalMb:
                toMegabytes(
                    processMemory.heapTotal
                ),

            heapUsedMb:
                toMegabytes(
                    processMemory.heapUsed
                ),

            externalMemoryMb:
                toMegabytes(
                    processMemory.external
                ),

            uptimeSeconds:
                Math.floor(process.uptime())
        },

        sources: {
            registeredUsersAvailable:
                registeredUsers.available,

            storedRoomsAvailable:
                storedRooms.available,

            storedRoomsUpdatedAt:
                storedRooms.updatedAt ||
                null,

            roomModelName:
                storedRooms.modelName ||
                null,

            realtimeAvailable:
                realtime.available,

            gameServersAvailable:
                gameServers.available,

            registeredUsersUpdatedAt:
                registeredUsers.updatedAt ||
                null
        },

        degradedReasons,

        responseTimeMs:
            Math.max(
                0,
                nowMs() - startedAt
            )
    };
}

//* این تابع اسنپ شات کامل هلت را با کش کوتاه برمی گرداند تا چند درخواست همزمان دوباره همه منابع را محاسبه نکنند.
async function getPublicHealthSnapshot(
    getGameServerControl
) {
    const currentTime = nowMs();

    if (
        healthSnapshotCache &&
        currentTime - healthSnapshotCacheAt <
            HEALTH_SNAPSHOT_CACHE_MS
    ) {
        return healthSnapshotCache;
    }

    if (healthSnapshotBuildPromise) {
        return healthSnapshotBuildPromise;
    }

    healthSnapshotBuildPromise =
        buildPublicHealthSnapshot(
            getGameServerControl
        );

    try {
        healthSnapshotCache =
            await healthSnapshotBuildPromise;

        healthSnapshotCacheAt =
            nowMs();

        return healthSnapshotCache;
    } finally {
        healthSnapshotBuildPromise = null;
    }
}

//#endregion Public Health Snapshot Builder

//#region Public Health HTTP Wrapper

//* این تابع فقط درخواست عمومی مسیر هلت را پردازش می کند و برای همه مسیرهای دیگر مقدار فالس برمی گرداند تا مسیر اصلی سرور ادامه پیدا کند.
async function tryHandlePublicHealthRequest(
    req,
    res,
    options = {}
) {
    const requestPath =
        readRequestPath(req);

    if (
        requestPath !==
        PUBLIC_HEALTH_PATH
    ) {
        return false;
    }

    const method =
        String(
            req?.method || "GET"
        ).toUpperCase();

    if (
        method !== "GET" &&
        method !== "HEAD"
    ) {
        sendJson(
            res,
            405,
            {
                success: false,
                status: "error",
                timestamp: nowMs(),
                error:
                    "method_not_allowed"
            },
            method,
            {
                Allow: "GET, HEAD"
            }
        );

        return true;
    }

    ensureCpuSamplerStarted();

    try {
        const snapshot =
            await getPublicHealthSnapshot(
                options
                    .getGameServerControl
            );

        if (shouldRenderHealthHtml(req)) {
            sendHtml(
                res,
                200,
                buildPublicHealthDashboardHtml(
                    snapshot
                ),
                method
            );
        } else {
            sendJson(
                res,
                200,
                snapshot,
                method
            );
        }

        return true;
    } catch (error) {
        console.error(
            "[PublicHealth] endpoint failed",
            {
                error:
                    error?.stack ??
                    error?.message ??
                    String(error)
            }
        );

        sendJson(
            res,
            500,
            {
                success: false,
                status: "error",
                timestamp: nowMs(),
                error:
                    "health_snapshot_failed"
            },
            method
        );

        return true;
    }
}

//#endregion Public Health HTTP Wrapper

export {
    registerPublicHealthClientsRegistry,
    registerPublicHealthRoomManager,
    tryHandlePublicHealthRequest
};

/*
توضیح کلی اسکریپت:

این فایل ورپر کامل مانیتورینگ عمومی سرور است.

تمام منطق مسیر Health، شمارش کاربران، شمارش روم های فعال،
وضعیت Game Serverها، مصرف CPU و مصرف RAM داخل همین فایل قرار دارد.

فایل اصلی src/index.js هیچ تغییری نمی کند و هیچ تابع مانیتورینگ
داخل آن نوشته نمی شود.

ClientsRegistry و RoomManager فقط آبجکت واقعی خود را به این ورپر
معرفی می کنند و هیچ منطق Health داخل آن فایل ها نوشته نمی شود.

GameServerControlRawHttpAdapter نیز فقط درخواست را ابتدا به این
ورپر تحویل می دهد. اگر مسیر درخواست /health نباشد، مسیر قبلی
Game Server Control بدون تغییر ادامه پیدا می کند.
*/
