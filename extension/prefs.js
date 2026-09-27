import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class AgnomeTopPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: 'Agnome Top',
            icon_name: 'speedometer-symbolic',
        });
        const group = new Adw.PreferencesGroup({
            title: 'Codex',
            description: 'Cuota del plan ChatGPT consultada mediante Codex App Server.',
        });
        const enabled = new Adw.SwitchRow({
            title: 'Mostrar cuota de Codex',
            subtitle: 'Requiere Codex CLI instalado y autenticado.',
        });
        enabled.active = settings.get_boolean('codex-enabled');
        enabled.connect('notify::active', () => {
            settings.set_boolean('codex-enabled', enabled.active);
        });

        const refreshModel = new Gtk.StringList();
        refreshModel.append('5 minutos');
        refreshModel.append('10 minutos');
        refreshModel.append('15 minutos');
        const refreshRow = new Adw.ComboRow({
            title: 'Frecuencia de actualización',
            model: refreshModel,
        });
        const intervals = [300, 600, 900];
        const syncInterval = () => {
            const value = settings.get_int('refresh-interval-seconds');
            const index = intervals.indexOf(value);
            refreshRow.selected = index >= 0 ? index : 0;
        };
        syncInterval();
        refreshRow.connect('notify::selected', () => {
            const value = intervals[refreshRow.selected];
            if (value)
                settings.set_int('refresh-interval-seconds', value);
        });

        group.add(enabled);
        group.add(refreshRow);
        page.add(group);
        window.add(page);
    }
}
