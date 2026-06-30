import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AppLauncher} from './appLauncher.js';
import {WindowPreviews} from './windowPreviews.js';


export class Dock {
    constructor(settings) {
        this._settings = settings;
        this._hideTimeoutId = null;
        this._collisionCheckId = null;
        this._dockVisible = true;
        this._positioned = false;
        this._behaviorSigIds = [];
        this._hotStrip = null;

        // Outer actor added to Chrome
        this.actor = new St.Widget({
            name: 'gdash-dock',
            style_class: 'gdash-dock',
            reactive: true,
            track_hover: true,
            layout_manager: new Clutter.BinLayout(),
        });

        // Inner row: [AppLauncher | separator | WindowPreviews]
        this._row = new St.BoxLayout({
            style_class: 'gdash-dock-row',
            x_expand: true,
            y_expand: true,
        });
        this.actor.add_child(this._row);

        this._appLauncher = new AppLauncher(settings);
        this._separator = new St.Widget({
            style_class: 'gdash-separator',
            y_expand: true,
        });
        this._windowPreviews = new WindowPreviews(settings);

        this._row.add_child(this._appLauncher.actor);
        this._row.add_child(this._separator);
        this._row.add_child(this._windowPreviews.actor);

        // Position changes also affect hide translation and hot-strip placement
        this._positionSettingIds = [
            'dock-position', 'dock-size', 'dock-alignment', 'edge-margin',
        ].map(key => settings.connect(`changed::${key}`, () => {
            this.reposition();
            this._initBehavior();
        }));

        // Reposition (animated) when windows are added / removed
        this._windowPreviews.onSizeChanged = () => this.reposition(true);

        // Background / appearance
        this._bgSettingIds = [
            'use-theme-colors',
            'background-color', 'border-radius', 'dock-padding',
            'outer-border-width', 'outer-border-color',
        ].map(key => settings.connect(`changed::${key}`, () => this._applyBackground()));
        this._applyBackground();

        // Behavior (visibility mode)
        this._behaviorSettingId = settings.connect(
            'changed::dock-behavior', () => this._initBehavior()
        );
        this._initBehavior();

        // Always show the dock when the GNOME overview opens, regardless of
        // the current behavior mode. Guard the auto-hide paths against
        // the overview being open so they can't fight this.
        this._overviewShowingId = Main.overview.connect('showing', () => this._showDock(true));
        this._overviewHiddenId  = Main.overview.connect('hidden',  () => this._restoreBehaviorVisibility());
    }

    reposition(animate = false) {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;

        const position  = this._settings.get_string('dock-position');
        const size      = this._settings.get_int('dock-size');
        const alignment = this._settings.get_string('dock-alignment');
        const margin    = this._settings.get_int('edge-margin');

        if (position === 'BOTTOM' || position === 'TOP') {
            this._row.vertical = false;
            this._separator.set_size(1, -1);

            // Clear explicit size so get_preferred_width re-queries the layout
            // instead of returning the previously frozen set_size() value.
            this.actor.width = -1;
            const maxW = monitor.width - 2 * margin;
            const [, natW] = this.actor.get_preferred_width(size);
            const dockW = Math.min(Math.max(natW, 64), maxW);

            let dockX;
            if (alignment === 'START')
                dockX = monitor.x + margin;
            else if (alignment === 'END')
                dockX = monitor.x + monitor.width - dockW - margin;
            else
                dockX = monitor.x + Math.round((monitor.width - dockW) / 2);

            const dockY = position === 'BOTTOM'
                ? monitor.y + monitor.height - size - margin
                : monitor.y + margin;

            this._applyGeometry(dockX, dockY, dockW, size, animate);
        } else {
            this._row.vertical = true;
            this._separator.set_size(-1, 1);

            this.actor.height = -1;
            const maxH = monitor.height - 2 * margin;
            const [, natH] = this.actor.get_preferred_height(size);
            const dockH = Math.min(Math.max(natH, 64), maxH);

            let dockY;
            if (alignment === 'START')
                dockY = monitor.y + margin;
            else if (alignment === 'END')
                dockY = monitor.y + monitor.height - dockH - margin;
            else
                dockY = monitor.y + Math.round((monitor.height - dockH) / 2);

            const dockX = position === 'LEFT'
                ? monitor.x + margin
                : monitor.x + monitor.width - size - margin;

            this._applyGeometry(dockX, dockY, size, dockH, animate);
        }
    }

