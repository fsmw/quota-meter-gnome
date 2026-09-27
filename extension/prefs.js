import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {resolveLanguage, translate} from './i18n.js';

export default class AgnomeTopPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({icon_name: 'speedometer-symbolic'});
        const group = new Adw.PreferencesGroup();
        const enabled = new Adw.SwitchRow();
        const refreshModel = new Gtk.StringList();
        const refreshRow = new Adw.ComboRow({model: refreshModel});
        const languageModel = new Gtk.StringList();
        const languageRow = new Adw.ComboRow({model: languageModel});
        const intervals = [60, 300, 600, 900];
        const languages = ['system', 'es', 'en', 'pt'];
        const languageNames = ['System language', 'Spanish', 'English', 'Portuguese'];
        let syncingLanguage = false;

        enabled.active = settings.get_boolean('codex-enabled');
        enabled.connect('notify::active', () => {
            settings.set_boolean('codex-enabled', enabled.active);
        });
        const syncInterval = () => {
            const selected = intervals.indexOf(settings.get_int('refresh-interval-seconds'));
            refreshRow.selected = selected >= 0 ? selected : 0;
        };
        refreshRow.connect('notify::selected', () => {
            const value = intervals[refreshRow.selected];
            if (value)
                settings.set_int('refresh-interval-seconds', value);
        });

        const syncLanguage = () => {
            const preference = settings.get_string('language');
            const language = resolveLanguage(preference);
            const tr = message => translate(message, language);
            syncingLanguage = true;
            page.title = 'Quota Meter';
            group.title = tr('Codex');
            group.description = tr('ChatGPT plan quota queried through Codex App Server.');
            enabled.title = tr('Show Codex quota');
            enabled.subtitle = tr('Requires Codex CLI installed and authenticated.');
            refreshRow.title = tr('Refresh interval');
            languageRow.title = tr('Language');
            languageRow.subtitle = tr('Follow the desktop language or choose one for this extension.');

            refreshModel.splice(0, refreshModel.get_n_items(), [
                tr('1 minute'), tr('5 minutes'), tr('10 minutes'), tr('15 minutes'),
            ]);
            languageModel.splice(0, languageModel.get_n_items(), languageNames.map(tr));
            const selectedLanguage = languages.indexOf(preference);
            languageRow.selected = selectedLanguage >= 0 ? selectedLanguage : 0;
            syncingLanguage = false;
        };

        languageRow.connect('notify::selected', () => {
            if (!syncingLanguage && languages[languageRow.selected])
                settings.set_string('language', languages[languageRow.selected]);
        });
        settings.connect('changed::language', syncLanguage);
        syncInterval();
        syncLanguage();

        group.add(enabled);
        group.add(refreshRow);
        group.add(languageRow);
        page.add(group);
        window.add(page);
    }
}
