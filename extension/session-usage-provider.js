import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    addTokenCounters,
    consumeSessionUsageLine,
    createSessionUsageAccumulator,
    deriveTokenCounters,
} from './session-usage-parser.js';

const MAX_SESSIONS = 3;
const READ_CHUNK_BYTES = 65536;
const MAX_LINE_CHARS = 65536;
const ENUM_ATTRIBUTES = 'standard::name,standard::type,standard::size,time::modified,id::file';

function gioAsync(target, method, finishMethod, args) {
    return new Promise((resolve, reject) => {
        target[method](...args, (source, result) => {
            try {
                resolve(source[finishMethod](result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

function ensureNotCancelled(cancellable) {
    if (cancellable?.is_cancelled())
        throw new Error('Cancelled');
}

function yieldToShell() {
    return new Promise(resolve => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

async function enumerateDirectory(directory, candidates, cancellable) {
    ensureNotCancelled(cancellable);
    let enumerator;
    try {
        enumerator = await gioAsync(directory, 'enumerate_children_async', 'enumerate_children_finish', [
            ENUM_ATTRIBUTES, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable,
        ]);
    } catch (error) {
        if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            return;
        throw error;
    }

    try {
        while (true) {
            ensureNotCancelled(cancellable);
            const infos = await gioAsync(enumerator, 'next_files_async', 'next_files_finish', [
                64, GLib.PRIORITY_DEFAULT, cancellable,
            ]);
            if (infos.length === 0)
                break;
            for (const info of infos) {
                const child = directory.get_child(info.get_name());
                if (info.get_file_type() === Gio.FileType.DIRECTORY)
                    await enumerateDirectory(child, candidates, cancellable);
                else if (info.get_file_type() === Gio.FileType.REGULAR
                    && info.get_name().endsWith('.jsonl')) {
                    candidates.push({
                        file: child,
                        path: child.get_path(),
                        modified: info.get_attribute_uint64('time::modified'),
                        size: info.get_size(),
                        fileId: info.get_attribute_string('id::file') ?? '',
                    });
                }
            }
            await yieldToShell();
        }
    } finally {
        try {
            await gioAsync(enumerator, 'close_async', 'close_finish', [GLib.PRIORITY_DEFAULT, null]);
        } catch {
            // Enumeration cleanup is best effort.
        }
    }
}

function newFileState(candidate) {
    return {
        size: 0,
        fileId: candidate.fileId,
        pending: '',
        discardingLine: false,
        accumulator: createSessionUsageAccumulator(),
    };
}

async function readCandidate(candidate, cache, cancellable) {
    ensureNotCancelled(cancellable);
    let state = cache.get(candidate.path);
    if (!state || state.fileId !== candidate.fileId || candidate.size < state.size) {
        state = newFileState(candidate);
        cache.set(candidate.path, state);
    }
    if (candidate.size === state.size)
        return state;

    const stream = await gioAsync(candidate.file, 'read_async', 'read_finish', [
        GLib.PRIORITY_DEFAULT, cancellable,
    ]);
    try {
        if (state.size > 0)
            stream.seek(state.size, Gio.SeekType.SET, cancellable);
        while (state.size < candidate.size) {
            ensureNotCancelled(cancellable);
            const bytes = await gioAsync(stream, 'read_bytes_async', 'read_bytes_finish', [
                Math.min(READ_CHUNK_BYTES, candidate.size - state.size),
                GLib.PRIORITY_DEFAULT, cancellable,
            ]);
            const data = bytes.get_data();
            if (data.byteLength === 0)
                break;
            state.size += data.byteLength;
            state.pending += new TextDecoder().decode(data);
            let newline = state.pending.indexOf('\n');
            while (newline >= 0) {
                const line = state.pending.slice(0, newline);
                if (state.discardingLine) {
                    state.discardingLine = false;
                } else if (line.length <= MAX_LINE_CHARS) {
                    consumeSessionUsageLine(
                        state.accumulator, line.endsWith('\r') ? line.slice(0, -1) : line
                    );
                } else {
                    state.accumulator.invalidLines++;
                }
                state.pending = state.pending.slice(newline + 1);
                newline = state.pending.indexOf('\n');
            }
            if (state.pending.length > MAX_LINE_CHARS) {
                state.pending = '';
                state.discardingLine = true;
                state.accumulator.invalidLines++;
            }
            await yieldToShell();
        }
    } finally {
        try {
            await gioAsync(stream, 'close_async', 'close_finish', [GLib.PRIORITY_DEFAULT, null]);
        } catch {
            // Stream cleanup is best effort after read failure or cancellation.
        }
    }
    return state;
}

function snapshotFor(candidate, state) {
    return {
        id: candidate.path,
        modifiedAt: candidate.modified * 1000,
        tokens: deriveTokenCounters(state.accumulator.tokens),
        status: state.accumulator.invalidLines > 0 ? 'partial' : 'ok',
    };
}

export async function readCodexObservedUsage(cancellable, cache = new Map()) {
    const codexHome = GLib.getenv('CODEX_HOME') || GLib.build_filenamev([
        GLib.get_home_dir(), '.codex',
    ]);
    const root = Gio.File.new_for_path(GLib.build_filenamev([codexHome, 'sessions']));
    const candidates = [];
    await enumerateDirectory(root, candidates, cancellable);
    candidates.sort((a, b) => b.modified - a.modified || b.path.localeCompare(a.path));

    const selected = candidates.slice(0, MAX_SESSIONS);
    const selectedPaths = new Set(selected.map(candidate => candidate.path));
    for (const cachedPath of cache.keys()) {
        if (!selectedPaths.has(cachedPath))
            cache.delete(cachedPath);
    }
    const sessions = [];
    for (const candidate of selected) {
        try {
            const state = await readCandidate(candidate, cache, cancellable);
            if (state.accumulator.hasUsage)
                sessions.push(snapshotFor(candidate, state));
        } catch (error) {
            if (cancellable?.is_cancelled())
                throw error;
            sessions.push({id: candidate.path, modifiedAt: candidate.modified * 1000, status: 'unavailable'});
        }
    }

    const tokens = {};
    for (const session of sessions) {
        if (session.tokens)
            addTokenCounters(tokens, session.tokens);
    }
    const usable = sessions.filter(session => session.tokens);
    const displayTotal = deriveTokenCounters(tokens);
    const status = usable.length === 0 ? 'unavailable'
        : sessions.some(session => session.status !== 'ok') ? 'partial' : 'ok';

    return {
        status,
        fetchedAt: Date.now(),
        sessionCount: usable.length,
        latest: usable[0] ?? null,
        total: displayTotal,
        sessions: usable,
    };
}
