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
const customRemarkList = document.getElementById("customRemarkList");
const customRemarkModalTitle = document.getElementById("customRemarkModalTitle");
const saveCustomRemarkButton = document.getElementById("saveCustomRemarkButton");
const homepageToolList = document.getElementById("homepageToolList");
const homepageStatus = document.getElementById("homepageStatus");
const resetHomepageButton = document.getElementById("resetHomepage");
const homepageNameInput = document.getElementById("homepageName");
const homepageNameStatus = document.getElementById("homepageNameStatus");

let editingCustomRemarkId = null;
let customRemarkModalTrigger = openCustomRemarkModalButton;
let draggedHomepageTool = null;

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

function homepageToolMap() {
  return new Map(settings.homepageTools.map(tool => [tool.id, tool]));
}

function saveHomepageOrder(order, hidden, message = "Homepage saved.") {
  if (!settings.saveHomepagePreferences({ version: 1, order, hidden })) {
    setStatus(homepageStatus, "Homepage preferences could not be saved.", true);
    return false;
  }
  setStatus(homepageStatus, message);
  return true;
}

function renderHomepageSettings() {
  const preferences = settings.getHomepagePreferences();
  const tools = homepageToolMap();
  homepageToolList.replaceChildren();
  for (const id of preferences.order) {
    const tool = tools.get(id);
    if (!tool) continue;
    const row = document.createElement("div");
    row.className = "homepage-tool-row";
    row.draggable = true;
    row.dataset.toolId = id;

    const handle = document.createElement("span");
    handle.className = "homepage-drag-handle";
    handle.textContent = "::";
    handle.setAttribute("aria-hidden", "true");

    const name = document.createElement("strong");
    name.textContent = tool.label;

    const controls = document.createElement("div");
    controls.className = "homepage-tool-controls";
    const moveUp = document.createElement("button");
    moveUp.type = "button";
    moveUp.className = "homepage-move-button";
    moveUp.dataset.homepageMove = "up";
    moveUp.textContent = "↑";
    moveUp.title = "Move up";
    moveUp.setAttribute("aria-label", `Move ${tool.label} up`);
    moveUp.disabled = preferences.order.indexOf(id) === 0;
    const moveDown = document.createElement("button");
    moveDown.type = "button";
    moveDown.className = "homepage-move-button";
    moveDown.dataset.homepageMove = "down";
    moveDown.textContent = "↓";
    moveDown.title = "Move down";
    moveDown.setAttribute("aria-label", `Move ${tool.label} down`);
    moveDown.disabled = preferences.order.indexOf(id) === preferences.order.length - 1;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "settings-toggle homepage-visibility-toggle";
    toggle.dataset.homepageToggle = "true";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(!preferences.hidden.includes(id)));
    toggle.setAttribute("aria-label", `${preferences.hidden.includes(id) ? "Show" : "Hide"} ${tool.label} on homepage`);
    toggle.appendChild(document.createElement("span"));
    controls.append(moveUp, moveDown, toggle);
    row.append(handle, name, controls);
    homepageToolList.appendChild(row);
  }
}

function moveHomepageTool(id, direction) {
  const preferences = settings.getHomepagePreferences();
  const index = preferences.order.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= preferences.order.length) return;
  const order = [...preferences.order];
  [order[index], order[target]] = [order[target], order[index]];
  saveHomepageOrder(order, preferences.hidden, "Homepage order saved.");
}

function dropHomepageTool(targetId) {
  if (!draggedHomepageTool || draggedHomepageTool === targetId) return;
  const preferences = settings.getHomepagePreferences();
  const order = preferences.order.filter(id => id !== draggedHomepageTool);
  const targetIndex = order.indexOf(targetId);
  order.splice(targetIndex, 0, draggedHomepageTool);
  saveHomepageOrder(order, preferences.hidden, "Homepage order saved.");
  draggedHomepageTool = null;
}

