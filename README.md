# GDash

A GNOME Shell extension that replaces the standard dash with a two-panel dock.

```
┌────────────────────────────────────────────────────────────────────┐
│  [Files] [Firefox] [Terminal] [Code]  │  [Win1] [Win2] [Win3] …  │
└────────────────────────────────────────────────────────────────────┘
          Left: app launcher                Right: window previews
```

## Concept

Most docks conflate two distinct ideas: *launching apps* and *managing open windows*. GDash keeps them separate.

**Left panel — app launcher**
Displays the apps pinned to the standard GNOME dash (`org.gnome.shell favourite-apps`). Clicking an icon always launches/activates the app. There are no running indicators, no window count badges, no dots — it is purely a launcher.

**Right panel — window previews**
Shows a live scaled-down thumbnail of every open window. Thumbnails update in real time as windows change. Clicking a thumbnail raises that window. Right-clicking opens the standard GNOME window menu (the same menu you get from right-clicking a window title bar: Minimize, Maximize, Move, Resize, Always on Top, Move to Workspace, Close, …).

Because the two roles are separated, there is no ambiguity and no need for any status indicators on either side.

## Requirements

- GNOME Shell 45 – 50
- Fedora 38+ / any distro shipping a compatible GNOME Shell

## Installation

### From source (development)

```bash
git clone <repo>
cd gdash
make install      # compiles schema + symlinks into ~/.local/share/gnome-shell/extensions/
make enable       # enables the extension via gnome-extensions CLI
```

Then press **Alt+F2**, type `r`, press Enter to restart GNOME Shell (X11), or **log out and back in** (Wayland).

### Uninstall

```bash
make disable
make uninstall
```

## Makefile targets

| Target | Description |
|--------|-------------|
| `make install` | Compile schema, create symlink in extensions dir |
| `make uninstall` | Remove the symlink |
| `make enable` | Enable the extension (`gnome-extensions enable`) |
| `make disable` | Disable the extension (`gnome-extensions disable`) |
| `make reload` | Disable → enable (picks up JS changes without a shell restart) |
| `make prefs` | Open the preferences window |
| `make pack` | Build a distributable `.zip` |
| `make logs` | Tail GNOME Shell logs filtered to GDash |

## Settings

Open **GNOME Extensions** app → GDash → Settings, or run `make prefs`.

| Setting | Default | Description |
|---------|---------|-------------|
| Dock position | Bottom | Bottom, Top, Left, Right |
| Dock thickness | 96 px | Height (Bottom/Top) or width (Left/Right) |
| App icon size | 48 px | Size of launcher icons |
| Thumbnail scale | 0.12 | Fraction of the original window size |
| Show window titles | On | Label below each thumbnail |
| All workspaces | On | Off = current workspace only |
| Show minimized | On | Minimized windows appear dimmed |
| Auto-hide | Off | Fade dock out when pointer leaves |
| Hide delay | 400 ms | Grace period before the dock fades |

## Architecture

```
extension.js        — entry point; owns the Chrome registration
dock.js             — outer container; positioning, auto-hide animations
appLauncher.js      — left panel; reads favourite-apps from GSettings
windowPreviews.js   — right panel; window tracking and thumbnails
prefs.js            — Adwaita preferences UI
stylesheet.css      — visual styles
schemas/            — GSettings schema
```

### Window thumbnail implementation

Each thumbnail is a `Clutter.Clone` whose source is the window's `Meta.WindowActor`. The clone is scaled to a fraction of the original window size (`thumbnail-scale` setting). Because it is a direct GPU texture clone, it updates live without any polling.

The right-click menu is opened via `Main.wm._windowMenuManager.showWindowMenuForWindow()`, which is the same code path GNOME Shell uses for the window title-bar context menu.

### App launcher implementation

Favourite apps are read from `org.gnome.shell favourite-apps` and refreshed whenever that key changes, so pinning or unpinning apps in the GNOME dash is immediately reflected in GDash. No running-state signals are connected, keeping the left panel a pure launcher with no indicators.

## Known limitations

- Wayland does not support `Alt+F2 r` to restart the shell; log out to apply JS changes.
- Very small `thumbnail-scale` values (< 0.07) can make thumbnails hard to distinguish.
- Auto-hide does not currently use pressure barriers; the dock appears/disappears on pointer enter/leave.
