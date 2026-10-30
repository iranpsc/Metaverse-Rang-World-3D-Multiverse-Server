function nextPowerOfTwo(value) {
    let result = 1;
    const target = Math.max(1, Math.ceil(Number(value) || 1));
    while (result < target) result <<= 1;
    return result;
}

function fftInPlace(real, imag, inverse = false) {
    const n = real.length;
    if (imag.length !== n || n < 1 || (n & (n - 1)) !== 0) {
        throw new TypeError("FFT arrays must have the same power-of-two length.");
    }

    for (let i = 1, j = 0; i < n; i += 1) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            const tr = real[i]; real[i] = real[j]; real[j] = tr;
            const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
        }
    }

    for (let length = 2; length <= n; length <<= 1) {
        const angle = (inverse ? 2 : -2) * Math.PI / length;
        const wLengthReal = Math.cos(angle);
        const wLengthImag = Math.sin(angle);
        const half = length >> 1;

        for (let offset = 0; offset < n; offset += length) {
            let wReal = 1;
            let wImag = 0;
            for (let j = 0; j < half; j += 1) {
                const even = offset + j;
                const odd = even + half;
                const oddReal = real[odd] * wReal - imag[odd] * wImag;
                const oddImag = real[odd] * wImag + imag[odd] * wReal;
                const evenReal = real[even];
                const evenImag = imag[even];
                real[even] = evenReal + oddReal;
                imag[even] = evenImag + oddImag;
                real[odd] = evenReal - oddReal;
                imag[odd] = evenImag - oddImag;
                const nextWReal = wReal * wLengthReal - wImag * wLengthImag;
                wImag = wReal * wLengthImag + wImag * wLengthReal;
                wReal = nextWReal;
            }
        }
    }

    if (inverse) {
        for (let index = 0; index < n; index += 1) {
            real[index] /= n;
            imag[index] /= n;
        }
    }
}

export { nextPowerOfTwo, fftInPlace };
