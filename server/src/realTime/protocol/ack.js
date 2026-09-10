// File => src/realTime/protocol/ack.js

import { Channels } from "./channels.js";
import { MessageTypes } from "./messageTypes.js";

const AckStatus = Object.freeze({
    received: "received",
    processed: "processed",
    failed: "failed",
    timeout: "timeout"
});

//* این تابع پیلود پیام اک را می سازد تا مشخص شود پیام اصلی دریافت، پردازش، رد یا تایم اوت شده است.
function makeAckPayload(originalMessageId, status = AckStatus.received, details = null) {
    return { originalMessageId, status, details };
}

//* این تابع بررسی می کند که آیا انولوپ دریافتی یک پیام اک سیستمی است یا نه.
function isAckEnvelope(env) {
    return env?.ch === Channels.system && env?.t === MessageTypes.system.ack;
}

/*
توضیح کلی اسکریپت:
این فایل وضعیت ها و ابزارهای پایه ACK را برای سیستم Realtime تعریف می کند.
ACK برای تأیید دریافت یا پردازش پیام های مهم استفاده می شود.
این فایل خودش پیام کامل Realtime نمی سازد، بلکه فقط Payload مخصوص ACK را تولید می کند.
پیام کامل ACK در envelope.js ساخته می شود تا داخل قالب استاندارد Envelope قرار بگیرد.
*/

export { AckStatus, makeAckPayload, isAckEnvelope };