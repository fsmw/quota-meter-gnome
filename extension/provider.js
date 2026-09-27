import {CodexAppServerClient} from './app-server-client.js';
import {GioCodexTransport} from './gio-transport.js';

export async function readCodexRateLimits(cancellable) {
    const client = new CodexAppServerClient(new GioCodexTransport(cancellable));
    return client.readRateLimits(Date.now());
}
