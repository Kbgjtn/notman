UUID := notman@ozy.local
EXT_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SCHEMA := schemas/org.gnome.shell.extensions.notman.gschema.xml
STAMP := node_modules/.package-lock.json

TS_SOURCES := extension.ts prefs.ts ambient.d.ts tsconfig.json $(shell find src -name '*.ts' -print)

.PHONY: all build check check-schema check-imports test lint lint-fix format dev-install install pack uninstall clean baseline

all: build

$(STAMP): package.json
	npm install
	touch $@

build: dist/extension.js

dist/extension.js dist/prefs.js: $(STAMP) $(TS_SOURCES)
	npm run build
	cp metadata.json dist/
	cp -R schemas dist/
	glib-compile-schemas dist/schemas

schemas/gschemas.compiled: $(SCHEMA)
	glib-compile-schemas --strict schemas

check-schema: schemas/gschemas.compiled

check-imports: build
	@echo "Checking pinned resource:// import paths..."
	@! grep -R "resource:///org/gnome/Shell/Extensions/js/" dist --include='*.js'
	@grep -q "resource:///org/gnome/shell/extensions/extension.js" dist/extension.js
	@grep -q "resource:///org/gnome/shell/extensions/prefs.js" dist/prefs.js
	@echo "Import paths OK"

test: $(STAMP)
	npm test

lint: $(STAMP)
	npm run lint

lint-fix: $(STAMP)
	npm run lint:fix

format: $(STAMP)
	npm run format

check: check-schema check-imports test lint
	npm run check

dev-install: build check-schema
	@mkdir -p $(dir $(EXT_DIR))
	@rm -rf $(EXT_DIR)
	@ln -s $(CURDIR)/dist $(EXT_DIR)
	@echo "Symlinked: $(EXT_DIR)"
	@echo "Enable with: gnome-extensions enable $(UUID)"
	@echo "Reload shell on X11 with Alt+F2 then r"

pack: build
	@(cd dist && zip -9r ../notman.zip .)
	@echo "Packed: notman.zip"

install: pack
	gnome-extensions install --force notman.zip
	@echo "Reload shell (Alt+F2 r on X11) or log out/in to load"

uninstall:
	-gnome-extensions uninstall $(UUID)
	rm -rf $(EXT_DIR)

baseline:
	bash tools/measure.sh

clean:
	rm -rf dist node_modules notman.zip schemas/gschemas.compiled
