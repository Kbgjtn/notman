import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import {
  gettext as _,
  ExtensionPreferences,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { formatBytes } from "./src/byte-estimate.js";
import { exportSettingsJson, importSettingsJson } from "./src/config-io.js";
import { DBUS_BUS_NAME, DBUS_OBJECT_PATH, DbusMethod } from "./src/dbus.js";
import { formatTimeMinutes, parseTimeMinutes } from "./src/quiet-hours.js";
import {
  parseAppRules,
  parseIndicatorPosition,
  parseThumbnailMode,
  SettingKey,
} from "./src/settings.js";
import { type AppRuleEntry, IndicatorPosition, ThumbnailMode } from "./src/types.js";

const PREFS_CSS = `
.notman-mode-frame {
  border-radius: 12px;
  border: 1px solid alpha(@window_fg_color, 0.14);
  background-color: @card_bg_color;
  padding: 6px;
}
button.notman-mode-card {
  border-radius: 9px;
  padding: 12px 10px;
  border: 1px solid transparent;
  background-color: transparent;
}
button.notman-mode-card:hover {
  background-color: alpha(@window_fg_color, 0.06);
}
button.notman-mode-card:checked {
  background-color: alpha(@window_fg_color, 0.13);
  border-color: alpha(@window_fg_color, 0.28);
}
.notman-stat-box {
  border-radius: 12px;
  border: 1px solid alpha(@window_fg_color, 0.12);
  background-color: @card_bg_color;
  padding: 14px 0;
}
.notman-stat-col {
  padding: 0 12px;
  border-right: 1px solid alpha(@window_fg_color, 0.1);
}
.notman-stat-col-last {
  border-right: none;
}
.notman-stat-active .notman-stat-accent {
  color: #38bdf8;
}
.notman-stat-cleaned .notman-stat-accent {
  color: #fbbf24;
}
.notman-stat-saved .notman-stat-accent {
  color: #34d399;
}
`;

interface LiveStats {
  readonly activeCount: number;
  readonly estimatedBytes: number;
  readonly peakBytes: number;
  readonly prunedCount: number;
  readonly savedBytes: number;
}

function fetchStatsAsync(callback: (stats: LiveStats | null) => void): void {
  Gio.DBus.session.call(
    DBUS_BUS_NAME,
    DBUS_OBJECT_PATH,
    DBUS_BUS_NAME,
    DbusMethod.GetStats,
    null,
    null,
    Gio.DBusCallFlags.NONE,
    500,
    null,
    (connection, result) => {
      try {
        const reply = connection?.call_finish(result);
        if (!reply) {
          callback(null);
          return;
        }
        const [dict] = reply.deepUnpack() as [Record<string, GLib.Variant>];
        callback({
          activeCount: dict.activeCount.get_int32(),
          estimatedBytes: Number(dict.estimatedBytes.get_int64()),
          peakBytes: Number(dict.peakBytes.get_int64()),
          prunedCount: dict.prunedCount.get_int32(),
          savedBytes: dict.savedBytes ? Number(dict.savedBytes.get_int64()) : 0,
        });
      } catch {
        callback(null);
      }
    },
  );
}

function openExternalUri(uri: string): void {
  try {
    Gio.AppInfo.launch_default_for_uri(uri, null);
  } catch {
    // Ignore if no URI handler is registered in this environment.
  }
}

export default class NotmanPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window: Adw.PreferencesWindow): void {
    window.search_enabled = true;
    window.set_default_size(680, 720);

    const display = Gdk.Display.get_default();
    let cssProvider: Gtk.CssProvider | null = null;
    if (display) {
      cssProvider = new Gtk.CssProvider();
      cssProvider.load_from_string(PREFS_CSS);
      Gtk.StyleContext.add_provider_for_display(
        display,
        cssProvider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
      );
    }

    const settings = this.getSettings();
    const bindings: Array<{ target: unknown; property: string }> = [];
    const signalIds: number[] = [];
    let statsTimerId: number | null = null;
    let disposed = false;

    const bind = (
      key: SettingKey,
      target: unknown,
      property: string,
      flags = Gio.SettingsBindFlags.DEFAULT,
    ): void => {
      settings.bind(key, target as never, property, flags);
      bindings.push({ target, property });
    };

