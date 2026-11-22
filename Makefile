UUID := notman@kbgjtn.github.io
EXT_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SCHEMA := schemas/org.gnome.shell.extensions.notman.gschema.xml
STAMP := node_modules/.package-lock.json

TS_SOURCES := extension.ts prefs.ts ambient.d.ts tsconfig.json stylesheet.css metadata.json LICENSE $(shell find src -name '*.ts' -print)

CASE ?= leak
RES ?=
RUNS ?= 2
SHOTS ?= 10
PIN_CPU ?= 2
TIMEOUT ?= 90

.PHONY: all help build check check-schema check-imports check-ego check-scripts test lint lint-fix format dev-install install pack pack-ego uninstall clean baseline benchmark report qa-xvfb

help:
	@echo "Targets: build, check, check-ego, lint, test, dev-install, install, pack, pack-ego, baseline, benchmark, report, qa-xvfb, clean"
	@echo "benchmark: CONFIRM=1 RES=WxH [CASE=leak] [RUNS=2] [SHOTS=10] [PIN_CPU=2] [TIMEOUT=90]"
	@echo "Cases: leak, leak-dndoff, drop, compact, text, text-dndoff, limit, expire, budget, cap, combined, unlimited"

all: build

$(STAMP): package.json
	npm install
	touch $@

build: dist/extension.js

dist/extension.js dist/prefs.js &: $(STAMP) $(TS_SOURCES)
	rm -rf dist
	npm run build
	@# Stage a complete tree, then swap it in atomically: a running shell must
	@# never read a half-written compiled schema.
	rm -rf dist.new dist.old
	mkdir -p dist.new
	cp dist/extension.js dist/prefs.js dist.new/
	cp -R dist/src dist.new/ 2>/dev/null || true
	cp metadata.json stylesheet.css LICENSE dist.new/
	cp -R schemas dist.new/
	glib-compile-schemas --strict dist.new/schemas
	@if [ -d dist ]; then mv dist dist.old; fi
	mv dist.new dist
	rm -rf dist.old

schemas/gschemas.compiled: $(SCHEMA)
	glib-compile-schemas --strict schemas

check-schema: schemas/gschemas.compiled

check-imports: build
	@echo "Checking pinned resource:// import paths..."
	@! grep -R "resource:///org/gnome/shell/extensions/prefs.js" dist --include='*.js'
	@grep -q "resource:///org/gnome/shell/extensions/extension.js" dist/extension.js
	@grep -q "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js" dist/prefs.js
	@echo "Checking adapter coverage for every declared shell-version..."
	@node -e 'const fs=require("fs");const m=JSON.parse(fs.readFileSync("metadata.json","utf8"));const src=fs.readFileSync("src/compat/adapter.ts","utf8");for(const v of m["shell-version"]){if(!src.includes("SupportedMajor.V"+v)){console.error("No adapter case for GNOME",v);process.exit(1);}if(!src.includes("./v"+v+".js")||!fs.existsSync("src/compat/v"+v+".ts")){console.error("No adapter module for GNOME",v);process.exit(1);}}'
	@echo "Import paths OK"

test: $(STAMP)
	npm test

lint: $(STAMP)
	npm run lint

lint-fix: $(STAMP)
	npm run lint:fix

format: $(STAMP)
	npm run format

check-ego: build
	@echo "Checking extensions.gnome.org (EGO) review requirements..."
	@node -e 'const fs=require("fs"),m=JSON.parse(fs.readFileSync("dist/metadata.json","utf8"));for(const k of["uuid","name","description","url","shell-version","settings-schema","gettext-domain"]){if(!m[k]){console.error("Missing metadata.json field:",k);process.exit(1);}}if("version"in m){console.error("metadata.json must not set version");process.exit(1);}'
	@test -f dist/LICENSE
	@test -f dist/schemas/org.gnome.shell.extensions.notman.gschema.xml
	@test -f dist/schemas/gschemas.compiled
	@! find dist -name '*.js' ! -path 'dist/prefs.js' -exec grep -Eq 'gi://(Gtk|Adw|Gdk)["?]' {} +
	@! grep -Eq 'gi://(St|Clutter|Meta|Shell)["?]' dist/prefs.js
	@! grep -REq 'gi://(St|Clutter|Meta|Shell)["?]' dist/src/byte-estimate.js dist/src/config-io.js dist/src/dbus.js dist/src/quiet-hours.js dist/src/settings.js dist/src/types.js
	@! grep -Rq 'imports\.mainloop' dist --include='*.js'
	@! find dist -name '*.ts' | grep -q .
	@echo "EGO checks OK"

check-scripts:
	@bash -n tools/*.sh
	@python3 -m py_compile tools/*.py

check: check-schema check-imports check-ego check-scripts test lint
	npm run check

dev-install: build check-schema
	@mkdir -p $(dir $(EXT_DIR))
	@rm -rf $(EXT_DIR)
	@ln -s $(CURDIR)/dist $(EXT_DIR)
	@echo "Symlinked: $(EXT_DIR)"
	@echo "Enable with: gnome-extensions enable $(UUID)"
	@echo "Reload shell on X11 with Alt+F2 then r"

pack: build
	@rm -f notman.zip
	@(cd dist && zip -9r ../notman.zip .)
	@echo "Packed: notman.zip"

pack-ego: check-ego
	@rm -f $(UUID).shell-extension.zip
	@(cd dist && zip -9r ../$(UUID).shell-extension.zip .)
	@echo "Packed: $(UUID).shell-extension.zip"

install: pack
	gnome-extensions install --force notman.zip
	@echo "Reload shell (Alt+F2 r on X11) or log out/in to load"

uninstall:
	-gnome-extensions uninstall $(UUID)
	rm -rf $(EXT_DIR)

baseline:
	bash tools/measure.sh

# Bounded case matrix. Requires explicit confirmation to avoid accidental load.
benchmark:
	@if [ "$(CONFIRM)" != "1" ] || [ -z "$(RES)" ]; then \
		echo "Refusing to run: set CONFIRM=1 and RES=WxH (run 'make help' for options)"; \
		exit 1; \
	fi
	bash tools/benchmark.sh --case "$(CASE)" --res "$(RES)" --runs "$(RUNS)" --shots "$(SHOTS)" --pin "$(PIN_CPU)" --timeout "$(TIMEOUT)" --confirm

report:
	python3 tools/report.py > results/report.md
	@echo "Wrote results/report.md"

# Isolated QA: private Xvfb display + private D-Bus session, no live session use.
qa-xvfb: build
	bash tools/qa-xvfb.sh

clean:
	rm -rf dist node_modules notman.zip $(UUID).shell-extension.zip schemas/gschemas.compiled