function renderCustomRemarkList() {
  const customRemarks = settings.getCustomRemarks();
  customRemarkList.replaceChildren();
  customRemarkList.hidden = customRemarks.length === 0;

  customRemarks.forEach((remark) => {
    const item = document.createElement("div");
    item.className = "custom-remark-list-item";

    const copy = document.createElement("div");
    copy.className = "custom-remark-list-copy";
    const title = document.createElement("strong");
    title.textContent = remark.title;
    const section = document.createElement("span");
    section.textContent = remark.group;
    copy.append(title, section);

    const actions = document.createElement("div");
    actions.className = "custom-remark-list-actions";
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "custom-remark-action";
    editButton.textContent = "Edit";
    editButton.setAttribute("aria-label", `Edit ${remark.title}`);
    editButton.addEventListener("click", () => openCustomRemarkModal(remark, editButton));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "custom-remark-action delete";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete ${remark.title}`);
    deleteButton.addEventListener("click", () => {
      if (!window.confirm(`Delete “${remark.title}”? This cannot be undone.`)) return;
      const saved = settings.saveCustomRemarks(settings.getCustomRemarks().filter((item) => item.id !== remark.id));
      if (!saved) {
        window.alert("The custom remark could not be deleted from this browser.");
        return;
      }
      openCustomRemarkModalButton.focus();
    });

    actions.append(editButton, deleteButton);
    item.append(copy, actions);
    customRemarkList.appendChild(item);
  });
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

function openCustomRemarkModal(remark = null, trigger = openCustomRemarkModalButton) {
  customRemarkForm.reset();
  customRemarkFormStatus.textContent = "";
  populateRemarkSections();
  editingCustomRemarkId = remark?.id || null;
  customRemarkModalTrigger = trigger;
  customRemarkModalTitle.textContent = remark ? "Edit custom remark" : "Add custom remark";
  saveCustomRemarkButton.textContent = remark ? "Save changes" : "Save remark";

  if (remark) {
    customRemarkTitle.value = remark.title;
    customRemarkSection.value = remark.group;
    customRemarkText.value = remark.text;
  }
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
  if (returnFocus) customRemarkModalTrigger?.focus();
  editingCustomRemarkId = null;
  customRemarkModalTrigger = openCustomRemarkModalButton;
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
  renderHomepageSettings();
  if (forceFormValues || document.activeElement !== homepageNameInput) homepageNameInput.value = settings.getHomepagePreferences().name;
  renderCustomRemarkList();
}

document.querySelectorAll("[data-setting-option]").forEach((button) => {
  button.addEventListener("click", () => settings.setSetting(button.dataset.settingOption, button.dataset.value));
});

themeSelect.addEventListener("change", (event) => settings.setSetting("theme", event.currentTarget.value));
customRemarkSection.addEventListener("change", () => {
  updateNewSectionField();
  if (!newCustomSectionField.hidden) newCustomSectionName.focus();
});
openCustomRemarkModalButton.addEventListener("click", () => openCustomRemarkModal());
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
  const updatedRemark = {
    id: editingCustomRemarkId || createCustomRemarkId(),
    application: "filing",
    group,
    title,
    text
  };
  const nextCustomRemarks = editingCustomRemarkId
    ? customRemarks.map((remark) => remark.id === editingCustomRemarkId ? updatedRemark : remark)
    : [...customRemarks, updatedRemark];
  const saved = settings.saveCustomRemarks(nextCustomRemarks);

  if (!saved) {
    customRemarkFormStatus.textContent = "The custom remark could not be saved in this browser.";
    return;
  }

  closeCustomRemarkModal(false);
  updateCustomRemarkSummary();
  openCustomRemarkModalButton.focus();
});

document.getElementById("openDraftsToggle").addEventListener("click", (event) => {
  settings.setSetting("openDraftsInNewTab", event.currentTarget.getAttribute("aria-checked") !== "true");
});

document.getElementById("confirmMedTabsToggle").addEventListener("click", (event) => {
  settings.setSetting("confirmBeforeClearingMedTabs", event.currentTarget.getAttribute("aria-checked") !== "true");
});

homepageToolList.addEventListener("click", (event) => {
  const row = event.target.closest("[data-tool-id]");
  if (!row) return;
  const preferences = settings.getHomepagePreferences();
  if (event.target.closest("[data-homepage-toggle]")) {
    const hidden = preferences.hidden.includes(row.dataset.toolId)
      ? preferences.hidden.filter(id => id !== row.dataset.toolId)
      : [...preferences.hidden, row.dataset.toolId];
    saveHomepageOrder(preferences.order, hidden, "Homepage visibility saved.");
  } else {
    const direction = event.target.closest("[data-homepage-move]")?.dataset.homepageMove;
    if (direction) moveHomepageTool(row.dataset.toolId, direction === "up" ? -1 : 1);
  }
});
homepageNameInput.addEventListener("input", () => {
  const preferences = settings.getHomepagePreferences();
  const saved = settings.saveHomepagePreferences({ ...preferences, name: homepageNameInput.value });
  if (saved) setStatus(homepageNameStatus, "Name saved.");
  else setStatus(homepageNameStatus, "Name could not be saved.", true);
});
homepageToolList.addEventListener("dragstart", (event) => {
  const row = event.target.closest("[data-tool-id]");
  if (!row) return;
  draggedHomepageTool = row.dataset.toolId;
  row.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedHomepageTool);
});
homepageToolList.addEventListener("dragend", (event) => {
  event.target.closest("[data-tool-id]")?.classList.remove("dragging");
  draggedHomepageTool = null;
});
homepageToolList.addEventListener("dragover", (event) => {
  if (event.target.closest("[data-tool-id]")) event.preventDefault();
});
homepageToolList.addEventListener("drop", (event) => {
  event.preventDefault();
  const row = event.target.closest("[data-tool-id]");
  if (row) dropHomepageTool(row.dataset.toolId);
});
resetHomepageButton.addEventListener("click", () => {
  if (settings.resetHomepagePreferences()) setStatus(homepageStatus, "Homepage reset to default.");
  else setStatus(homepageStatus, "Homepage preferences could not be reset.", true);
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
