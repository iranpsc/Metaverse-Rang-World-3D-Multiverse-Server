import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const runners = [
    "runVoiceProtocolV1Tests.js",
    "runVoiceTransportFoundationTests.js",
    "runVoiceV3AuthorityTests.js",
    "runVoiceV4Tests.js",
    "runVoiceV5Tests.js",
    "runVoiceV7Tests.js",
    "runVoiceV8Tests.js",
    "voiceProductionCompositionV9.test.js"
];

for (const runner of runners) {
    const path = fileURLToPath(new URL(`./${runner}`, import.meta.url));
    const result = spawnSync(process.execPath, [path], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: process.env
    });

    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    if (result.status !== 0) {
        throw new Error(`Voice roadmap runner failed: ${runner} (exit ${result.status}).`);
    }
}

console.log("VOICE_F_V3_TO_V9_NODE_ALL_TESTS=PASS");

/*
توضیح فایل:
این فایل همه قراردادها و تست‌های Node فاز Voice را در Processهای جدا اجرا می‌کند تا تنها فرمان نهایی پیش از Restart باشد.
*/
