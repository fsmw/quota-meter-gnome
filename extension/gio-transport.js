import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {
    CodexProtocolError,
    CodexUnavailableError,
} from './app-server-client.js';

Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');
Gio._promisify(Gio.InputStream.prototype, 'close_async');
Gio._promisify(Gio.OutputStream.prototype, 'write_bytes_async');
Gio._promisify(Gio.OutputStream.prototype, 'close_async');
Gio._promisify(Gio.Subprocess.prototype, 'wait_async');

const ENVIRONMENT_ALLOWLIST = new Set([
    'CODEX_HOME',
    'HOME',
    'LANG',
    'LC_ALL',
    'LC_MESSAGES',
    'PATH',
    'TMPDIR',
    'XDG_CACHE_HOME',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'XDG_STATE_HOME',
]);

const MAX_LINE_BYTES = 65536;
const READ_CHUNK_BYTES = 4096;

export class CodexCliMissingError extends Error {
    constructor() {
        super('Codex CLI could not be started');
        this.name = 'CodexCliMissingError';
    }
}

export class GioCodexTransport {
    constructor(cancellable) {
        this._cancellable = cancellable;
        this._process = null;
        this._stdin = null;
        this._stdout = null;
        this._readBuffer = new Uint8Array(0);
        this._readOffset = 0;
        this._cancelSignal = 0;
        this._waitPromise = null;
        this._started = false;
        this._closed = false;
    }

    async start() {
        if (this._started)
            throw new Error('Codex transport can only be started once');

        this._started = true;
        try {
            const launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDIN_PIPE
                    | Gio.SubprocessFlags.STDOUT_PIPE
                    | Gio.SubprocessFlags.STDERR_SILENCE,
            });
            const environment = GLib.get_environ().filter(entry => {
                const separator = entry.indexOf('=');
                return separator > 0 && ENVIRONMENT_ALLOWLIST.has(entry.slice(0, separator));
            });
            launcher.set_environ(environment);
            // This user-installed CLI is essential to read the account quota through Codex's
            // own authenticated local protocol; do not replace it with credential or HTTP access.
            this._process = launcher.spawnv(['codex', 'app-server']);
            this._stdin = this._process.get_stdin_pipe();
            this._stdout = this._process.get_stdout_pipe();

            if (this._cancellable instanceof Gio.Cancellable) {
                this._cancelSignal = this._cancellable.connect(() => {
                    this._process?.force_exit();
                });
                if (this._cancellable.is_cancelled())
                    this._process.force_exit();
            }
        } catch {
            throw new CodexCliMissingError();
        }
    }

    async writeLine(message) {
        if (!this._process || this._closed)
            throw new CodexUnavailableError();

        const line = `${JSON.stringify(message)}\n`;
        if (new TextEncoder().encode(line).byteLength > MAX_LINE_BYTES)
            throw new Error('Codex request exceeded the protocol size limit');

        await this._stdin.write_bytes_async(
            new GLib.Bytes(line),
            GLib.PRIORITY_DEFAULT,
            this._cancellable
        );
    }

    async readLine() {
        if (!this._stdout || this._closed)
            return null;

        const chunks = [];
        let size = 0;
        while (true) {
            if (this._readOffset < this._readBuffer.length) {
                const newline = this._readBuffer.indexOf(10, this._readOffset);
                const end = newline >= 0 ? newline : this._readBuffer.length;
                const piece = this._readBuffer.subarray(this._readOffset, end);
                chunks.push(piece);
                size += piece.byteLength;
                if (size > MAX_LINE_BYTES)
                    throw new CodexProtocolError();
                this._readOffset = newline >= 0 ? newline + 1 : this._readBuffer.length;
                if (newline >= 0)
                    return this._decodeLine(chunks, size);
            }

            let bytes;
            try {
                bytes = await this._stdout.read_bytes_async(
                    READ_CHUNK_BYTES,
                    GLib.PRIORITY_DEFAULT,
                    this._cancellable
                );
            } catch (error) {
                if (this._cancellable?.is_cancelled())
                    throw error;
                throw new CodexUnavailableError();
            }

            if (bytes.get_size() === 0)
                return size > 0 ? this._decodeLine(chunks, size) : null;
            this._readBuffer = bytes.get_data();
            this._readOffset = 0;
        }
    }

    _decodeLine(chunks, size) {
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        try {
            return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
        } catch {
            throw new CodexProtocolError();
        }
    }

    async close() {
        if (this._closed)
            return;
        this._closed = true;

        if (this._cancelSignal > 0) {
            this._cancellable.disconnect(this._cancelSignal);
            this._cancelSignal = 0;
        }

        try {
            await this._stdin?.close_async(GLib.PRIORITY_DEFAULT, null);
        } catch {
            // Closing stdin may fail when the child has already exited.
        }

        if (this._process) {
            this._waitPromise ??= this._process.wait_async(null).catch(() => {});
            const exited = await this._waitForExitOrTimeout(250);
            if (!exited) {
                this._process.force_exit();
                await this._waitPromise;
            }
        }

        try {
            await this._stdout?.close_async(GLib.PRIORITY_DEFAULT, null);
        } catch {
            // Stream cleanup is best effort after the process has been reaped.
        }
    }

    async _waitForExitOrTimeout(milliseconds) {
        let timeoutId = 0;
        let timedOut = false;
        const timeout = new Promise(resolve => {
            timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
                timedOut = true;
                timeoutId = 0;
                resolve(false);
                return GLib.SOURCE_REMOVE;
            });
        });

        const exited = await Promise.race([this._waitPromise.then(() => true), timeout]);
        if (timeoutId > 0)
            GLib.source_remove(timeoutId);
        return exited || !timedOut;
    }
}
