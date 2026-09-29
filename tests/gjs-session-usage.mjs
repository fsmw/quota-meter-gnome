import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {readCodexObservedUsage} from '../extension/session-usage-provider.js';

const cache = new Map();
const first = await readCodexObservedUsage(new Gio.Cancellable(), cache);
const appendPath = GLib.getenv('USAGE_TEST_APPEND_PATH');
if (!appendPath) {
    print(JSON.stringify({first}));
} else {
const [loaded, contents] = Gio.File.new_for_path(appendPath).load_contents(null);
if (!loaded)
    throw new Error('Fixture could not be read');
GLib.file_set_contents(appendPath, `${new TextDecoder().decode(contents)}${JSON.stringify({
    type: 'event_msg',
    payload: {type: 'token_count', info: {last_token_usage: {input_tokens: 4, output_tokens: 1, total_tokens: 5}}},
})}\n{"type":"event_msg"`);
const second = await readCodexObservedUsage(new Gio.Cancellable(), cache);
print(JSON.stringify({first, second}));
}
