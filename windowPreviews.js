import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// ── Single window thumbnail ──────────────────────────────────────────────────

class WindowPreview {
    constructor(metaWindow, settings) {
        this._metaWindow = metaWindow;
        this._settings = settings;

        // BinLayout: _thumbnailBox sets the actor size; _label overlays on top
        this.actor = new St.Widget({
            style_class: 'gdash-window-preview',
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
            layout_manager: new Clutter.BinLayout(),
        });

        this._thumbnailBox = new St.Widget({
            style_class: 'gdash-thumbnail-box',
            clip_to_allocation: true,
            x_expand: false,
            y_expand: false,
        });
        this.actor.add_child(this._thumbnailBox);

        // App icon overlay — centered, hidden until hover
        const app = Shell.WindowTracker.get_default().get_window_app(metaWindow);
        this._appIcon = new St.Icon({
            gicon: app?.get_icon() ?? null,
            icon_size: 32,
            style_class: 'gdash-window-app-icon',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
            opacity: 0,
        });
        this.actor.add_child(this._appIcon);

        this._clone = null;
        this._actorWatchId = null;
        this._firstFrameId = null;
        this._retryId = null;
        this._onCloneReady = null;
        this._buildClone();

        // Scale from center for the zoom-on-hover effect
        this.actor.set_pivot_point(0.5, 0.5);

        this._buttonPressId = this.actor.connect(
            'button-press-event', (_a, event) => this._onButtonPress(event)
        );

        this._hoverChangedId = this.actor.connect('notify::hover', () => {
            const zoom = this._settings.get_int('preview-hover-zoom') / 100.0;
            if (this.actor.hover) {
                this.actor.ease({
                    scale_x: zoom,
                    scale_y: zoom,
                    duration: 150,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
                this._appIcon.visible = true;
                this._appIcon.ease({
                    opacity: 255,
                    duration: 120,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            } else {
                this.actor.ease({
                    scale_x: 1.0,
                    scale_y: 1.0,
                    duration: 150,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
                this._appIcon.ease({
                    opacity: 0,
                    duration: 120,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => { this._appIcon.visible = false; },
                });
            }
        });

        this._minimizeChangedId = metaWindow.connect(
            'notify::minimized', () => this._updateMinimized()
        );
        this._updateMinimized();

        // Rebuild thumbnail when the window is maximized/unmaximized or
        // otherwise resized via keyboard (Super+↑, tiling, etc.).
        // The notify signals fire before Mutter has applied the new geometry,
        // so defer one tick with idle_add so get_frame_rect() returns the new size.
        this._maximizeHId = metaWindow.connect(
            'notify::maximized-horizontally', () => this._scheduleRebuildClone()
        );
        this._maximizeVId = metaWindow.connect(
            'notify::maximized-vertically', () => this._scheduleRebuildClone()
        );

        this._focusChangedId = global.display.connect(
            'notify::focus-window', () => this._updateFocus()
        );
        this._updateFocus();
    }

    _buildClone() {
        const windowActor = this._metaWindow.get_compositor_private();
        if (!windowActor) {
            // Actor not yet assigned — watch for it and retry
            if (!this._actorWatchId) {
                this._actorWatchId = this._metaWindow.connect(
                    'notify::compositor-private', () => {
                        if (!this._metaWindow.get_compositor_private()) return;
                        this._metaWindow.disconnect(this._actorWatchId);
                        this._actorWatchId = null;
                        this._buildClone();
                    }
                );
            }
            return;
        }

        const frame = this._metaWindow.get_frame_rect();
        const srcW = frame.width > 0 ? frame.width : windowActor.width;
        const srcH = frame.height > 0 ? frame.height : windowActor.height;

        if (srcW === 0 || srcH === 0) {
            // Actor exists but hasn't painted its first frame yet.
            // Connect to first-frame AND schedule a fallback timeout in case
            // first-frame already fired before we could connect (race on fast systems).
            if (!this._firstFrameId) {
                this._firstFrameId = windowActor.connect('first-frame', () => {
                    windowActor.disconnect(this._firstFrameId);
                    this._firstFrameId = null;
                    this._buildClone();
                });
            }
            if (!this._retryId) {
                this._retryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                    this._retryId = null;
                    if (!this._clone)
                        this._buildClone();
                    return GLib.SOURCE_REMOVE;
                });
            }
            return;
        }

        const thumbH = this._settings.get_int('thumbnail-height');
        const thumbW = Math.round(srcW * (thumbH / srcH));

        this._thumbnailBox.set_size(thumbW, thumbH);
        this._clone = new Clutter.Clone({
            source: windowActor,
            width: thumbW,
            height: thumbH,
        });
        this._thumbnailBox.add_child(this._clone);

        this._onCloneReady?.();
    }

    rebuildClone() {
        if (this._firstFrameId) {
            const wa = this._metaWindow.get_compositor_private();
            if (wa) wa.disconnect(this._firstFrameId);
            this._firstFrameId = null;
        }
        if (this._retryId) {
            GLib.source_remove(this._retryId);
            this._retryId = null;
        }
        if (this._clone) {
            this._clone.destroy();
            this._clone = null;
        }
        this._thumbnailBox.remove_all_children();
        this._buildClone();
    }

    // Schedule a rebuild deferred one main-loop tick so that get_frame_rect()
    // has the updated dimensions.  Deduplicated: multiple calls before the
    // idle fires result in only one rebuild.
    _scheduleRebuildClone() {
        if (this._rebuildScheduledId) return;
        this._rebuildScheduledId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._rebuildScheduledId = null;
            this.rebuildClone();
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateMinimized() {
        const minimized = this._metaWindow.minimized;
        if (!this._settings.get_boolean('show-minimized') && minimized) {
            this.actor.hide();
        } else {
            this.actor.show();
            this.actor.opacity = minimized ? 140 : 255;
        }
    }

    _updateFocus() {
        const isFocused = global.display.focus_window === this._metaWindow;
        if (isFocused)
            this.actor.add_style_class_name('focused');
        else
            this.actor.remove_style_class_name('focused');
    }

    _onButtonPress(event) {
        const button = event.get_button();

        if (button === Clutter.BUTTON_PRIMARY) {
            const win = this._metaWindow;
            if (win.minimized) win.unminimize();
            win.activate(global.get_current_time());
            return Clutter.EVENT_STOP;
        }

        let action = null;
        if (button === Clutter.BUTTON_SECONDARY)
            action = this._settings.get_string('window-right-click');
        else if (button === Clutter.BUTTON_MIDDLE)
            action = this._settings.get_string('window-middle-click');

        if (!action) return Clutter.EVENT_PROPAGATE;
        return this._executeWindowAction(action, event);
    }

    _executeWindowAction(action, event) {
        const win = this._metaWindow;
        switch (action) {
            case 'CLOSE':
                win.delete(global.get_current_time());
                return Clutter.EVENT_STOP;
            case 'NEW_INSTANCE': {
                const app = Shell.WindowTracker.get_default().get_window_app(win);
                app?.open_new_window(-1);
                return Clutter.EVENT_STOP;
            }
            case 'CYCLE': {
                const app = Shell.WindowTracker.get_default().get_window_app(win);
                if (app) {
                    const wins = app.get_windows().filter(w => !w.minimized);
                    if (wins.length > 1) {
                        const next = wins[(wins.indexOf(win) + 1) % wins.length];
                        next.activate(global.get_current_time());
                    }
                }
                return Clutter.EVENT_STOP;
            }
            case 'MENU':
            default: {
                // GNOME Shell 50 changed the 3rd arg from Clutter.Event → rect {x,y,w,h}
                const [ex, ey] = event.get_coords();
                Main.wm._windowMenuManager.showWindowMenuForWindow(
                    win, Meta.WindowMenuType.WM, {x: ex, y: ey, width: 1, height: 1});
                return Clutter.EVENT_STOP;
            }
        }
    }

    destroy() {
        if (this._rebuildScheduledId) {
            GLib.source_remove(this._rebuildScheduledId);
            this._rebuildScheduledId = null;
        }
        if (this._firstFrameId) {
            const wa = this._metaWindow.get_compositor_private();
            if (wa) wa.disconnect(this._firstFrameId);
            this._firstFrameId = null;
        }
        if (this._retryId) {
            GLib.source_remove(this._retryId);
            this._retryId = null;
        }
        if (this._actorWatchId) {
            this._metaWindow.disconnect(this._actorWatchId);
            this._actorWatchId = null;
        }
        if (this._hoverChangedId) {
            this.actor.disconnect(this._hoverChangedId);
            this._hoverChangedId = null;
        }
        if (this._buttonPressId) {
            this.actor.disconnect(this._buttonPressId);
            this._buttonPressId = null;
        }
        if (this._minimizeChangedId) {
            this._metaWindow.disconnect(this._minimizeChangedId);
            this._minimizeChangedId = null;
        }
        if (this._maximizeHId) {
            this._metaWindow.disconnect(this._maximizeHId);
            this._maximizeHId = null;
        }
        if (this._maximizeVId) {
            this._metaWindow.disconnect(this._maximizeVId);
            this._maximizeVId = null;
        }
        if (this._focusChangedId) {
            global.display.disconnect(this._focusChangedId);
            this._focusChangedId = null;
        }
        this.actor.destroy();
    }
}

// ── Window previews panel ────────────────────────────────────────────────────

export class WindowPreviews {
    constructor(settings) {
        this._settings = settings;
        this._previews = new Map(); // metaWindow → WindowPreview
        this.onSizeChanged = null; // set by Dock to trigger reposition

        this.actor = new St.Widget({
            style_class: 'gdash-window-previews',
            x_expand: false,
            y_expand: true,
            layout_manager: new Clutter.BinLayout(),
        });

        this._row = new St.BoxLayout({
            style_class: 'gdash-previews-row',
            x_expand: false,
            y_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.add_child(this._row);

        this._populateFromExisting();
        this._row.style = `spacing: ${settings.get_int('preview-spacing')}px`;

        // Rebuild the affected thumbnail after a mouse-driven resize/snap
        // completes.  At grab-op-end the frame rect is already at its new size.
        this._grabOpEndId = global.display.connect('grab-op-end', (_display, win) => {
            if (win) this._previews.get(win)?._scheduleRebuildClone();
        });

        // Watch for new windows — use 'map' (window actor shown on screen) rather
        // than 'window-created' (window not fully initialized yet: type, frame rect
        // and skip-taskbar may all be unset when window-created fires).
        this._windowMappedId = global.window_manager.connect(
            'map', (_wm, windowActor) => {
                const win = windowActor.meta_window;
                if (win && !this._previews.has(win) && this._isWindowVisible(win))
                    this._addWindow(win);
            }
        );

        // Settings changes that affect which windows to show
        ['show-all-workspaces', 'show-minimized'].forEach(key => {
            settings.connect(`changed::${key}`, () => this._rebuild());
        });

        // Workspace switch → re-filter if showing only current workspace
        this._workspaceSwitchedId = global.workspace_manager.connect(
            'active-workspace-changed', () => {
                if (!this._settings.get_boolean('show-all-workspaces'))
                    this._rebuild();
            }
        );

        // Thumbnail height change: resize clones in-place
        settings.connect('changed::thumbnail-height', () => {
            for (const [, preview] of this._previews)
                preview.rebuildClone();
        });

        // Spacing change: update via CSS style property
        settings.connect('changed::preview-spacing', () => {
            this._row.style = `spacing: ${settings.get_int('preview-spacing')}px`;
        });

        // Orientation or dock-size change: full rebuild
        ['dock-position', 'dock-size'].forEach(key => {
            settings.connect(`changed::${key}`, () => this._rebuild());
        });

        this._updateOrientation();
        settings.connect('changed::dock-position', () => this._updateOrientation());
    }

    _updateOrientation() {
        const pos = this._settings.get_string('dock-position');
        this._row.vertical = (pos === 'LEFT' || pos === 'RIGHT');
    }

    _isWindowVisible(win) {
        if (win.is_skip_taskbar()) return false;
        if (win.get_window_type() !== Meta.WindowType.NORMAL) return false;
        if (!this._settings.get_boolean('show-all-workspaces')) {
            const ws = global.workspace_manager.get_active_workspace();
            if (!win.located_on_workspace(ws)) return false;
        }
        return true;
    }

    _populateFromExisting() {
        const allWindows = global.display.get_tab_list(
            Meta.TabList.NORMAL_ALL, null
        );
        for (const win of allWindows) {
            if (this._isWindowVisible(win))
                this._addWindow(win);
        }
    }

    _addWindow(win) {
        if (this._previews.has(win)) return;

        const preview = new WindowPreview(win, this._settings);
        preview._onCloneReady = () => this.onSizeChanged?.();
        this._previews.set(win, preview);
        this._row.add_child(preview.actor);
        this.onSizeChanged?.();

        const unmanagedId = win.connect('unmanaged', () => {
            this._removeWindow(win);
            win.disconnect(unmanagedId);
        });
    }

    _removeWindow(win) {
        const preview = this._previews.get(win);
        if (!preview) return;
        preview.destroy();
        this._previews.delete(win);
        this.onSizeChanged?.();
    }

    _onWindowCreated(_display, win) {
        if (this._isWindowVisible(win))
            this._addWindow(win);
    }

    _rebuild() {
        for (const [, preview] of this._previews)
            preview.destroy();
        this._previews.clear();
        this._populateFromExisting();
    }

    destroy() {
        if (this._grabOpEndId) {
            global.display.disconnect(this._grabOpEndId);
            this._grabOpEndId = null;
        }
        if (this._windowMappedId) {
            global.window_manager.disconnect(this._windowMappedId);
            this._windowMappedId = null;
        }
        if (this._workspaceSwitchedId) {
            global.workspace_manager.disconnect(this._workspaceSwitchedId);
            this._workspaceSwitchedId = null;
        }
        for (const [, preview] of this._previews)
            preview.destroy();
        this._previews.clear();
        this.actor.destroy();
    }
}
