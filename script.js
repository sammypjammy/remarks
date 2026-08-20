const themeController = {
  storageKey: "canned-remarks-theme",
  themes: ["light", "dark", "sepia", "forest", "blossom"],

  getInitialTheme() {
    try {
      const savedTheme = window.localStorage.getItem(this.storageKey);
      if (this.themes.includes(savedTheme)) return savedTheme;
    } catch (error) {
      // Themes still work when browser storage is unavailable.
    }

    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  },

  apply(theme, persist = false) {
    const selectedTheme = this.themes.includes(theme) ? theme : "light";
    document.documentElement.dataset.theme = selectedTheme;

    document.querySelectorAll("[data-theme-option]").forEach((option) => {
      const isActive = option.dataset.themeOption === selectedTheme;
      option.setAttribute("aria-checked", String(isActive));
      option.tabIndex = isActive ? 0 : -1;
    });

    if (persist) {
      try {
        window.localStorage.setItem(this.storageKey, selectedTheme);
      } catch (error) {
        // Ignore storage failures without interrupting the UI.
      }
    }
  },

  open() {
    const toggle = document.getElementById("themeToggle");
    const menu = document.getElementById("themeMenu");
    if (!toggle || !menu) return;
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    (menu.querySelector('[aria-checked="true"]') || menu.querySelector(".theme-option"))?.focus();
  },

  close(returnFocus = false) {
    const toggle = document.getElementById("themeToggle");
    const menu = document.getElementById("themeMenu");
    if (!toggle || !menu) return;
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    if (returnFocus) toggle.focus();
  },

  bind() {
    const toggle = document.getElementById("themeToggle");
    const menu = document.getElementById("themeMenu");
    if (!toggle || !menu) return;
    const options = [...menu.querySelectorAll(".theme-option")];

    toggle.addEventListener("click", () => menu.hidden ? this.open() : this.close(true));
    toggle.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        this.open();
        if (event.key === "ArrowUp") options.at(-1)?.focus();
      }
    });

    options.forEach((option) => option.addEventListener("click", () => {
      this.apply(option.dataset.themeOption, true);
      this.close(true);
    }));

    menu.addEventListener("keydown", (event) => {
      const currentIndex = options.indexOf(document.activeElement);
      let nextIndex;
      if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % options.length;
      if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + options.length) % options.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = options.length - 1;
      if (nextIndex !== undefined) {
        event.preventDefault();
        options[nextIndex].focus();
      }
    });

    document.addEventListener("click", (event) => {
      if (!menu.hidden && !event.target.closest(".theme-picker")) this.close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !menu.hidden) {
        event.preventDefault();
        this.close(true);
      }
    });
  }
};

themeController.apply(themeController.getInitialTheme());
themeController.bind();

