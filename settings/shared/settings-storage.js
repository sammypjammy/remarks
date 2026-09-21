(function initializePackardSettings(global) {
  "use strict";

  const SETTINGS_STORAGE_KEY = "packard-toolkit-settings";
  const CUSTOM_REMARKS_STORAGE_KEY = "packard-toolkit-custom-remarks";
  const LEGACY_EMAIL_SIGNATURE_STORAGE_KEY = "packard-toolkit-email-signature";
  const EMAIL_TEMPLATES_STORAGE_KEY = "packard-toolkit-email-templates";
  const CUSTOM_CASE_MANAGERS_STORAGE_KEY = "packard-toolkit-custom-case-managers";
  const HOMEPAGE_STORAGE_KEY = "packard-toolkit-homepage";
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
    emailSignature: "",
    emailResourcesUrl: ""
  });
  const HOMEPAGE_TOOLS = Object.freeze([
    Object.freeze({ id: "remarks", label: "Canned Remarks" }),
    Object.freeze({ id: "med-tabs", label: "Med Tabs" }),
    Object.freeze({ id: "email", label: "Welcome Emails" }),
    Object.freeze({ id: "fax", label: "Fax Sender" }),
    Object.freeze({ id: "intake", label: "Intake Checker" })
  ]);
  const HOMEPAGE_VERSION = 1;
  const DEFAULT_HOMEPAGE_PREFERENCES = Object.freeze({
    version: HOMEPAGE_VERSION,
    order: Object.freeze(HOMEPAGE_TOOLS.map(tool => tool.id)),
    hidden: Object.freeze([])
  });

  function readJson(key, fallback) {
    try {
      const value = global.localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function normalizeHomepagePreferences(value) {
    const knownIds = new Set(HOMEPAGE_TOOLS.map(tool => tool.id));
    if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== HOMEPAGE_VERSION || !Array.isArray(value.order) || !Array.isArray(value.hidden)) {
      return {
        version: HOMEPAGE_VERSION,
        order: [...DEFAULT_HOMEPAGE_PREFERENCES.order],
        hidden: []
      };
    }
    const order = [...new Set(value.order.filter(id => typeof id === "string" && knownIds.has(id)))];
    for (const id of DEFAULT_HOMEPAGE_PREFERENCES.order) if (!order.includes(id)) order.push(id);
    const hidden = [...new Set(value.hidden.filter(id => typeof id === "string" && knownIds.has(id)))].filter(id => order.includes(id));
    return { version: HOMEPAGE_VERSION, order, hidden };
  }

  function getHomepagePreferences() {
    return normalizeHomepagePreferences(readJson(HOMEPAGE_STORAGE_KEY, null));
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
      ...settings,
      theme,
      density,
      openDraftsInNewTab: typeof settings.openDraftsInNewTab === "boolean"
        ? settings.openDraftsInNewTab
        : DEFAULT_SETTINGS.openDraftsInNewTab,
      confirmBeforeClearingMedTabs: typeof settings.confirmBeforeClearingMedTabs === "boolean"
        ? settings.confirmBeforeClearingMedTabs
        : DEFAULT_SETTINGS.confirmBeforeClearingMedTabs,
      emailSignature,
      emailResourcesUrl: typeof settings.emailResourcesUrl === "string" ? settings.emailResourcesUrl.trim() : ""
    };
  }

  function getSettings() {
    return normalizeSettings(readJson(SETTINGS_STORAGE_KEY, {}));
  }

  function getSetting(name) {
    return getSettings()[name];
  }

  function normalizeSetting(name, value) {
    if (name === "theme") return THEMES.includes(value) ? value : DEFAULT_SETTINGS.theme;
    if (name === "density") return DENSITIES.includes(value) ? value : DEFAULT_SETTINGS.density;
    if (name === "openDraftsInNewTab" || name === "confirmBeforeClearingMedTabs") return Boolean(value);
    if (name === "emailSignature" || name === "emailResourcesUrl") return typeof value === "string" ? value.trim() : "";
    return value;
  }

  function getResolvedTheme(preference = getSetting("theme")) {
    if (preference === "system") {
      return global.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return THEMES.includes(preference) ? preference : "light";
  }

  function syncLegacyTheme(preference) {
    const resolvedTheme = getResolvedTheme(preference);
    try {
      LEGACY_THEME_STORAGE_KEYS.forEach((key) => global.localStorage.setItem(key, resolvedTheme));
    } catch {
      // The global preference remains available even when legacy keys cannot be updated.
    }
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

  function syncLegacySignature(text) {
    const signature = signatureTextToObject(text);
    if (!signature?.name || !signature.position || !signature.phone) return;
    writeJson(LEGACY_EMAIL_SIGNATURE_STORAGE_KEY, {
      name: signature.name,
      position: signature.position,
      phone: signature.phone
    });
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
    const normalizedValue = normalizeSetting(name, value);
    const savedSettings = getSettings();
    const succeeded = writeJson(SETTINGS_STORAGE_KEY, { ...savedSettings, [name]: normalizedValue });
    if (!succeeded) return false;
    if (name === "theme") syncLegacyTheme(normalizedValue);
    if (name === "emailSignature") syncLegacySignature(normalizedValue);
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
    return writeJson(EMAIL_TEMPLATES_STORAGE_KEY, normalizeEmailTemplates(templates));
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
    return writeJson(CUSTOM_CASE_MANAGERS_STORAGE_KEY, normalizedManagers);
  }

  function migrateSettings() {
    const savedSettings = readJson(SETTINGS_STORAGE_KEY, {});
    const normalizedSettings = normalizeSettings(savedSettings);
    writeJson(SETTINGS_STORAGE_KEY, normalizedSettings);
    syncLegacyTheme(normalizedSettings.theme);
    if (normalizedSettings.emailSignature) syncLegacySignature(normalizedSettings.emailSignature);
  }

  const systemThemeQuery = global.matchMedia?.("(prefers-color-scheme: dark)");
  systemThemeQuery?.addEventListener?.("change", () => {
    if (getSetting("theme") !== "system") return;
    syncLegacyTheme("system");
    applyPreferences();
    announceChange("theme", "system");
  });

  global.addEventListener("storage", (event) => {
    if (event.key !== SETTINGS_STORAGE_KEY) return;
    applyPreferences();
    announceChange("storage", null);
  });

  migrateSettings();
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
    getHomepagePreferences,
    saveHomepagePreferences,
    resetHomepagePreferences
  });
})(window);
