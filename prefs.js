import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class GDashPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(600, 600);

        // ── Layout page ──────────────────────────────────────────────────────
        const layoutPage = new Adw.PreferencesPage({
            title: 'Layout',
            icon_name: 'view-grid-symbolic',
        });
        window.add(layoutPage);

        const layoutGroup = new Adw.PreferencesGroup({title: 'Dock position & size'});
        layoutPage.add(layoutGroup);

        layoutGroup.add(this._makeMonitorDropDown(settings));

        layoutGroup.add(this._makeDropDown(settings, 'dock-position', 'Position', [
            {label: 'Bottom', value: 'BOTTOM'},
            {label: 'Top',    value: 'TOP'},
            {label: 'Left',   value: 'LEFT'},
            {label: 'Right',  value: 'RIGHT'},
        ]));

        layoutGroup.add(this._makeDropDown(settings, 'dock-alignment', 'Alignment', [
            {label: 'Start',  value: 'START'},
            {label: 'Center', value: 'CENTER'},
            {label: 'End',    value: 'END'},
        ]));

        layoutGroup.add(this._makeSpinRow(settings, 'dock-size',
            'Dock thickness', 'Pixels', 48, 256, 4));

        layoutGroup.add(this._makeSpinRow(settings, 'icon-size',
            'App icon size', 'Pixels', 24, 128, 4));

        const spacingGroup = new Adw.PreferencesGroup({title: 'Spacing'});
        layoutPage.add(spacingGroup);

        spacingGroup.add(this._makeSpinRow(settings, 'launcher-spacing',
            'App icon spacing', 'Pixels', 0, 48, 1));

        spacingGroup.add(this._makeSpinRow(settings, 'preview-spacing',
            'Window thumbnail spacing', 'Pixels', 0, 48, 1));

        const hoverGroup = new Adw.PreferencesGroup({title: 'Hover zoom'});
        layoutPage.add(hoverGroup);

        hoverGroup.add(this._makeSpinRow(settings, 'launcher-hover-zoom',
            'Icon zoom', '% — 100 = no zoom, 130 = 30% larger', 100, 200, 5));

        hoverGroup.add(this._makeSpinRow(settings, 'preview-hover-zoom',
            'Thumbnail zoom', '% — 100 = no zoom, 130 = 30% larger', 100, 200, 5));

        // ── Thumbnails page ──────────────────────────────────────────────────
        const thumbPage = new Adw.PreferencesPage({
            title: 'Windows',
            icon_name: 'window-symbolic',
        });
        window.add(thumbPage);

        const thumbGroup = new Adw.PreferencesGroup({title: 'Window previews'});
        thumbPage.add(thumbGroup);

        thumbGroup.add(this._makeSpinRow(settings, 'thumbnail-height',
            'Thumbnail height', 'Pixels', 32, 200, 4));

        thumbGroup.add(this._makeSwitchRow(settings, 'show-all-workspaces',
            'All workspaces', 'Show windows from every workspace'));

        thumbGroup.add(this._makeSwitchRow(settings, 'show-minimized',
            'Show minimized', 'Include minimized windows (shown dimmed)'));

        thumbGroup.add(this._makeSwitchRow(settings, 'show-minimized-only',
            'Minimized only', 'Show only minimized windows — use the preview strip as a minimized-window tray'));

        const clickGroup = new Adw.PreferencesGroup({title: 'Click actions'});
        thumbPage.add(clickGroup);

        const clickOptions = [
            {label: 'Open window menu', value: 'MENU'},
            {label: 'Close',            value: 'CLOSE'},
            {label: 'New instance',     value: 'NEW_INSTANCE'},
            {label: 'Cycle windows',    value: 'CYCLE'},
        ];
        clickGroup.add(this._makeDropDown(settings, 'window-right-click',  'Right click',  clickOptions));
        clickGroup.add(this._makeDropDown(settings, 'window-middle-click', 'Middle click', clickOptions));

        // ── Behaviour page ───────────────────────────────────────────────────
        const behaviourPage = new Adw.PreferencesPage({
            title: 'Behaviour',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(behaviourPage);

        const dashGroup = new Adw.PreferencesGroup({title: 'GNOME Shell'});
        behaviourPage.add(dashGroup);

        dashGroup.add(this._makeSwitchRow(settings, 'show-overview-button',
            'Show overview button',
            'Display an Activities button at the start of the dock'));

        dashGroup.add(this._makeSwitchRow(settings, 'hide-dash',
            'Hide built-in dash',
            'Remove the standard GNOME dash from the overview (use GDash instead)'));

        const hideGroup = new Adw.PreferencesGroup({title: 'Visibility'});
        behaviourPage.add(hideGroup);

        hideGroup.add(this._makeDropDown(settings, 'dock-behavior', 'Behavior', [
            {label: 'Always visible',    value: 'ALWAYS_VISIBLE'},
            {label: 'Intellihide',       value: 'INTELLIHIDE'},
            {label: 'Windows can cover', value: 'WINDOWS_CAN_COVER'},
            {label: 'Always hidden',     value: 'ALWAYS_HIDDEN'},
        ]));

        hideGroup.add(this._makeSpinRow(settings, 'hide-delay',
            'Hide delay', 'ms — delay before the dock hides', 0, 5000, 50));

        // ── Appearance page ──────────────────────────────────────────────────
        const appearancePage = new Adw.PreferencesPage({
            title: 'Appearance',
            icon_name: 'preferences-desktop-wallpaper-symbolic',
        });
        window.add(appearancePage);

        const themeGroup = new Adw.PreferencesGroup({title: 'Theme'});
        appearancePage.add(themeGroup);

        themeGroup.add(this._makeSwitchRow(settings, 'use-theme-colors',
            'Use shell theme colors',
            'Removes custom styling so the active GNOME Shell theme styles the dock'));

        const bgGroup = new Adw.PreferencesGroup({title: 'Background'});
        appearancePage.add(bgGroup);

        bgGroup.add(this._makeColorRow(settings, 'background-color',
            'Background color'));
        bgGroup.add(this._makeSpinRow(settings, 'border-radius',
            'Corner radius', 'px', 0, 48, 1));
        bgGroup.add(this._makeSpinRow(settings, 'dock-padding',
            'Padding', 'px — space inside the dock border', 0, 32, 1));
        bgGroup.add(this._makeSpinRow(settings, 'edge-margin',
            'Edge margin', 'px — gap between dock and screen edge', 0, 64, 1));

        const outerGroup = new Adw.PreferencesGroup({
            title: 'Outer border',
            description: 'The border drawn around the dock background',
        });
        appearancePage.add(outerGroup);

        outerGroup.add(this._makeSpinRow(settings, 'outer-border-width',
            'Width', 'px (0 = no border)', 0, 8, 1));
        outerGroup.add(this._makeColorRow(settings, 'outer-border-color', 'Color'));
    }

    // ── Widget helpers ───────────────────────────────────────────────────────

    _makeMonitorDropDown(settings) {
        const row = new Adw.ActionRow({title: 'Monitor'});

        const display = Gdk.Display.get_default();
        const gdkMonitors = display.get_monitors();
        const count = gdkMonitors.get_n_items();

        const options = [{label: 'Primary (auto)', value: -1}];
        for (let i = 0; i < count; i++) {
            const mon = gdkMonitors.get_item(i);
            const geo = mon.get_geometry();
            const name =
                mon.get_description?.() ||
                [mon.get_manufacturer(), mon.get_model()].filter(Boolean).join(' ') ||
                mon.get_connector() ||
                `Monitor ${i}`;
            options.push({label: `${name} (${geo.width}×${geo.height})`, value: i});
        }

        const model = new Gtk.StringList({strings: options.map(o => o.label)});
        const currentVal = settings.get_int('monitor-index');
        const currentIdx = Math.max(0, options.findIndex(o => o.value === currentVal));

        const combo = new Gtk.DropDown({
            model,
            selected: currentIdx,
            valign: Gtk.Align.CENTER,
        });

        combo.connect('notify::selected', () => {
            settings.set_int('monitor-index', options[combo.selected].value);
        });

        settings.connect('changed::monitor-index', () => {
            const val = settings.get_int('monitor-index');
            const idx = options.findIndex(o => o.value === val);
            if (idx >= 0 && combo.selected !== idx)
                combo.selected = idx;
        });

        row.add_suffix(combo);
        row.activatable_widget = combo;
        return row;
    }

    _makeDropDown(settings, key, title, options) {
        const row = new Adw.ActionRow({title});
        const model = new Gtk.StringList({strings: options.map(o => o.label)});

        const current = settings.get_string(key);
        const currentIdx = options.findIndex(o => o.value === current);

        const combo = new Gtk.DropDown({
            model,
            selected: currentIdx >= 0 ? currentIdx : 0,
            valign: Gtk.Align.CENTER,
        });

        combo.connect('notify::selected', () => {
            settings.set_string(key, options[combo.selected].value);
        });

        settings.connect(`changed::${key}`, () => {
            const idx = options.findIndex(o => o.value === settings.get_string(key));
            if (idx >= 0 && combo.selected !== idx)
                combo.selected = idx;
        });

        row.add_suffix(combo);
        row.activatable_widget = combo;
        return row;
    }

    _makeSpinRow(settings, key, title, subtitle, min, max, step) {
        const row = new Adw.ActionRow({title, subtitle});
        const spin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: min, upper: max, step_increment: step,
                value: settings.get_int(key),
            }),
            valign: Gtk.Align.CENTER,
            digits: 0,
        });
        settings.bind(key, spin, 'value', Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(spin);
        row.activatable_widget = spin;
        return row;
    }

    _makeSwitchRow(settings, key, title, subtitle = '') {
        const row = new Adw.SwitchRow({title, subtitle});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _makeColorRow(settings, key, title, subtitle = '') {
        const row = new Adw.ActionRow({title, subtitle});

        const initialRgba = new Gdk.RGBA();
        initialRgba.parse(settings.get_string(key));

        const dialog = new Gtk.ColorDialog({with_alpha: true, title});
        const button = new Gtk.ColorDialogButton({
            dialog,
            rgba: initialRgba,
            valign: Gtk.Align.CENTER,
        });

        button.connect('notify::rgba', () => {
            const c = button.rgba;
            const r = Math.round(c.red * 255);
            const g = Math.round(c.green * 255);
            const b = Math.round(c.blue * 255);
            const a = parseFloat(c.alpha.toFixed(3));
            settings.set_string(key, `rgba(${r},${g},${b},${a})`);
        });

        // Keep button in sync if the setting is changed externally
        settings.connect(`changed::${key}`, () => {
            const rgba = new Gdk.RGBA();
            rgba.parse(settings.get_string(key));
            if (!button.rgba.equal(rgba))
                button.rgba = rgba;
        });

        row.add_suffix(button);
        row.activatable_widget = button;
        return row;
    }
}
