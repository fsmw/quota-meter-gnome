import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {
    CodexAuthRequiredError,
    CodexRpcError,
    CodexUnsupportedAccountError,
} from './app-server-client.js';
import {CodexCliMissingError} from './gio-transport.js';
import {readCodexRateLimits} from './provider.js';

const DEFAULT_REFRESH_SECONDS = 300;
const REQUEST_TIMEOUT_SECONDS = 8;
const MANUAL_REFRESH_COOLDOWN_MS = 60000;
const STALE_AFTER_MS = 5 * 60 * 1000;
const MAX_STALE_MS = 30 * 60 * 1000;
const BACKOFF_SECONDS = [300, 900, 1800, 3600];

const RateLimitsIndicator = class extends PanelMenu.Button {
    constructor(settings) {
        super(0.0, 'Agnome Top Codex quota');
        this._settings = settings;
        this._destroyed = false;
        this._inFlight = null;
        this._lastSnapshot = null;
        this._lastManualRefreshAt = 0;
        this._timerId = 0;
        this._timeoutId = 0;
        this._backoffIndex = 0;
        this._rerunAfterCurrent = false;
        this._refreshSeconds = this._readRefreshSeconds();

        const box = new St.BoxLayout();
        this._label = new St.Label({
            text: 'Codex —',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._label);
        this.add_child(box);

        this._statusItem = new PopupMenu.PopupMenuItem('Consultando Codex…');
        this._statusItem.setSensitive(false);
        this.menu.addMenuItem(this._statusItem);

        this._metricsSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._metricsSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._updatedItem = new PopupMenu.PopupMenuItem('Sin datos recientes');
        this._updatedItem.setSensitive(false);
        this.menu.addMenuItem(this._updatedItem);

        this._refreshItem = new PopupMenu.PopupMenuItem('Actualizar ahora');
        this._refreshItem.connect('activate', () => {
            const now = Date.now();
            if (now - this._lastManualRefreshAt < MANUAL_REFRESH_COOLDOWN_MS)
                return;
            this._lastManualRefreshAt = now;
            void this.refresh();
        });
        this.menu.addMenuItem(this._refreshItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._noticeItem = new PopupMenu.PopupMenuItem(
            'Versión personal experimental: Codex App Server no está soportado para producción.'
        );
        this._noticeItem.setSensitive(false);
        this.menu.addMenuItem(this._noticeItem);

        this._settingsChangedId = settings.connect('changed', (_settings, key) => {
            if (key === 'codex-enabled') {
                if (settings.get_boolean('codex-enabled')) {
                    if (this._inFlight)
                        this._rerunAfterCurrent = true;
                    else
                        void this.refresh();
                    this._scheduleRefresh();
                } else {
                    this._cancelScheduledRefresh();
                    this._inFlight?.cancel();
                    this._label.text = 'Codex —';
                    this._metricsSection.removeAll();
                    this._setStatus('Codex desactivado en Preferencias');
                }
            }
            if (key === 'refresh-interval-seconds') {
                this._refreshSeconds = this._readRefreshSeconds();
                this._scheduleRefresh();
            }
        });

        void this.refresh();
    }

    _readRefreshSeconds() {
        const value = this._settings.get_int('refresh-interval-seconds');
        return [300, 600, 900].includes(value) ? value : DEFAULT_REFRESH_SECONDS;
    }

    _scheduleRefresh(delaySeconds = this._refreshSeconds) {
        this._cancelScheduledRefresh();
        if (this._destroyed || !this._settings.get_boolean('codex-enabled'))
            return;

        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            delaySeconds,
            () => {
                this._timerId = 0;
                void this.refresh();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _cancelScheduledRefresh() {
        if (this._timerId > 0)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
    }

    async refresh() {
        if (this._destroyed || this._inFlight)
            return;

        if (!this._settings.get_boolean('codex-enabled')) {
            this._setStatus('Codex desactivado en Preferencias');
            return;
        }

        const cancellable = new Gio.Cancellable();
        this._inFlight = cancellable;
        let timedOut = false;
        this._setStatus('Consultando Codex…');
        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REQUEST_TIMEOUT_SECONDS,
            () => {
                this._timeoutId = 0;
                timedOut = true;
                cancellable.cancel();
                return GLib.SOURCE_REMOVE;
            }
        );

        try {
            const snapshot = await readCodexRateLimits(cancellable);
            if (!this._destroyed && this._inFlight === cancellable) {
                this._lastSnapshot = snapshot;
                this._backoffIndex = 0;
                this._renderSnapshot(snapshot);
            }
        } catch (error) {
            if (!this._destroyed && this._inFlight === cancellable) {
                if (!this._settings.get_boolean('codex-enabled'))
                    this._setStatus('Codex desactivado en Preferencias');
                else {
                    this._renderError(error, timedOut);
                    this._backoffIndex = Math.min(this._backoffIndex + 1, BACKOFF_SECONDS.length);
                }
            }
        } finally {
            if (this._timeoutId > 0) {
                GLib.source_remove(this._timeoutId);
                this._timeoutId = 0;
            }
            if (this._inFlight === cancellable)
                this._inFlight = null;
            if (!this._destroyed && this._settings.get_boolean('codex-enabled')) {
                if (this._rerunAfterCurrent) {
                    this._rerunAfterCurrent = false;
                    void this.refresh();
                } else {
                    this._scheduleRefresh(this._backoffIndex > 0
                        ? Math.round(BACKOFF_SECONDS[this._backoffIndex - 1]
                            * (0.8 + Math.random() * 0.4))
                        : this._refreshSeconds);
                }
            }
        }
    }

    _renderError(error, timedOut) {
        if (timedOut) {
            this._setStatus('La consulta de Codex excedió el tiempo límite');
        } else if (error instanceof CodexCliMissingError) {
            this._setStatus('No se encontró Codex CLI en PATH');
        } else if (error instanceof CodexAuthRequiredError) {
            this._setStatus('Inicia sesión en Codex CLI con tu cuenta ChatGPT');
        } else if (error instanceof CodexUnsupportedAccountError) {
            this._setStatus('La cuenta activa no ofrece cuota del plan ChatGPT');
        } else if (error instanceof CodexRpcError) {
            this._setStatus('Codex App Server rechazó la consulta');
        } else {
            this._setStatus('No se pudo consultar Codex');
        }

        if (this._lastSnapshot) {
            this._renderMetrics(this._lastSnapshot.metrics);
            const ageMs = Date.now() - Date.parse(this._lastSnapshot.fetchedAt);
            if (ageMs > STALE_AFTER_MS) {
                if (ageMs > MAX_STALE_MS) {
                    this._lastSnapshot = null;
                    this._metricsSection.removeAll();
                    this._label.text = 'Codex —';
                } else {
                    this._statusItem.label.text = 'Dato antiguo · última consulta fallida';
                    this._label.text = `${this._panelSummary(this._lastSnapshot.metrics)} · antiguo`;
                }
            }
        }
        this._updatedItem.label.text = this._lastSnapshot
            ? `Última lectura ${new Date(this._lastSnapshot.fetchedAt).toLocaleTimeString()}`
            : 'Sin datos recientes';
    }

    _renderSnapshot(snapshot) {
        this._renderMetrics(snapshot.metrics);
        if (snapshot.status !== 'ok' || snapshot.metrics.length === 0) {
            this._label.text = 'Codex —';
            this._setStatus('La cuenta no informó ventanas de cuota');
        } else {
            this._setStatus(snapshot.planType
                ? `Cuenta ChatGPT ${snapshot.planType}`
                : 'Cuota de Codex disponible');
            this._label.text = this._panelSummary(snapshot.metrics);
        }
        this._updatedItem.label.text = `Actualizado ${new Date(snapshot.fetchedAt).toLocaleTimeString()}`;
    }

    _renderMetrics(metrics) {
        this._metricsSection.removeAll();
        for (const metric of metrics) {
            const parts = [metric.bucketId, metric.windowId];
            if (metric.window.durationSeconds)
                parts.push(this._formatDuration(metric.window.durationSeconds));
            if (metric.usedPercent !== undefined && metric.usedPercent >= 0 && metric.usedPercent <= 100)
                parts.push(`${this._formatPercent(metric.usedPercent)} usado`);
            else if (metric.usedPercent !== undefined)
                parts.push('porcentaje inválido');
            if (metric.remainingPercent !== undefined)
                parts.push(`${this._formatPercent(metric.remainingPercent)} libre`);
            if (metric.window.resetsAt)
                parts.push(`reinicia ${new Date(metric.window.resetsAt).toLocaleString()}`);
            if (parts.length === 2)
                parts.push('datos de cuota incompletos');
            this._metricsSection.addMenuItem(new PopupMenu.PopupMenuItem(parts.join(' · ')));
        }
    }

    _panelSummary(metrics) {
        const primary = metrics.find(metric => metric.bucketId === 'codex'
            && metric.windowId === 'primary')
            ?? metrics.find(metric => metric.windowId === 'primary')
            ?? metrics[0];
        if (primary.remainingPercent !== undefined)
            return `Codex ${this._formatPercent(primary.remainingPercent)}% libre`;
        if (primary.usedPercent !== undefined && primary.usedPercent >= 0 && primary.usedPercent <= 100)
            return `Codex ${this._formatPercent(primary.usedPercent)}% usado`;
        return 'Codex —';
    }

    _formatPercent(value) {
        return Number.isInteger(value) ? String(value) : value.toFixed(1);
    }

    _formatDuration(seconds) {
        if (seconds % 86400 === 0)
            return `${seconds / 86400} d`;
        if (seconds % 3600 === 0)
            return `${seconds / 3600} h`;
        return `${Math.round(seconds / 60)} min`;
    }

    _setStatus(text) {
        this._statusItem.label.text = text;
    }

    destroy() {
        this._destroyed = true;
        this._cancelScheduledRefresh();
        if (this._timeoutId > 0) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._inFlight?.cancel();
        this._inFlight = null;
        if (this._settingsChangedId > 0) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        super.destroy();
    }
};

export default class AgnomeTopExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new RateLimitsIndicator(this._settings);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
