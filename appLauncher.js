import Gio from 'gi://Gio';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';

const GNOME_SHELL_SCHEMA = 'org.gnome.shell';
const FAVORITES_KEY = 'favorite-apps';

// ── App icon button ──────────────────────────────────────────────────────────

class AppIconButton {
    constructor(app, iconSize, settings) {
        this._app = app;
        this._settings = settings;
        this._menu = null;

        const icon = new St.Icon({
            gicon: app.get_icon(),
            icon_size: iconSize,
            style_class: 'gdash-app-icon-image',
        });

        this.actor = new St.Button({
            style_class: 'gdash-app-icon',
            child: icon,
            can_focus: true,
            reactive: true,
            track_hover: true,
            x_expand: false,
            y_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.set_pivot_point(0.5, 0.5);
        this.actor.set_name(app.get_name());

        this._clickId = this.actor.connect('clicked', () => app.activate());

        this._menuManager = new PopupMenu.PopupMenuManager(this.actor);

        this._rightClickId = this.actor.connect(
            'button-press-event', (_a, event) => {
                if (event.get_button() === Clutter.BUTTON_SECONDARY) {
                    this._showMenu();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }
        );
    }

    setIconSize(size) {
        const icon = this.actor.get_child();
        if (icon) icon.icon_size = size;
    }

    // ── Context menu ─────────────────────────────────────────────────────────

    _menuSide() {
        const pos = this._settings?.get_string('dock-position') ?? 'BOTTOM';
        if (pos === 'TOP')   return St.Side.TOP;
        if (pos === 'LEFT')  return St.Side.LEFT;
        if (pos === 'RIGHT') return St.Side.RIGHT;
        return St.Side.BOTTOM;
    }

    _showMenu() {
        // Destroy any existing menu first (handles dock-position changes)
        if (this._menu) {
            this._menuManager.removeMenu(this._menu);
            this._menu.destroy();
            this._menu = null;
        }

        this._menu = new PopupMenu.PopupMenu(this.actor, 0.5, this._menuSide());
        Main.uiGroup.add_child(this._menu.actor);
        this._menuManager.addMenu(this._menu);

        this._buildMenuItems();

        this._menu.connect('open-state-changed', (m, open) => {
            if (open) return;
            this._menuManager.removeMenu(this._menu);
            this._menu.destroy();
            this._menu = null;
        });

        this._menu.open(true);
    }

    _buildMenuItems() {
        const app = this._app;
        const isRunning = app.get_state() === Shell.AppState.RUNNING;

        // ── Launch section ────────────────────────────────────────────────────
        if (isRunning && app.can_open_new_window()) {
            this._menu.addAction('New Window', () => app.open_new_window(-1));
        } else if (!isRunning) {
            this._menu.addAction('Open', () => app.activate());
        }

        // ── Open windows ──────────────────────────────────────────────────────
        if (isRunning) {
            const wins = app.get_windows();
            if (wins.length > 0) {
                this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                for (const win of wins) {
                    const title = win.get_title() ?? app.get_name();
                    const label = title.length > 50 ? `${title.slice(0, 47)}…` : title;
                    this._menu.addAction(label, () => {
                        if (win.minimized) win.unminimize();
                        win.activate(global.get_current_time());
                    });
                }
            }
        }

        // ── Dash management ───────────────────────────────────────────────────
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const favs = AppFavorites.getAppFavorites();
        const isPinned = favs.isFavorite(app.get_id());
        this._menu.addAction(isPinned ? 'Unpin from Dash' : 'Pin to Dash', () => {
            if (isPinned)
                favs.removeFavorite(app.get_id());
            else
                favs.addFavorite(app.get_id());
        });

        this._menu.addAction('App Details', () => {
            Gio.AppInfo.launch_default_for_uri_async(
                `appstream://${app.get_id()}`, null, null, null);
        });

        // ── Quit ──────────────────────────────────────────────────────────────
        if (isRunning) {
            this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._menu.addAction('Quit', () => {
                app.get_windows().forEach(w => w.delete(global.get_current_time()));
            });
        }
    }

    destroy() {
        if (this._menu) {
            this._menuManager.removeMenu(this._menu);
            this._menu.destroy();
            this._menu = null;
        }
        if (this._rightClickId) {
            this.actor.disconnect(this._rightClickId);
            this._rightClickId = null;
        }
        if (this._clickId) {
            this.actor.disconnect(this._clickId);
            this._clickId = null;
        }
        this.actor.destroy();
    }
}

// ── AppLauncher panel ────────────────────────────────────────────────────────

export class AppLauncher {
    constructor(settings) {
        this._settings = settings;
        this._iconButtons = [];

        this.actor = new St.BoxLayout({
            style_class: 'gdash-app-launcher',
            x_expand: false,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._gnomeSettings = new Gio.Settings({schema: GNOME_SHELL_SCHEMA});
        this._appSystem = Shell.AppSystem.get_default();

        this._overviewButton = null;
        this._rebuild();
        this.actor.style = `spacing: ${settings.get_int('launcher-spacing')}px`;

        this._favChangedId = this._gnomeSettings.connect(
            `changed::${FAVORITES_KEY}`, () => this._rebuild()
        );
        this._iconSizeChangedId = settings.connect(
            'changed::icon-size', () => this._rebuild()
        );
        this._spacingChangedId = settings.connect(
            'changed::launcher-spacing',
            () => { this.actor.style = `spacing: ${settings.get_int('launcher-spacing')}px`; }
        );
        this._positionChangedId = settings.connect(
            'changed::dock-position', () => this._updateOrientation()
        );
        this._overviewButtonSettingId = settings.connect(
            'changed::show-overview-button', () => this._buildOverviewButton()
        );

        this._updateOrientation();
    }

    _updateOrientation() {
        const pos = this._settings.get_string('dock-position');
        this.actor.vertical = (pos === 'LEFT' || pos === 'RIGHT');
    }

    _buildOverviewButton() {
        if (this._overviewButton) {
            this._overviewButton.destroy();
            this._overviewButton = null;
        }
        if (!this._settings.get_boolean('show-overview-button')) return;

        const iconSize = this._settings.get_int('icon-size');
        const icon = new St.Icon({
            icon_name: 'view-app-grid-symbolic',
            icon_size: iconSize,
            style_class: 'gdash-app-icon-image',
        });
        this._overviewButton = new St.Button({
            style_class: 'gdash-app-icon gdash-overview-button',
            child: icon,
            can_focus: true,
            reactive: true,
            track_hover: true,
            x_expand: false,
            y_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._overviewButton.set_pivot_point(0.5, 0.5);
        this._overviewButton.connect('clicked', () => {
            if (Main.overview.visible)
                Main.overview.hide();
            else
                Main.overview.showApps();
        });
        this._overviewButton.connect('notify::hover', () => {
            const zoom = this._settings.get_int('launcher-hover-zoom') / 100.0;
            this._overviewButton.ease({
                scale_x: this._overviewButton.hover ? zoom : 1.0,
                scale_y: this._overviewButton.hover ? zoom : 1.0,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });
        this.actor.insert_child_at_index(this._overviewButton, 0);
    }

    _rebuild() {
        this._iconButtons.forEach(b => b.destroy());
        this._iconButtons = [];
        this._buildOverviewButton();

        const iconSize = this._settings.get_int('icon-size');
        const favorites = this._gnomeSettings.get_strv(FAVORITES_KEY);

        for (const appId of favorites) {
            const app = this._appSystem.lookup_app(appId);
            if (!app) continue;

            const btn = new AppIconButton(app, iconSize, this._settings);
            btn.actor.connect('notify::hover', () => {
                const zoom = this._settings.get_int('launcher-hover-zoom') / 100.0;
                btn.actor.ease({
                    scale_x: btn.actor.hover ? zoom : 1.0,
                    scale_y: btn.actor.hover ? zoom : 1.0,
                    duration: 150,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            });
            this._iconButtons.push(btn);
            this.actor.add_child(btn.actor);
        }
    }

    destroy() {
        if (this._overviewButton) {
            this._overviewButton.destroy();
            this._overviewButton = null;
        }
        this._iconButtons.forEach(b => b.destroy());
        this._iconButtons = [];

        if (this._favChangedId) {
            this._gnomeSettings.disconnect(this._favChangedId);
            this._favChangedId = null;
        }
        if (this._iconSizeChangedId) {
            this._settings.disconnect(this._iconSizeChangedId);
            this._iconSizeChangedId = null;
        }
        if (this._spacingChangedId) {
            this._settings.disconnect(this._spacingChangedId);
            this._spacingChangedId = null;
        }
        if (this._positionChangedId) {
            this._settings.disconnect(this._positionChangedId);
            this._positionChangedId = null;
        }
        if (this._overviewButtonSettingId) {
            this._settings.disconnect(this._overviewButtonSettingId);
            this._overviewButtonSettingId = null;
        }
        this.actor.destroy();
    }
}
