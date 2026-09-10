class VoiceDirectionalPolicyRegistry {
    constructor({ now = () => Date.now() } = {}) {
        if (typeof now !== "function") {
            throw new TypeError("now must be a function.");
        }

        this.now = now;
        this.policiesByRoute = new Map();
    }

    setBlocked({
        senderConnectionId,
        receiverConnectionId,
        blocked,
        changedAtMs = this.now()
    } = {}) {
        const senderId = normalizeConnectionId(senderConnectionId);
        const receiverId = normalizeConnectionId(receiverConnectionId);

        if (!senderId || !receiverId || senderId === receiverId) {
            throw new Error("Voice directional policy requires two different connection ids.");
        }

        if (typeof blocked !== "boolean") {
            throw new TypeError("blocked must be a boolean.");
        }

        if (!Number.isSafeInteger(changedAtMs) || changedAtMs < 0) {
            throw new RangeError("changedAtMs must be a non-negative safe integer.");
        }

        const key = createRouteKey(senderId, receiverId);

        if (!blocked) {
            const removed = this.policiesByRoute.delete(key);
            return Object.freeze({ changed: removed, blocked: false });
        }

        const previous = this.policiesByRoute.get(key);
        if (previous?.blocked === true) {
            return Object.freeze({ changed: false, blocked: true });
        }

        this.policiesByRoute.set(key, {
            senderConnectionId: senderId,
            receiverConnectionId: receiverId,
            blocked: true,
            changedAtMs
        });

        return Object.freeze({ changed: true, blocked: true });
    }

    isRouteAllowed(senderConnectionId, receiverConnectionId) {
        const senderId = normalizeConnectionId(senderConnectionId);
        const receiverId = normalizeConnectionId(receiverConnectionId);
        if (!senderId || !receiverId || senderId === receiverId) return false;

        return !this.policiesByRoute.has(createRouteKey(senderId, receiverId));
    }

    removeConnection(connectionId) {
        const normalizedConnectionId = normalizeConnectionId(connectionId);
        if (!normalizedConnectionId) return 0;

        let removed = 0;

        for (const [key, policy] of this.policiesByRoute) {
            if (
                policy.senderConnectionId !== normalizedConnectionId &&
                policy.receiverConnectionId !== normalizedConnectionId
            ) {
                continue;
            }

            this.policiesByRoute.delete(key);
            removed += 1;
        }

        return removed;
    }

    cleanupInactivePolicies(hasActivePeer) {
        if (typeof hasActivePeer !== "function") {
            throw new TypeError("hasActivePeer must be a function.");
        }

        let removed = 0;

        for (const [key, policy] of this.policiesByRoute) {
            if (hasActivePeer(policy.senderConnectionId, policy.receiverConnectionId)) continue;

            this.policiesByRoute.delete(key);
            removed += 1;
        }

        return removed;
    }

    getSnapshot() {
        return Object.freeze(
            Array.from(this.policiesByRoute.values(), (policy) => Object.freeze({ ...policy }))
                .sort((left, right) => {
                    const senderCompare = left.senderConnectionId.localeCompare(right.senderConnectionId);
                    if (senderCompare !== 0) return senderCompare;
                    return left.receiverConnectionId.localeCompare(right.receiverConnectionId);
                })
        );
    }
}

function createRouteKey(senderConnectionId, receiverConnectionId) {
    return `${senderConnectionId}>${receiverConnectionId}`;
}

function normalizeConnectionId(value) {
    return String(value ?? "").trim().toLowerCase();
}

export {
    VoiceDirectionalPolicyRegistry
};
