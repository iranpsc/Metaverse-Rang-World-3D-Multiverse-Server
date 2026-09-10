const OGG_CRC_POLYNOMIAL = 0x04c11db7;

//* این تابع CRC استاندارد صفحه Ogg را محاسبه می‌کند.
function calculateOggCrc(buffer) {
    let crc = 0;

    for (const byte of buffer) {
        crc ^= byte << 24;

        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc & 0x80000000) !== 0
                ? ((crc << 1) ^ OGG_CRC_POLYNOMIAL)
                : (crc << 1);
            crc >>>= 0;
        }
    }

    return crc >>> 0;
}

//* این تابع جدول Lacing یک بسته Ogg را می‌سازد.
function createOggLacing(packetLength) {
    if (
        !Number.isSafeInteger(packetLength) ||
        packetLength < 0
    ) {
        throw new RangeError("Ogg packet length is invalid.");
    }

    const values = [];
    let remaining = packetLength;

    while (remaining >= 255) {
        values.push(255);
        remaining -= 255;
    }

    values.push(remaining);

    if (values.length > 255) {
        throw new RangeError("Ogg packet requires too many segments.");
    }

    return Buffer.from(values);
}

//* این تابع یک صفحه Ogg کامل با CRC معتبر می‌سازد.
function createOggPage({
    serialNumber,
    pageSequence,
    granulePosition,
    packet = Buffer.alloc(0),
    beginningOfStream = false,
    endOfStream = false
} = {}) {
    if (!Buffer.isBuffer(packet)) {
        throw new TypeError("Ogg packet must be a Buffer.");
    }

    const lacing = createOggLacing(packet.length);
    const header = Buffer.alloc(27 + lacing.length);
    header.write("OggS", 0, "ascii");
    header.writeUInt8(0, 4);

    let headerType = 0;
    if (beginningOfStream) headerType |= 2;
    if (endOfStream) headerType |= 4;
    header.writeUInt8(headerType, 5);
    header.writeBigUInt64LE(BigInt(granulePosition), 6);
    header.writeUInt32LE(serialNumber >>> 0, 14);
    header.writeUInt32LE(pageSequence >>> 0, 18);
    header.writeUInt32LE(0, 22);
    header.writeUInt8(lacing.length, 26);
    lacing.copy(header, 27);

    const page = Buffer.concat([header, packet]);
    page.writeUInt32LE(calculateOggCrc(page), 22);
    return page;
}

//* این تابع سربرگ OpusHead تک‌کاناله را می‌سازد.
function createOpusHead() {
    const packet = Buffer.alloc(19);
    packet.write("OpusHead", 0, "ascii");
    packet.writeUInt8(1, 8);
    packet.writeUInt8(1, 9);
    packet.writeUInt16LE(312, 10);
    packet.writeUInt32LE(48000, 12);
    packet.writeInt16LE(0, 16);
    packet.writeUInt8(0, 18);
    return packet;
}

//* این تابع سربرگ OpusTags را بدون داده شخصی می‌سازد.
function createOpusTags() {
    const vendor = Buffer.from("Metaverse Voice", "utf8");
    const packet = Buffer.alloc(16 + vendor.length);
    packet.write("OpusTags", 0, "ascii");
    packet.writeUInt32LE(vendor.length, 8);
    vendor.copy(packet, 12);
    packet.writeUInt32LE(0, 12 + vendor.length);
    return packet;
}

class VoiceOggOpusStreamState {
    //* این سازنده شماره سریال و شمارنده‌های یک Logical Stream اوپوس را نگه می‌دارد.
    constructor(serialNumber) {
        this.serialNumber = serialNumber >>> 0;
        this.pageSequence = 0;
        this.granulePosition = 0n;
    }

    //* این تابع دو صفحه آغازین Opus را برای Logical Stream می‌سازد.
    createHeaders() {
        const head = createOggPage({
            serialNumber: this.serialNumber,
            pageSequence: this.pageSequence++,
            granulePosition: 0n,
            packet: createOpusHead(),
            beginningOfStream: true
        });

        const tags = createOggPage({
            serialNumber: this.serialNumber,
            pageSequence: this.pageSequence++,
            granulePosition: 0n,
            packet: createOpusTags()
        });

        return [head, tags];
    }

    //* این تابع یک فریم بیست میلی‌ثانیه‌ای اوپوس را به صفحه مستقل تبدیل می‌کند.
    createFrame(packet) {
        this.granulePosition += 960n;
        return createOggPage({
            serialNumber: this.serialNumber,
            pageSequence: this.pageSequence++,
            granulePosition: this.granulePosition,
            packet
        });
    }

    //* این تابع صفحه پایان Logical Stream را می‌سازد.
    createEnd() {
        return createOggPage({
            serialNumber: this.serialNumber,
            pageSequence: this.pageSequence++,
            granulePosition: this.granulePosition,
            packet: Buffer.alloc(0),
            endOfStream: true
        });
    }
}

export {
    VoiceOggOpusStreamState,
    calculateOggCrc,
    createOggPage,
    createOpusHead,
    createOpusTags
};

/*
توضیح فایل:
این فایل فریم‌های Opus تک‌کاناله را بدون Decode یا Encode به Logical Streamهای استاندارد Ogg Opus تبدیل می‌کند و CRC هر صفحه را می‌سازد.
*/
