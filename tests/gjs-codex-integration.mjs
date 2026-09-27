import Gio from 'gi://Gio';

import {readCodexRateLimits} from '../extension/provider.js';

const snapshot = await readCodexRateLimits(new Gio.Cancellable());
print(JSON.stringify(snapshot));