    _applyGeometry(x, y, w, h, animate) {
        if (animate && this._positioned) {
            this.actor.ease({
                x, y,
                width: w,
                height: h,
                duration: 160,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            this.actor.set_position(x, y);
            this.actor.set_size(w, h);
            this.actor.queue_redraw();
            this._positioned = true;
            // Let active behavior re-check overlap/maximize now that the dock
            // has a real position and size on screen.
            this._onAfterReposition?.();
        }
    }

    // ── Appearance ───────────────────────────────────────────────────────────

    _applyBackground() {
        const s = this._settings;

        if (s.get_boolean('use-theme-colors')) {
            // Clear inline style and let .gdash-theme CSS rule provide the fallback
            this.actor.style = '';
            this.actor.add_style_class_name('gdash-theme');
        } else {
            this.actor.remove_style_class_name('gdash-theme');

            const bg      = s.get_string('background-color');
            const radius  = s.get_int('border-radius');
            const padding = s.get_int('dock-padding');
            const obw     = s.get_int('outer-border-width');
            const obc     = s.get_string('outer-border-color');

            const shadows = ['0 4px 24px rgba(0,0,0,0.55)'];

            this.actor.style = [
                `background-color: ${bg}`,
                `border-radius: ${radius}px`,
                `padding: ${padding}px`,
                `border: ${obw}px solid ${obc}`,
                `box-shadow: ${shadows.join(', ')}`,
            ].join('; ');
        }

        // Padding is part of the style, so reposition after the actor is staged
        if (this.actor.get_stage())
            this.reposition();
    }

    // ── Behavior / visibility ────────────────────────────────────────────────

    _initBehavior() {
        this._cleanupBehavior();
        switch (this._settings.get_string('dock-behavior')) {
            case 'ALWAYS_VISIBLE':
                this._setupAlwaysVisibleCollision();
                break;
            case 'WINDOWS_CAN_COVER':
                this._showDock(false);
                break;
            case 'INTELLIHIDE':
                this._setupIntellihide();
                break;
            case 'ALWAYS_HIDDEN':
                this._setupAlwaysHidden();
                break;
            default:
                this._showDock(false);
        }
    }

    _cleanupBehavior() {
        this._cancelDockHide();
        if (this._collisionCheckId) {
            GLib.source_remove(this._collisionCheckId);
            this._collisionCheckId = null;
        }
        this._onAfterReposition = null;
        for (const [obj, id] of this._behaviorSigIds)
            obj.disconnect(id);
        this._behaviorSigIds = [];
        if (this._hotStrip) {
            Main.layoutManager.removeChrome(this._hotStrip);
            this._hotStrip.destroy();
            this._hotStrip = null;
        }
    }

    _showDock(animate = true) {
        this._cancelDockHide();
        this._dockVisible = true;
        if (animate) {
            this.actor.ease({
                translation_x: 0,
                translation_y: 0,
                opacity: 255,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            this.actor.remove_all_transitions();
            this.actor.translation_x = 0;
            this.actor.translation_y = 0;
            this.actor.opacity = 255;
        }
    }

    _hideDock(animate = true) {
        this._dockVisible = false;
        const {x: tx, y: ty} = this._hideTranslation();
        if (animate) {
            this.actor.ease({
                translation_x: tx,
                translation_y: ty,
                opacity: 0,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
            });
        } else {
            this.actor.remove_all_transitions();
            this.actor.translation_x = tx;
            this.actor.translation_y = ty;
            this.actor.opacity = 0;
        }
    }

    _scheduleDockHide() {
        if (this._hideTimeoutId || !this._dockVisible) return;
        if (Main.overview.visible) return;
        const delay = this._settings.get_int('hide-delay');
        this._hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._hideTimeoutId = null;
            this._hideDock();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelDockHide() {
        if (this._hideTimeoutId) {
            GLib.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = null;
        }
    }

    _hideTranslation() {
        const pos  = this._settings.get_string('dock-position');
        const size = this._settings.get_int('dock-size');
        const edge = this._settings.get_int('edge-margin');
        const dist = size + edge + 4;
        if (pos === 'TOP')   return {x: 0,    y: -dist};
        if (pos === 'LEFT')  return {x: -dist, y: 0};
        if (pos === 'RIGHT') return {x: dist,  y: 0};
        return {x: 0, y: dist}; // BOTTOM (default)
    }

    // Restore the correct visibility state after the overview closes.
    _restoreBehaviorVisibility() {
        switch (this._settings.get_string('dock-behavior')) {
            case 'ALWAYS_VISIBLE':
                this._checkAlwaysVisibleCollision();
                break;
            case 'INTELLIHIDE':
                this._checkIntellihide();
                break;
            case 'ALWAYS_HIDDEN':
                this._hideDock(false);
                break;
            // WINDOWS_CAN_COVER: dock is always visible, nothing to do
        }
    }

    // ── Always-visible collision — slides to edge when a window overlaps ────────

    _setupAlwaysVisibleCollision() {
        this._showDock(false); // start at configured margin, fully visible
        if (this._settings.get_int('edge-margin') === 0) return; // no gap to animate

        const on = (obj, sig, cb) =>
            this._behaviorSigIds.push([obj, obj.connect(sig, cb)]);
        const check = () => this._checkAlwaysVisibleCollision();

        on(global.display,           'notify::focus-window',     check);
        on(global.workspace_manager, 'active-workspace-changed', check);
        on(global.window_manager,    'map',                      check);
        on(global.window_manager,    'destroy',                  check);
        on(global.window_manager,    'minimize',                 check);
        on(global.window_manager,    'unminimize',               check);
        on(global.window_manager,    'size-change',              () => this._scheduleCollisionCheck());
        on(global.display,           'grab-op-end',              check);

        this._onAfterReposition = check;
    }

    // Defer the overlap check one idle tick so get_frame_rect() reflects
    // the final geometry after a keyboard maximize/unmaximize.  Deduplicated:
    // rapid size-change signals coalesce into a single check.
    _scheduleCollisionCheck() {
        if (this._collisionCheckId) return;
        this._collisionCheckId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._collisionCheckId = null;
            this._checkAlwaysVisibleCollision();
            return GLib.SOURCE_REMOVE;
        });
    }

    _checkAlwaysVisibleCollision() {
        if (!this.actor.get_stage()) return;
        if (Main.overview.visible) return;

        const ax = this.actor.x, aw = this.actor.width;
        const ay = this.actor.y, ah = this.actor.height;
        if (aw === 0 || ah === 0) return;

        const margin = this._settings.get_int('edge-margin');
        const pos    = this._settings.get_string('dock-position');

        // Expand the trigger zone by margin on the screen-interior side so
        // windows approaching the dock (or a maximized window whose edge is
        // flush with the dock) also trigger the push.  The screen-edge side
        // is left at the dock's actual boundary — we're already moving there.
        const extX1 = pos === 'RIGHT'  ? ax - margin : ax;
        const extX2 = pos === 'LEFT'   ? ax + aw + margin : ax + aw;
        const extY1 = pos === 'BOTTOM' ? ay - margin : ay;
        const extY2 = pos === 'TOP'    ? ay + ah + margin : ay + ah;

        const ws = global.workspace_manager.get_active_workspace();
        const overlaps = ws.list_windows().some(win => {
            if (win.minimized || win.is_skip_taskbar()) return false;
            if (win.get_window_type() !== Meta.WindowType.NORMAL) return false;
            const r = win.get_frame_rect();
            return r.x <= extX2 && r.x + r.width  >= extX1 &&
                   r.y <= extY2 && r.y + r.height >= extY1;
        });

        // Compute the translation that moves the dock flush to the screen edge.
        const tx = pos === 'LEFT' ? -margin : pos === 'RIGHT' ? margin  : 0;
        const ty = pos === 'TOP'  ? -margin : pos === 'BOTTOM' ? margin : 0;

        this.actor.ease({
            translation_x: overlaps ? tx : 0,
            translation_y: overlaps ? ty : 0,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    // ── Intellihide — hides when a window overlaps the dock area ─────────────

    _setupIntellihide() {
        const on = (obj, sig, cb) =>
            this._behaviorSigIds.push([obj, obj.connect(sig, cb)]);
        const check = () => this._checkIntellihide();

        on(global.display,           'notify::focus-window',     check);
        on(global.workspace_manager, 'active-workspace-changed', check);
        on(global.window_manager,    'map',                      check);
        on(global.window_manager,    'destroy',                  check);
        on(global.window_manager,    'minimize',                 check);
        on(global.window_manager,    'unminimize',               check);
        on(global.window_manager,    'size-change',              check);
        on(global.display,           'grab-op-end',              check);
        on(this.actor,               'notify::hover', () => {
            (this.actor.hover || this._hotStrip?.hover) ? this._showDock() : check();
        });

        // Hotstrip at the screen edge reveals the dock even when windows overlap
        this._createHotStrip();
        this._hotStrip.connect('notify::hover', () => {
            if (this._hotStrip.hover)
                this._showDock();
            else if (!this.actor.hover)
                check(); // re-check overlap rather than unconditional hide
        });

        // Initial check runs after the dock is positioned (get_stage() is null
        // here because addChrome() hasn't been called yet).
        this._onAfterReposition = check;
    }

    _checkIntellihide() {
        if (!this.actor.get_stage()) return;
        if (Main.overview.visible) return;
        if (this.actor.hover || this._hotStrip?.hover) { this._showDock(); return; }

        const ax = this.actor.x, aw = this.actor.width;
        const ay = this.actor.y, ah = this.actor.height;
        if (aw === 0 || ah === 0) return;

        const ws = global.workspace_manager.get_active_workspace();
        const overlaps = ws.list_windows().some(win => {
            if (win.minimized || win.is_skip_taskbar()) return false;
            if (win.get_window_type() !== Meta.WindowType.NORMAL) return false;
            const r = win.get_frame_rect();
            return r.x < ax + aw && r.x + r.width  > ax &&
                   r.y < ay + ah && r.y + r.height > ay;
        });

        overlaps ? this._scheduleDockHide() : this._showDock();
    }

    // ── Always hidden — off-screen until pointer reaches the screen edge ─────

    _setupAlwaysHidden() {
        this._hideDock(false);
        this._createHotStrip();

        this._hotStrip.connect('notify::hover', () => {
            if (this._hotStrip.hover)
                this._showDock();
            else if (!this.actor.hover)
                this._scheduleDockHide();
        });

        this._behaviorSigIds.push([this.actor, this.actor.connect('notify::hover', () => {
            if (!this.actor.hover && !this._hotStrip?.hover)
                this._scheduleDockHide();
        })]);
    }

    _createHotStrip() {
        this._hotStrip = new St.Widget({
            name:        'gdash-hotstrip',
            reactive:    true,
            track_hover: true,
            opacity:     0,
        });
        Main.layoutManager.addChrome(this._hotStrip);
        this._positionHotStrip();
    }

    _positionHotStrip() {
        if (!this._hotStrip) return;
        const mon = Main.layoutManager.primaryMonitor;
        if (!mon) return;
        const pos   = this._settings.get_string('dock-position');
        const STRIP = 2;
        if (pos === 'TOP') {
            this._hotStrip.set_position(mon.x, mon.y);
            this._hotStrip.set_size(mon.width, STRIP);
        } else if (pos === 'LEFT') {
            this._hotStrip.set_position(mon.x, mon.y);
            this._hotStrip.set_size(STRIP, mon.height);
        } else if (pos === 'RIGHT') {
            this._hotStrip.set_position(mon.x + mon.width - STRIP, mon.y);
            this._hotStrip.set_size(STRIP, mon.height);
        } else { // BOTTOM
            this._hotStrip.set_position(mon.x, mon.y + mon.height - STRIP);
            this._hotStrip.set_size(mon.width, STRIP);
        }
    }

    // ── Teardown ─────────────────────────────────────────────────────────────

    destroy() {
        if (this._overviewShowingId) {
            Main.overview.disconnect(this._overviewShowingId);
            this._overviewShowingId = null;
        }
        if (this._overviewHiddenId) {
            Main.overview.disconnect(this._overviewHiddenId);
            this._overviewHiddenId = null;
        }
        this._cleanupBehavior();

        if (this._behaviorSettingId) {
            this._settings.disconnect(this._behaviorSettingId);
            this._behaviorSettingId = null;
        }
        this._positionSettingIds?.forEach(id => this._settings.disconnect(id));
        this._positionSettingIds = [];
        this._bgSettingIds?.forEach(id => this._settings.disconnect(id));
        this._bgSettingIds = [];

        this._appLauncher.destroy();
        this._windowPreviews.destroy();
        this.actor.destroy();
    }
}
