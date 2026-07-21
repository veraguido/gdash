import Gio from 'gi://Gio';
import Mtk from 'gi://Mtk';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';

const GNOME_SHELL_SCHEMA = 'org.gnome.shell';
const FAVORITES_KEY = 'favorite-apps';
const DRAG_THRESHOLD = 8;

// ── App icon button ──────────────────────────────────────────────────────────

class AppIconButton {
    constructor(app, iconSize, settings) {
        this._app = app;
        this._settings = settings;
        this._menu = null;
        this._launcher = null;
        this._dragPending = false;
        this._dragging = false;
        this._stageCaptureId = null;

        this._icon = new St.Icon({
            gicon: app.get_icon(),
            icon_size: iconSize,
            style_class: 'gdash-app-icon-image',
        });

        this._indicator = new St.Widget({
            style_class: 'gdash-running-indicator',
            opacity: 0,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // BoxLayout order and direction encode the position; no runtime alignment
        // mutation needed — indicator-position changes call _rebuild() instead.
        const indPos = settings.get_string('indicator-position');
        const iconBox = new St.BoxLayout({
            vertical: indPos === 'TOP' || indPos === 'BOTTOM',
        });
        if (indPos === 'TOP' || indPos === 'LEFT') {
            iconBox.add_child(this._indicator);
            iconBox.add_child(this._icon);
        } else {
            iconBox.add_child(this._icon);
            iconBox.add_child(this._indicator);
        }

        this.actor = new St.Button({
            style_class: 'gdash-app-icon',
            child: iconBox,
            can_focus: true,
            reactive: true,
            track_hover: true,
            x_expand: false,
            y_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.set_pivot_point(0.5, 0.5);
        this.actor.set_name(app.get_name());

        this._appStateId = app.connect('notify::state', () => this._updateIndicator());
        this._indicatorSettingId = settings.connect(
            'changed::show-running-indicators', () => this._updateIndicator()
        );
        this._updateIndicator();

        // Keep geometry fresh: allocation fires on initial placement / icon-size rebuild;
        // windows-changed covers new windows opened while the dock is static.
        this._allocationId = this.actor.connect(
            'notify::allocation', () => this.updateWindowGeometry()
        );
        this._windowsChangedId = app.connect(
            'windows-changed', () => this.updateWindowGeometry()
        );

        this._clickId = this.actor.connect('clicked', () => {
            if (!this._dragging) app.activate();
        });

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

        this._dragPressId = this.actor.connect(
            'button-press-event', (_a, event) => {
                if (event.get_button() !== Clutter.BUTTON_PRIMARY) return Clutter.EVENT_PROPAGATE;
                [this._dragStartX, this._dragStartY] = event.get_coords();
                this._dragPending = true;
                this._stageCaptureId = global.stage.connect(
                    'captured-event', (_stage, ev) => this._onStageCapture(ev)
                );
                return Clutter.EVENT_PROPAGATE;
            }
        );
    }

    connectLauncher(launcher) {
        this._launcher = launcher;
    }

    _onStageCapture(event) {
        const type = event.type();

        if (type === Clutter.EventType.MOTION) {
            const [x, y] = event.get_coords();
            if (this._dragPending) {
                if (Math.hypot(x - this._dragStartX, y - this._dragStartY) > DRAG_THRESHOLD) {
                    this._dragPending = false;
                    this._dragging = true;
                    this._launcher?._startDrag(this, x, y);
                }
            } else if (this._dragging) {
                this._launcher?._updateDrag(x, y);
                return Clutter.EVENT_STOP;
            }
        } else if (type === Clutter.EventType.BUTTON_RELEASE) {
            const wasDragging = this._dragging;
            this._dragPending = false;
            this._dragging = false;
            this._disconnectStageCapture();
            if (wasDragging) {
                this._launcher?._endDrag();
                return Clutter.EVENT_STOP;
            }
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _disconnectStageCapture() {
        if (this._stageCaptureId) {
            global.stage.disconnect(this._stageCaptureId);
            this._stageCaptureId = null;
        }
    }

    _updateIndicator() {
        const show = this._settings.get_boolean('show-running-indicators');
        const running = this._app.get_state() === Shell.AppState.RUNNING;
        this._indicator.opacity = (show && running) ? 255 : 0;
    }

    updateWindowGeometry() {
        if (!this.actor.get_stage()) return;
        const [x, y] = this.actor.get_transformed_position();
        const {width: w, height: h} = this.actor;
        if (w === 0 || h === 0) return;
        const rect = new Mtk.Rectangle({
            x: Math.round(x), y: Math.round(y),
            width: Math.round(w), height: Math.round(h),
        });
        for (const win of this._app.get_windows())
            win.set_icon_geometry(rect);
    }

    setIconSize(size) {
        this._icon.icon_size = size;
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

        if (isRunning && app.can_open_new_window()) {
            this._menu.addAction('New Window', () => app.open_new_window(-1));
        } else if (!isRunning) {
            this._menu.addAction('Open', () => app.activate());
        }

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

        if (isRunning) {
            this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._menu.addAction('Quit', () => {
                app.get_windows().forEach(w => w.delete(global.get_current_time()));
            });
        }
    }

    destroy() {
        this._disconnectStageCapture();
        if (this._appStateId) {
            this._app.disconnect(this._appStateId);
            this._appStateId = null;
        }
        if (this._indicatorSettingId) {
            this._settings.disconnect(this._indicatorSettingId);
            this._indicatorSettingId = null;
        }
        if (this._allocationId) {
            this.actor.disconnect(this._allocationId);
            this._allocationId = null;
        }
        if (this._windowsChangedId) {
            this._app.disconnect(this._windowsChangedId);
            this._windowsChangedId = null;
        }
        if (this._dragPressId) {
            this.actor.disconnect(this._dragPressId);
            this._dragPressId = null;
        }
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
        this._dragButton = null;
        this._dragClone = null;

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
        this._indicatorPositionChangedId = settings.connect(
            'changed::indicator-position', () => this._rebuild()
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

    updateWindowGeometries() {
        for (const btn of this._iconButtons)
            btn.updateWindowGeometry();
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
            btn.connectLauncher(this);
            btn.actor.connect('notify::hover', () => {
                if (this._dragButton) return;
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

    // ── Drag reorder ─────────────────────────────────────────────────────────

    _startDrag(btn, stageX, stageY) {
        this._dragButton = btn;

        const [ax, ay] = btn.actor.get_transformed_position();
        this._dragOffsetX = stageX - ax;
        this._dragOffsetY = stageY - ay;

        const iconSize = this._settings.get_int('icon-size');
        this._dragClone = new St.Icon({
            gicon: btn._app.get_icon(),
            icon_size: iconSize,
            style_class: 'gdash-app-icon-image',
            opacity: 220,
        });
        Main.uiGroup.add_child(this._dragClone);
        // Center the bare icon over the button's position
        this._dragClone.set_position(
            ax + Math.round((btn.actor.width  - iconSize) / 2),
            ay + Math.round((btn.actor.height - iconSize) / 2)
        );

        // Dim and shrink original — it stays in the layout as the drop placeholder
        btn.actor.opacity = 80;
        btn.actor.set_scale(0.85, 0.85);
    }

    _updateDrag(stageX, stageY) {
        if (!this._dragButton || !this._dragClone) return;

        const iconSize = this._settings.get_int('icon-size');
        this._dragClone.set_position(
            stageX - this._dragOffsetX + Math.round((this._dragButton.actor.width  - iconSize) / 2),
            stageY - this._dragOffsetY + Math.round((this._dragButton.actor.height - iconSize) / 2)
        );

        const newIdx = this._computeDropIndex(stageX, stageY);
        if (newIdx === null) return;

        const curIdx = this._iconButtons.indexOf(this._dragButton);
        if (newIdx === curIdx) return;

        // Reorder the ghost in the live layout
        this._iconButtons.splice(curIdx, 1);
        this._iconButtons.splice(newIdx, 0, this._dragButton);

        const offset = this._overviewButton ? 1 : 0;
        for (let i = 0; i < this._iconButtons.length; i++)
            this.actor.set_child_at_index(this._iconButtons[i].actor, i + offset);
    }

    _computeDropIndex(stageX, stageY) {
        const pos = this._settings.get_string('dock-position');
        const vertical = pos === 'LEFT' || pos === 'RIGHT';

        let bestIdx = null;
        let bestDist = Infinity;

        for (let i = 0; i < this._iconButtons.length; i++) {
            const btn = this._iconButtons[i];
            if (btn === this._dragButton) continue;

            const [bx, by] = btn.actor.get_transformed_position();
            const cx = bx + btn.actor.width  / 2;
            const cy = by + btn.actor.height / 2;
            const dist = vertical ? Math.abs(stageY - cy) : Math.abs(stageX - cx);

            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = (vertical ? stageY < cy : stageX < cx) ? i : i + 1;
            }
        }

        return bestIdx;
    }

    _endDrag() {
        if (!this._dragButton) return;

        this._dragButton.actor.opacity = 255;
        this._dragButton.actor.set_scale(1.0, 1.0);
        this._dragButton = null;

        if (this._dragClone) {
            Main.uiGroup.remove_child(this._dragClone);
            this._dragClone.destroy();
            this._dragClone = null;
        }

        // Persist new order; _favChangedId fires synchronously → _rebuild() resets button state
        const newFavorites = this._iconButtons.map(b => b._app.get_id());
        this._gnomeSettings.set_strv(FAVORITES_KEY, newFavorites);
    }

    // ── Teardown ─────────────────────────────────────────────────────────────

    destroy() {
        // Clean up any in-progress drag
        if (this._dragButton) {
            this._dragButton.actor.opacity = 255;
            this._dragButton.actor.set_scale(1.0, 1.0);
            this._dragButton = null;
        }
        if (this._dragClone) {
            Main.uiGroup.remove_child(this._dragClone);
            this._dragClone.destroy();
            this._dragClone = null;
        }

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
        if (this._indicatorPositionChangedId) {
            this._settings.disconnect(this._indicatorPositionChangedId);
            this._indicatorPositionChangedId = null;
        }
        this.actor.destroy();
    }
}

// ── Running (unpinned) apps panel ────────────────────────────────────────────

export class RunningAppsLauncher {
    constructor(settings) {
        this._settings = settings;
        this._iconButtons = [];

        this.actor = new St.BoxLayout({
            style_class: 'gdash-app-launcher',
            x_expand: false,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });

        this._gnomeSettings = new Gio.Settings({schema: GNOME_SHELL_SCHEMA});
        this._appSystem = Shell.AppSystem.get_default();

        this._rebuild();
        this.actor.style = `spacing: ${settings.get_int('launcher-spacing')}px`;

        this._appStateId = this._appSystem.connect(
            'app-state-changed', () => this._rebuild()
        );
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
        this._indicatorPositionChangedId = settings.connect(
            'changed::indicator-position', () => this._rebuild()
        );
        this._updateOrientation();
    }

    _updateOrientation() {
        const pos = this._settings.get_string('dock-position');
        this.actor.vertical = (pos === 'LEFT' || pos === 'RIGHT');
    }

    _rebuild() {
        this._iconButtons.forEach(b => b.destroy());
        this._iconButtons = [];

        const iconSize  = this._settings.get_int('icon-size');
        const favorites = new Set(this._gnomeSettings.get_strv(FAVORITES_KEY));

        for (const app of this._appSystem.get_running()) {
            if (favorites.has(app.get_id())) continue;

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

        this.actor.visible = this._iconButtons.length > 0;
        this.onSizeChanged?.();
    }

    updateWindowGeometries() {
        for (const btn of this._iconButtons)
            btn.updateWindowGeometry();
    }

    destroy() {
        this._iconButtons.forEach(b => b.destroy());
        this._iconButtons = [];

        if (this._appStateId) {
            this._appSystem.disconnect(this._appStateId);
            this._appStateId = null;
        }
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
        if (this._indicatorPositionChangedId) {
            this._settings.disconnect(this._indicatorPositionChangedId);
            this._indicatorPositionChangedId = null;
        }
        this.actor.destroy();
    }
}
