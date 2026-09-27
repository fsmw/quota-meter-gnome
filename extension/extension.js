import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
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
import {resolveLanguage, translate} from './i18n.js';

const DEFAULT_REFRESH_SECONDS = 60;
const REQUEST_TIMEOUT_SECONDS = 8;
const MANUAL_REFRESH_COOLDOWN_MS = 60000;
const STALE_AFTER_MS = 5 * 60 * 1000;
const MAX_STALE_MS = 30 * 60 * 1000;
const BACKOFF_SECONDS = [300, 900, 1800, 3600];

const RateLimitsIndicator = GObject.registerClass(
class RateLimitsIndicator extends PanelMenu.Button {
    constructor(settings) {
        super(0.0, translate('Quota Meter · Codex account quota', settings.get_string('language')));
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
        this._language = this._settings.get_string('language');

        const box = new St.BoxLayout();
        box.add_child(this._createQuotaIcon(16));
        this._label = new St.Label({
            text: '—',
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-left: 4px;',
        });
        box.add_child(this._label);
        this.add_child(box);

        this._headerItem = this._createMenuItem();
        const header = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 10px; padding: 4px 2px;',
        });
        header.add_child(this._createQuotaIcon(21));
        const identity = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style: 'spacing: 1px;',
        });
        identity.add_child(new St.Label({
            text: this._t('Codex'),
            style: 'font-weight: 700; font-size: 14px;',
        }));
        this._accountSubtitle = new St.Label({
            text: this._t('Checking quota…'),
            style: 'color: rgba(255,255,255,0.58); font-size: 11px;',
        });
        identity.add_child(this._accountSubtitle);
        header.add_child(identity);
        this._headerItem.add_child(header);
        this.menu.addMenuItem(this._headerItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._primarySection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._primarySection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._secondarySection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._secondarySection);

        this._footerItem = this._createMenuItem({activate: true});
        const footer = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 12px; padding: 3px 2px;',
        });
        this._updatedLabel = new St.Label({
            text: this._t('No recent data'),
            x_expand: true,
            style: 'color: rgba(255,255,255,0.55); font-size: 10px;',
        });
        footer.add_child(this._updatedLabel);
        const refreshAction = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 5px;',
        });
        refreshAction.add_child(new St.Icon({
            icon_name: 'view-refresh-symbolic',
            icon_size: 14,
            style_class: 'popup-menu-icon',
        }));
        this._refreshActionLabel = new St.Label({
            text: this._t('Update now'),
            style: 'font-weight: 600; font-size: 11px;',
        });
        refreshAction.add_child(this._refreshActionLabel);
        footer.add_child(refreshAction);
        this._footerItem.add_child(footer);
        this._footerItem.connect('activate', () => {
            const now = Date.now();
            if (now - this._lastManualRefreshAt < MANUAL_REFRESH_COOLDOWN_MS)
                return;
            this._lastManualRefreshAt = now;
            void this.refresh();
        });
        this.menu.addMenuItem(this._footerItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._noticeItem = this._createMenuItem();
        this._noticeLabel = new St.Label({
            text: this._t('Unofficial extension · Uses the Codex CLI installed on this system'),
            x_expand: true,
            style: 'color: rgba(255,255,255,0.42); font-size: 10px; padding: 2px;',
        });
        this._noticeItem.add_child(this._noticeLabel);
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
                    this._label.text = '—';
                    this._clearMetrics();
                    this._setStatus('Codex disabled in Preferences');
                }
            }
            if (key === 'refresh-interval-seconds') {
                this._refreshSeconds = this._readRefreshSeconds();
                this._scheduleRefresh();
            }
            if (key === 'language') {
                this._language = settings.get_string('language');
                this._noticeLabel.text = this._t('Unofficial extension · Uses the Codex CLI installed on this system');
                this._refreshActionLabel.text = this._t('Update now');
                if (this._lastSnapshot)
                    this._renderSnapshot(this._lastSnapshot);
                else if (!settings.get_boolean('codex-enabled'))
                    this._setStatus('Codex disabled in Preferences');
                else {
                    this._setStatus('Checking Codex…');
                    this._updatedLabel.text = this._t('No recent data');
                }
            }
        });

        void this.refresh();
    }

    _createQuotaIcon(iconSize) {
        const badge = new St.BoxLayout({
            style: 'background-color: #fff; border-radius: 99px; padding: 1px;',
            y_align: Clutter.ActorAlign.CENTER,
        });
        badge.add_child(new St.Icon({
            icon_name: 'speedometer-symbolic',
            icon_size: iconSize,
            accessible_name: 'Quota Meter',
        }));
        return badge;
    }

    _createMenuItem({activate = false} = {}) {
        return new PopupMenu.PopupBaseMenuItem({
            activate,
            can_focus: activate,
            reactive: activate,
        });
    }

    _readRefreshSeconds() {
        const value = this._settings.get_int('refresh-interval-seconds');
        return [60, 300, 600, 900].includes(value) ? value : DEFAULT_REFRESH_SECONDS;
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
            this._setStatus('Codex disabled in Preferences');
            return;
        }

        const cancellable = new Gio.Cancellable();
        this._inFlight = cancellable;
        let timedOut = false;
        this._setStatus('Checking Codex…');
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
                    this._setStatus('Codex disabled in Preferences');
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
            this._setStatus('Codex request timed out');
        } else if (error instanceof CodexCliMissingError) {
            this._setStatus('Codex CLI was not found in PATH');
        } else if (error instanceof CodexAuthRequiredError) {
            this._setStatus('Sign in to Codex CLI with your ChatGPT account');
        } else if (error instanceof CodexUnsupportedAccountError) {
            this._setStatus('The active account does not provide ChatGPT plan quota');
        } else if (error instanceof CodexRpcError) {
            this._setStatus('Codex App Server rejected the request');
        } else {
            this._setStatus('Could not query Codex');
        }

        if (this._lastSnapshot) {
            this._renderMetrics(this._lastSnapshot.metrics);
            const ageMs = Date.now() - Date.parse(this._lastSnapshot.fetchedAt);
            if (ageMs > STALE_AFTER_MS) {
                if (ageMs > MAX_STALE_MS) {
                    this._lastSnapshot = null;
                    this._clearMetrics();
                    this._label.text = '—';
                    this._updatedLabel.text = this._t('No recent data');
                } else {
                    this._setStatus('Old data · refresh failed');
                    this._label.text = this._panelSummary(this._lastSnapshot.metrics);
                    this._updatedLabel.text = this._t('Last read {time}', {
                        time: this._formatTime(this._lastSnapshot.fetchedAt),
                    });
                }
            }
        }
        if (!this._lastSnapshot)
            this._updatedLabel.text = this._t('No recent data');
    }

    _renderSnapshot(snapshot) {
        this._renderMetrics(snapshot.metrics);
        if (snapshot.status !== 'ok' || snapshot.metrics.length === 0) {
            this._label.text = '—';
            this._setStatus('The account did not report quota windows');
        } else {
            this._setStatus(snapshot.planType
                ? this._t('ChatGPT account {plan}', {plan: snapshot.planType})
                : 'Codex quota available');
            this._label.text = this._panelSummary(snapshot.metrics);
        }
        this._updatedLabel.text = this._t('Updated {time} · every {duration}', {
            time: this._formatTime(snapshot.fetchedAt),
            duration: this._formatDuration(this._refreshSeconds),
        });
    }

    _renderMetrics(metrics) {
        this._clearMetrics();

        const primary = metrics.find(metric => metric.bucketId === 'codex'
            && metric.windowId === 'primary')
            ?? metrics.find(metric => metric.windowId === 'primary')
            ?? metrics[0];
        if (!primary) {
            this._primarySection.addMenuItem(this._emptyMetricItem('The account did not report quota windows'));
            return;
        }

        this._primarySection.addMenuItem(this._primaryMetricItem(primary));
        for (const metric of metrics) {
            if (metric !== primary)
                this._secondarySection.addMenuItem(this._secondaryMetricItem(metric));
        }
    }

    _clearMetrics() {
        this._primarySection.removeAll();
        this._secondarySection.removeAll();
    }

    _emptyMetricItem(text) {
        const item = this._createMenuItem();
        item.add_child(new St.Label({
            text: this._t(text),
            style: 'color: rgba(255,255,255,0.62); padding: 8px 2px;',
        }));
        return item;
    }

    _primaryMetricItem(metric) {
        const item = this._createMenuItem();
        const content = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style: 'spacing: 5px; padding: 6px 2px 8px;',
        });

        const titleRow = new St.BoxLayout({x_expand: true});
        const title = new St.Label({
            text: this._metricTitle(metric),
            x_expand: true,
            style: 'font-weight: 700; font-size: 12px;',
        });
        titleRow.add_child(title);
        titleRow.add_child(new St.Label({
            text: this._windowLabel(metric),
            style: 'color: rgba(255,255,255,0.58); font-size: 11px;',
        }));
        content.add_child(titleRow);

        const critical = this._isQuotaCritical(metric);
        let valueText = this._t('— free');
        if (metric.remainingPercent !== undefined) {
            valueText = this._t('{value}% available', {value: this._formatPercent(metric.remainingPercent)});
        } else if (metric.usedPercent !== undefined
            && metric.usedPercent >= 0 && metric.usedPercent <= 100) {
            valueText = this._t('{value}% used', {value: this._formatPercent(metric.usedPercent)});
        }
        content.add_child(new St.Label({
            text: valueText,
            style: `font-weight: 700; font-size: 22px; padding-top: 1px;${critical ? ' color: #ff6b6b;' : ''}`,
        }));

        if (metric.usedPercent !== undefined && metric.usedPercent >= 0 && metric.usedPercent <= 100) {
            const track = new St.BoxLayout({
                style: 'background-color: rgba(255,255,255,0.15); border-radius: 99px;',
            });
            track.set_width(280);
            track.set_height(6);
            const fill = new St.Widget({
                style: `background-color: ${critical ? '#ff6b6b' : '#78aeff'}; border-radius: 99px;`,
            });
            fill.set_width(Math.round(280 * metric.usedPercent / 100));
            fill.set_height(6);
            track.add_child(fill);
            content.add_child(track);
        }

        const foot = new St.BoxLayout({x_expand: true});
        const usedText = metric.usedPercent !== undefined
            && metric.usedPercent >= 0 && metric.usedPercent <= 100
            ? this._t('{value}% used', {value: this._formatPercent(metric.usedPercent)})
            : this._t('Usage not reported');
        foot.add_child(new St.Label({
            text: usedText,
            x_expand: true,
            style: 'color: rgba(255,255,255,0.62); font-size: 10px;',
        }));
        foot.add_child(new St.Label({
            text: this._resetLabel(metric, true),
            style: 'color: rgba(255,255,255,0.48); font-size: 10px;',
        }));
        content.add_child(foot);
        item.add_child(content);
        return item;
    }

    _secondaryMetricItem(metric) {
        const item = this._createMenuItem();
        const row = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 12px; padding: 5px 2px;',
        });
        const detail = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style: 'spacing: 2px;',
        });
        detail.add_child(new St.Label({
            text: this._metricTitle(metric),
            style: 'font-weight: 600; font-size: 11px;',
        }));
        detail.add_child(new St.Label({
            text: this._t('Window: {window}', {window: this._windowLabel(metric)}),
            style: 'color: rgba(255,255,255,0.5); font-size: 10px;',
        }));
        row.add_child(detail);

        const remaining = metric.remainingPercent !== undefined
            ? this._t('{value}% free', {value: this._formatPercent(metric.remainingPercent)})
            : this._t('— free');
        const summary = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 2px;',
        });
        summary.add_child(new St.Label({
            text: remaining,
            style: `font-weight: 600; font-size: 11px;${this._isQuotaCritical(metric) ? ' color: #ff6b6b;' : ''}`,
        }));
        summary.add_child(new St.Label({
            text: this._resetLabel(metric, false),
            style: 'color: rgba(255,255,255,0.48); font-size: 10px;',
        }));
        row.add_child(summary);
        item.add_child(row);
        return item;
    }

    _metricTitle(metric) {
        if (metric.bucketId === 'codex')
            return metric.windowId === 'primary' ? this._t('Primary quota') : this._t('Secondary quota');
        const title = metric.bucketId
            .split(/[_-]/)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
        return this._t(title);
    }

    _windowLabel(metric) {
        if (!metric.window.durationSeconds)
            return metric.windowId === 'primary' ? this._t('Primary window') : this._t('Secondary window');
        const seconds = metric.window.durationSeconds;
        if (seconds % 86400 === 0) {
            const days = seconds / 86400;
            return this._t(days === 1 ? '{value} day' : '{value} days', {value: days});
        }
        if (seconds % 3600 === 0) {
            const hours = seconds / 3600;
            return this._t(hours === 1 ? '{value} hour' : '{value} hours', {value: hours});
        }
        const minutes = Math.round(seconds / 60);
        return this._t('{value} min', {value: minutes});
    }

    _resetLabel(metric, includeTime) {
        if (!metric.window.resetsAt)
            return this._t('No reset information');
        const date = new Date(metric.window.resetsAt);
        const options = includeTime
            ? {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}
            : {day: 'numeric', month: 'short'};
        return this._t('Resets {date}', {date: date.toLocaleString(this._locale(), options)});
    }

    _panelSummary(metrics) {
        const primary = metrics.find(metric => metric.bucketId === 'codex'
            && metric.windowId === 'primary')
            ?? metrics.find(metric => metric.windowId === 'primary')
            ?? metrics[0];
        if (primary.remainingPercent !== undefined)
            return `${this._formatPercent(primary.remainingPercent)}%`;
        if (primary.usedPercent !== undefined && primary.usedPercent >= 0 && primary.usedPercent <= 100)
            return `${this._formatPercent(primary.usedPercent)}%`;
        return '—';
    }

    _isQuotaCritical(metric) {
        return metric.remainingPercent !== undefined
            && metric.remainingPercent <= 10;
    }

    _formatPercent(value) {
        return Number.isInteger(value) ? String(value) : value.toFixed(1);
    }

    _formatDuration(seconds) {
        if (seconds % 86400 === 0)
            return this._t('{value} d', {value: seconds / 86400});
        if (seconds % 3600 === 0)
            return this._t('{value} h', {value: seconds / 3600});
        return this._t('{value} min', {value: Math.round(seconds / 60)});
    }

    _setStatus(text) {
        this._accountSubtitle.text = this._t(text);
    }

    _t(message, values = {}) {
        return translate(message, this._language, values);
    }

    _locale() {
        const language = resolveLanguage(this._language);
        return language === 'pt' ? 'pt_BR' : language;
    }

    _formatTime(value) {
        return new Date(value).toLocaleTimeString(this._locale());
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
});

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