    const addHeaderSwitch = (group: Adw.PreferencesGroup, key: SettingKey): Gtk.Switch => {
      const toggle = new Gtk.Switch({ valign: Gtk.Align.CENTER });
      bind(key, toggle, "active");
      group.set_header_suffix(toggle);
      return toggle;
    };

    const addSwitch = (
      group: Adw.PreferencesGroup,
      key: SettingKey,
      title: string,
      subtitle: string,
    ): Adw.SwitchRow => {
      const row = new Adw.SwitchRow({ title, subtitle });
      bind(key, row, "active");
      group.add(row);
      return row;
    };

    const addSpin = (
      group: Adw.PreferencesGroup,
      key: SettingKey,
      title: string,
      subtitle: string,
      lower: number,
      upper: number,
      step: number,
    ): Adw.SpinRow => {
      const adjustment = new Gtk.Adjustment({
        lower,
        upper,
        step_increment: step,
        value: settings.get_int(key),
      });
      const row = new Adw.SpinRow({ title, subtitle, adjustment });
      bind(key, row, "value");
      group.add(row);
      return row;
    };

    const addSlider = (
      group: Adw.PreferencesGroup,
      key: SettingKey,
      title: string,
      subtitle: string,
      lower: number,
      upper: number,
      step: number,
    ): Adw.ActionRow => {
      const adjustment = new Gtk.Adjustment({
        lower,
        upper,
        step_increment: step,
        page_increment: step * 2,
        value: settings.get_int(key),
      });
      bind(key, adjustment, "value");
      const scale = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        adjustment,
        draw_value: true,
        value_pos: Gtk.PositionType.TOP,
        digits: 0,
        round_digits: 0,
        width_request: 180,
        valign: Gtk.Align.CENTER,
      });
      const row = new Adw.ActionRow({ title, subtitle });
      row.add_suffix(scale);
      group.add(row);
      return row;
    };

    const addLinkRow = (group: Adw.PreferencesGroup, title: string, uri: string): void => {
      const row = new Adw.ActionRow({ title, activatable: true });
      row.add_suffix(new Gtk.Image({ icon_name: "go-next-symbolic" }));
      row.connect("activated", () => openExternalUri(uri));
      group.add(row);
    };

    const generalPage = new Adw.PreferencesPage({
      title: _("General"),
      icon_name: "emblem-system-symbolic",
    });

    const statusGroup = new Adw.PreferencesGroup({
      title: _("Status"),
    });
    const statsGrid = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      homogeneous: true,
      spacing: 0,
      css_classes: ["notman-stat-box"],
    });
    const makeStatTile = (
      caption: string,
      iconName: string,
      toneClass: string,
      isLast = false,
    ): Gtk.Label => {
      const tile = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
        css_classes: isLast
          ? ["notman-stat-col", "notman-stat-col-last", toneClass]
          : ["notman-stat-col", toneClass],
      });
      const value = new Gtk.Label({
        label: "—",
        css_classes: ["title-2", "notman-stat-accent"],
      });
      const footer = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 4,
        halign: Gtk.Align.CENTER,
      });
      footer.append(
        new Gtk.Image({
          icon_name: iconName,
          pixel_size: 13,
          css_classes: ["notman-stat-accent"],
        }),
      );
      footer.append(
        new Gtk.Label({
          label: caption,
          css_classes: ["caption", "dim-label"],
        }),
      );
      tile.append(value);
      tile.append(footer);
      statsGrid.append(tile);
      return value;
    };
    const activeVal = makeStatTile(_("Active"), "go-up-symbolic", "notman-stat-active");
    const cleanedVal = makeStatTile(_("Cleaned"), "go-down-symbolic", "notman-stat-cleaned");
    const savedVal = makeStatTile(
      _("Memory saved"),
      "emblem-ok-symbolic",
      "notman-stat-saved",
      true,
    );
    statusGroup.add(statsGrid);
    generalPage.add(statusGroup);

    const refreshStatus = (): void => {
      fetchStatsAsync((stats) => {
        if (disposed) return;
        if (!stats) {
          statusGroup.description = _(
            "Notman isn't running right now. Enable the extension or reload GNOME Shell.",
          );
          activeVal.label = "—";
          cleanedVal.label = "—";
          savedVal.label = "—";
          return;
        }
        statusGroup.description =
          stats.estimatedBytes > 0
            ? `${_("Current previews")}: ${formatBytes(stats.estimatedBytes)}`
            : "";
        activeVal.label = String(stats.activeCount);
        cleanedVal.label = String(stats.prunedCount);
        savedVal.label = stats.savedBytes > 0 ? formatBytes(stats.savedBytes) : "0 B";
      });
    };
    refreshStatus();
    statsTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
      refreshStatus();
      return GLib.SOURCE_CONTINUE;
    });

    const generalGroup = new Adw.PreferencesGroup({
      title: _("General"),
    });
    addSwitch(generalGroup, SettingKey.GuardEnabled, _("Enabled"), _("Turn off to pause Notman."));
    addSwitch(
      generalGroup,
      SettingKey.ClearOnPanelOpen,
      _("Clear on panel open"),
      _("Clear screenshots when you open the notification list."),
    );
    generalPage.add(generalGroup);

    const topBarGroup = new Adw.PreferencesGroup({
      title: _("Tray"),
      description: _("Quick menu and live status in the top bar."),
    });
    addHeaderSwitch(topBarGroup, SettingKey.ShowIndicator);

    const positionRow = new Adw.ActionRow({
      title: _("Position"),
      subtitle: _("Side of the top bar."),
    });
    const positionBox = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      valign: Gtk.Align.CENTER,
      css_classes: ["linked"],
    });
    const positionChoices: Array<{ pos: IndicatorPosition; label: string }> = [
      { pos: IndicatorPosition.Left, label: _("Left") },
      { pos: IndicatorPosition.Center, label: _("Center") },
      { pos: IndicatorPosition.Right, label: _("Right") },
    ];
    const positionButtons = new Map<IndicatorPosition, Gtk.ToggleButton>();
    let firstPositionButton: Gtk.ToggleButton | null = null;
    for (const choice of positionChoices) {
      const btn = new Gtk.ToggleButton({ label: choice.label });
      if (firstPositionButton) {
        btn.set_group(firstPositionButton);
      } else {
        firstPositionButton = btn;
      }
      btn.connect("toggled", () => {
        if (btn.active) {
          settings.set_string(SettingKey.IndicatorPosition, choice.pos);
        }
      });
      positionButtons.set(choice.pos, btn);
      positionBox.append(btn);
    }
    const syncPositionButtons = (): void => {
      const current = parseIndicatorPosition(settings.get_string(SettingKey.IndicatorPosition));
      const target = positionButtons.get(current);
      if (target && !target.active) target.active = true;
    };
    syncPositionButtons();
    signalIds.push(
      settings.connect(`changed::${SettingKey.IndicatorPosition}`, syncPositionButtons),
    );
    positionRow.add_suffix(positionBox);
    topBarGroup.add(positionRow);

    const indexRow = addSpin(
      topBarGroup,
      SettingKey.IndicatorIndex,
      _("Order"),
      _("Placement inside that side."),
      0,
      20,
      1,
    );
    for (const dependentRow of [positionRow, indexRow]) {
      bind(SettingKey.ShowIndicator, dependentRow, "sensitive", Gio.SettingsBindFlags.GET);
    }
    generalPage.add(topBarGroup);

    const quietGroup = new Adw.PreferencesGroup({
      title: _("Quiet hours"),
      description: _("Automatically turn on Do Not Disturb on a daily schedule."),
    });
    addHeaderSwitch(quietGroup, SettingKey.QuietHoursEnabled);

    const addTimeRow = (key: SettingKey, title: string, fallback: string): Adw.ActionRow => {
      const row = new Adw.ActionRow({ title });
      const initial = parseTimeMinutes(settings.get_string(key)) ?? parseTimeMinutes(fallback) ?? 0;
      const hourSpin = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({
          lower: 0,
          upper: 23,
          step_increment: 1,
          value: Math.floor(initial / 60),
        }),
        wrap: true,
        width_chars: 2,
        valign: Gtk.Align.CENTER,
      });
      const minSpin = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({
          lower: 0,
          upper: 55,
          step_increment: 5,
          value: Math.floor((initial % 60) / 5) * 5,
        }),
        wrap: true,
        width_chars: 2,
        valign: Gtk.Align.CENTER,
      });
      const formatTwoDigit = (spin: Gtk.SpinButton): boolean => {
        spin.set_text(String(Math.round(spin.get_value())).padStart(2, "0"));
        return true;
      };
      hourSpin.connect("output", () => formatTwoDigit(hourSpin));
      minSpin.connect("output", () => formatTwoDigit(minSpin));
      formatTwoDigit(hourSpin);
      formatTwoDigit(minSpin);

      let syncing = false;
      const persist = (): void => {
        if (syncing) return;
        settings.set_string(key, formatTimeMinutes(hourSpin.get_value(), minSpin.get_value()));
      };
      hourSpin.connect("value-changed", persist);
      minSpin.connect("value-changed", persist);
      signalIds.push(
        settings.connect(`changed::${key}`, () => {
          const parsed = parseTimeMinutes(settings.get_string(key));
          if (parsed === null) return;
          syncing = true;
          hourSpin.set_value(Math.floor(parsed / 60));
          minSpin.set_value(parsed % 60);
          syncing = false;
        }),
      );

      const timeBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 4,
        valign: Gtk.Align.CENTER,
      });
      timeBox.append(hourSpin);
      timeBox.append(new Gtk.Label({ label: ":" }));
      timeBox.append(minSpin);
      row.add_suffix(timeBox);
      quietGroup.add(row);
      return row;
    };

    const quietStartRow = addTimeRow(SettingKey.QuietHoursStart, _("Starts at"), "22:00");
    const quietEndRow = addTimeRow(SettingKey.QuietHoursEnd, _("Ends at"), "08:00");
    for (const dependentRow of [quietStartRow, quietEndRow]) {
      bind(SettingKey.QuietHoursEnabled, dependentRow, "sensitive", Gio.SettingsBindFlags.GET);
    }
    generalPage.add(quietGroup);

    const screenshotsPage = new Adw.PreferencesPage({
      title: _("Captures"),
      icon_name: "camera-photo-symbolic",
    });

    const rulesGroup = new Adw.PreferencesGroup({
      title: _("Screenshots"),
      description: _("How screenshot alerts are kept. Set 0 to disable a limit."),
    });
    bind(SettingKey.GuardEnabled, rulesGroup, "sensitive", Gio.SettingsBindFlags.GET);
    addHeaderSwitch(rulesGroup, SettingKey.ScreenshotNotifyEnabled);

    const modeFrame = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      homogeneous: true,
      spacing: 6,
      margin_bottom: 12,
      css_classes: ["notman-mode-frame"],
    });
    const modeOptions: Array<{
      mode: ThumbnailMode;
      icon: string;
      title: string;
      subtitle: string;
    }> = [
      {
        mode: ThumbnailMode.Full,
        icon: "image-x-generic-symbolic",
        title: _("Full size"),
        subtitle: _("Original image (~32 MiB at 4K)"),
      },
      {
        mode: ThumbnailMode.Compact,
        icon: "view-restore-symbolic",
        title: _("Compact"),
        subtitle: _("Small preview (~36 KB)"),
      },
      {
        mode: ThumbnailMode.TextOnly,
        icon: "format-text-plaintext-symbolic",
        title: _("Text only"),
        subtitle: _("No image preview"),
      },
    ];

    const modeButtons = new Map<ThumbnailMode, Gtk.ToggleButton>();
    let firstModeButton: Gtk.ToggleButton | null = null;
    for (const opt of modeOptions) {
      const card = new Gtk.ToggleButton({
        css_classes: ["flat", "notman-mode-card"],
        hexpand: true,
      });
      if (firstModeButton) {
        card.set_group(firstModeButton);
      } else {
        firstModeButton = card;
      }

      const content = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
        halign: Gtk.Align.FILL,
      });
      content.append(
        new Gtk.Image({
          icon_name: opt.icon,
          pixel_size: 28,
          halign: Gtk.Align.START,
          margin_bottom: 4,
        }),
      );
      content.append(
        new Gtk.Label({
          label: opt.title,
          xalign: 0,
          css_classes: ["heading"],
        }),
      );
      content.append(
        new Gtk.Label({
          label: opt.subtitle,
          xalign: 0,
          wrap: true,
          css_classes: ["caption", "dim-label"],
        }),
      );
      card.set_child(content);
      card.connect("toggled", () => {
        if (card.active) {
          settings.set_string(SettingKey.ScreenshotThumbnailMode, opt.mode);
        }
      });
      modeButtons.set(opt.mode, card);
      modeFrame.append(card);
    }

    const syncModeCards = (): void => {
      const current = parseThumbnailMode(settings.get_string(SettingKey.ScreenshotThumbnailMode));
      const target = modeButtons.get(current);
      if (target && !target.active) target.active = true;
    };
    syncModeCards();
    signalIds.push(
      settings.connect(`changed::${SettingKey.ScreenshotThumbnailMode}`, syncModeCards),
    );
    rulesGroup.add(modeFrame);

    const maxCountRow = addSpin(
      rulesGroup,
      SettingKey.ScreenshotMaxCount,
      _("Max kept"),
      _("Clear older screenshots past this count."),
      0,
      100,
      1,
    );
    const expireRow = addSlider(
      rulesGroup,
      SettingKey.ScreenshotExpireSeconds,
      _("Clear after (seconds)"),
      _("Remove screenshots after this many seconds."),
      0,
      300,
      5,
    );
    const budgetRow = addSlider(
      rulesGroup,
      SettingKey.ScreenshotMemoryBudgetMb,
      _("Memory limit (MiB)"),
      _("Clear older screenshots above this size."),
      0,
      512,
      8,
    );

    for (const dependent of [modeFrame, maxCountRow, expireRow, budgetRow]) {
      bind(SettingKey.ScreenshotNotifyEnabled, dependent, "sensitive", Gio.SettingsBindFlags.GET);
    }
    screenshotsPage.add(rulesGroup);

    const screencastGroup = new Adw.PreferencesGroup({
      title: _("Screen recordings"),
    });
    bind(SettingKey.GuardEnabled, screencastGroup, "sensitive", Gio.SettingsBindFlags.GET);
    addSwitch(
      screencastGroup,
      SettingKey.ScreencastNotifyEnabled,
      _("Show recording alerts"),
      _("Turn off to hide screen recording alerts."),
    );
    screenshotsPage.add(screencastGroup);

    const retentionPage = new Adw.PreferencesPage({
      title: _("Limits"),
      icon_name: "preferences-system-time-symbolic",
    });

    const transientGroup = new Adw.PreferencesGroup({
      title: _("Temporary alerts"),
      description: _("Clear short-lived alerts that get stuck in Do Not Disturb."),
    });
    bind(SettingKey.GuardEnabled, transientGroup, "sensitive", Gio.SettingsBindFlags.GET);
    addHeaderSwitch(transientGroup, SettingKey.TransientExpireEnabled);

    const transientDndRow = addSwitch(
      transientGroup,
      SettingKey.TransientDndOnly,
      _("Only in Do Not Disturb"),
      _("Run only when banners are muted."),
    );
    const transientExpireRow = addSlider(
      transientGroup,
      SettingKey.TransientExpireSeconds,
      _("Clear after (seconds)"),
      _("Wait time before clearing."),
      5,
      300,
      5,
    );
    for (const dependentRow of [transientDndRow, transientExpireRow]) {
      bind(SettingKey.TransientExpireEnabled, dependentRow, "sensitive", Gio.SettingsBindFlags.GET);
    }
    retentionPage.add(transientGroup);

    const burstGroup = new Adw.PreferencesGroup({
      title: _("Burst limit"),
      description: _("Keep only the newest alerts when an app sends a burst."),
    });
    bind(SettingKey.GuardEnabled, burstGroup, "sensitive", Gio.SettingsBindFlags.GET);
    addHeaderSwitch(burstGroup, SettingKey.BurstLimitEnabled);

    const burstMaxRow = addSpin(
      burstGroup,
      SettingKey.BurstMaxPerSource,
      _("Max per app"),
      _("Newest alerts kept per app during a burst."),
      1,
      20,
      1,
    );
    const burstWindowRow = addSlider(
      burstGroup,
      SettingKey.BurstWindowSeconds,
      _("Window (seconds)"),
      _("Time window used to group a burst."),
      2,
      60,
      2,
    );
    for (const dependentRow of [burstMaxRow, burstWindowRow]) {
      bind(SettingKey.BurstLimitEnabled, dependentRow, "sensitive", Gio.SettingsBindFlags.GET);
    }
    retentionPage.add(burstGroup);

    const retentionGroup = new Adw.PreferencesGroup({
      title: _("All apps"),
      description: _("Applies to every app. Set 0 to disable a limit."),
    });
    bind(SettingKey.GuardEnabled, retentionGroup, "sensitive", Gio.SettingsBindFlags.GET);

    addSpin(
      retentionGroup,
      SettingKey.GlobalMaxCount,
      _("Max notifications"),
      _("Clear oldest alerts past this total."),
      0,
      100,
      1,
    );
    addSpin(
      retentionGroup,
      SettingKey.GlobalExpireMinutes,
      _("Clear after (minutes)"),
      _("Remove alerts older than this."),
      0,
      1440,
      5,
    );
    retentionPage.add(retentionGroup);

    const appRulesGroup = new Adw.PreferencesGroup({
      title: _("Per-app rules"),
      description: _("Custom mute, count, or expiry overrides matched by app name or ID."),
    });
    bind(SettingKey.GuardEnabled, appRulesGroup, "sensitive", Gio.SettingsBindFlags.GET);

    const installedApps = Gio.AppInfo.get_all()
      .filter((app) => app.should_show() && Boolean(app.get_id()))
      .map((app) => ({
        name: app.get_display_name() || app.get_name() || app.get_id() || "",
        id: app.get_id() || "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const writeAppRules = (rules: AppRuleEntry[]): void => {
      settings.set_string(SettingKey.AppRules, JSON.stringify(rules));
    };

    const addRule = (rawMatch: string): void => {
      const match = rawMatch.trim();
      if (!match) return;
      const rules = parseAppRules(settings.get_string(SettingKey.AppRules));
      if (!rules.some((r) => r.match.toLowerCase() === match.toLowerCase())) {
        rules.push({ match, muted: false, maxCount: 2, expireSeconds: 0 });
        writeAppRules(rules);
      }
    };

    if (installedApps.length > 0) {
      const appNames = new Gtk.StringList({});
      for (const app of installedApps) appNames.append(app.name);
      const pickAppRow = new Adw.ComboRow({
        title: _("Pick an app"),
        model: appNames,
        enable_search: true,
      });
      const pickAddBtn = new Gtk.Button({
        label: _("Add"),
        valign: Gtk.Align.CENTER,
        css_classes: ["suggested-action"],
      });
      pickAddBtn.connect("clicked", () => {
        const chosen = installedApps[pickAppRow.selected];
        if (chosen) addRule(chosen.id);
      });
      pickAppRow.add_suffix(pickAddBtn);
      appRulesGroup.add(pickAppRow);
    }

    const addRuleRow = new Adw.EntryRow({
      title: _("Or enter app name / ID"),
    });
    const addRuleBtn = new Gtk.Button({
      label: _("Add"),
      valign: Gtk.Align.CENTER,
    });
    addRuleRow.add_suffix(addRuleBtn);
    appRulesGroup.add(addRuleRow);

    const renderedRuleRows: Adw.ExpanderRow[] = [];

    const rebuildAppRuleRows = (): void => {
      while (renderedRuleRows.length > 0) {
        const old = renderedRuleRows.pop();
        if (old) appRulesGroup.remove(old);
      }
      const rules = parseAppRules(settings.get_string(SettingKey.AppRules));
      for (let idx = 0; idx < rules.length; idx++) {
        const entry = rules[idx];
        const summaryParts: string[] = [];
        if (entry.muted) summaryParts.push(_("Muted"));
        if (!entry.muted && entry.maxCount > 0) summaryParts.push(`${_("Max")} ${entry.maxCount}`);
        if (!entry.muted && entry.expireSeconds > 0) summaryParts.push(`${entry.expireSeconds}s`);
        const expander = new Adw.ExpanderRow({
          title: entry.match,
          subtitle: summaryParts.length > 0 ? summaryParts.join(" · ") : _("No limits set"),
        });

        const muteRow = new Adw.SwitchRow({
          title: _("Mute"),
          subtitle: _("Dismiss alerts from this app immediately."),
          active: entry.muted,
        });
        muteRow.connect("notify::active", () => {
          const next = parseAppRules(settings.get_string(SettingKey.AppRules));
          if (!next[idx]) return;
          next[idx] = { ...next[idx], muted: muteRow.active };
          writeAppRules(next);
        });
        expander.add_row(muteRow);

        const maxRow = new Adw.SpinRow({
          title: _("Max kept"),
          adjustment: new Gtk.Adjustment({
            lower: 0,
            upper: 100,
            step_increment: 1,
            value: entry.maxCount,
          }),
          sensitive: !entry.muted,
        });
        maxRow.connect("notify::value", () => {
          const next = parseAppRules(settings.get_string(SettingKey.AppRules));
          if (!next[idx]) return;
          next[idx] = { ...next[idx], maxCount: Math.round(maxRow.value) };
          writeAppRules(next);
        });
        expander.add_row(maxRow);

        const expRow = new Adw.SpinRow({
          title: _("Clear after (seconds)"),
          adjustment: new Gtk.Adjustment({
            lower: 0,
            upper: 3600,
            step_increment: 5,
            value: entry.expireSeconds,
          }),
          sensitive: !entry.muted,
        });
        expRow.connect("notify::value", () => {
          const next = parseAppRules(settings.get_string(SettingKey.AppRules));
          if (!next[idx]) return;
          next[idx] = { ...next[idx], expireSeconds: Math.round(expRow.value) };
          writeAppRules(next);
        });
        expander.add_row(expRow);

        const removeBtn = new Gtk.Button({
          label: _("Remove"),
          valign: Gtk.Align.CENTER,
          css_classes: ["destructive-action"],
        });
        removeBtn.connect("clicked", () => {
          const next = parseAppRules(settings.get_string(SettingKey.AppRules));
          next.splice(idx, 1);
          writeAppRules(next);
        });
        const removeRow = new Adw.ActionRow({ title: _("Remove rule") });
        removeRow.add_suffix(removeBtn);
        expander.add_row(removeRow);

        appRulesGroup.add(expander);
        renderedRuleRows.push(expander);
      }
    };

    const addRuleFromEntry = (): void => {
      addRule(addRuleRow.text);
      addRuleRow.text = "";
    };
    addRuleBtn.connect("clicked", addRuleFromEntry);
    addRuleRow.connect("entry-activated", addRuleFromEntry);
    rebuildAppRuleRows();
    signalIds.push(settings.connect(`changed::${SettingKey.AppRules}`, rebuildAppRuleRows));
    retentionPage.add(appRulesGroup);

    const aboutPage = new Adw.PreferencesPage({
      title: _("About"),
      icon_name: "help-about-symbolic",
    });

    const advancedGroup = new Adw.PreferencesGroup({
      title: _("Advanced"),
    });
    addSpin(
      advancedGroup,
      SettingKey.EmergencyHardCap,
      _("Safety cap"),
      _("Hard limit on screenshots and temporary alerts."),
      0,
      256,
      8,
    );
    addSwitch(
      advancedGroup,
      SettingKey.DebugLogging,
      _("Debug logging"),
      _("Write extra logs to the system journal."),
    );

    const showToast = (title: string): void => {
      try {
        window.add_toast(new Adw.Toast({ title }));
      } catch {
        // Ignore if window is closing.
      }
    };

    const exportBtn = new Gtk.Button({
      label: _("Export"),
      valign: Gtk.Align.CENTER,
    });
    exportBtn.connect("clicked", () => {
      const dialog = new Gtk.FileDialog({
        title: _("Export Notman settings"),
        initial_name: "notman-settings.json",
      });
      dialog.save(window, null, (_dlg, result) => {
        try {
          const file = dialog.save_finish(result);
          if (!file) return;
          const payload = new TextEncoder().encode(exportSettingsJson(settings as never));
          file.replace_contents_async(
            payload,
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null,
            (_f, writeRes) => {
              try {
                file.replace_contents_finish(writeRes);
                showToast(_("Settings exported"));
              } catch {
                showToast(_("Could not save settings file"));
              }
            },
          );
        } catch {
          // User cancelled dialog.
        }
      });
    });
    const exportRow = new Adw.ActionRow({
      title: _("Export settings"),
      subtitle: _("Save your configuration to a JSON file."),
    });
    exportRow.add_suffix(exportBtn);
    advancedGroup.add(exportRow);

    const importBtn = new Gtk.Button({
      label: _("Import"),
      valign: Gtk.Align.CENTER,
    });
    importBtn.connect("clicked", () => {
      const filter = new Gtk.FileFilter();
      filter.set_name(_("JSON files"));
      filter.add_pattern("*.json");
      const filters = new Gio.ListStore({ item_type: Gtk.FileFilter.$gtype });
      filters.append(filter);
      const dialog = new Gtk.FileDialog({
        title: _("Import Notman settings"),
        filters,
      });
      dialog.open(window, null, (_dlg, result) => {
        try {
          const file = dialog.open_finish(result);
          if (!file) return;
          file.load_contents_async(null, (_f, loadRes) => {
            try {
              const [ok, bytes] = file.load_contents_finish(loadRes);
              if (!ok) {
                showToast(_("Could not read settings file"));
                return;
              }
              const count = importSettingsJson(
                new TextDecoder("utf-8").decode(bytes),
                settings as never,
              );
              showToast(`${_("Imported")} ${count} ${_("settings")}`);
            } catch {
              showToast(_("Invalid settings file"));
            }
          });
        } catch {
          // User cancelled dialog.
        }
      });
    });
    const importRow = new Adw.ActionRow({
      title: _("Import settings"),
      subtitle: _("Load a configuration from a JSON file."),
    });
    importRow.add_suffix(importBtn);
    advancedGroup.add(importRow);

    const resetButton = new Gtk.Button({
      label: _("Reset"),
      valign: Gtk.Align.CENTER,
      css_classes: ["destructive-action"],
    });
    resetButton.connect("clicked", () => {
      const confirm = new Adw.MessageDialog({
        transient_for: window,
        modal: true,
        heading: _("Reset all settings?"),
        body: _(
          "This will restore default values and remove any custom per-app rules and quiet hours.",
        ),
      });
      confirm.add_response("cancel", _("Cancel"));
      confirm.add_response("reset", _("Reset"));
      confirm.set_response_appearance("reset", Adw.ResponseAppearance.DESTRUCTIVE);
      confirm.set_default_response("cancel");
      confirm.set_close_response("cancel");
      confirm.connect("response", (_dlg, response) => {
        if (response !== "reset") return;
        for (const key of Object.values(SettingKey)) {
          try {
            settings.reset(key);
          } catch {
            // Ignore individual key reset failures.
          }
        }
        showToast(_("Settings reset to defaults"));
      });
      confirm.present();
    });
    const resetRow = new Adw.ActionRow({
      title: _("Reset settings"),
      subtitle: _("Restore all defaults."),
    });
    resetRow.add_suffix(resetButton);
    advancedGroup.add(resetRow);
    aboutPage.add(advancedGroup);

    const baseUrl = (this.metadata.url ?? "https://github.com/Kbgjtn/notman").replace(/\/+$/, "");
    const infoGroup = new Adw.PreferencesGroup({
      title: _("Information"),
    });
    addLinkRow(infoGroup, _("Homepage"), baseUrl);
    addLinkRow(infoGroup, _("Release notes"), `${baseUrl}/releases`);
    addLinkRow(infoGroup, _("Report an issue"), `${baseUrl}/issues/new?template=bug_report.yml`);
    addLinkRow(
      infoGroup,
      _("Feature request"),
      `${baseUrl}/issues/new?template=feature_request.yml`,
    );
    aboutPage.add(infoGroup);

    const cleanup = (): void => {
      if (disposed) return;
      disposed = true;
      if (statsTimerId !== null) {
        GLib.source_remove(statsTimerId);
        statsTimerId = null;
      }
      if (display && cssProvider) {
        Gtk.StyleContext.remove_provider_for_display(display, cssProvider);
        cssProvider = null;
      }
      for (const id of signalIds) {
        try {
          settings.disconnect(id);
        } catch {
          // Already disconnected.
        }
      }
      signalIds.length = 0;
      for (const { target, property } of bindings) {
        Gio.Settings.unbind(target as never, property);
      }
      bindings.length = 0;
    };
    window.connect("close-request", cleanup);
    window.connect("destroy", cleanup);

    window.add(generalPage);
    window.add(screenshotsPage);
    window.add(retentionPage);
    window.add(aboutPage);
  }
}
