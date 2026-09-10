// File => src/realTime/transport/grpcStreaming/inspectGrpcRealtimeCoreExports.js

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const DEFAULT_TARGET_FILES = [
    "src/realTime/index.js",
    "src/realTime/core/realtimeServer.js",
    "src/realTime/core/realtimeConnection.js",
    "src/realTime/core/realtimeContext.js",
    "src/realTime/transport/websocket/websocketTransport.js",
    "src/realTime/router/realtimeRouter.js",
    "src/realTime/router/systemRoutes.js",
    "src/realTime/router/presenceRoutes.js",
    "src/realTime/router/gameRoutes.js",
    "src/realTime/rooms/roomManager.js",
    "src/realTime/clients/clientsRegistry.js"
];

//* این تابع لاگ ساده با پیشوند مشخص برای بازرسی مسیر جی‌آر‌پی‌سی چاپ می‌کند.
function logInspect(message, data = {}) {
    console.log("[G8-CoreInspect]", message, data);
}

//* این تابع لاگ خطای ساده با پیشوند مشخص برای بازرسی مسیر جی‌آر‌پی‌سی چاپ می‌کند.
function logInspectError(message, data = {}) {
    console.error("[G8-CoreInspect][ERROR]", message, data);
}

//* این تابع مسیر کامل فایل را از روی ریشه اجرای پروژه می‌سازد.
function resolveProjectFilePath(filePath) {
    return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

//* این تابع بررسی می‌کند فایل هدف در پروژه وجود دارد یا نه.
function fileExists(filePath) {
    return fs.existsSync(resolveProjectFilePath(filePath));
}

//* این تابع نام‌های export شده از یک ماژول را بدون تغییر دادن فایل اصلی می‌خواند.
async function readModuleExports(filePath) {
    const absolutePath = resolveProjectFilePath(filePath);

    if (!fs.existsSync(absolutePath)) {
        return {
            filePath,
            exists: false,
            exports: [],
            error: ""
        };
    }

    try {
        const fileUrl = pathToFileURL(absolutePath).href;
        const moduleExports = await import(fileUrl);
        const exportNames = Object.keys(moduleExports).sort();

        return {
            filePath,
            exists: true,
            exports: exportNames,
            error: ""
        };
    } catch (error) {
        return {
            filePath,
            exists: true,
            exports: [],
            error: error?.message ?? String(error)
        };
    }
}

//* این تابع همه فایل‌های هدف ریل‌تایم را بررسی می‌کند و exportهای قابل استفاده را گزارش می‌دهد.
async function inspectGrpcRealtimeCoreExports(targetFiles = DEFAULT_TARGET_FILES) {
    const results = [];

    logInspect("Grpc realtime core export inspection started", {
        targetCount: targetFiles.length
    });

    for (const filePath of targetFiles) {
        const result = await readModuleExports(filePath);
        results.push(result);

        if (!result.exists) {
            logInspect("File not found", {
                filePath: result.filePath
            });
            continue;
        }

        if (result.error) {
            logInspectError("File import failed", {
                filePath: result.filePath,
                error: result.error
            });
            continue;
        }

        logInspect("File exports inspected", {
            filePath: result.filePath,
            exports: result.exports
        });
    }

    const existingCount = results.filter((item) => item.exists).length;
    const importedCount = results.filter((item) => item.exists && !item.error).length;
    const failedCount = results.filter((item) => item.exists && item.error).length;

    logInspect("Grpc realtime core export inspection finished", {
        existingCount,
        importedCount,
        failedCount,
        totalCount: results.length
    });

    return results;
}

//* این تابع خط فرمان بازرسی را اجرا می‌کند و نتیجه نهایی را به پروسه اعلام می‌کند.
async function main() {
    try {
        await inspectGrpcRealtimeCoreExports();
        process.exitCode = 0;
    } catch (error) {
        logInspectError("Grpc realtime core export inspection crashed", {
            error: error?.message ?? String(error)
        });
        process.exitCode = 1;
    }
}

main();

//* توضیح کلی فایل:
//* این فایل فقط برای بازرسی exportهای فایل‌های واقعی ریل‌تایم ساخته شده است.
//* هدف این است که قبل از وصل کردن جی‌آر‌پی‌سی به کُر واقعی، نام دقیق تابع‌ها و ماژول‌های قابل استفاده مشخص شود.
//* این فایل هیچ فایل قبلی را تغییر نمی‌دهد.
//* این فایل سرور اصلی را اجرا نمی‌کند و فقط importهای قابل بررسی را گزارش می‌دهد.
//* خروجی این فایل مبنای ساخت اتصال واقعی gRPC به Realtime Core خواهد بود.

export {
    inspectGrpcRealtimeCoreExports,
    readModuleExports,
    resolveProjectFilePath,
    fileExists
};
