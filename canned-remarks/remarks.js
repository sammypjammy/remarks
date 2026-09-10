/*
 * Remarks Builder page logic.
 *
 * App-wide navigation and theme behavior live in ../settings/shared/app-shell.js so
 * this file can stay focused on the existing Remarks Builder functionality.
 */


async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    return fallbackCopyText(text);
  } catch (error) {
    return fallbackCopyText(text);
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

function showToastMessage(toastElement, message) {
  if (!toastElement) return;
  toastElement.textContent = message;
  toastElement.classList.add("show");
  window.clearTimeout(Number(toastElement.dataset.timer));
  const timer = window.setTimeout(() => toastElement.classList.remove("show"), 1800);
  toastElement.dataset.timer = String(timer);
}

const shortTermInput = document.getElementById("shortTermInput");
if (shortTermInput) {
  const storageKey = "packard-short-term-remarks";
  const copyButton = document.getElementById("copyShortTermButton");
  const clearButton = document.getElementById("clearShortTermButton");
  const characterCount = document.getElementById("shortTermCount");
  const shortTermToast = document.getElementById("toast");

  const updateShortTermState = () => {
    const hasText = Boolean(shortTermInput.value.trim());
    copyButton.disabled = !hasText;
    clearButton.disabled = !hasText;
    characterCount.textContent = `${shortTermInput.value.length.toLocaleString()} characters`;
  };

  try {
    shortTermInput.value = window.sessionStorage.getItem(storageKey) || "";
  } catch (error) {
    showToastMessage(shortTermToast, "Temporary browser storage is unavailable.");
  }
  updateShortTermState();

  shortTermInput.addEventListener("input", () => {
    try {
      if (shortTermInput.value) {
        window.sessionStorage.setItem(storageKey, shortTermInput.value);
      } else {
        window.sessionStorage.removeItem(storageKey);
      }
    } catch (error) {
      showToastMessage(shortTermToast, "Could not retain this text for the session.");
    }
    updateShortTermState();
  });

  copyButton.addEventListener("click", async () => {
    if (!shortTermInput.value.trim()) return;
    const copied = await copyTextToClipboard(shortTermInput.value);
    showToastMessage(shortTermToast, copied ? "Short-term remark copied." : "Copy failed. Please try again.");
  });

  clearButton.addEventListener("click", () => {
    shortTermInput.value = "";
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch (error) {
      // The textarea can still be cleared when browser storage is unavailable.
    }
    updateShortTermState();
    shortTermInput.focus();
    showToastMessage(shortTermToast, "Short-term remark cleared.");
  });
}

if (document.getElementById("remarkList")) {
// Filing Application options
const filingRemarks = [
  {
    id: "filing-dib",
    group: "Filing Remarks",
    title: "DIB",
    text: "The claimant only wishes to provide banking information if their disability is approved. All figures and dates are reported to the best of the claimant's memory, and may not be exact.",
    fields: []
  },
  {
    id: "filing-dr",
    group: "Filing Remarks",
    title: "DR",
    text: `The claimant has a more complete Work History than what was provided in this report. We will describe the prior work in detail on the Work History Report SSA-3369. The claimant's condition causes them to have "bad days" which makes it difficult for them to do anything for more than 15-30 minutes at a time. Thus, making it difficult for the claimant to keep a job; they would have too many unscheduled absences (minimum once a week).

We do not currently have the dates of all tests and medical visits. Please order all the medical records from the dates provided to get the claimant's complete medical history.

Should there be any difficulties in obtaining the claimant's complete medical records from the providers we have listed, please reach out to The Packard Law Firm's medical records acquisitions department for assistance: (210) 340-8877.`,
    fields: []
  },
  {
    id: "filing-all-appeals",
    group: "Filing Remarks",
    title: "All Appeals",
    text: "Because of the severity of my condition, I am unable to maintain Substantial Gainful Activity. My condition continues to deteriorate day by day.",
    fields: []
  },
  {
    id: "filing-medical",
    group: "Filing Remarks",
    title: "Medical",
    text: `All the medical doctors and hospitals I have mentioned performed tests, including:
X-rays
MRIs
Blood work
Imaging
CT scans
My doctors also prescribed medications I am currently taking.`,
    fields: []
  },
  {
    id: "filing-recon",
    group: "Filing Remarks",
    title: "Recon",
    text: "The claimant continues to receive medical treatment from all the doctors and treatment facilities listed in the initial claim, from which your office should order updated medical records.",
    fields: []
  },
  {
    id: "filing-rh",
    group: "Filing Remarks",
    title: "RH",
    text: "The claimant continues to receive medical treatment. In order to expedite the processing of the claimant's hearing, we have filed this appeal before collecting a comprehensive medical history. We will collect and submit all missing medical documentation/records as soon as we are given access to the claimant's electronic file.",
    fields: []
  },
  {
    id: "filing-795-dire-need",
    group: "795 Remarks",
    title: "795 Dire Need - Homeless or Transient",
    text: "The claimant is currently transient or homeless. They have been transient or homeless since {{date}}. We have sent in a 795 and we are respectfully requesting Critical Claim status and Expedited Processing.",
    fields: [{ key: "date", label: "Homeless or transient since", type: "text", format: "numericMonth", placeholder: "MM/YYYY", inputMode: "numeric", maxLength: 7, pattern: "(?:0[1-9]|1[0-2])/[0-9]{4}", required: true }]
  },
  {
    id: "filing-795-disabled-veteran",
    group: "795 Remarks",
    title: "795 Disabled Veteran (DAV)",
    text: "The claimant is a 100% Disabled Veteran. Their medical conditions include: {{conditions}}. We have sent in a 795 and we are respectfully requesting Critical Claim status and Expedited Processing.",
    fields: [{ key: "conditions", label: "Medical conditions", type: "textarea", placeholder: "Enter the medical conditions", required: true }]
  },
  {
    id: "filing-795-teri",
    group: "795 Remarks",
    title: "795 Terminal Illness (TERI)",
    text: "The claimant's medical condition is critical and the claim is based on terminal illness. The claimant was diagnosed with {{condition}}. We have sent in a 795 and we are respectfully requesting Critical Claim status and Expedited Processing.",
    fields: [{ key: "condition", label: "Diagnosis / condition", type: "text", placeholder: "Enter the diagnosis", required: true }]
  },
  {
    id: "filing-795-ssr-24-1p",
    group: "795 Remarks",
    title: "795 SSR 24-1p",
    text: "Because the claimant satisfies all the criteria outlined in SSR 24-1p, we respectfully request that the SSA find that the claimant is disabled under the Social Security Act.",
    fields: []
  },
  {
    id: "filing-795-safety-risk",
    group: "795 Remarks",
    title: "795 Risk to Personal or Public Safety",
    text: "The claimant poses a risk to {{safetyType}}. We have sent in a 795 and we are respectfully requesting Critical Claim status and Expedited Processing.",
    fields: [
      {
        key: "safetyType",
        label: "Which type of safety risk applies?",
        type: "select",
        placeholder: "Choose personal or public safety",
        required: true,
        options: [
          { label: "Personal safety", value: "their personal safety" },
          { label: "Public safety", value: "the safety of the public" }
        ]
      }
    ]
  },
  {
    id: "filing-cal",
    group: "795 Remarks",
    title: "795 Compassionate Allowance (CAL)",
    text: "The claimant suffers with a medical condition recognized by the SSA that would qualify for Compassionate Allowance. The claimant suffers with: {{conditions}}. We have sent in a 795 and we are respectfully requesting Critical Claim status and Expedited Processing.",
    fields: [{ key: "conditions", label: "Medical conditions", type: "textarea", placeholder: "Enter the medical conditions", required: true }]
  },
  {
    id: "filing-more-than-10-conditions",
    group: "Things to Notate in Remarks",
    title: "More Than 10 Conditions",
    text: "The claimant has more than 10 conditions: {{conditions}}.",
    fields: [{ key: "conditions", label: "Conditions", type: "textarea", placeholder: "Enter the claimant's conditions", required: true }]
  },
  {
    id: "filing-separated",
    group: "Things to Notate in Remarks",
    title: "Separated but Still Married",
    text: "The claimant is separated but technically still married to their spouse. They have been separated since {{date}} and have not shared any resources or assets since then.",
    fields: [{ key: "date", label: "Separated since", type: "text", format: "numericMonth", placeholder: "MM/YYYY", inputMode: "numeric", maxLength: 7, pattern: "(?:0[1-9]|1[0-2])/[0-9]{4}", required: true }]
  },
  {
    id: "filing-prior-claim",
    group: "Things to Notate in Remarks",
    title: "Reopening a Prior Claim",
    text: "The claimant has a prior claim. We have sent in a 795 and are respectfully requesting that this claim be reopened.",
    fields: []
  },
  {
    id: "filing-failed-work-attempt",
    group: "Things to Notate in Remarks",
    title: "Failed Work Attempt",
    text: "The claimant has a Failed Work Attempt from {{startDate}} to {{endDate}}.",
    fields: [
      { key: "startDate", label: "Start date", type: "text", format: "numericMonth", placeholder: "MM/YYYY", inputMode: "numeric", maxLength: 7, pattern: "(?:0[1-9]|1[0-2])/[0-9]{4}", required: true },
      { key: "endDate", label: "End date", type: "text", format: "numericMonth", placeholder: "MM/YYYY", inputMode: "numeric", maxLength: 7, pattern: "(?:0[1-9]|1[0-2])/[0-9]{4}", required: true }
    ]
  },
  {
    id: "filing-money-after-onset",
    group: "Things to Notate in Remarks",
    title: "Money Received after Onset Date",
    text: "The claimant received money from {{source}} after the onset date in the amount of ${{amount}} per month.",
    fields: [
      { key: "source", label: "Where did the money come from?", type: "text", placeholder: "Enter the source of the money", required: true },
      { key: "amount", label: "How much money was received?", type: "text", placeholder: "e.g. $1,000", required: true }
    ]
  },
  {
    id: "filing-other-name",
    group: "Things to Notate in Remarks",
    title: "Other Name",
    text: "The claimant wishes to be called {{otherName}}.",
    fields: [
      { key: "otherName", label: "What name does the claimant wish to be called?", type: "text", placeholder: "Enter the claimant's preferred name", required: true }
    ]
  }
];

// 795 Application options use different wording and do not say a 795 was sent.
const application795Remarks = [
  {
    id: "795-dire-need",
    title: "795 Dire Need - Homeless or Transient",
    text: "The claimant is currently transient or homeless. They have been transient or homeless since {{date}}. We are respectfully requesting Critical Claim status and Expedited Processing.",
    fields: [{ key: "date", label: "Homeless or transient since", type: "text", format: "numericMonth", placeholder: "MM/YYYY", inputMode: "numeric", maxLength: 7, pattern: "(?:0[1-9]|1[0-2])/[0-9]{4}", required: true }]
  },
  {
    id: "795-disabled-veteran",
    title: "795 Disabled Veteran (DAV)",
    text: "The claimant is a 100% Disabled Veteran. Their medical conditions include: {{conditions}}. We are respectfully requesting Critical Claim status and Expedited Processing.",
    fields: [{ key: "conditions", label: "Medical conditions", type: "textarea", placeholder: "Enter the medical conditions", required: true }]
  },
  {
    id: "795-teri",
    title: "795 Terminal Illness (TERI)",
    text: "The claimant's medical condition is critical and the claim is based on terminal illness. The claimant was diagnosed with {{condition}}. We are respectfully requesting Critical Claim status and Expedited Processing.",
    fields: [{ key: "condition", label: "Diagnosis / condition", type: "text", placeholder: "Enter the diagnosis", required: true }]
  },
  {
    id: "795-ssr-24-1p",
    title: "795 SSR 24-1p",
    text: "Because the claimant satisfies all the criteria outlined in SSR 24-1p, we respectfully request that the SSA find that the claimant is disabled under the Social Security Act.",
    fields: []
  },
  {
    id: "795-safety-risk",
    title: "795 Risk to Personal or Public Safety",
    text: "The claimant poses a risk to {{safetyType}}. We are respectfully requesting Critical Claim status and Expedited Processing.",
    fields: [
      {
        key: "safetyType",
        label: "Which type of safety risk applies?",
        type: "select",
        placeholder: "Choose personal or public safety",
        required: true,
        options: [
          { label: "Personal safety", value: "their personal safety" },
          { label: "Public safety", value: "the safety of the public" }
        ]
      }
    ]
  },
  {
    id: "795-cal",
    title: "Compassionate Allowance (CAL)",
    text: "The claimant suffers with a medical condition recognized by the SSA that would qualify for Compassionate Allowance. The claimant suffers with {{conditions}}. We are respectfully requesting Critical Claim status and Expedited Processing.",
    fields: [{ key: "conditions", label: "Medical conditions", type: "textarea", placeholder: "Enter the medical conditions", required: true }]
  }
];

// Edit these entries to change the SSI questions and their generated text.
const ssiRemarks = [
  {
    id: "food-stamps",
    label: "Receives food stamps",
    text: "The claimant currently receives food stamps.",
    yesAddsText: true,
    noAddsText: false
  },
  {
    id: "living-alone",
    label: "Lives alone",
    text: "The claimant currently lives alone.",
    yesAddsText: true,
    noText: "The claimant currently lives with {{livingWith}}.",
    prompt: {
      answer: "no",
      key: "livingWith",
      title: "Who does the claimant live with?",
      label: "The claimant lives with",
      placeholder: "e.g. their father"
    }
  },
  {
    id: "living-expenses",
    label: "Living expenses",
    text: "The claimant's living expenses are paid for by {{expenseSource}}.",
    yesText: "The claimant's living expenses are paid for by {{expenseSource}}. Expenses are paid for by {{expenseSource}} directly to the service provider.",
    noAddsText: false,
    prompt: {
      answer: "yes",
      key: "expenseSource",
      title: "Who pays for the claimant's living expenses?",
      label: "The claimant's living expenses are paid for by",
      placeholder: "e.g. family members",
      reuseFrom: {
        itemId: "living-alone",
        key: "livingWith",
        label: "Fill"
      }
    }
  },
  {
    id: "receives-money",
    label: "Receives money",
    text: "At no point does the claimant ever receive any money from anyone.",
    yesText: "The claimant currently receives money from {{moneySource}}.",
    prompt: {
      answer: "yes",
      key: "moneySource",
      title: "Where does the claimant receive money from?",
      label: "The claimant receives money from",
      placeholder: "e.g. part-time work"
    }
  },
  {
    id: "marriage-status",
    label: "Marriage status",
    text: "The claimant is not married and does not share any assets and/or resources with anyone (i.e. bank accounts, bills, titles, etc.).",
    yesText: "The claimant is currently married."
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
let activeApplication = "filing";
const ssiSelections = {};
const ssiDetails = {};
let activeSsiPrompt = null;

function buildFilingRemarks() {
  const customRemarks = (window.PackardSettings?.getCustomRemarks() || [])
    .filter((remark) => remark.application === "filing")
    .map((remark) => ({ ...remark, fields: [] }));
  const sectionOrder = [...new Set([
    ...filingRemarks.map((remark) => remark.group),
    ...customRemarks.map((remark) => remark.group)
  ])];

  return sectionOrder.flatMap((group) => [
    ...filingRemarks.filter((remark) => remark.group === group),
    ...customRemarks.filter((remark) => remark.group === group)
  ]);
}

const remarkSets = {
  filing: buildFilingRemarks(),
  "795": application795Remarks,
  ssi: ssiRemarks
};

window.addEventListener("packardsettingschange", (event) => {
  if (event.detail?.name !== "customRemarks") return;
  remarkSets.filing = buildFilingRemarks();
  if (activeApplication === "filing") renderRemarks();
});

function createRemarkCard(remark) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "remark-card";
  button.setAttribute("aria-label", `Use remark: ${remark.title}`);

  const label = document.createElement("span");
  label.className = "remark-card-title";
  label.textContent = remark.title;

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

// The UI is generated from the currently selected application collection.
function renderRemarks(filterText = "") {
  if (activeApplication === "ssi") {
    renderSsiApplication();
    return;
  }

  const searchValue = filterText.trim().toLowerCase();
  const filteredRemarks = remarkSets[activeApplication].filter((remark) =>
    `${remark.title} ${remark.text}`.toLowerCase().includes(searchValue)
  );

  remarkList.innerHTML = "";

  if (!filteredRemarks.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent = searchValue
      ? "No remarks match your search."
      : "No remarks have been added yet.";
    remarkList.appendChild(emptyState);
    return;
  }

  let currentGroup = null;
  filteredRemarks.forEach((remark) => {
    if (remark.group && remark.group !== currentGroup) {
      const heading = document.createElement("h2");
      heading.className = "remark-group-title";
      heading.textContent = remark.group;
      remarkList.appendChild(heading);
      currentGroup = remark.group;
    }
    remarkList.appendChild(createRemarkCard(remark));
  });
}

function getSsiBlurb() {
  return ssiRemarks
    .map((item) => {
      const answer = ssiSelections[item.id];

      if (answer === "yes" && item.yesText) {
        if (item.prompt?.answer === "yes") {
          const value = ssiDetails[item.id]?.[item.prompt.key];
          return value ? replacePlaceholders(item.yesText, { [item.prompt.key]: value }) : "";
        }
        return item.yesText;
      }
      if (item.yesAddsText && answer === "yes") return item.text;
      if (item.noText && answer === "no") {
        const detailKey = item.prompt?.key;
        const value = detailKey ? ssiDetails[item.id]?.[detailKey] : "";
        return value ? replacePlaceholders(item.noText, { [detailKey]: value }) : "";
      }

      return answer === "no" && item.noAddsText !== false ? item.text : "";
    })
    .filter(Boolean)
    .join(" ");
}

function updateSsiPreview() {
  const previewText = document.getElementById("ssiPreviewText");
  if (!previewText) return;

  const blurb = getSsiBlurb();
  previewText.textContent = blurb || "Answer the items below to build the SSI remark.";
  previewText.classList.toggle("is-empty", !blurb);
}

function renderSsiApplication() {
  remarkList.innerHTML = "";

  const builder = document.createElement("section");
  builder.className = "ssi-builder";
  builder.setAttribute("aria-labelledby", "ssiBuilderTitle");

  const heading = document.createElement("h2");
  heading.id = "ssiBuilderTitle";
  heading.className = "ssi-builder-title";
  heading.textContent = "SSI Application Remarks";

  const description = document.createElement("p");
  description.className = "ssi-builder-description";
  description.textContent = "Your answers automatically build the appropriate SSI remark below.";

  const questionList = document.createElement("div");
  questionList.className = "ssi-question-list";

  ssiRemarks.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "ssi-question-row";
    row.setAttribute("role", "radiogroup");
    row.setAttribute("aria-labelledby", `ssi-question-${index + 1}`);

    const legend = document.createElement("span");
    legend.id = `ssi-question-${index + 1}`;
    legend.className = "ssi-question-label";
    legend.textContent = item.label;

    const choices = document.createElement("div");
    choices.className = "ssi-choice-group";

    ["yes", "no"].forEach((answer) => {
      const choice = document.createElement("label");
      choice.className = "ssi-choice";

      const input = document.createElement("input");
      input.type = "radio";
      input.name = `ssi-${item.id}`;
      input.value = answer;
      input.checked = ssiSelections[item.id] === answer;
      input.addEventListener("click", () => {
        if (item.prompt?.answer === answer && ssiSelections[item.id] === answer) {
          openSsiDetailModal(item);
        }
      });
      input.addEventListener("change", () => {
        ssiSelections[item.id] = answer;
        if (item.prompt?.answer === answer) {
          openSsiDetailModal(item);
          return;
        }
        updateSsiPreview();
      });

      const choiceText = document.createElement("span");
      choiceText.textContent = answer === "yes" ? "Yes" : "No";

      choice.append(input, choiceText);
      choices.appendChild(choice);
    });

    row.append(legend, choices);
    questionList.appendChild(row);
  });

  const preview = document.createElement("div");
  preview.className = "ssi-preview";

  const previewLabel = document.createElement("strong");
  previewLabel.textContent = "Remark preview";

  const previewText = document.createElement("p");
  previewText.id = "ssiPreviewText";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "primary-btn ssi-copy-button";
  copyButton.textContent = "Copy SSI Remark";
  copyButton.addEventListener("click", () => {
    const blurb = getSsiBlurb();
    if (!blurb) {
      showToast("Choose an answer that adds an SSI remark.");
      return;
    }
    copyRemarkText(blurb, "SSI Remark");
  });

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "secondary-btn";
  clearButton.textContent = "Clear";
  clearButton.addEventListener("click", () => {
    Object.keys(ssiSelections).forEach((key) => delete ssiSelections[key]);
    Object.keys(ssiDetails).forEach((key) => delete ssiDetails[key]);
    renderSsiApplication();
    showToast("SSI preview cleared.");
  });

  const actions = document.createElement("div");
  actions.className = "ssi-actions";
  actions.append(copyButton, clearButton);

  const previewColumn = document.createElement("aside");
  previewColumn.className = "ssi-preview-column";
  previewColumn.setAttribute("aria-label", "SSI remark result");

  const workspace = document.createElement("div");
  workspace.className = "ssi-workspace";

  preview.append(previewLabel, previewText);
  previewColumn.append(preview, actions);
  workspace.append(questionList, previewColumn);
  builder.append(heading, description, workspace);
  remarkList.appendChild(builder);
  updateSsiPreview();
}

function openSsiDetailModal(item) {
  const prompt = item.prompt;
  if (!prompt) return;

  activeSsiPrompt = { item, prompt };
  activeRemark = null;
  modalTitle.textContent = prompt.title;

  const form = document.createElement("form");
  form.className = "modal-form";

  const field = document.createElement("div");
  field.className = "field";

  const label = document.createElement("label");
  label.setAttribute("for", "ssiDetailInput");
  label.textContent = prompt.label;

  const input = document.createElement("input");
  input.id = "ssiDetailInput";
  input.name = prompt.key;
  input.type = "text";
  input.required = true;
  input.placeholder = prompt.placeholder;
  input.value = ssiDetails[item.id]?.[prompt.key] || "";

  if (prompt.reuseFrom) {
    const reuseValue = ssiDetails[prompt.reuseFrom.itemId]?.[prompt.reuseFrom.key] || "";
    const reuseButton = document.createElement("button");
    reuseButton.type = "button";
    reuseButton.className = "autofill-button";
    reuseButton.disabled = !reuseValue;
    reuseButton.textContent = reuseValue
      ? `${prompt.reuseFrom.label}: ${reuseValue}`
      : "No answer from \"Who does the claimant live with?\" yet";
    reuseButton.addEventListener("click", () => {
      input.value = reuseValue;
      input.focus();
    });
    field.append(label, input, reuseButton);
  } else {
    field.append(label, input);
  }

  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "primary-btn";
  saveButton.textContent = "Add to Remark";

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  actions.appendChild(saveButton);

  form.append(field, actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const detailValue = input.value.trim().replace(/[.!?]+$/, "");
    if (!detailValue) {
      input.focus();
      return;
    }

    ssiDetails[item.id] = {
      ...ssiDetails[item.id],
      [prompt.key]: detailValue
    };
    activeSsiPrompt = null;
    closeModal();
    updateSsiPreview();
  });

  modalContent.innerHTML = "";
  modalContent.appendChild(form);
  modalBackdrop.classList.remove("hidden");
  modalBackdrop.setAttribute("aria-hidden", "false");
  input.focus();
}

function selectApplication(application) {
  if (!remarkSets[application]) return;
  activeApplication = application;

  document.querySelectorAll("[data-application]").forEach((option) => {
    const isActive = option.dataset.application === application;
    option.classList.toggle("active", isActive);
    option.setAttribute("aria-checked", String(isActive));
    option.tabIndex = isActive ? 0 : -1;
  });

  const shortTermWorkspace = document.getElementById("shortTermWorkspace");
  if (shortTermWorkspace) shortTermWorkspace.hidden = application !== "filing";

  renderRemarks();
}

const applicationOptions = [...document.querySelectorAll("[data-application]")];
applicationOptions.forEach((option, index) => {
  option.addEventListener("click", () => selectApplication(option.dataset.application));
  option.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextOption = applicationOptions[(index + direction + applicationOptions.length) % applicationOptions.length];
    selectApplication(nextOption.dataset.application);
    nextOption.focus();
  });
});

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

    const input = document.createElement(
      field.type === "textarea" ? "textarea" : field.type === "select" ? "select" : "input"
    );
    input.id = `field-${field.key}`;
    input.name = field.key;
    input.required = Boolean(field.required);

    if (field.type === "select") {
      const placeholderOption = document.createElement("option");
      placeholderOption.value = "";
      placeholderOption.textContent = field.placeholder || "Choose an option";
      placeholderOption.disabled = true;
      placeholderOption.selected = true;
      input.appendChild(placeholderOption);

      field.options.forEach((option) => {
        const optionElement = document.createElement("option");
        optionElement.value = option.value;
        optionElement.textContent = option.label;
        input.appendChild(optionElement);
      });
    } else {
      input.type = ["number", "date", "month"].includes(field.type) ? field.type : "text";
      input.placeholder = field.placeholder || "";
      if (field.inputMode) input.inputMode = field.inputMode;
      if (field.maxLength) input.maxLength = field.maxLength;
      if (field.pattern) input.pattern = field.pattern;
    }

    if (field.type === "textarea") {
      input.rows = 4;
    }

    const dataKey = field.key;
    input.addEventListener("input", () => {
      const formattedValue = formatFieldValue(field, input.value);
      if (field.format === "numericMonth") input.value = formattedValue;
      modalValues[dataKey] = formattedValue;
      updatePreview();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && field.type !== "textarea" && !event.shiftKey) {
        event.preventDefault();
        copyFromModal();
      }
    });

    wrapper.append(label, input);

    const shortTermValue = shortTermInput?.value.trim() || "";
    const acceptsConditionList = field.key === "condition" || field.key === "conditions";
    if (acceptsConditionList && shortTermValue) {
      const reuseButton = document.createElement("button");
      reuseButton.type = "button";
      reuseButton.className = "autofill-button";
      reuseButton.textContent = "Use short-term condition list";
      reuseButton.addEventListener("click", () => {
        input.value = shortTermValue;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      });
      wrapper.appendChild(reuseButton);
    }

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

  const firstInput = modalContent.querySelector("input, textarea, select");
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
  if (!value) {
    return value;
  }

  if (field.format === "numericMonth") {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
  }

  if (field.type === "month") {
    const [year, month] = value.split("-");
    return year && month ? `${month}/${year}` : value;
  }

  if (field.type !== "date") return value;

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

  const form = modalContent.querySelector("form");
  if (form && !form.reportValidity()) return;

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
  const copied = await copyTextToClipboard(text);

  if (copied) {
    showToast(`Copied: ${remarkTitle}`);
  } else {
    showToast("Copy failed. Please try again.");
  }
}

function showToast(message) {
  showToastMessage(toast, message);
}

function closeModal() {
  if (activeSsiPrompt && !ssiDetails[activeSsiPrompt.item.id]?.[activeSsiPrompt.prompt.key]) {
    delete ssiSelections[activeSsiPrompt.item.id];
  }
  const shouldRefreshSsi = Boolean(activeSsiPrompt) && activeApplication === "ssi";
  activeSsiPrompt = null;
  activeRemark = null;
  modalValues = {};
  modalBackdrop.classList.add("hidden");
  modalBackdrop.setAttribute("aria-hidden", "true");
  modalContent.innerHTML = "";
  if (shouldRefreshSsi) renderSsiApplication();
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

selectApplication(activeApplication);
}
