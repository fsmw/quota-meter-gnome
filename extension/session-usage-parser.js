const TOKEN_FIELDS = Object.freeze({
    input_tokens: 'inputTotal',
    cached_input_tokens: 'cachedInput',
    output_tokens: 'output',
    reasoning_output_tokens: 'reasoningOutput',
    total_tokens: 'total',
});

export function createSessionUsageAccumulator() {
    return {tokens: {}, hasUsage: false, invalidLines: 0};
}

export function consumeSessionUsageLine(accumulator, line) {
    if (!line)
        return;

    let event;
    try {
        event = JSON.parse(line);
    } catch {
        accumulator.invalidLines++;
        return;
    }

    if (!event || event.type !== 'event_msg' || event.payload?.type !== 'token_count')
        return;

    const usage = event.payload?.info?.last_token_usage;
    if (!usage || typeof usage !== 'object' || Array.isArray(usage))
        return;

    for (const [source, target] of Object.entries(TOKEN_FIELDS)) {
        if (Number.isFinite(usage[source]) && usage[source] >= 0) {
            accumulator.tokens[target] = (accumulator.tokens[target] ?? 0) + usage[source];
            accumulator.hasUsage = true;
        }
    }
}

export function addTokenCounters(target, source) {
    for (const [field, value] of Object.entries(source))
        target[field] = (target[field] ?? 0) + value;
    return target;
}

export function deriveTokenCounters(tokens) {
    const result = {...tokens};
    if (Number.isFinite(result.inputTotal) && Number.isFinite(result.cachedInput))
        result.input = Math.max(0, result.inputTotal - result.cachedInput);
    return result;
}
