//* این تابع پاسخ JSON عملیاتی را بدون Cache می‌نویسد.
function writeOperationalJson(response, statusCode, body) {
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": payload.length,
        "Cache-Control": "no-store"
    });
    response.end(payload);
}

//* این تابع Health عمومی محدود و Metrics محافظت‌شده Voice را برای HTTP اصلی می‌سازد.
function createVoiceOperationalHttpHandler({
    getHealthSnapshot,
    getMetricsSnapshot,
    authorizeMetricsRequest = async () => false
} = {}) {
    if (typeof getHealthSnapshot !== "function" || typeof getMetricsSnapshot !== "function")
        throw new TypeError("Voice operational snapshot providers are required.");
    if (typeof authorizeMetricsRequest !== "function")
        throw new TypeError("authorizeMetricsRequest must be a function.");

    return async function handleVoiceOperationalHttp(request, response) {
        const path = new URL(String(request?.url ?? "/"), "http://127.0.0.1").pathname;
        if (path !== "/voice/health" && path !== "/voice/metrics") return false;

        if (request.method !== "GET") {
            writeOperationalJson(response, 405, { success: false, reason: "method_not_allowed" });
            return true;
        }

        if (path === "/voice/health") {
            const health = await getHealthSnapshot();
            writeOperationalJson(response, health?.healthy === false ? 503 : 200, {
                success: health?.healthy !== false,
                voice: health
            });
            return true;
        }

        if (await authorizeMetricsRequest(request) !== true) {
            writeOperationalJson(response, 403, { success: false, reason: "voice_metrics_forbidden" });
            return true;
        }

        writeOperationalJson(response, 200, {
            success: true,
            voice: await getMetricsSnapshot()
        });
        return true;
    };
}

export { createVoiceOperationalHttpHandler };

/*
توضیح فایل:
این فایل Health محدود عمومی و Metrics دارای Authorizer صریح را روی HTTP اصلی ارائه می‌کند و هیچ Token یا داده صوتی را در پاسخ قرار نمی‌دهد.
*/
