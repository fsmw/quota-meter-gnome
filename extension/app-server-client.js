import {normalizeRateLimitsResponse} from './normalizer.js';
import {parseJsonLine} from './jsonl.js';

export class CodexRpcError extends Error {
    constructor(code) {
        super('Codex App Server rejected a request');
        this.name = 'CodexRpcError';
        this.code = typeof code === 'number' || typeof code === 'string'
            ? String(code).slice(0, 32)
            : 'unknown';
    }
}

export class CodexProtocolError extends Error {
    constructor() {
        super('Codex App Server returned an invalid protocol response');
        this.name = 'CodexProtocolError';
    }
}

export class CodexUnavailableError extends Error {
    constructor() {
        super('Codex App Server exited before replying');
        this.name = 'CodexUnavailableError';
    }
}

export class CodexAuthRequiredError extends Error {
    constructor() {
        super('Sign in to Codex with a ChatGPT account');
        this.name = 'CodexAuthRequiredError';
    }
}

export class CodexUnsupportedAccountError extends Error {
    constructor() {
        super('The active Codex account does not provide a ChatGPT plan quota');
        this.name = 'CodexUnsupportedAccountError';
    }
}

export class CodexAppServerClient {
    constructor(transport, {clientName = 'agnome_top', clientVersion = '0.1.0'} = {}) {
        if (!transport || typeof transport.start !== 'function'
            || typeof transport.readLine !== 'function'
            || typeof transport.writeLine !== 'function'
            || typeof transport.close !== 'function')
            throw new TypeError('A Codex App Server transport is required');

        this._transport = transport;
        this._clientInfo = {name: clientName, version: clientVersion};
        this._busy = false;
    }

    async readRateLimits(fetchedAtMs = Date.now()) {
        if (this._busy)
            throw new Error('A Codex rate limit request is already active');

        this._busy = true;
        try {
            await this._transport.start();
            const initialized = await this._request('initialize', {
                clientInfo: this._clientInfo,
            }, 1);
            if (!initialized || typeof initialized !== 'object')
                throw new CodexProtocolError();

            await this._transport.writeLine({
                method: 'initialized',
                params: {},
            });

            const accountResult = await this._request('account/read', {
                refreshToken: false,
            }, 2);
            const account = accountResult?.account;
            if (!account || typeof account !== 'object')
                throw new CodexAuthRequiredError();
            if (account.type !== 'chatgpt')
                throw new CodexUnsupportedAccountError();

            const result = await this._request('account/rateLimits/read', {}, 3);
            const snapshot = normalizeRateLimitsResponse(result, fetchedAtMs);
            if (typeof account.planType === 'string')
                snapshot.planType = account.planType;
            return snapshot;
        } finally {
            try {
                await this._transport.close();
            } finally {
                this._busy = false;
            }
        }
    }

    async _request(method, params, id) {
        await this._transport.writeLine({method, id, params});

        while (true) {
            const line = await this._transport.readLine();
            if (line === null || line === undefined)
                throw new CodexUnavailableError();

            const message = parseJsonLine(line);
            if (message.id !== id)
                continue;

            if (message.error !== undefined) {
                const code = message.error && typeof message.error === 'object'
                    ? message.error.code
                    : undefined;
                throw new CodexRpcError(code);
            }
            if (!Object.hasOwn(message, 'result'))
                throw new CodexProtocolError();

            return message.result;
        }
    }
}
