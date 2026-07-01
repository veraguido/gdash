import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Dock} from './dock.js';

export default class GDashExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._dock = new Dock(this._settings);
        this._dockInChrome = false;

        this._setupDockLayer();
        this._dock.reposition();

        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', () => {
                this._dock.reposition();
                this._updateStrutActor();
            }
        );
        this._behaviorChangedId = this._settings.connect(
            'changed::dock-behavior', () => this._updateDockLayer()
        );
        this._hideDashChangedId = this._settings.connect(
            'changed::hide-dash', () => {
                if (this._settings.get_boolean('hide-dash'))
                    this._applyHideDash();
                else
                    this._restoreDash();
            }
        );
        // Strut actor geometry must track any setting that changes the dock's
        // resting position or thickness.
        this._strutSettingIds = ['dock-position', 'dock-size', 'edge-margin', 'monitor-index'].map(key =>
            this._settings.connect(`changed::${key}`, () => this._updateStrutActor())
        );

        if (this._settings.get_boolean('hide-dash'))
            this._applyHideDash();
    }

    disable() {
        this._restoreDash();

        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = null;
        }
        if (this._behaviorChangedId) {
            this._settings.disconnect(this._behaviorChangedId);
            this._behaviorChangedId = null;
        }
        if (this._hideDashChangedId) {
            this._settings.disconnect(this._hideDashChangedId);
            this._hideDashChangedId = null;
        }
        this._strutSettingIds?.forEach(id => this._settings.disconnect(id));
        this._strutSettingIds = [];
        if (this._dock) {
            this._teardownDockLayer();
            this._dock.destroy();
            this._dock = null;
        }
        this._settings = null;
    }

    // ── Dock layer management ─────────────────────────────────────────────────

    _setupDockLayer() {
        const behavior = this._settings.get_string('dock-behavior');
        if (behavior === 'WINDOWS_CAN_COVER') {
            // Place the dock below the window stack so windows render above it.
            const parent = global.window_group.get_parent();
            if (parent) {
                parent.add_child(this._dock.actor);
                parent.set_child_below_sibling(this._dock.actor, global.window_group);
                this._dockInChrome = false;
                return;
            }
        }
        Main.layoutManager.addChrome(this._dock.actor, {
            affectsStruts:   false, // dedicated strut actor handles this
            trackFullscreen: true,
        });
        this._dockInChrome = true;

        if (behavior === 'ALWAYS_VISIBLE')
            this._createStrutActor();
    }

    _teardownDockLayer() {
        if (this._dockInChrome) {
            Main.layoutManager.removeChrome(this._dock.actor);
            this._dockInChrome = false;
        } else {
            const parent = this._dock.actor.get_parent();
            if (parent) parent.remove_child(this._dock.actor);
        }
        this._destroyStrutActor();
    }

    _updateDockLayer() {
        if (!this._dock) return;
        this._teardownDockLayer();
        this._setupDockLayer();
        this._dock.reposition();
    }

    // ── Strut actor — reserves screen space for ALWAYS_VISIBLE mode ──────────
    //
    // GNOME Shell's strut calculator only recognises an actor as an edge actor
    // when its far side is within 1 px of the screen boundary.  The dock has an
    // edge-margin gap, so the dock actor itself never passes that check.  We
    // instead register a separate transparent, non-reactive actor that spans the
    // full monitor width/height and extends from the dock's resting position all
    // the way to the screen edge — its far edge is always exactly at the monitor
    // boundary, so the strut is always detected and applied correctly.

    _createStrutActor() {
        this._destroyStrutActor();
        this._strutActor = new St.Widget({name: 'gdash-strut', opacity: 0, reactive: false});
        Main.layoutManager.addChrome(this._strutActor, {affectsStruts: true});
        this._updateStrutActor();
    }

    _destroyStrutActor() {
        if (!this._strutActor) return;
        Main.layoutManager.removeChrome(this._strutActor);
        this._strutActor.destroy();
        this._strutActor = null;
    }

    _getMonitor() {
        const idx = this._settings.get_int('monitor-index');
        const monitors = Main.layoutManager.monitors;
        if (idx >= 0 && idx < monitors.length)
            return monitors[idx];
        return Main.layoutManager.primaryMonitor;
    }

    _updateStrutActor() {
        if (!this._strutActor) return;
        const mon = this._getMonitor();
        if (!mon) return;

        const pos    = this._settings.get_string('dock-position');
        const size   = this._settings.get_int('dock-size');
        const margin = this._settings.get_int('edge-margin');

        if (pos === 'BOTTOM') {
            this._strutActor.set_position(mon.x, mon.y + mon.height - size - margin);
            this._strutActor.set_size(mon.width, size + margin);
        } else if (pos === 'TOP') {
            this._strutActor.set_position(mon.x, mon.y);
            this._strutActor.set_size(mon.width, size + margin);
        } else if (pos === 'LEFT') {
            this._strutActor.set_position(mon.x, mon.y);
            this._strutActor.set_size(size + margin, mon.height);
        } else { // RIGHT
            this._strutActor.set_position(mon.x + mon.width - size - margin, mon.y);
            this._strutActor.set_size(size + margin, mon.height);
        }

        this._strutActor.queue_relayout();
    }

    // ── GNOME Dash hiding ────────────────────────────────────────────────────

    _getGnomeDash() {
        return Main.overview.dash ??
               Main.overview._overview?._controls?._dash ??
               null;
    }

    _applyHideDash() {
        const dash = this._getGnomeDash();
        if (!dash) return;
        dash.visible = false;
        if (!this._overviewShowingId) {
            this._overviewShowingId = Main.overview.connect('showing', () => {
                this._getGnomeDash()?.set({ visible: false });
            });
        }
    }

    _restoreDash() {
        if (this._overviewShowingId) {
            Main.overview.disconnect(this._overviewShowingId);
            this._overviewShowingId = null;
        }
        this._getGnomeDash()?.set({ visible: true });
    }
}
