import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fftInPlace } from "./voiceHrtfFft.js";

const MAGIC = "VMEHRTF1";
const HEADER_BYTES = 24;

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function toUnitVector(azimuthDegrees, elevationDegrees) {
    const azimuth = finite(azimuthDegrees) * Math.PI / 180;
    const elevation = finite(elevationDegrees) * Math.PI / 180;
    const horizontal = Math.cos(elevation);
    return Object.freeze({
        x: horizontal * Math.cos(azimuth),
        y: horizontal * Math.sin(azimuth),
        z: Math.sin(elevation)
    });
}

class VoiceHrtfDatasetStore {
    constructor({ sampleRate, positions, leftIr, rightIr, irLength, sourceSha256 = "" }) {
        this.sampleRate = sampleRate;
        this.positions = positions;
        this.leftIr = leftIr;
        this.rightIr = rightIr;
        this.irLength = irLength;
        this.measurementCount = positions.length / 3;
        this.sourceSha256 = sourceSha256;
        this.unitVectors = new Float32Array(this.measurementCount * 3);
        this.spectralBanks = new Map();

        for (let index = 0; index < this.measurementCount; index += 1) {
            const vector = toUnitVector(positions[index * 3], positions[index * 3 + 1]);
            this.unitVectors[index * 3] = vector.x;
            this.unitVectors[index * 3 + 1] = vector.y;
            this.unitVectors[index * 3 + 2] = vector.z;
        }
    }

    static async fromFile(path) {
        const buffer = await readFile(path);
        if (buffer.length < HEADER_BYTES || buffer.subarray(0, 8).toString("ascii") !== MAGIC) {
            throw new Error("Invalid VME HRTF dataset magic.");
        }

        const version = buffer.readUInt32LE(8);
        const sampleRate = buffer.readUInt32LE(12);
        const measurementCount = buffer.readUInt32LE(16);
        const irLength = buffer.readUInt32LE(20);
        if (version !== 1 || !sampleRate || !measurementCount || !irLength) {
            throw new Error("Unsupported or invalid VME HRTF dataset header.");
        }

        const positionFloatCount = measurementCount * 3;
        const irFloatCount = measurementCount * irLength;
        const expectedBytes = HEADER_BYTES + (positionFloatCount + irFloatCount * 2) * 4;
        if (buffer.length !== expectedBytes) {
            throw new Error(`VME HRTF dataset size mismatch: expected ${expectedBytes}, got ${buffer.length}.`);
        }

        let offset = HEADER_BYTES;
        const positions = new Float32Array(positionFloatCount);
        for (let i = 0; i < positionFloatCount; i += 1, offset += 4) positions[i] = buffer.readFloatLE(offset);
        const leftIr = new Float32Array(irFloatCount);
        for (let i = 0; i < irFloatCount; i += 1, offset += 4) leftIr[i] = buffer.readFloatLE(offset);
        const rightIr = new Float32Array(irFloatCount);
        for (let i = 0; i < irFloatCount; i += 1, offset += 4) rightIr[i] = buffer.readFloatLE(offset);

        return new VoiceHrtfDatasetStore({
            sampleRate,
            positions,
            leftIr,
            rightIr,
            irLength,
            sourceSha256: createHash("sha256").update(buffer).digest("hex")
        });
    }

    buildSpectralBank(fftSize) {
        const normalizedFftSize = Number(fftSize);
        const cached = this.spectralBanks.get(normalizedFftSize);
        if (cached) return cached;
        if (!Number.isInteger(normalizedFftSize) || normalizedFftSize < this.irLength || (normalizedFftSize & (normalizedFftSize - 1)) !== 0) {
            throw new TypeError("HRTF FFT size must be a power of two not smaller than the IR length.");
        }

        const total = this.measurementCount * normalizedFftSize;
        const leftReal = new Float32Array(total);
        const leftImag = new Float32Array(total);
        const rightReal = new Float32Array(total);
        const rightImag = new Float32Array(total);

        for (let measurement = 0; measurement < this.measurementCount; measurement += 1) {
            const lr = new Float64Array(normalizedFftSize);
            const li = new Float64Array(normalizedFftSize);
            const rr = new Float64Array(normalizedFftSize);
            const ri = new Float64Array(normalizedFftSize);
            const irOffset = measurement * this.irLength;
            for (let tap = 0; tap < this.irLength; tap += 1) {
                lr[tap] = this.leftIr[irOffset + tap];
                rr[tap] = this.rightIr[irOffset + tap];
            }
            fftInPlace(lr, li, false);
            fftInPlace(rr, ri, false);
            const spectrumOffset = measurement * normalizedFftSize;
            for (let bin = 0; bin < normalizedFftSize; bin += 1) {
                leftReal[spectrumOffset + bin] = lr[bin];
                leftImag[spectrumOffset + bin] = li[bin];
                rightReal[spectrumOffset + bin] = rr[bin];
                rightImag[spectrumOffset + bin] = ri[bin];
            }
        }

        const bank = Object.freeze({
            fftSize: normalizedFftSize,
            leftReal,
            leftImag,
            rightReal,
            rightImag
        });
        this.spectralBanks.set(normalizedFftSize, bank);
        return bank;
    }
}

export { MAGIC, VoiceHrtfDatasetStore };
