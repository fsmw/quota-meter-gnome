export class InvalidJsonLineError extends Error {
    constructor() {
        super('Codex App Server emitted an invalid JSONL object');
        this.name = 'InvalidJsonLineError';
    }
}

export class OversizedJsonLineError extends Error {
    constructor() {
        super('Codex App Server JSONL message exceeded the size limit');
        this.name = 'OversizedJsonLineError';
    }
}

export function parseJsonLine(line, maxBytes = 65536) {
    if (typeof line !== 'string' || !Number.isSafeInteger(maxBytes) || maxBytes < 1)
        throw new InvalidJsonLineError();

    if (new TextEncoder().encode(line).byteLength > maxBytes)
        throw new OversizedJsonLineError();

    let message;
    try {
        message = JSON.parse(line);
    } catch {
        throw new InvalidJsonLineError();
    }

    if (message === null || typeof message !== 'object' || Array.isArray(message))
        throw new InvalidJsonLineError();

    return message;
}
