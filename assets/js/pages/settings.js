const settings = window.PackardSettings;

if (!settings) throw new Error("Packard settings storage was not loaded.");

const signatureInput = document.getElementById("emailSignature");
const resourcesInput = document.getElementById("emailResourcesUrl");
const themeSelect = document.getElementById("themeSelect");
const signatureStatus = document.getElementById("signatureStatus");
const resourcesStatus = document.getElementById("resourcesStatus");
const openCustomRemarkModalButton = document.getElementById("openCustomRemarkModal");
const customRemarkModalBackdrop = document.getElementById("customRemarkModalBackdrop");
const customRemarkForm = document.getElementById("customRemarkForm");
const customRemarkTitle = document.getElementById("customRemarkTitle");
const customRemarkSection = document.getElementById("customRemarkSection");
const newCustomSectionField = document.getElementById("newCustomSectionField");
const newCustomSectionName = document.getElementById("newCustomSectionName");
const customRemarkText = document.getElementById("customRemarkText");
const customRemarkFormStatus = document.getElementById("customRemarkFormStatus");

const BUILT_IN_REMARK_SECTIONS = [
  { value: "Filing Remarks", label: "Filing Remarks" },
  { value: "795 Remarks", label: "795 Remarks" },
  { value: "Things to Notate in Remarks", label: "Things to Notate" }
];

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

function updateCustomRemarkSummary() {
  const count = settings.getCustomRemarks().length;
  const summary = document.getElementById("customRemarkSummary");
  summary.textContent = count
    ? `${count.toLocaleString()} custom ${count === 1 ? "remark" : "remarks"} saved. Add another to an existing or new section.`
    : "Add a remark to an existing section or create a new section.";
}

function getRemarkSections() {
  const sections = [...BUILT_IN_REMARK_SECTIONS];
  settings.getCustomRemarks().forEach((remark) => {
    if (!remark.group || sections.some((section) => section.value.toLowerCase() === remark.group.toLowerCase())) return;
    sections.push({ value: remark.group, label: remark.group });
  });
  return sections;
}

function populateRemarkSections() {
  customRemarkSection.replaceChildren();
  getRemarkSections().forEach((section) => {
    const option = document.createElement("option");
    option.value = section.value;
    option.textContent = section.label;
    customRemarkSection.appendChild(option);
  });
  const newSectionOption = document.createElement("option");
  newSectionOption.value = "__new__";
  newSectionOption.textContent = "Add a new section…";
  customRemarkSection.appendChild(newSectionOption);
}

function updateNewSectionField() {
  const isCreatingSection = customRemarkSection.value === "__new__";
  newCustomSectionField.hidden = !isCreatingSection;
  newCustomSectionName.required = isCreatingSection;
  if (!isCreatingSection) newCustomSectionName.value = "";
}

function openCustomRemarkModal() {
  customRemarkForm.reset();
  customRemarkFormStatus.textContent = "";
  populateRemarkSections();
  updateNewSectionField();
  customRemarkModalBackdrop.classList.remove("hidden");
  customRemarkModalBackdrop.setAttribute("aria-hidden", "false");
  document.body.classList.add("menu-open");
  customRemarkTitle.focus();
}

function closeCustomRemarkModal(returnFocus = true) {
  customRemarkModalBackdrop.classList.add("hidden");
  customRemarkModalBackdrop.setAttribute("aria-hidden", "true");
  document.body.classList.remove("menu-open");
  if (returnFocus) openCustomRemarkModalButton.focus();
}

function createCustomRemarkId() {
  if (globalThis.crypto?.randomUUID) return `custom-${globalThis.crypto.randomUUID()}`;
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function hydrateFormValues(force = false) {
  if (force || document.activeElement !== signatureInput) signatureInput.value = settings.getEmailSignatureText();
  if (force || document.activeElement !== resourcesInput) resourcesInput.value = settings.getSetting("emailResourcesUrl") || "";
}

function renderSettings(forceFormValues = false) {
  themeSelect.value = settings.getSetting("theme");
  updateChoiceGroups();
  updateToggle(document.getElementById("openDraftsToggle"), "openDraftsInNewTab");
  updateToggle(document.getElementById("confirmMedTabsToggle"), "confirmBeforeClearingMedTabs");
  hydrateFormValues(forceFormValues);
  updateResourcesState();
  updateCustomRemarkSummary();
}

document.querySelectorAll("[data-setting-option]").forEach((button) => {
  button.addEventListener("click", () => settings.setSetting(button.dataset.settingOption, button.dataset.value));
});

themeSelect.addEventListener("change", (event) => settings.setSetting("theme", event.currentTarget.value));
customRemarkSection.addEventListener("change", () => {
  updateNewSectionField();
  if (!newCustomSectionField.hidden) newCustomSectionName.focus();
});
openCustomRemarkModalButton.addEventListener("click", openCustomRemarkModal);
document.getElementById("closeCustomRemarkModal").addEventListener("click", () => closeCustomRemarkModal());
document.getElementById("cancelCustomRemarkModal").addEventListener("click", () => closeCustomRemarkModal());
customRemarkModalBackdrop.addEventListener("click", (event) => {
  if (event.target === customRemarkModalBackdrop) closeCustomRemarkModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !customRemarkModalBackdrop.classList.contains("hidden")) {
    event.preventDefault();
    closeCustomRemarkModal();
  }
});

customRemarkForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = customRemarkTitle.value.trim();
  const text = customRemarkText.value.trim();
  let group = customRemarkSection.value;

  if (group === "__new__") group = newCustomSectionName.value.trim().replace(/\s+/g, " ");
  const existingSection = getRemarkSections().find((section) => section.value.toLowerCase() === group.toLowerCase());
  if (existingSection) group = existingSection.value;

  if (!title || !text || !group) {
    customRemarkFormStatus.textContent = "Enter a name, section, and remark text.";
    return;
  }

  const customRemarks = settings.getCustomRemarks();
  const saved = settings.saveCustomRemarks([
    ...customRemarks,
    { id: createCustomRemarkId(), application: "filing", group, title, text }
  ]);

  if (!saved) {
    customRemarkFormStatus.textContent = "The custom remark could not be saved in this browser.";
    return;
  }

  closeCustomRemarkModal();
  updateCustomRemarkSummary();
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
