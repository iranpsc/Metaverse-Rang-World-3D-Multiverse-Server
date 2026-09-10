// File => src/shutdown.js

import logger from "./utils/logger.js";

//* این تابع سرور جی آر پی سی را به شکل امن متوقف می کند تا کال های فعال فرصت بسته شدن داشته باشند.
function closeGrpcServer(grpcServer) {
    return new Promise((resolve) => {
        if (!grpcServer) {
            resolve();
            return;
        }

        grpcServer.tryShutdown((err) => {
            if (err) logger.error("gRPC shutdown error", { err: String(err) });
            else logger.info("gRPC server stopped.");
            resolve();
        });
    });
}

//* این تابع سرور اچ تی تی پی و مسیر وب سوکت را به شکل امن می بندد.
function closeHttpServer(httpServer) {
    return new Promise((resolve) => {
        if (!httpServer) {
            resolve();
            return;
        }

        httpServer.close((err) => {
            if (err) logger.error("HTTP server shutdown error", { err: String(err) });
            else logger.info("HTTP/WebSocket server stopped.");
            resolve();
        });
    });
}

//* این تابع رانتایم ریل تایم را متوقف می کند تا ترنسپورت، کانکشن ها، اَک ترَکِر و تایمرها تمیز بسته شوند.
function closeRealtimeRuntime(realtimeRuntime) {
    try {
        realtimeRuntime?.stop?.();
        logger.info("Realtime runtime stopped.");
    } catch (err) {
        logger.error("Realtime runtime shutdown error", { err: String(err?.stack || err) });
    }
}

//* این تابع سیگنال های خروج را ثبت می کند و خاموش شدن امن ریل تایم، اچ تی تی پی و جی آر پی سی را اجرا می کند.
export function setupGracefulShutdown({ grpcServer, httpServer, realtimeRuntime = null }) {
    let isShuttingDown = false;

    async function shutdown(signal) {
        if (isShuttingDown) {
            logger.warn(`Shutdown already in progress. Ignoring ${signal}.`);
            return;
        }

        isShuttingDown = true;
        logger.warn(`Received ${signal}, shutting down...`);

        const shutdownTimeout = new Promise((resolve) => {
            setTimeout(() => {
                logger.error("Shutdown timeout reached. Forcing exit.");
                resolve("timeout");
            }, 10000);
        });

        const shutdownSequence = (async () => {
            closeRealtimeRuntime(realtimeRuntime);
            await closeHttpServer(httpServer);
            await closeGrpcServer(grpcServer);
            return "done";
        })();

        const result = await Promise.race([shutdownSequence, shutdownTimeout]);

        if (result === "timeout") {
            process.exit(1);
            return;
        }

        logger.info("Graceful shutdown completed.");
        process.exit(0);
    }

    process.on("SIGINT", () => {
        shutdown("SIGINT");
    });

    process.on("SIGTERM", () => {
        shutdown("SIGTERM");
    });
}

/*
توضیح کلی اسکریپت:
این فایل مسئول خاموش شدن امن سرور هنگام خروج برنامه است.
در این نسخه، رانتایم ریل تایم هم قبل از بستن سرور اچ تی تی پی متوقف می شود تا ترنسپورت، کانکشن ها، اَک ترَکِر و تایمرها باز نمانند.
بعد از توقف ریل تایم، سرور اچ تی تی پی و سپس سرور جی آر پی سی بسته می شوند.
برای جلوگیری از گیر کردن برنامه، یک تایم آوت ده ثانیه ای وجود دارد.
این فایل نباید لاجیک آث، رُتِر، ترنسپورت خام یا بازی اجرا کند.
وظیفه این فایل فقط اجرای خاموش شدن امن سرویس های ساخته شده در بوت استرپ است.
*/
