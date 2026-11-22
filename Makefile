UUID := notman@kbgjtn.github.io
EXT_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SCHEMA := schemas/org.gnome.shell.extensions.notman.gschema.xml
STAMP := node_modules/.package-lock.json

TS_SOURCES := extension.ts prefs.ts ambient.d.ts tsconfig.json stylesheet.css $(shell find src -name '*.ts' -print)

CASE ?= leak
RES ?=
RUNS ?= 2
SHOTS ?= 10
PIN_CPU ?= 2
TIMEOUT ?= 90

.PHONY: all help build check check-schema check-imports check-scripts test lint lint-fix format dev-install install pack uninstall clean baseline benchmark report qa-xvfb

help:
	@echo "Targets: build, check, lint, test, dev-install, install, pack, baseline, benchmark, report, qa-xvfb, clean"
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
	cp metadata.json stylesheet.css dist.new/
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
	@echo "Import paths OK"

test: $(STAMP)
	npm test

lint: $(STAMP)
	npm run lint

lint-fix: $(STAMP)
	npm run lint:fix

format: $(STAMP)
	npm run format

check-scripts:
	@bash -n tools/*.sh
	@python3 -m py_compile tools/*.py

check: check-schema check-imports check-scripts test lint
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
	rm -rf dist node_modules notman.zip schemas/gschemas.compiled
