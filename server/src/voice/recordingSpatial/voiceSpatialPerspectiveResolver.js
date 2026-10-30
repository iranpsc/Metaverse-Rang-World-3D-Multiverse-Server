import {
    resolveSpatialPerspective
} from "./voiceSpatialPerspectiveMath.js";

class VoiceSpatialPerspectiveResolver {
    constructor(
        sampler
    ) {
        if (
            !sampler ||
            typeof sampler.sampleUser !==
                "function"
        ) {
            throw new TypeError(
                "A VoiceSpatialTimelineSampler instance is required."
            );
        }

        this.sampler =
            sampler;
    }

    resolveAt(
        listenerUserId,
        speakerUserId,
        relativeMs
    ) {
        const listener =
            this.sampler.sampleUser(
                listenerUserId,
                relativeMs
            );

        const speaker =
            this.sampler.sampleUser(
                speakerUserId,
                relativeMs
            );

        if (
            !listener ||
            !speaker
        ) {
            return null;
        }

        const perspective =
            resolveSpatialPerspective({
                listenerPosition:
                    listener.position,
                listenerRotation:
                    listener.rotation,
                speakerPosition:
                    speaker.position
            });

        if (!perspective) {
            return null;
        }

        return Object.freeze({
            relativeMs:
                Number(
                    relativeMs
                ),
            listenerUserId:
                String(
                    listenerUserId
                ),
            speakerUserId:
                String(
                    speakerUserId
                ),
            listener,
            speaker,
            ...perspective
        });
    }

    resolveAllSpeakersAt(
        listenerUserId,
        relativeMs
    ) {
        const result =
            new Map();

        const listenerKey =
            String(
                listenerUserId ??
                ""
            ).trim();

        for (
            const speakerUserId of
            this.sampler.timeline
                .statesByUserId
                .keys()
        ) {
            if (
                speakerUserId ===
                listenerKey
            ) {
                continue;
            }

            const perspective =
                this.resolveAt(
                    listenerKey,
                    speakerUserId,
                    relativeMs
                );

            if (perspective) {
                result.set(
                    speakerUserId,
                    perspective
                );
            }
        }

        return result;
    }
}

export {
    VoiceSpatialPerspectiveResolver
};
