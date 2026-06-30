UUID        := gdash@guido.local
SRCDIR      := $(shell pwd)
EXTDIR      := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SCHEMADIR   := $(SRCDIR)/schemas
PACKNAME    := $(UUID).zip

# Files included in a distribution pack (excludes dev artifacts)
PACK_FILES  := extension.js dock.js appLauncher.js windowPreviews.js prefs.js \
               stylesheet.css metadata.json README.md schemas/

.PHONY: all install uninstall enable disable reload prefs pack logs help

all: help

## Compile the GSettings schema (run automatically by install)
schema:
	glib-compile-schemas $(SCHEMADIR)/

## Symlink the extension into the GNOME extensions directory
install: schema
	@if [ -L "$(EXTDIR)" ]; then \
		echo "Already installed (symlink exists): $(EXTDIR)"; \
	elif [ -d "$(EXTDIR)" ]; then \
		echo "ERROR: $(EXTDIR) exists as a real directory. Remove it first."; exit 1; \
	else \
		ln -s $(SRCDIR) $(EXTDIR) && echo "Installed: $(EXTDIR)"; \
	fi

## Remove the symlink from the GNOME extensions directory
uninstall:
	@if [ -L "$(EXTDIR)" ]; then \
		rm $(EXTDIR) && echo "Uninstalled: $(EXTDIR)"; \
	else \
		echo "Nothing to remove at $(EXTDIR)"; \
	fi

## Enable the extension
enable:
	gnome-extensions enable $(UUID)

## Disable the extension
disable:
	gnome-extensions disable $(UUID)

## Reload: disable then re-enable (picks up JS changes without a shell restart)
reload: disable enable

## Open the preferences window
prefs:
	gnome-extensions prefs $(UUID)

## Build a distributable zip (excludes .git, node_modules, etc.)
pack: schema
	@rm -f $(PACKNAME)
	zip -r $(PACKNAME) $(PACK_FILES)
	@echo "Created: $(PACKNAME)"

## Tail GNOME Shell journal logs filtered to GDash output
logs:
	journalctl -f -o cat /usr/bin/gnome-shell 2>/dev/null \
	  | grep --line-buffered -i 'gdash\|$(UUID)' \
	  || journalctl -f SYSLOG_IDENTIFIER=gnome-shell \
	       | grep --line-buffered -i 'gdash\|$(UUID)'

help:
	@echo ""
	@echo "  GDash — GNOME Shell extension"
	@echo "  UUID: $(UUID)"
	@echo ""
	@echo "  make install    compile schema + symlink into extensions dir"
	@echo "  make uninstall  remove the symlink"
	@echo "  make enable     enable via gnome-extensions"
	@echo "  make disable    disable via gnome-extensions"
	@echo "  make reload     disable + enable (picks up JS changes)"
	@echo "  make prefs      open preferences window"
	@echo "  make pack       build $(PACKNAME)"
	@echo "  make logs       tail GNOME Shell logs filtered to GDash"
	@echo ""
