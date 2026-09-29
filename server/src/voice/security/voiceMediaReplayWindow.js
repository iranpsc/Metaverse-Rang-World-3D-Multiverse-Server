const VoiceMediaReplayDecision = Object.freeze({
    ACCEPTED: "accepted",
    INVALID_SEQUENCE: "invalid_sequence",
    DUPLICATE: "duplicate",
    TOO_OLD: "too_old",
    AMBIGUOUS: "ambiguous"
});

function normalizeSequence(value) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 0xffffffff) return null;
    return value >>> 0;
}

function createVoiceMediaReplayWindow({ windowSize = 64 } = {}) {
    if (!Number.isInteger(windowSize) || windowSize < 32 || windowSize > 256) throw new RangeError("windowSize must be between 32 and 256.");
    const windowMask = (1n << BigInt(windowSize)) - 1n;
    let highestSequence = null;
    let receivedBitmap = 0n;
    let acceptedPackets = 0;
    let duplicatePackets = 0;
    let stalePackets = 0;
    let invalidPackets = 0;

    function accept(sequence) {
        const current = normalizeSequence(sequence);
        if (current === null) {
            invalidPackets += 1;
            return Object.freeze({ accepted: false, reason: VoiceMediaReplayDecision.INVALID_SEQUENCE });
        }

        if (highestSequence === null) {
            highestSequence = current;
            receivedBitmap = 1n;
            acceptedPackets += 1;
            return Object.freeze({ accepted: true, reason: VoiceMediaReplayDecision.ACCEPTED });
        }

        const forwardDistance = (current - highestSequence) >>> 0;
        if (forwardDistance === 0) {
            duplicatePackets += 1;
            return Object.freeze({ accepted: false, reason: VoiceMediaReplayDecision.DUPLICATE });
        }

        if (forwardDistance < 0x80000000) {
            receivedBitmap = forwardDistance >= windowSize ? 1n : ((receivedBitmap << BigInt(forwardDistance)) | 1n) & windowMask;
            highestSequence = current;
            acceptedPackets += 1;
            return Object.freeze({ accepted: true, reason: VoiceMediaReplayDecision.ACCEPTED });
        }

        const backwardDistance = (highestSequence - current) >>> 0;
        if (backwardDistance >= 0x80000000) {
            stalePackets += 1;
            return Object.freeze({ accepted: false, reason: VoiceMediaReplayDecision.AMBIGUOUS });
        }
        if (backwardDistance >= windowSize) {
            stalePackets += 1;
            return Object.freeze({ accepted: false, reason: VoiceMediaReplayDecision.TOO_OLD });
        }

        const bit = 1n << BigInt(backwardDistance);
        if ((receivedBitmap & bit) !== 0n) {
            duplicatePackets += 1;
            return Object.freeze({ accepted: false, reason: VoiceMediaReplayDecision.DUPLICATE });
        }

        receivedBitmap |= bit;
        acceptedPackets += 1;
        return Object.freeze({ accepted: true, reason: VoiceMediaReplayDecision.ACCEPTED });
    }

    function reset() {
        highestSequence = null;
        receivedBitmap = 0n;
    }

    function getStats() {
        return Object.freeze({ windowSize, highestSequence, acceptedPackets, duplicatePackets, stalePackets, invalidPackets });
    }

    return Object.freeze({ accept, reset, getStats });
}

export {
    VoiceMediaReplayDecision,
    createVoiceMediaReplayWindow
};
