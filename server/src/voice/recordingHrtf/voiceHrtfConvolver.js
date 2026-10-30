import { fftInPlace, nextPowerOfTwo } from "./voiceHrtfFft.js";

class VoiceHrtfConvolver {
    constructor({ dataset, frameSize, smoothingMs = 35, frameDurationMs = 20 } = {}) {
        if (!dataset?.irLength) throw new TypeError("VoiceHrtfConvolver requires a HRTF dataset.");
        this.dataset = dataset;
        this.frameSize = Math.max(1, Number(frameSize) || 960);
        this.overlapLength = Math.max(0, dataset.irLength - 1);
        this.fftSize = nextPowerOfTwo(this.frameSize + this.overlapLength);
        this.bank = dataset.buildSpectralBank(this.fftSize);
        this.inputOverlap = new Float64Array(this.overlapLength);
        this.currentLeftReal = new Float64Array(this.fftSize);
        this.currentLeftImag = new Float64Array(this.fftSize);
        this.currentRightReal = new Float64Array(this.fftSize);
        this.currentRightImag = new Float64Array(this.fftSize);
        this.hasFilter = false;
        const tau = Math.max(1, Number(smoothingMs) || 35);
        this.smoothingAlpha = 1 - Math.exp(-Math.max(1, Number(frameDurationMs) || 20) / tau);
    }

    #updateFilter(selection) {
        const { leftReal, leftImag, rightReal, rightImag } = this.bank;
        const alpha = this.hasFilter ? this.smoothingAlpha : 1;
        const keep = 1 - alpha;
        for (let bin = 0; bin < this.fftSize; bin += 1) {
            let tlr = 0, tli = 0, trr = 0, tri = 0;
            for (const neighbor of selection.neighbors) {
                const offset = neighbor.index * this.fftSize + bin;
                const weight = neighbor.weight;
                tlr += leftReal[offset] * weight;
                tli += leftImag[offset] * weight;
                trr += rightReal[offset] * weight;
                tri += rightImag[offset] * weight;
            }
            this.currentLeftReal[bin] = this.currentLeftReal[bin] * keep + tlr * alpha;
            this.currentLeftImag[bin] = this.currentLeftImag[bin] * keep + tli * alpha;
            this.currentRightReal[bin] = this.currentRightReal[bin] * keep + trr * alpha;
            this.currentRightImag[bin] = this.currentRightImag[bin] * keep + tri * alpha;
        }
        this.hasFilter = true;
    }

    process(input, selection, gain = 1) {
        const count = input.length;
        if (!count) return new Float32Array(0);
        this.#updateFilter(selection);

        const xr = new Float64Array(this.fftSize);
        const xi = new Float64Array(this.fftSize);
        for (let i = 0; i < this.overlapLength; i += 1) xr[i] = this.inputOverlap[i];
        for (let i = 0; i < count; i += 1) xr[this.overlapLength + i] = input[i];
        fftInPlace(xr, xi, false);

        const leftReal = new Float64Array(this.fftSize);
        const leftImag = new Float64Array(this.fftSize);
        const rightReal = new Float64Array(this.fftSize);
        const rightImag = new Float64Array(this.fftSize);

        for (let bin = 0; bin < this.fftSize; bin += 1) {
            const ar = xr[bin], ai = xi[bin];
            const blr = this.currentLeftReal[bin], bli = this.currentLeftImag[bin];
            const brr = this.currentRightReal[bin], bri = this.currentRightImag[bin];
            leftReal[bin] = ar * blr - ai * bli;
            leftImag[bin] = ar * bli + ai * blr;
            rightReal[bin] = ar * brr - ai * bri;
            rightImag[bin] = ar * bri + ai * brr;
        }
        fftInPlace(leftReal, leftImag, true);
        fftInPlace(rightReal, rightImag, true);

        const output = new Float32Array(count * 2);
        const scalar = Number.isFinite(Number(gain)) ? Number(gain) : 1;
        for (let i = 0; i < count; i += 1) {
            output[i * 2] = leftReal[this.overlapLength + i] * scalar;
            output[i * 2 + 1] = rightReal[this.overlapLength + i] * scalar;
        }

        if (this.overlapLength > 0) {
            if (count >= this.overlapLength) {
                for (let i = 0; i < this.overlapLength; i += 1) this.inputOverlap[i] = input[count - this.overlapLength + i];
            } else {
                const shift = this.overlapLength - count;
                this.inputOverlap.copyWithin(0, count);
                for (let i = 0; i < count; i += 1) this.inputOverlap[shift + i] = input[i];
            }
        }
        return output;
    }
}

export { VoiceHrtfConvolver };
