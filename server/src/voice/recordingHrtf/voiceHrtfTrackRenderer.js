import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { VoiceSpatialPerspectiveResolver } from "../recordingSpatial/voiceSpatialPerspectiveResolver.js";
import { resolveDistanceGain } from "../recordingSpatial/voiceSpatialRenderPolicy.js";
import { createVoiceHrtfRenderPolicy } from "./voiceHrtfRenderPolicy.js";
import { VoiceHrtfDirectionResolver } from "./voiceHrtfDirectionResolver.js";
import { VoiceHrtfConvolver } from "./voiceHrtfConvolver.js";

function appendBoundedText(current, chunk, maximum = 65536) {
    const next = current + String(chunk ?? "");
    return next.length > maximum ? next.slice(next.length - maximum) : next;
}

async function writeWithBackpressure(writable, buffer) {
    if (writable.destroyed || writable.writableEnded) throw new Error("HRTF renderer encoder stdin is not writable.");
    if (writable.write(buffer)) return;
    await once(writable, "drain");
}

function float32ToBuffer(values) {
    return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
}

function bufferToFloat32(buffer) {
    if (buffer.byteLength % 4 !== 0) throw new Error("Decoded PCM is not Float32 aligned.");
    return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

function duplicateMono(input) {
    const output = new Float32Array(input.length * 2);
    for (let i = 0; i < input.length; i += 1) {
        output[i * 2] = input[i];
        output[i * 2 + 1] = input[i];
    }
    return output;
}

class VoiceHrtfTrackRenderer {
    constructor({ sampler, dataset, policy = null } = {}) {
        if (!sampler?.sampleUser) throw new TypeError("VoiceHrtfTrackRenderer requires a timeline sampler.");
        if (!dataset?.measurementCount) throw new TypeError("VoiceHrtfTrackRenderer requires a HRTF dataset.");
        this.sampler = sampler;
        this.dataset = dataset;
        this.policy = createVoiceHrtfRenderPolicy(policy ?? {});
        if (dataset.sampleRate !== this.policy.sampleRate) {
            throw new Error(`HRTF dataset sample rate ${dataset.sampleRate} does not match render sample rate ${this.policy.sampleRate}.`);
        }
        this.perspectiveResolver = new VoiceSpatialPerspectiveResolver(sampler);
        this.directionResolver = new VoiceHrtfDirectionResolver(dataset, { neighbors: this.policy.interpolationNeighbors });
    }

    async render({ inputPath, outputPath, listenerUserId, speakerUserId, durationMs = null, mutedIntervals = null } = {}) {
        if (!inputPath || !outputPath || !listenerUserId || !speakerUserId) throw new TypeError("HRTF track render input/output/listener/speaker are required.");
        await mkdir(dirname(outputPath), { recursive: true });

        const decoder = spawn(this.policy.ffmpegPath, [
            "-hide_banner", "-nostdin", "-loglevel", "error", "-i", inputPath,
            "-vn", "-ac", "1", "-ar", String(this.policy.sampleRate), "-f", "f32le", "pipe:1"
        ], { stdio: ["ignore", "pipe", "pipe"] });
        const encoder = spawn(this.policy.ffmpegPath, [
            "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
            "-f", "f32le", "-ar", String(this.policy.sampleRate), "-ac", "2", "-i", "pipe:0",
            "-vn", "-c:a", "libopus", "-b:a", String(this.policy.opusBitrate),
            "-application", "audio", "-vbr", "on", "-ar", String(this.policy.sampleRate), "-ac", "2", "-f", "ogg", outputPath
        ], { stdio: ["pipe", "ignore", "pipe"] });

        let decoderStderr = "", encoderStderr = "", encoderInputError = null;
        decoder.stderr.on("data", (chunk) => { decoderStderr = appendBoundedText(decoderStderr, chunk); });
        encoder.stderr.on("data", (chunk) => { encoderStderr = appendBoundedText(encoderStderr, chunk); });
        encoder.stdin.on("error", (error) => { encoderInputError = error; });
        const decoderExit = once(decoder, "exit");
        const encoderExit = once(encoder, "exit");

        const frameSamples = Math.round(this.policy.sampleRate * this.policy.frameDurationMs / 1000);
        const frameBytes = frameSamples * 4;
        const isSelf = String(listenerUserId) === String(speakerUserId);
        const convolver = isSelf ? null : new VoiceHrtfConvolver({
            dataset: this.dataset,
            frameSize: frameSamples,
            smoothingMs: this.policy.filterSmoothingMs,
            frameDurationMs: this.policy.frameDurationMs
        });

        // Apply listener-specific speaker restrictions to the speaker's own
        // binaural track, before it is mixed with the listener or other users.
        // Muting samples here is independent of FFmpeg's timeline `enable`
        // semantics and preserves the absolute recording timeline.
        const mutedSampleRanges = (!isSelf && Array.isArray(mutedIntervals) ? mutedIntervals : [])
            .map((interval) => ({
                start: Math.max(0, Math.round(Number(interval?.startOffsetMs) * this.policy.sampleRate / 1000)),
                end: Math.max(0, Math.round(Number(interval?.endOffsetMs) * this.policy.sampleRate / 1000))
            }))
            .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
            .sort((left, right) => left.start - right.start || left.end - right.end);
        const mergedMutedRanges = [];
        for (const range of mutedSampleRanges) {
            const previous = mergedMutedRanges[mergedMutedRanges.length - 1];
            if (previous && range.start <= previous.end) {
                previous.end = Math.max(previous.end, range.end);
            } else {
                mergedMutedRanges.push({ ...range });
            }
        }
        let muteRangeIndex = 0;
        let mutedSamples = 0;

        let pending = Buffer.alloc(0), frameIndex = 0, samples = 0, missingSpatialFrames = 0;
        let minimumDistance = Number.POSITIVE_INFINITY, maximumDistance = 0;
        const sectors = { front: 0, right: 0, back: 0, left: 0, self: 0 };

        const processFrame = async (frameBuffer) => {
            const mono = bufferToFloat32(frameBuffer);
            let stereo;
            if (isSelf) {
                stereo = duplicateMono(mono);
                sectors.self += 1;
            } else {
                const relativeMs = frameIndex * this.policy.frameDurationMs + this.policy.frameDurationMs / 2;
                const perspective = this.perspectiveResolver.resolveAt(listenerUserId, speakerUserId, relativeMs);
                if (!perspective) {
                    stereo = new Float32Array(mono.length * 2);
                    missingSpatialFrames += 1;
                } else {
                    const selection = this.directionResolver.resolve(perspective);
                    const distanceGain = resolveDistanceGain(perspective.distance, {
                        referenceDistanceMeters: this.policy.referenceDistanceMeters,
                        minimumDistanceGain: this.policy.minimumDistanceGain,
                        maximumDistanceGain: this.policy.maximumDistanceGain
                    });
                    stereo = convolver.process(mono, selection, distanceGain * this.policy.hrtfOutputGain);
                    minimumDistance = Math.min(minimumDistance, perspective.distance);
                    maximumDistance = Math.max(maximumDistance, perspective.distance);
                    if (Object.hasOwn(sectors, perspective.sector)) sectors[perspective.sector] += 1;
                }
            }
            // Stereo samples are interleaved (L,R). Only this sender's
            // samples are silenced; all other tracks remain unaffected.
            const frameStart = samples;
            const frameEnd = frameStart + mono.length;
            while (muteRangeIndex < mergedMutedRanges.length &&
                   mergedMutedRanges[muteRangeIndex].end <= frameStart) {
                muteRangeIndex += 1;
            }
            for (let i = muteRangeIndex; i < mergedMutedRanges.length; i += 1) {
                const range = mergedMutedRanges[i];
                if (range.start >= frameEnd) break;
                const from = Math.max(frameStart, range.start) - frameStart;
                const to = Math.min(frameEnd, range.end) - frameStart;
                if (to > from) {
                    stereo.fill(0, from * 2, to * 2);
                    mutedSamples += to - from;
                }
            }
            await writeWithBackpressure(encoder.stdin, float32ToBuffer(stereo));
            samples += mono.length;
            frameIndex += 1;
        };

        try {
            for await (const chunk of decoder.stdout) {
                pending = pending.length ? Buffer.concat([pending, chunk]) : Buffer.from(chunk);
                while (pending.length >= frameBytes) {
                    const frame = pending.subarray(0, frameBytes);
                    pending = pending.subarray(frameBytes);
                    await processFrame(frame);
                }
            }
            if (pending.length) {
                const aligned = pending.length - (pending.length % 4);
                if (aligned > 0) await processFrame(pending.subarray(0, aligned));
            }
        } catch (error) {
            decoder.kill("SIGTERM");
            encoder.kill("SIGTERM");
            throw error;
        } finally {
            if (!encoder.stdin.destroyed && !encoder.stdin.writableEnded) encoder.stdin.end();
        }

        const [[decoderCode], [encoderCode]] = await Promise.all([decoderExit, encoderExit]);
        if (decoderCode !== 0) throw new Error(`HRTF decoder failed with code ${decoderCode}: ${decoderStderr}`);
        if (encoderCode !== 0) throw new Error(`HRTF encoder failed with code ${encoderCode}: ${encoderStderr}`);
        if (encoderInputError && encoderInputError.code !== "EPIPE") throw encoderInputError;

        return Object.freeze({
            listenerUserId: String(listenerUserId),
            speakerUserId: String(speakerUserId),
            frames: frameIndex,
            samples,
            mutedSamples,
            durationMs: durationMs ?? samples * 1000 / this.policy.sampleRate,
            missingSpatialFrames,
            frontFrames: sectors.front,
            rightFrames: sectors.right,
            backFrames: sectors.back,
            leftFrames: sectors.left,
            selfFrames: sectors.self,
            minimumDistance: Number.isFinite(minimumDistance) ? minimumDistance : 0,
            maximumDistance,
            hrtfDatasetSha256: this.dataset.sourceSha256,
            hrtfMode: isSelf ? "self_center" : "binaural_hrtf"
        });
    }
}

export { VoiceHrtfTrackRenderer };
