const settings = window.PackardSettings;

if (!settings) throw new Error("Packard settings storage was not loaded.");

const signatureInput = document.getElementById("emailSignature");
const resourcesInput = document.getElementById("emailResourcesUrl");
const signatureStatus = document.getElementById("signatureStatus");
const resourcesStatus = document.getElementById("resourcesStatus");

function setStatus(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function updateChoiceGroups() {
  document.querySelectorAll("[data-setting-option]").forEach((button) => {
    const isActive = settings.getSetting(button.dataset.settingOption) === button.dataset.value;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-checked", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  });
}

function updateToggle(button, settingName) {
  button.setAttribute("aria-checked", String(Boolean(settings.getSetting(settingName))));
}

function updateResourcesState() {
  const state = document.getElementById("resourcesState");
  const isConfigured = Boolean(settings.getSetting("emailResourcesUrl"));
  state.textContent = isConfigured ? "Configured" : "Not configured";
  state.classList.toggle("configured", isConfigured);
}

function hydrateFormValues(force = false) {
  if (force || document.activeElement !== signatureInput) signatureInput.value = settings.getEmailSignatureText();
  if (force || document.activeElement !== resourcesInput) resourcesInput.value = settings.getSetting("emailResourcesUrl") || "";
}

function renderSettings(forceFormValues = false) {
  updateChoiceGroups();
  updateToggle(document.getElementById("openDraftsToggle"), "openDraftsInNewTab");
  updateToggle(document.getElementById("confirmMedTabsToggle"), "confirmBeforeClearingMedTabs");
  hydrateFormValues(forceFormValues);
  updateResourcesState();
}

document.querySelectorAll("[data-setting-option]").forEach((button) => {
  button.addEventListener("click", () => settings.setSetting(button.dataset.settingOption, button.dataset.value));
});

document.getElementById("openDraftsToggle").addEventListener("click", (event) => {
  settings.setSetting("openDraftsInNewTab", event.currentTarget.getAttribute("aria-checked") !== "true");
});

document.getElementById("confirmMedTabsToggle").addEventListener("click", (event) => {
  settings.setSetting("confirmBeforeClearingMedTabs", event.currentTarget.getAttribute("aria-checked") !== "true");
});

document.getElementById("signatureForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const signature = signatureInput.value.trim();
  const saved = settings.setSetting("emailSignature", signature);
  setStatus(signatureStatus, saved ? (signature ? "Signature saved." : "Signature removed.") : "Signature could not be saved.", !saved);
});

document.getElementById("resourcesForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const url = resourcesInput.value.trim();
  if (url) {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") throw new Error("Unsupported URL");
    } catch {
      setStatus(resourcesStatus, "Enter a complete http:// or https:// URL.", true);
      resourcesInput.focus();
      return;
    }
  }
  const saved = settings.setSetting("emailResourcesUrl", url);
  setStatus(resourcesStatus, saved ? (url ? "Resources link saved." : "Resources link removed.") : "Resources link could not be saved.", !saved);
});

window.addEventListener("packardsettingschange", () => renderSettings());
renderSettings(true);