// Add or edit remarks here. Each item defines a title, the base text template,
// and any field values needed to fill placeholders like {{date}} or {{facility}}.
const remarks = [
  {
    id: "dire-need-homeless",
    title: "795 Dire Need - Homeless or Transient",
    text: "The claimant is currently transient or homeless. They have been transient or homeless since {{date}}. We have sent in a 795 and are respectfully requesting that this claim be expedited and given critical claim status.",
    fields: [
      {
        key: "date",
        label: "Date",
        type: "date",
        required: true,
        placeholder: "MM/DD/YYYY"
      }
    ]
  },
  {
    id: "more-than-10-conditions",
    title: "More Than 10 Conditions",
    text: "The claimant has more than 10 conditions: {{conditions}}.",
    fields: [
      {
        key: "conditions",
        label: "Conditions",
        type: "textarea",
        placeholder: "Enter the claimant's conditions",
        required: true
      }
    ]
  },
  {
    id: "separated-but-still-married",
    title: "Separated but still married",
    text: "The claimant is separated but technically still married to his spouse. They have been separated since {{date}} and have not shared any resources or assets since then.",
    fields: [
      {
        key: "date",
        label: "Separation Date",
        type: "date",
        required: true,
        placeholder: "MM/DD/YYYY"
      }
    ]
  },
  {
    id: "disabled-veteran",
    title: "795 Disabled Veteran",
    text: "The claimant is a 100% Disabled Veteran. His medical conditions include: {{conditions}}. We have sent in a 795 and are respectfully requestingthat this claim be expedited and given Critical Claim status.",
    fields: [
      {
        key: "conditions",
        label: "Medical conditions",
        type: "textarea",
        placeholder: "Enter the medical conditions",
        required: true
      }
    ]
  },
  {
    id: "teri-cases",
    title: "795 TERI Cases",
    text: "The claimant's medical condition is critical and the claim is based on terminal illness. The claimant was diagnosed with {{condition}}. We have sent in a 795 and are respectfully requesting that this claim be expedited and given critical claim status.",
    fields: [
      {
        key: "condition",
        label: "Diagnosis / Condition",
        type: "text",
        placeholder: "Diagnosis",
        required: true
      }
    ]
  },
  {
    id: "prior-claim",
    title: "Prior Claim",
    text: "The claimant has a prior claim. We have sent in a 795 and are respectfully requesting that this claim be reopened.",
    fields: []
  },
  {
    id: "compassionate-allowance",
    title: "Compassionate Allowance or \"CAL\"",
    text: "The claimant suffers with a medical condition recognized by the SSA that would qualify for Compassionate Allowance. The claimant suffers with {{condition}}. We have sent in a 795 and are respectfully requesting that this claim be expedited and given Critical Claim status.",
    fields: [
      {
        key: "condition",
        label: "Medical condition",
        type: "text",
        placeholder: "Condition",
        required: true
      }
    ]
  },
  {
    id: "ssr-24-1p",
    title: "795 SSR 24-1p",
    text: "Because the claimant satisfies all the criteria outlined in SSR 24-1p, we respectfully request that the SSA find that the claimant is disabled under the Social Security Act.",
    fields: []
  },
  {
    id: "dib",
    title: "DIB",
    text: "The claimant only wishes to provide banking information if their disability is approved. All figures and dates are reported to the best of the claimant's memory, and may not be exact.",
    fields: []
  },
  {
    id: "dr",
    title: "DR",
    text: "The claimant has a more complete Work History than what was provided in this report. We will describe the prior work in detail on the Work History Report SSA-3369. The claimant's condition causes them to have \"bad days\" which makes it difficult for them to do anything for more than 15-30 minutes at a time. Thus, making it difficult for the claimant to keep a job; they would have too many unscheduled absences (minimum once a week). We do not currently have the dates of all tests and medical visits. Please order all the medical records from the dates provided to get the claimant's complete medical history. Should there be any difficulties in obtaining the claimant's complete medical records from the providers we have listed, please reach out to The Packard Law Firm's medical records acquisitions department for assistance: (210) 340-8877.",
    fields: []
  }
];

const remarkList = document.getElementById("remarkList");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalTitle = document.getElementById("modalTitle");
const modalContent = document.getElementById("modalContent");
const toast = document.getElementById("toast");
const closeModalButton = document.getElementById("closeModalButton");

let activeRemark = null;
let modalValues = {};
let toastTimer = null;
let is795FolderOpen = false;

function is795Remark(remark) {
  return remark.title.toLowerCase().startsWith("795 ");
}

