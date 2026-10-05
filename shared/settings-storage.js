(function initializePackardSettings(global) {
  "use strict";

  const SETTINGS_STORAGE_KEY = "packard-toolkit-settings";
  const CUSTOM_REMARKS_STORAGE_KEY = "packard-toolkit-custom-remarks";
  const LEGACY_EMAIL_SIGNATURE_STORAGE_KEY = "packard-toolkit-email-signature";
  const EMAIL_TEMPLATES_STORAGE_KEY = "packard-toolkit-email-templates";
  const CUSTOM_CASE_MANAGERS_STORAGE_KEY = "packard-toolkit-custom-case-managers";
  const HOMEPAGE_STORAGE_KEY = "packard-toolkit-homepage";
  const ACCOUNT_EVENT_KEY = "packard-account-change";
  const preferenceKeys = {
    [SETTINGS_STORAGE_KEY]: "settings", [HOMEPAGE_STORAGE_KEY]: "homepage",
    [CUSTOM_REMARKS_STORAGE_KEY]: "customRemarks", [EMAIL_TEMPLATES_STORAGE_KEY]: "emailTemplates",
    [CUSTOM_CASE_MANAGERS_STORAGE_KEY]: "customCaseManagers"
  };
  let accountId = null, generation = 0, refreshSequence = 0, editRevision = 0, loading = true;
  let memory = {}, pending = {}, saving = null;
  let syncStatus = "loading";
  const LEGACY_THEME_STORAGE_KEYS = [
    "canned-remarks-theme",
    "med-tabs-theme",
    "packard-welcome-email-theme"
  ];
  const THEMES = ["light", "dark", "system", "sepia", "forest", "blossom"];
  const DENSITIES = ["comfortable", "compact"];
  const DEFAULT_SETTINGS = Object.freeze({
    theme: "system",
    density: "comfortable",
    openDraftsInNewTab: true,
    confirmBeforeClearingMedTabs: true,
    autoClearRemarksAfterCopy: false,
    emailSignature: "",
    emailResourcesUrl: "",
    emailManager: "",
    emailLanguage: "english"
  });
  const HOMEPAGE_TOOLS = Object.freeze([
    Object.freeze({ id: "remarks", label: "Canned Remarks", path: "canned-remarks/" }),
    Object.freeze({ id: "med-tabs", label: "Med Tabs", path: "med-tabs-generator/" }),
    Object.freeze({ id: "email", label: "Welcome Emails", path: "welcome-email-sender/" }),
    Object.freeze({ id: "fax", label: "Fax Sender", path: "fax-sender/" }),
    Object.freeze({ id: "intake", label: "Intake Checker", path: "intake-checker/" }),
    Object.freeze({ id: "ssa-intake", label: "SSA Intake Assistant", path: "ssa-intake-assistant/" })
  ]);
  const HOMEPAGE_VERSION = 1;
  const NAVIGATION_SECTIONS = Object.freeze([
    Object.freeze({ label: "Packard Toolkit", items: Object.freeze([
      Object.freeze({ id: "home", label: "Home", path: "" }), ...HOMEPAGE_TOOLS
    ]) }),
    Object.freeze({ label: "Other", items: Object.freeze([
      Object.freeze({ id: "settings", label: "Settings", path: "settings/" })
    ]) })
  ]);

  function getToolkitNavigation() {
    const orderedIds = orderHomepageToolIds(HOMEPAGE_TOOLS.map(tool => tool.id));
    return [
      { ...NAVIGATION_SECTIONS[0], items: [NAVIGATION_SECTIONS[0].items[0],
        ...orderedIds.map(id => HOMEPAGE_TOOLS.find(tool => tool.id === id)).filter(Boolean)] },
      NAVIGATION_SECTIONS[1]
    ];
  }
  const DEFAULT_HOMEPAGE_PREFERENCES = Object.freeze({
    version: HOMEPAGE_VERSION,
    order: Object.freeze(HOMEPAGE_TOOLS.map(tool => tool.id)),
    hidden: Object.freeze([]),
    name: ""
  });

  function readJson(key, fallback) {
    if (Object.hasOwn(preferenceKeys, key)) return memory[preferenceKeys[key]] ?? fallback;
    return readLocalJson(key, fallback);
  }

  function readLocalJson(key, fallback) {
    try {
      const value = global.localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    if (!Object.hasOwn(preferenceKeys, key) || (loading && !accountId)) return false;
    ++editRevision;
    const name = preferenceKeys[key];
    const patch = name === "settings"
      ? Object.fromEntries(Object.entries(value).filter(([key, val]) => memory.settings?.[key] !== val))
      : { [name]: value };
    memory[name] = value;
    if (accountId) { Object.assign(pending, patch); void flushPreferences(); }
    else reportStatus("signed-out");
    return true;
  }

  function normalizeHomepagePreferences(value) {
    const knownIds = new Set(HOMEPAGE_TOOLS.map(tool => tool.id));
    if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== HOMEPAGE_VERSION || !Array.isArray(value.order) || !Array.isArray(value.hidden)) {
      return {
        version: HOMEPAGE_VERSION,
        order: [...DEFAULT_HOMEPAGE_PREFERENCES.order],
        hidden: [],
        name: ""
      };
    }
    const order = [...new Set(value.order.filter(id => typeof id === "string" && knownIds.has(id)))];
    for (const id of DEFAULT_HOMEPAGE_PREFERENCES.order) if (!order.includes(id)) order.push(id);
    const hidden = [...new Set(value.hidden.filter(id => typeof id === "string" && knownIds.has(id)))].filter(id => order.includes(id));
    return { version: HOMEPAGE_VERSION, order, hidden, name: typeof value.name === "string" ? value.name.trim() : "" };
  }

  function getHomepagePreferences() {
    return normalizeHomepagePreferences(readJson(HOMEPAGE_STORAGE_KEY, null));
  }

  function orderHomepageToolIds(toolIds) {
    const available = [...new Set((Array.isArray(toolIds) ? toolIds : [])
      .filter(id => typeof id === "string" && id.length > 0))];
    const availableSet = new Set(available);
    const preferenceOrder = getHomepagePreferences().order;
    const ordered = preferenceOrder.filter(id => availableSet.delete(id));
    return [...ordered, ...available.filter(id => availableSet.has(id))];
  }

  function saveHomepagePreferences(preferences) {
    const normalized = normalizeHomepagePreferences(preferences);
    const succeeded = writeJson(HOMEPAGE_STORAGE_KEY, normalized);
    if (succeeded) announceChange("homepage", normalized);
    return succeeded;
  }

  function resetHomepagePreferences() {
    return saveHomepagePreferences(DEFAULT_HOMEPAGE_PREFERENCES);
  }

  function readLegacyTheme() {
    try {
      for (const key of LEGACY_THEME_STORAGE_KEYS) {
        const value = global.localStorage.getItem(key);
        if (THEMES.includes(value)) return value;
      }
    } catch {
      // Fall back to the new default when legacy storage is unavailable.
    }
    return DEFAULT_SETTINGS.theme;
  }

  function signatureObjectToText(signature) {
    if (!signature || typeof signature !== "object") return "";
    return [signature.name, signature.position, signature.phone]
      .filter((line) => typeof line === "string" && line.trim())
      .map((line) => line.trim())
      .join("\n");
  }

  function readLegacySignatureText() {
    return signatureObjectToText(readJson(LEGACY_EMAIL_SIGNATURE_STORAGE_KEY, null));
  }

  function normalizeSettings(value = {}, useLegacyValues = true) {
    const settings = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const theme = THEMES.includes(settings.theme)
      ? settings.theme
      : useLegacyValues
        ? readLegacyTheme()
        : DEFAULT_SETTINGS.theme;
    const density = DENSITIES.includes(settings.density) ? settings.density : DEFAULT_SETTINGS.density;
    const emailSignature = typeof settings.emailSignature === "string"
      ? settings.emailSignature.trim()
      : useLegacyValues
        ? readLegacySignatureText()
        : "";
    return {
      theme,
      density,
      openDraftsInNewTab: typeof settings.openDraftsInNewTab === "boolean"
        ? settings.openDraftsInNewTab
        : DEFAULT_SETTINGS.openDraftsInNewTab,
      confirmBeforeClearingMedTabs: typeof settings.confirmBeforeClearingMedTabs === "boolean"
        ? settings.confirmBeforeClearingMedTabs
        : DEFAULT_SETTINGS.confirmBeforeClearingMedTabs,
      autoClearRemarksAfterCopy: typeof settings.autoClearRemarksAfterCopy === "boolean"
        ? settings.autoClearRemarksAfterCopy
        : DEFAULT_SETTINGS.autoClearRemarksAfterCopy,
      emailSignature,
      emailResourcesUrl: typeof settings.emailResourcesUrl === "string" ? settings.emailResourcesUrl.trim() : "",
      emailManager: typeof settings.emailManager === "string" ? settings.emailManager : "",
      emailLanguage: settings.emailLanguage === "spanish" ? "spanish" : "english"
    };
  }

  function getSettings() {
    return normalizeSettings(readJson(SETTINGS_STORAGE_KEY, {}), false);
  }

  function getSetting(name) {
    return getSettings()[name];
  }

  function normalizeSetting(name, value) {
    if (name === "theme") return THEMES.includes(value) ? value : DEFAULT_SETTINGS.theme;
    if (name === "density") return DENSITIES.includes(value) ? value : DEFAULT_SETTINGS.density;
    if (name === "openDraftsInNewTab" || name === "confirmBeforeClearingMedTabs" || name === "autoClearRemarksAfterCopy") return Boolean(value);
    if (name === "emailSignature" || name === "emailResourcesUrl") return typeof value === "string" ? value.trim() : "";
    return value;
  }

  function getResolvedTheme(preference = getSetting("theme")) {
    if (preference === "system") {
      return global.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return THEMES.includes(preference) ? preference : "light";
  }

  function signatureTextToObject(text) {
    const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return null;
    return {
      text: lines.join("\n"),
      name: lines[0] || "",
      position: lines[1] || "",
      phone: lines.slice(2).join("\n") || ""
    };
  }

  function applyPreferences() {
    const settings = getSettings();
    const resolvedTheme = getResolvedTheme(settings.theme);
    global.document.documentElement.dataset.theme = resolvedTheme;
    global.document.documentElement.dataset.themePreference = settings.theme;
    global.document.documentElement.dataset.density = settings.density;
    const themeColor = global.document.querySelector('meta[name="theme-color"]');
    const themeColors = {
      light: "#f3f5f8",
      dark: "#0d121b",
      sepia: "#f4eedf",
      forest: "#edf4ef",
      blossom: "#fdf4f8"
    };
    if (themeColor) themeColor.content = themeColors[resolvedTheme] || themeColors.light;
    return settings;
  }

  function announceChange(name, value) {
    global.dispatchEvent(new CustomEvent("packardsettingschange", { detail: { name, value, settings: getSettings() } }));
  }

  function setSetting(name, value) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, name)) return false;
    const normalizedValue = normalizeSetting(name, value);
    const savedSettings = getSettings();
    const succeeded = writeJson(SETTINGS_STORAGE_KEY, { ...savedSettings, [name]: normalizedValue });
    if (!succeeded) return false;
    applyPreferences();
    announceChange(name, normalizedValue);
    return true;
  }

  function getEmailSignatureText() {
    return getSetting("emailSignature") || "";
  }

  function getEmailSignature() {
    return signatureTextToObject(getEmailSignatureText());
  }

  function saveEmailSignature(signature) {
    const text = typeof signature === "string" ? signature : signatureObjectToText(signature);
    return Boolean(text.trim()) && setSetting("emailSignature", text);
  }

  function normalizeRemark(remark) {
    if (!remark || typeof remark !== "object") return null;
    const id = typeof remark.id === "string" ? remark.id.trim() : "";
    const title = typeof remark.title === "string" ? remark.title.trim() : "";
    const text = typeof remark.text === "string" ? remark.text.trim() : "";
    const application = remark.application === "795" ? "795" : "filing";
    const group = typeof remark.group === "string" && remark.group.trim()
      ? remark.group.trim()
      : "Filing Remarks";
    return id && title && text ? { id, application, group, title, text, kind: "custom" } : null;
  }

  function getCustomRemarks() {
    const remarks = readJson(CUSTOM_REMARKS_STORAGE_KEY, []);
    return Array.isArray(remarks) ? remarks.map(normalizeRemark).filter(Boolean) : [];
  }

  function saveCustomRemarks(remarks) {
    const normalizedRemarks = Array.isArray(remarks) ? remarks.map(normalizeRemark).filter(Boolean) : [];
    const succeeded = writeJson(CUSTOM_REMARKS_STORAGE_KEY, normalizedRemarks);
    if (succeeded) announceChange("customRemarks", normalizedRemarks);
    return succeeded;
  }

  function normalizeEmailTemplates(templates) {
    if (!templates || typeof templates !== "object") return {};
    return ["english", "spanish"].reduce((normalized, language) => {
      const subject = typeof templates[language]?.subject === "string" ? templates[language].subject.trim() : "";
      const body = typeof templates[language]?.body === "string" ? templates[language].body.trim() : "";
      if (subject && body) normalized[language] = { subject, body };
      return normalized;
    }, {});
  }

  function getEmailTemplates() {
    return normalizeEmailTemplates(readJson(EMAIL_TEMPLATES_STORAGE_KEY, {}));
  }

  function saveEmailTemplates(templates) {
    const succeeded = writeJson(EMAIL_TEMPLATES_STORAGE_KEY, normalizeEmailTemplates(templates));
    if (succeeded) announceChange("emailTemplates", getEmailTemplates());
    return succeeded;
  }

  function normalizeCaseManager(manager) {
    if (!manager || typeof manager !== "object") return null;
    const fullName = typeof manager.fullName === "string" ? manager.fullName.trim() : "";
    const phone = typeof manager.phone === "string" ? manager.phone.trim() : "";
    const email = typeof manager.email === "string" ? manager.email.trim() : "";
    const introVideo = typeof manager.introVideo === "string" ? manager.introVideo.trim() : "";
    const languages = Array.isArray(manager.languages)
      ? manager.languages.filter((language) => language === "english" || language === "spanish")
      : [];
    return fullName && phone && email
      ? { fullName, phone, email, introVideo: introVideo || null, languages: [...new Set(languages.length ? languages : ["english"])], kind: "custom" }
      : null;
  }

  function getCustomCaseManagers() {
    const managers = readJson(CUSTOM_CASE_MANAGERS_STORAGE_KEY, []);
    return Array.isArray(managers) ? managers.map(normalizeCaseManager).filter(Boolean) : [];
  }

  function saveCustomCaseManagers(managers) {
    const normalizedManagers = Array.isArray(managers) ? managers.map(normalizeCaseManager).filter(Boolean) : [];
    const succeeded = writeJson(CUSTOM_CASE_MANAGERS_STORAGE_KEY, normalizedManagers);
    if (succeeded) announceChange("customCaseManagers", normalizedManagers);
    return succeeded;
  }

  function legacyPreferences() {
    try {
      const keys = [...Object.keys(preferenceKeys), LEGACY_EMAIL_SIGNATURE_STORAGE_KEY, ...LEGACY_THEME_STORAGE_KEYS,
        "packard-selected-case-manager", "packard-welcome-email-language"];
      if (!keys.some(key => global.localStorage.getItem(key) !== null)) return null;
    } catch { return null; }
    const settings = normalizeSettings(readLocalJson(SETTINGS_STORAGE_KEY, {}));
    try {
      settings.emailManager = global.localStorage.getItem("packard-selected-case-manager") || "";
      settings.emailLanguage = global.localStorage.getItem("packard-welcome-email-language") === "spanish" ? "spanish" : "english";
    } catch { /* Storage can be unavailable. */ }
    return { ...settings,
      homepage: normalizeHomepagePreferences(readLocalJson(HOMEPAGE_STORAGE_KEY, null)),
      customRemarks: (Array.isArray(readLocalJson(CUSTOM_REMARKS_STORAGE_KEY, [])) ? readLocalJson(CUSTOM_REMARKS_STORAGE_KEY, []) : []).map(normalizeRemark).filter(Boolean),
      emailTemplates: normalizeEmailTemplates(readLocalJson(EMAIL_TEMPLATES_STORAGE_KEY, {})),
      customCaseManagers: (Array.isArray(readLocalJson(CUSTOM_CASE_MANAGERS_STORAGE_KEY, [])) ? readLocalJson(CUSTOM_CASE_MANAGERS_STORAGE_KEY, []) : []).map(normalizeCaseManager).filter(Boolean)
    };
  }

  function clearBrowserState(preserveLocalState = false) {
    try {
      [...Object.keys(preferenceKeys), LEGACY_EMAIL_SIGNATURE_STORAGE_KEY, ...LEGACY_THEME_STORAGE_KEYS,
        "packard-selected-case-manager", "packard-welcome-email-language",
        ...(preserveLocalState ? [] : ["packard-welcome-email-history", "packard-email-history-owner"])]
        .forEach(key => global.localStorage.removeItem(key));
    } catch { /* In-memory account state is always cleared, even without storage. */ }
    if (!preserveLocalState) { try { global.sessionStorage?.removeItem("packard-short-term-remarks"); } catch { /* Optional storage. */ } }
  }

  function reportStatus(status) {
    syncStatus = status;
    global.dispatchEvent(new CustomEvent("packardpreferencesstatus", { detail: { status } }));
  }

  function hydrate(values) {
    memory = { settings: normalizeSettings(values, false) };
    for (const name of Object.values(preferenceKeys)) if (name !== "settings" && values[name] !== undefined) memory[name] = values[name];
    applyPreferences();
    announceChange("storage", null);
    announceChange("customRemarks", getCustomRemarks());
  }

  function clearAccountPreferences(broadcast = true, clearStorage = true) {
    ++generation; ++refreshSequence;
    accountId = null; pending = {}; saving = null; loading = false;
    if (clearStorage) clearBrowserState();
    else { try { global.sessionStorage?.removeItem("packard-short-term-remarks"); } catch { /* Optional storage. */ } }
    hydrate({});
    reportStatus("signed-out");
    global.dispatchEvent(new CustomEvent("packardaccountchange"));
    if (broadcast) {
      try { global.localStorage.setItem(ACCOUNT_EVENT_KEY, String(Date.now()) + Math.random()); } catch { /* Optional cross-tab notification. */ }
    }
  }

  async function preferenceRequest(options = {}) {
    const response = await global.fetch("/api/auth/session?preferences=1", {
      credentials: "same-origin", cache: "no-store", ...options
    });
    if (!response.ok) throw Object.assign(new Error("Preferences unavailable"), { status: response.status });
    const data = await response.json();
    if (typeof data.accountId !== "string" || !Object.hasOwn(data, "values")) throw new Error("Invalid preferences response");
    return data;
  }

  function flushPreferences() {
    if (saving) return saving;
    if (!accountId || !Object.keys(pending).length) return Promise.resolve();
    const owner = accountId, epoch = generation;
    reportStatus("saving");
    saving = (async () => {
      while (epoch === generation && Object.keys(pending).length) {
        const patch = pending; pending = {};
        try {
          await preferenceRequest({ method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accountId: owner, mode: "patch", values: patch }) });
        } catch (error) {
          if (epoch !== generation) return;
          if ([401, 403, 409].includes(error.status)) clearAccountPreferences();
          else { pending = { ...patch, ...pending }; reportStatus("error"); }
          return;
        }
      }
      if (epoch === generation) reportStatus("saved");
    })().finally(() => { if (epoch === generation) saving = null; });
    return saving;
  }

  async function refreshAccountPreferences() {
    const sequence = ++refreshSequence, epoch = generation;
    // Never overwrite unsaved edits with an older server snapshot.
    await flushPreferences();
    if (epoch !== generation || Object.keys(pending).length) return;
    loading = true;
    const revision = editRevision;
    try {
      let data = await preferenceRequest();
      if (sequence !== refreshSequence || epoch !== generation) return;
      if (accountId === data.accountId && editRevision !== revision) return;
      let previousOwner = accountId;
      try { previousOwner ||= global.localStorage.getItem("packard-email-history-owner"); } catch { /* Optional local cache. */ }
      if (previousOwner && previousOwner !== data.accountId) {
        try { global.localStorage.setItem(ACCOUNT_EVENT_KEY, String(Date.now()) + Math.random()); } catch { /* Optional cross-tab notification. */ }
      }
      if (accountId && accountId !== data.accountId) {
        clearBrowserState();
        global.dispatchEvent(new CustomEvent("packardaccountchange"));
      }
      if (data.values === null) {
        const legacy = legacyPreferences();
        // A clean device must not claim the one-time import with empty defaults:
        // an older browser may still have preferences worth migrating.
        if (legacy) data = await preferenceRequest({ method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: data.accountId, mode: "migrate", values: legacy }) });
      }
      if (sequence !== refreshSequence || epoch !== generation) return;
      accountId = data.accountId;
      // Delete legacy preferences only after the server has acknowledged them.
      // History stays local during this login; it is never uploaded as a preference.
      let sameOwner = false;
      try {
        sameOwner = global.localStorage.getItem("packard-email-history-owner") === accountId;
      } catch { /* Account preferences work without local storage. */ }
      clearBrowserState(sameOwner);
      try {
        global.localStorage.setItem("packard-email-history-owner", accountId);
      } catch { /* Local history is optional. */ }
      hydrate(data.values || {});
      reportStatus("saved");
    } catch (error) {
      if (sequence !== refreshSequence || epoch !== generation) return;
      if ([401, 403].includes(error.status)) clearAccountPreferences();
      else reportStatus("error");
    } finally { if (sequence === refreshSequence) loading = false; }
  }

  global.addEventListener("beforeunload", event => {
    if (saving || Object.keys(pending).length) { event.preventDefault(); event.returnValue = ""; }
  });
  global.addEventListener("storage", event => {
    if (event.key === ACCOUNT_EVENT_KEY) clearAccountPreferences(false, false);
  });
  function accountPreferencesStatus() { return syncStatus; }
  function accountPreferenceOwner() { return accountId; }
  function sessionSignedOut() {
    if (accountId) clearAccountPreferences();
    else { loading = false; reportStatus("signed-out"); }
  }

  const systemThemeQuery = global.matchMedia?.("(prefers-color-scheme: dark)");
  systemThemeQuery?.addEventListener?.("change", () => {
    if (getSetting("theme") !== "system") return;
    applyPreferences();
    announceChange("theme", "system");
  });

  global.addEventListener("storage", (event) => {
    if (event.key === SETTINGS_STORAGE_KEY) {
      applyPreferences();
      announceChange("storage", null);
    } else if (event.key === HOMEPAGE_STORAGE_KEY) {
      announceHomepageChange();
    }
  });

  function announceHomepageChange() {
    global.dispatchEvent(new CustomEvent("packardsettingschange", {
      detail: { name: "homepage", value: getHomepagePreferences(), settings: getSettings() }
    }));
  }

  applyPreferences();

  global.PackardSettings = Object.freeze({
    storageKey: SETTINGS_STORAGE_KEY,
    homepageStorageKey: HOMEPAGE_STORAGE_KEY,
    defaults: DEFAULT_SETTINGS,
    themes: THEMES,
    densities: DENSITIES,
    getSettings,
    getSetting,
    setSetting,
    getResolvedTheme,
    applyPreferences,
    getEmailSignatureText,
    getEmailSignature,
    saveEmailSignature,
    getCustomRemarks,
    saveCustomRemarks,
    getEmailTemplates,
    saveEmailTemplates,
    getCustomCaseManagers,
    saveCustomCaseManagers,
    homepageTools: HOMEPAGE_TOOLS,
    getToolkitNavigation,
    getHomepagePreferences,
    orderHomepageToolIds,
    saveHomepagePreferences,
    resetHomepagePreferences,
    refreshAccountPreferences, clearAccountPreferences, flushPreferences, accountPreferencesStatus,
    accountPreferenceOwner, sessionSignedOut
  });
})(window);
