const WINDOW_SLOTS = ['primary', 'secondary'];

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeWindow(window) {
    const normalized = {};

    if (Number.isFinite(window.windowDurationMins) && window.windowDurationMins > 0)
        normalized.durationSeconds = window.windowDurationMins * 60;

    if (Number.isFinite(window.resetsAt) && window.resetsAt >= 0) {
        const resetMs = window.resetsAt * 1000;
        if (Number.isFinite(resetMs) && !Number.isNaN(new Date(resetMs).getTime()))
            normalized.resetsAt = new Date(resetMs).toISOString();
    }

    return normalized;
}

/**
 * Convert the documented account/rateLimits/read result into the extension's
 * account-scoped quota snapshot. Unknown and absent fields remain absent.
 */
export function normalizeRateLimitsResponse(result, fetchedAtMs = Date.now()) {
    if (!isRecord(result))
        throw new TypeError('Codex rate limit result must be an object');
    if (!Number.isFinite(fetchedAtMs) || Number.isNaN(new Date(fetchedAtMs).getTime()))
        throw new TypeError('fetchedAtMs must be a valid timestamp');

    let buckets;
    if (Object.hasOwn(result, 'rateLimitsByLimitId')) {
        buckets = isRecord(result.rateLimitsByLimitId) ? result.rateLimitsByLimitId : {};
    } else if (isRecord(result.rateLimits)) {
        const fallbackId = typeof result.rateLimits.limitId === 'string'
            && result.rateLimits.limitId.length > 0
            ? result.rateLimits.limitId
            : 'default';
        buckets = {[fallbackId]: result.rateLimits};
    } else {
        buckets = {};
    }

    const metrics = [];
    for (const [bucketId, bucket] of Object.entries(buckets)) {
        if (!isRecord(bucket))
            continue;

        for (const windowId of WINDOW_SLOTS) {
            const sourceWindow = bucket[windowId];
            if (!isRecord(sourceWindow) || Object.keys(sourceWindow).length === 0)
                continue;

            const usedPercent = Number.isFinite(sourceWindow.usedPercent)
                ? sourceWindow.usedPercent
                : undefined;
            const remainingPercent = usedPercent !== undefined
                && usedPercent >= 0 && usedPercent <= 100
                ? 100 - usedPercent
                : undefined;

            metrics.push({
                id: `${bucketId}:${windowId}`,
                kind: 'quota',
                scope: 'account',
                bucketId,
                windowId,
                usedPercent,
                remainingPercent,
                window: normalizeWindow(sourceWindow),
            });
        }
    }

    return {
        providerId: 'openai',
        productId: 'codex-chatgpt',
        status: metrics.length > 0 ? 'ok' : 'unsupported',
        fetchedAt: new Date(fetchedAtMs).toISOString(),
        metrics,
    };
}