function createRemarkCard(remark, in795Folder = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "remark-card";
  button.setAttribute("aria-label", `Use remark: ${remark.title}`);

  const label = document.createElement("span");
  label.className = "remark-card-title";
  label.textContent = in795Folder ? remark.title.replace(/^795\s+/i, "") : remark.title;

  const blurb = document.createElement("span");
  blurb.className = "remark-card-blurb";
  blurb.id = `blurb-${remark.id}`;
  blurb.setAttribute("role", "tooltip");
  blurb.textContent = remark.text;
  button.setAttribute("aria-describedby", blurb.id);

  button.append(label, blurb);
  const positionBlurb = () => {
    const cardBounds = button.getBoundingClientRect();
    const blurbWidth = Math.min(340, window.innerWidth - 52);
    const pagePadding = 16;
    const idealLeft = 10;
    const furthestLeft = window.innerWidth - pagePadding - cardBounds.left - blurbWidth;
    blurb.style.left = `${Math.max(pagePadding - cardBounds.left, Math.min(idealLeft, furthestLeft))}px`;
  };
  button.addEventListener("mouseenter", positionBlurb);
  button.addEventListener("focus", positionBlurb);
  button.addEventListener("click", () => {
    if (remark.fields && remark.fields.length > 0) {
      openRemarkModal(remark);
    } else {
      copyRemarkText(remark.text, remark.title);
    }
  });

  return button;
}

function create795Folder(groupedRemarks, openByDefault = false) {
  const folder = document.createElement("section");
  folder.className = "remark-folder";

  const folderButton = document.createElement("button");
  folderButton.type = "button";
  folderButton.className = "remark-card folder-card";
  folderButton.setAttribute("aria-expanded", String(openByDefault));
  folderButton.setAttribute("aria-controls", "folder-795-items");
  folderButton.innerHTML = `
    <span class="folder-card-row">
      <span class="folder-icon" aria-hidden="true">&#128193;</span>
      <span class="remark-card-title">795</span>
      <span class="folder-count">${groupedRemarks.length}</span>
      <span class="folder-chevron" aria-hidden="true">&#8964;</span>
    </span>`;

  const folderItems = document.createElement("div");
  folderItems.id = "folder-795-items";
  folderItems.className = "folder-items";
  folderItems.hidden = !openByDefault;
  groupedRemarks.forEach((remark) => folderItems.appendChild(createRemarkCard(remark, true)));

  folderButton.addEventListener("click", () => {
    is795FolderOpen = !is795FolderOpen;
    folderButton.setAttribute("aria-expanded", String(is795FolderOpen));
    folderItems.hidden = !is795FolderOpen;
  });

  folder.append(folderButton, folderItems);
  return folder;
}

// The UI is generated from the remarks array so new entries show up automatically.
function renderRemarks(filterText = "") {
  const searchValue = filterText.trim().toLowerCase();
  const filteredRemarks = remarks.filter((remark) =>
    `${remark.title} ${remark.text}`.toLowerCase().includes(searchValue)
  );

  remarkList.innerHTML = "";

  if (!filteredRemarks.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent = "No remarks match your search.";
    remarkList.appendChild(emptyState);
    return;
  }

  const grouped795 = filteredRemarks.filter(is795Remark);
  const ungrouped = filteredRemarks.filter((remark) => !is795Remark(remark));

  if (grouped795.length) {
    const shouldOpenFolder = Boolean(searchValue) || is795FolderOpen;
    is795FolderOpen = shouldOpenFolder;
    remarkList.appendChild(create795Folder(grouped795, shouldOpenFolder));
  }

  ungrouped.forEach((remark) => remarkList.appendChild(createRemarkCard(remark)));
}

function openRemarkModal(remark) {
  activeRemark = remark;
  modalValues = {};
  modalTitle.textContent = remark.title;

  const form = document.createElement("form");
  form.className = "modal-form";

  remark.fields.forEach((field) => {
    const wrapper = document.createElement("div");
    wrapper.className = "field";

    const label = document.createElement("label");
    label.setAttribute("for", `field-${field.key}`);
    label.textContent = field.label;

    const input = document.createElement(field.type === "textarea" ? "textarea" : "input");
    input.id = `field-${field.key}`;
    input.name = field.key;
    input.type = field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
    input.placeholder = field.placeholder || "";
    input.required = Boolean(field.required);

    if (field.type === "textarea") {
      input.rows = 4;
    }

    const dataKey = field.key;
    input.addEventListener("input", () => {
      modalValues[dataKey] = formatFieldValue(field, input.value);
      updatePreview();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && field.type !== "textarea" && !event.shiftKey) {
        event.preventDefault();
        copyFromModal();
      }
    });

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    form.appendChild(wrapper);
  });

  const preview = document.createElement("div");
  preview.className = "preview-box";
  preview.id = "remarkPreview";
  preview.innerHTML = "<strong>Preview</strong>";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "primary-btn";
  copyButton.textContent = "Copy";
  copyButton.addEventListener("click", copyFromModal);

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  actions.appendChild(copyButton);

  form.appendChild(preview);
  form.appendChild(actions);

  modalContent.innerHTML = "";
  modalContent.appendChild(form);

  updatePreview();
  modalBackdrop.classList.remove("hidden");
  modalBackdrop.setAttribute("aria-hidden", "false");

  const firstInput = modalContent.querySelector("input, textarea");
  if (firstInput) {
    firstInput.focus();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    copyFromModal();
  });
}

