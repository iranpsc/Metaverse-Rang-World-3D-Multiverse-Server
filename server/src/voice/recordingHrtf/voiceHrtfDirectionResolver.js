function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function normalize360(value) {
    const number = Number(value) || 0;
    return ((number % 360) + 360) % 360;
}

function sofaDirectionFromPerspective(perspective) {
    return Object.freeze({
        azimuthDegrees: normalize360(-Number(perspective?.azimuthDegrees || 0)),
        elevationDegrees: clamp(Number(perspective?.elevationDegrees || 0), -90, 90)
    });
}

function directionVector(azimuthDegrees, elevationDegrees) {
    const azimuth = azimuthDegrees * Math.PI / 180;
    const elevation = elevationDegrees * Math.PI / 180;
    const horizontal = Math.cos(elevation);
    return [horizontal * Math.cos(azimuth), horizontal * Math.sin(azimuth), Math.sin(elevation)];
}

class VoiceHrtfDirectionResolver {
    constructor(dataset, { neighbors = 4 } = {}) {
        if (!dataset?.measurementCount || !dataset?.unitVectors) {
            throw new TypeError("VoiceHrtfDirectionResolver requires a loaded HRTF dataset.");
        }
        this.dataset = dataset;
        this.neighborCount = Math.max(1, Math.min(8, Number.parseInt(String(neighbors), 10) || 4));
    }

    resolve(perspective) {
        const sofa = sofaDirectionFromPerspective(perspective);
        const query = directionVector(sofa.azimuthDegrees, sofa.elevationDegrees);
        const candidates = [];
        const vectors = this.dataset.unitVectors;

        for (let index = 0; index < this.dataset.measurementCount; index += 1) {
            const dot = clamp(
                query[0] * vectors[index * 3] + query[1] * vectors[index * 3 + 1] + query[2] * vectors[index * 3 + 2],
                -1,
                1
            );
            const angularDistance = Math.acos(dot);
            if (candidates.length < this.neighborCount) {
                candidates.push({ index, angularDistance });
                candidates.sort((a, b) => a.angularDistance - b.angularDistance);
            } else if (angularDistance < candidates[candidates.length - 1].angularDistance) {
                candidates[candidates.length - 1] = { index, angularDistance };
                candidates.sort((a, b) => a.angularDistance - b.angularDistance);
            }
        }

        if (candidates[0]?.angularDistance < 1e-6) {
            return Object.freeze({
                ...sofa,
                neighbors: Object.freeze([Object.freeze({ index: candidates[0].index, weight: 1 })])
            });
        }

        let sum = 0;
        const weighted = candidates.map((candidate) => {
            const weight = 1 / Math.max(1e-6, candidate.angularDistance * candidate.angularDistance);
            sum += weight;
            return { index: candidate.index, weight };
        });

        return Object.freeze({
            ...sofa,
            neighbors: Object.freeze(weighted.map((entry) => Object.freeze({ index: entry.index, weight: entry.weight / sum })))
        });
    }
}

export { sofaDirectionFromPerspective, VoiceHrtfDirectionResolver };