function updatePreview() {
  if (!activeRemark) {
    return;
  }

  const previewBox = document.getElementById("remarkPreview");
  if (!previewBox) {
    return;
  }

  const generatedText = replacePlaceholders(activeRemark.text, modalValues);
  previewBox.innerHTML = `<strong>Preview</strong>${escapeHtml(generatedText)}`;
}

function replacePlaceholders(template, values) {
  // Placeholders like {{name}} are replaced with the values entered in the popup.
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const value = values[key] ?? "";
    return value;
  });
}

function formatFieldValue(field, value) {
  if (field.type !== "date" || !value) {
    return value;
  }

  const [year, month, day] = value.split("-");
  return year && month && day ? `${month}/${day}/${year}` : value;
}

function escapeHtml(string) {
  return string
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function copyFromModal() {
  if (!activeRemark) {
    return;
  }

  const errors = activeRemark.fields.filter((field) => field.required && !(modalValues[field.key] || "").trim());

  if (errors.length > 0) {
    const firstMissingField = document.getElementById(`field-${errors[0].key}`);
    if (firstMissingField) {
      firstMissingField.focus();
    }
    return;
  }

  const finalText = replacePlaceholders(activeRemark.text, modalValues);
  copyRemarkText(finalText, activeRemark.title);
  closeModal();
}

// Copying uses the navigator clipboard when available and falls back to a textarea approach.
async function copyRemarkText(text, remarkTitle) {
  let copied = false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      copied = true;
    } else {
      copied = fallbackCopyText(text);
    }
  } catch (error) {
    copied = fallbackCopyText(text);
  }

  if (copied) {
    showToast(`Copied: ${remarkTitle}`);
  } else {
    showToast("Copy failed. Please try again.");
  }
}

function fallbackCopyText(text) {
  const tempTextArea = document.createElement("textarea");
  tempTextArea.value = text;
  tempTextArea.setAttribute("readonly", "");
  tempTextArea.style.position = "fixed";
  tempTextArea.style.left = "-9999px";
  document.body.appendChild(tempTextArea);
  tempTextArea.select();

  let success = false;
  try {
    success = document.execCommand("copy");
  } catch (error) {
    success = false;
  }

  document.body.removeChild(tempTextArea);
  return success;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 1500);
}

function closeModal() {
  activeRemark = null;
  modalValues = {};
  modalBackdrop.classList.add("hidden");
  modalBackdrop.setAttribute("aria-hidden", "true");
  modalContent.innerHTML = "";
}

closeModalButton.addEventListener("click", closeModal);

modalBackdrop.addEventListener("click", (event) => {
  if (event.target === modalBackdrop) {
    closeModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (modalBackdrop.classList.contains("hidden")) {
    return;
  }

  if (event.key === "Escape") {
    closeModal();
  }

  if (event.key === "Enter" && activeRemark && !event.target.matches("textarea")) {
    const activeElement = document.activeElement;
    if (!activeElement || activeElement.tagName !== "INPUT") {
      return;
    }

    if (!activeElement.form) {
      return;
    }

    event.preventDefault();
    copyFromModal();
  }
});

renderRemarks();
