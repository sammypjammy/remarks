import { useEffect, useMemo, useRef, useState } from "react";
import ToolkitAuth from '../shared/ToolkitAuth.jsx';
import { caseManagers } from "./caseManagers.js";
import { buildWelcomeEmail, buildWelcomeSubject, mergeEmailTemplates } from "./emailTemplate.js";
import { getManagerAttachments, isOutlookGraphConfigured } from "./outlookConfig.js";
import { createOutlookDraft, getOutlookErrorMessage, getGraphAccessToken } from "./outlookGraph.js";
import { openBulkDrafts, parseBulkRecipients } from "./bulkEmail.js";
import { addEmailHistory, browserEmailHistoryStorage, createEmailHistoryEntry, EMAIL_HISTORY_LIMIT, loadEmailHistory, saveEmailHistory } from "./emailHistory.js";
import { getCustomCaseManagers, getEmailSignature, getEmailTemplates, getSetting, setSetting, getToolkitNavigation } from "../shared/settingsStorage.js";

const EMAIL_TYPES = [
  { id: "welcome", label: "Welcome Emails", usesCaseManager: true },
  { id: "medical", label: "Medical Request", usesCaseManager: false },
  { id: "other", label: "Other", usesCaseManager: false },
];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OUTLOOK_WEB_HOSTS = new Set([
  "outlook.office.com",
  "outlook.office365.com",
  "outlook.cloud.microsoft",
]);
async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard copy failed");
}

function getOutlookComposeUrl(draft) {
  let outlookOrigin = "https://outlook.office365.com";
  let outlookHostname = "outlook.office365.com";

  try {
    const draftUrl = new URL(draft.webLink);
    if (OUTLOOK_WEB_HOSTS.has(draftUrl.hostname.toLowerCase())) {
      outlookOrigin = draftUrl.origin;
      outlookHostname = draftUrl.hostname.toLowerCase();
    }
  } catch {
    // Use the standard Outlook Web host if Graph returned an invalid webLink.
  }

  console.debug("Outlook draft handoff:", {
    hasDraftId: Boolean(draft.id),
    draftIdLength: draft.id?.length || 0,
    hasWebLink: Boolean(draft.webLink),
    outlookHostname,
    isDraft: typeof draft.isDraft === "boolean" ? draft.isDraft : "not returned by Graph",
  });

  if (!draft.id) throw new Error("Microsoft Graph did not return a draft message ID.");

  const encodedId = encodeURIComponent(draft.id);
  return `${outlookOrigin}/mail/deeplink/compose/${encodedId}?ItemID=${encodedId}&exvsurl=1`;
}

function getSavedManager() {
  try {
    const savedManager = getSetting("emailManager");
    const customManagerNames = getCustomCaseManagers().map((manager) => manager.fullName);
    return savedManager && (caseManagers[savedManager] || customManagerNames.includes(savedManager)) ? savedManager : "";
  } catch {
    return "";
  }
}

function getSavedLanguage() {
  try {
    return getSetting("emailLanguage") === "spanish" ? "spanish" : "english";
  } catch {
    return "english";
  }
}

function getInitialClientEmail() {
  try {
    return new URLSearchParams(window.location.search).get("email")?.trim() || "";
  } catch {
    return "";
  }
}

function formatHistoryTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export default function App() {
  const toolkitNavigation = getToolkitNavigation(false);
  const [clientEmail, setClientEmail] = useState(getInitialClientEmail);
  const [mode, setMode] = useState("single");
  const [emailType, setEmailType] = useState("welcome");
  const [constructionAlert, setConstructionAlert] = useState("");
  const isWelcome = EMAIL_TYPES.find(type => type.id === emailType)?.usesCaseManager;
  const [bulkText, setBulkText] = useState("");
  const [isBulkCreating, setIsBulkCreating] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const bulkBusyRef = useRef(false);
  const bulkRecipients = useMemo(() => parseBulkRecipients(bulkText), [bulkText]);
  const isBulk = mode === "bulk";
  const batchLocked = isBulkCreating;
  const [selectedManager, setSelectedManager] = useState(getSavedManager);
  const [errors, setErrors] = useState({});
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [language, setLanguage] = useState(getSavedLanguage);
  const [isAppMenuOpen, setIsAppMenuOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [isSignaturePromptOpen, setIsSignaturePromptOpen] = useState(false);
  const [emailSignature, setEmailSignature] = useState(getEmailSignature);
  const [preferencesRevision, setHomepageOrderRevision] = useState(0);
  const [emailHistory, setEmailHistory] = useState(() => loadEmailHistory(browserEmailHistoryStorage()));
  const emailHistoryRef = useRef(emailHistory);
  const draftRequestInProgressRef = useRef(false);
  const emailInputRef = useRef(null);
  const appMenuToggleRef = useRef(null);
  const appDrawerRef = useRef(null);
  const signaturePromptRef = useRef(null);

  const customCaseManagers = useMemo(getCustomCaseManagers, [preferencesRevision]);
  const allCaseManagers = useMemo(() => ({
    ...caseManagers,
    ...Object.fromEntries(customCaseManagers.map((caseManager) => [caseManager.fullName, caseManager])),
  }), [customCaseManagers]);
  const emailTemplates = useMemo(() => mergeEmailTemplates(getEmailTemplates()), [preferencesRevision]);
  const manager = allCaseManagers[selectedManager];
  const selectedTemplate = emailTemplates[language];
  const emailSubject = useMemo(
    () => buildWelcomeSubject(manager, selectedTemplate, language),
    [manager, selectedTemplate, language],
  );
  const emailBody = useMemo(
    () => buildWelcomeEmail(manager, emailSignature, selectedTemplate, language),
    [manager, emailSignature, selectedTemplate, language],
  );
  const managerAttachments = getManagerAttachments(selectedManager, language);
  const availableManagerNames = useMemo(
    () => Object.values(allCaseManagers)
      .filter((caseManager) => caseManager.languages?.includes(language))
      .map((caseManager) => caseManager.fullName),
    [allCaseManagers, language],
  );
  const hasRequiredFields = Boolean((isBulk ? bulkRecipients.recipients.length : clientEmail.trim()) && selectedManager);


  useEffect(() => {
    if (!isBulkCreating) return;
    const warnBeforeLeaving = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [isBulkCreating]);

  useEffect(() => {
    const syncSettings = event => {
      setEmailSignature(getEmailSignature());
      setHomepageOrderRevision(revision => revision + 1);
      if (event?.detail?.name === "storage") {
        setSelectedManager(getSavedManager());
        setLanguage(getSavedLanguage());
        const history = loadEmailHistory(browserEmailHistoryStorage());
        emailHistoryRef.current = history;
        setEmailHistory(history);
      }
    };
    const clearAccount = () => {
      setClientEmail(""); setBulkText(""); setCopyStatus(""); setBulkError("");
      setIsPreviewOpen(false); setErrors({});
      emailHistoryRef.current = []; setEmailHistory([]);
    };
    window.addEventListener("packardsettingschange", syncSettings);
    window.addEventListener("packardaccountchange", clearAccount);
    return () => {
      window.removeEventListener("packardsettingschange", syncSettings);
      window.removeEventListener("packardaccountchange", clearAccount);
    };
  }, []);

  useEffect(() => {
    if (!isAppMenuOpen) return undefined;
    document.body.classList.add("menu-open");
    appDrawerRef.current?.querySelector("button")?.focus();

    function handleDrawerKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsAppMenuOpen(false);
        requestAnimationFrame(() => appMenuToggleRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(appDrawerRef.current?.querySelectorAll("button, a[href]") || [])];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleDrawerKeydown);
    return () => {
      document.body.classList.remove("menu-open");
      document.removeEventListener("keydown", handleDrawerKeydown);
    };
  }, [isAppMenuOpen]);

  useEffect(() => {
    if (!isSignaturePromptOpen) return undefined;
    signaturePromptRef.current?.querySelector("a, button")?.focus();
    const closeSignaturePrompt = (event) => {
      if (event.key === "Escape") setIsSignaturePromptOpen(false);
    };
    document.addEventListener("keydown", closeSignaturePrompt);
    return () => document.removeEventListener("keydown", closeSignaturePrompt);
  }, [isSignaturePromptOpen]);

  function closeAppMenu(returnFocus = false) {
    setIsAppMenuOpen(false);
    if (returnFocus) requestAnimationFrame(() => appMenuToggleRef.current?.focus());
  }

  function validate() {
    const nextErrors = {};
    const trimmedEmail = clientEmail.trim();

    if (!trimmedEmail) {
      nextErrors.email = "Enter the client's email address.";
    } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
      nextErrors.email = "Enter a valid email address.";
    }

    if (!selectedManager) {
      nextErrors.manager = "Select a case manager.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function recordOpenedEmail(content, owner = window.PackardSettings.accountPreferenceOwner()) {
    if (owner !== window.PackardSettings.accountPreferenceOwner()) return;
    const nextHistory = addEmailHistory(emailHistoryRef.current, createEmailHistoryEntry(content));
    emailHistoryRef.current = nextHistory;
    setEmailHistory(nextHistory);
    saveEmailHistory(browserEmailHistoryStorage(), nextHistory);
  }

  function resetSenderForm({ focus = false, clearStatus = false } = {}) {
    setClientEmail("");
    setSelectedManager("");
    setErrors({});
    setIsPreviewOpen(false);
    if (clearStatus) setCopyStatus("");
    setSetting("emailManager", "");
    if (focus) requestAnimationFrame(() => emailInputRef.current?.focus());
  }

  async function handleBulkDrafts() {
    const owner = window.PackardSettings.accountPreferenceOwner();
    if (bulkBusyRef.current || draftRequestInProgressRef.current || !bulkRecipients.recipients.length || !selectedManager || !isOutlookGraphConfigured) return;
    if (!emailSignature) { setIsSignaturePromptOpen(true); return; }
    bulkBusyRef.current = true;
    setIsBulkCreating(true);
    setBulkError("");
    setCopyStatus("");
    try {
      const count = await openBulkDrafts({
        text: bulkText,
        content: { subject: emailSubject, body: emailBody, managerName: selectedManager, language },
        createDraft: createOutlookDraft, composeUrl: getOutlookComposeUrl, authorize: getGraphAccessToken,
        onDraftOpened: (recipient, content) => recordOpenedEmail({ ...content, recipient }, owner),
      });
      setCopyStatus(`Opened ${count} Outlook draft${count === 1 ? "" : "s"}. Review and send each draft in Outlook.`);
    } catch (error) {
      setBulkError(error.message);
    } finally {
      bulkBusyRef.current = false;
      setIsBulkCreating(false);
    }
  }

  async function handleSubmit(event) {
    const owner = window.PackardSettings.accountPreferenceOwner();
    event.preventDefault();
    if (!isWelcome) {
      setConstructionAlert(`${EMAIL_TYPES.find(type => type.id === emailType).label} is under construction. No email or Outlook draft was created.`);
      return;
    }
    if (bulkBusyRef.current) return;
    if (isBulk) { handleBulkDrafts(); return; }
    if (!validate()) return;

    if (!emailSignature) {
      setIsSignaturePromptOpen(true);
      return;
    }

    const draftContent = {
      recipient: clientEmail.trim(),
      subject: emailSubject,
      body: emailBody,
      managerName: selectedManager,
      language,
    };
    resetSenderForm();

    if (isOutlookGraphConfigured) {
      if (draftRequestInProgressRef.current) {
        setCopyStatus("Microsoft sign-in is already in progress.");
        return;
      }

      draftRequestInProgressRef.current = true;
      const openInNewTab = getSetting("openDraftsInNewTab");
      const outlookTab = openInNewTab ? window.open("about:blank", "_blank") : null;
      if (openInNewTab && !outlookTab) {
        draftRequestInProgressRef.current = false;
        setCopyStatus("Please allow popups for this site so the Outlook draft can open in a new tab.");
        return;
      }

      try {
        if (outlookTab) outlookTab.opener = null;
      } catch {
        // Some browsers prevent changing window.opener; the tab can still be reused.
      }

      setIsCreatingDraft(true);
      setCopyStatus("Signing in and creating your Outlook draft…");

      try {
        const draft = await createOutlookDraft(draftContent);
        setCopyStatus("Draft created with its PDF attachments. Opening Outlook…");
        const composeUrl = getOutlookComposeUrl(draft);
        if (outlookTab) {
          outlookTab.location.href = composeUrl;
          recordOpenedEmail(draftContent, owner);
        } else {
          recordOpenedEmail(draftContent, owner);
          window.location.assign(composeUrl);
        }
      } catch (error) {
        outlookTab?.close();
        console.error("Outlook draft creation failed:", error);
        setCopyStatus(`The Outlook draft could not be created. ${getOutlookErrorMessage(error)}`);
      } finally {
        draftRequestInProgressRef.current = false;
        setIsCreatingDraft(false);
      }
      return;
    }

    const composeUrl =
      "https://outlook.office.com/mail/deeplink/compose" +
      `?to=${encodeURIComponent(draftContent.recipient)}` +
      `&subject=${encodeURIComponent(draftContent.subject)}`;

    const openInNewTab = getSetting("openDraftsInNewTab");
    const outlookTab = openInNewTab ? window.open(composeUrl, "_blank", "noopener,noreferrer") : null;
    if (!openInNewTab || outlookTab) recordOpenedEmail(draftContent);

    try {
      await copyToClipboard(emailBody);
      if (openInNewTab) {
        setCopyStatus("Email body copied. Paste it into the Outlook draft.");
      } else {
        window.location.assign(composeUrl);
      }
    } catch {
      if (!openInNewTab) window.location.assign(composeUrl);
      setCopyStatus("Outlook opened, but the email body could not be copied. Use the preview to copy it manually.");
    }
  }

  function handleEmailChange(event) {
    setClientEmail(event.target.value);
    setCopyStatus("");
    if (errors.email) setErrors((current) => ({ ...current, email: undefined }));
  }

  function handleManagerChange(event) {
    setSelectedManager(event.target.value);
    setSetting("emailManager", event.target.value);
    setCopyStatus("");
    if (errors.manager) {
      setErrors((current) => ({ ...current, manager: undefined }));
    }
  }

  function handleLanguageChange(nextLanguage) {
    setLanguage(nextLanguage);
    setSetting("emailLanguage", nextLanguage);
    setCopyStatus("");
    setIsPreviewOpen(false);

    if (selectedManager && !manager?.languages?.includes(nextLanguage)) {
      setSelectedManager("");
      setSetting("emailManager", "");
      setErrors((current) => ({ ...current, manager: undefined }));
    }
  }

  function handleClear() {
    setBulkText("");
    setBulkError("");
    resetSenderForm({ focus: true, clearStatus: true });
  }

  function handleEmailTypeChange(nextType) {
    setEmailType(nextType);
    setErrors({});
    setBulkError("");
    setCopyStatus("");
    setConstructionAlert("");
    setIsPreviewOpen(false);
    setIsSignaturePromptOpen(false);
  }

  return (
    <div className="page-shell">
      <div className="app-shell">
        <header className="app-header">
          <div className="app-navigation">
            <button
              ref={appMenuToggleRef}
              className="app-menu-toggle"
              type="button"
              aria-label="Open Packard Toolkit menu"
              aria-haspopup="dialog"
              aria-expanded={isAppMenuOpen}
              aria-controls="app-menu"
              onClick={() => setIsAppMenuOpen((open) => !open)}
            >
              <span aria-hidden="true"></span>
              <span aria-hidden="true"></span>
              <span aria-hidden="true"></span>
            </button>

          </div>
          <a className="app-brand" href="/">Packard Toolkit</a>
          <ToolkitAuth />
        </header>

        {isAppMenuOpen && (
          <>
            <div className="app-menu-backdrop" onClick={() => closeAppMenu(true)} aria-hidden="true"></div>
            <aside
              id="app-menu"
              className="app-menu"
              ref={appDrawerRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="toolkit-menu-title"
            >
              <div className="app-menu-header">
                <div>
                  <p className="app-menu-eyebrow">Internal tools</p>
                  <h2 id="toolkit-menu-title">Packard Toolkit</h2>
                </div>
                <button className="icon-button drawer-close" type="button" onClick={() => closeAppMenu(true)} aria-label="Close Packard Toolkit menu">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                </button>
              </div>
              <nav className="toolkit-navigation" aria-label="Packard Toolkit tools">
                {toolkitNavigation.map((section) => (
                  <section className="toolkit-nav-section" key={section.label}>
                    <h3 className="toolkit-nav-label">{section.label}</h3>
                    {section.items.map((tool) =>
                      tool.current ? (
                        <span className="toolkit-nav-item active" aria-current="page" key={tool.id}>
                          <span>{tool.label}</span><span className="toolkit-nav-status">Current</span>
                        </span>
                      ) : tool.href ? (
                        <a className="toolkit-nav-item" href={tool.href} target={tool.external ? "_blank" : undefined} rel={tool.external ? "noopener noreferrer" : undefined} key={tool.id}>{tool.label}</a>
                      ) : (
                        <span className="toolkit-nav-item disabled" aria-disabled="true" key={tool.id}>
                          <span>{tool.label}</span><span className="toolkit-nav-status">{tool.status}</span>
                        </span>
                      ),
                    )}
                  </section>
                ))}
              </nav>
            </aside>
          </>
        )}

        <main className="panel" aria-labelledby="page-title">
          <div className="page-header">
            <div className="page-header-copy">
              <h1 id="page-title">Email Sender</h1>
              <p className="subtitle">Prepare a personalized welcome email and open it in Outlook.</p>
            </div>
          </div>

          <div className="email-workspace">
          <form className="sender-card" onSubmit={handleSubmit} noValidate>
          <fieldset className="sender-fields" disabled={batchLocked}>
          <div className="sender-top-controls">
            <div className="email-type-control">
              <label htmlFor="email-type">Email Type</label>
              <div className="select-wrap">
                <select id="email-type" value={emailType} disabled={isCreatingDraft} onChange={event => handleEmailTypeChange(event.target.value)}>
                  {EMAIL_TYPES.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
                </select>
              </div>
            </div>
            <div className="language-selector email-mode" role="group" aria-label="Email mode">
              {["single", "bulk"].map(value => (
                <button key={value} type="button" className={`language-option ${mode === value ? "active" : ""}`}
                  aria-pressed={mode === value} disabled={isCreatingDraft}
                  onClick={() => { setMode(value); setErrors({}); setCopyStatus(""); setConstructionAlert(""); }}>
                  {value === "single" ? "Single" : "Bulk"}
                </button>
              ))}
            </div>
            <div className="language-selector" role="radiogroup" aria-label="Email language">
              <button
                className={`language-option ${language === "english" ? "active" : ""}`}
                type="button"
                role="radio"
                aria-checked={language === "english"}
                disabled={batchLocked}
                onClick={() => handleLanguageChange("english")}
              >
                English
              </button>
              <button
                className={`language-option ${language === "spanish" ? "active" : ""}`}
                type="button"
                role="radio"
                aria-checked={language === "spanish"}
                disabled={batchLocked}
                onClick={() => handleLanguageChange("spanish")}
              >
                Spanish
              </button>
            </div>
          </div>
          <div className="form-fields">
            <div className="field-group">
            {isBulk ? <>
              <label htmlFor="bulk-recipients">Recipients</label>
              <textarea id="bulk-recipients" rows={7} value={bulkText}
                placeholder="Paste email addresses here…" spellCheck={false}
                aria-describedby="bulk-recipient-summary"
                onChange={event => setBulkText(event.target.value)} />
              <p id="bulk-recipient-summary" className="bulk-summary" role="status">
                {bulkRecipients.found > 0 && `${bulkRecipients.found} found · `}
                {bulkRecipients.recipients.length} unique valid
                {bulkRecipients.duplicates > 0 && ` · ${bulkRecipients.duplicates} duplicates removed`}
                {bulkRecipients.invalid.length > 0 && ` · ${bulkRecipients.invalid.length} invalid`}
              </p>
              {bulkRecipients.invalid.length > 0 && <details className="bulk-details">
                <summary>View rejected entries</summary>
                <ul>{bulkRecipients.invalid.map((entry, index) => <li key={index}>{entry}</li>)}</ul>
              </details>}
            </> : <>
            <label htmlFor="client-email">Client Email</label>
            <input
              ref={emailInputRef}
              id="client-email"
              className={errors.email ? "has-error" : ""}
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="client@email.com"
              value={clientEmail}
              onChange={handleEmailChange}
              onBlur={() => {
                if (clientEmail.trim() && !EMAIL_PATTERN.test(clientEmail.trim())) {
                  setErrors((current) => ({ ...current, email: "Enter a valid email address." }));
                }
              }}
              aria-describedby={errors.email ? "email-error" : undefined}
              aria-invalid={Boolean(errors.email)}
              autoFocus
            />
            {errors.email && <p className="field-error" id="email-error">{errors.email}</p>}
            </>}
            </div>

            {isWelcome && <div className="field-group">
            <label htmlFor="case-manager">Case Manager</label>
            <div className="select-wrap">
              <select
                id="case-manager"
                className={errors.manager ? "has-error" : ""}
                value={selectedManager}
                onChange={handleManagerChange}
                aria-describedby={errors.manager ? "manager-error" : undefined}
                aria-invalid={Boolean(errors.manager)}
              >
                <option value="">Select a case manager</option>
                {availableManagerNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            {errors.manager && <p className="field-error" id="manager-error">{errors.manager}</p>}
            </div>}
          </div>

          {isWelcome && <button
            className="preview-toggle"
            type="button"
            onClick={() => setIsPreviewOpen((open) => !open)}
            aria-expanded={isPreviewOpen}
            disabled={!hasRequiredFields}
          >
            {isPreviewOpen ? "Hide preview" : "Preview email"}
            <span aria-hidden="true">{isPreviewOpen ? "\u2212" : "+"}</span>
          </button>}

          {isWelcome && isPreviewOpen && (
            <section className="email-preview" aria-label="Email preview">
              <dl>
                <div><dt>To:</dt><dd>{isBulk ? `Individual copy to each of ${bulkRecipients.recipients.length} recipients` : clientEmail.trim()}</dd></div>
                <div><dt>Subject:</dt><dd>{emailSubject}</dd></div>
              </dl>
              <pre>{emailBody}</pre>
            </section>
          )}

          <div className="actions">
            <button className="primary-button" type="submit" disabled={isWelcome && (!hasRequiredFields || isCreatingDraft || (isBulk && !isOutlookGraphConfigured))}>
              <span>{isWelcome ? (isBulk ? `Open ${bulkRecipients.recipients.length} Draft${bulkRecipients.recipients.length === 1 ? "" : "s"}` : isCreatingDraft ? "Creating Draft…" : "Open Outlook Draft") : "Open Email"}</span>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M7.5 4.5h8v8M15 5 8.25 11.75M15 10.5v4a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
              </svg>
            </button>
            <button className="clear-button" type="button" onClick={handleClear} disabled={!clientEmail && !bulkText && !selectedManager && !isPreviewOpen}>
              Clear
            </button>
          </div>

          {isWelcome ? <p className="privacy-note">
            {isBulk ? (isOutlookGraphConfigured
              ? `Each recipient opens in a separate Outlook tab with ${managerAttachments.length} PDF attachment${managerAttachments.length === 1 ? "" : "s"}. Review and send each draft yourself in Outlook.`
              : "Bulk draft creation requires Microsoft Outlook integration to be configured.") : isOutlookGraphConfigured
              ? !selectedManager
                ? `Choose a case manager to use the ${language === "spanish" ? "Spanish" : "English"} welcome packet.`
                : managerAttachments.length
                ? `${managerAttachments.length} PDF attachment${managerAttachments.length === 1 ? "" : "s"} will be added automatically. Nothing is sent until you review it.`
                : "No PDF is mapped to this case manager yet. The draft will still be created for review."
              : "Outlook attachment setup is pending. Until configured, the email body is copied for you to paste."}
          </p> : <p className="privacy-note">{EMAIL_TYPES.find(type => type.id === emailType).label} is under construction.</p>}
          </fieldset>
          {constructionAlert && <p className="field-error" role="alert">{constructionAlert}</p>}
          {isBulk && bulkError && <p className="field-error" role="alert">{bulkError}</p>}
          </form>
          <aside className="email-history-card" aria-labelledby="email-history-title">
            <div className="email-history-header">
              <div>
                <p className="email-history-eyebrow">History</p>
                <h2 id="email-history-title">Sent Emails</h2>
              </div>
              <span>{emailHistory.length}/{EMAIL_HISTORY_LIMIT}</span>
            </div>
            <p className="email-history-description">Marked as sent when its prepared Outlook draft opens.</p>
            {emailHistory.length ? (
              <ol className="email-history-list" aria-live="polite">
                {emailHistory.map((entry) => (
                  <li className="email-history-item" key={entry.id}>
                    <strong>{entry.recipient}</strong>
                    <span className="email-history-subject" title={entry.subject}>{entry.subject}</span>
                    <span className="email-history-meta">
                      {entry.managerName} · {entry.language === "spanish" ? "Spanish" : "English"} · {formatHistoryTime(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="email-history-empty">
                <span aria-hidden="true">@</span>
                <p>Your most recently sent emails will appear here.</p>
              </div>
            )}
          </aside>
          </div>
        </main>
      </div>

      <footer className="app-footer">
        <div className="app-footer-inner">
          <span>&copy; 2026 Packard Law Firm</span>
          <span className="app-footer-divider" aria-hidden="true">&bull;</span>
          <details id="email-version-history" className="email-version-history">
            <summary>Email Sender v2.8.0</summary>
            <p><a href="/version-history/#email-sender-v2-8-0">v2.8.0 release notes</a></p>
            <p><strong>v2.7.0</strong> - Added persistent recent-email history for successfully opened Single and Bulk Outlook drafts, limited to the newest 20 recipients.</p>
            <p><strong>v2.6.0</strong> - Bulk Outlook Drafts opens one individual Outlook tab per valid unique recipient, preserving manual review and sending.</p>
          </details>
          <span className="app-footer-divider" aria-hidden="true">&bull;</span>
          <span>Internal use only</span>
          <span className="app-footer-divider" aria-hidden="true">&bull;</span>
          <span>Built by Sam Jensen</span>
          <span className="app-footer-links">
            <a className="app-footer-link" href="#email-version-history" onClick={() => { document.getElementById("email-version-history").open = true; }}>Version history</a>
            <a className="app-footer-link" href="/settings/">Settings</a>
            <a className="app-footer-link" href="https://outlook.office.com/mail/deeplink/compose?to=sam.jensen%40packardfirm.com&amp;subject=Packard%20Toolkit%20update%20request" target="_blank" rel="noopener noreferrer">Request an update</a>
          </span>
        </div>
      </footer>

      {copyStatus && (
        <div className="toast-container" aria-live="polite" aria-atomic="true">
          <div className={`toast ${copyStatus.includes("could not") || copyStatus.includes("allow popups") ? "toast-error" : "toast-success"}`} role="status">
            {copyStatus}
          </div>
        </div>
      )}

      {isSignaturePromptOpen && (
        <div className="settings-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setIsSignaturePromptOpen(false);
        }}>
          <section ref={signaturePromptRef} className="settings-modal signature-required-modal" role="dialog" aria-modal="true" aria-labelledby="signature-required-title">
            <div className="settings-modal-header">
              <div>
                <p className="settings-section-label">Signature Required</p>
                <h2 id="signature-required-title">Add your email signature first</h2>
              </div>
              <button className="icon-button" type="button" aria-label="Close" onClick={() => setIsSignaturePromptOpen(false)}>
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <div className="signature-required-content">
              <p>Your welcome emails need your name, position, and phone number before a draft can be created.</p>
              <div className="settings-modal-actions">
                <button className="clear-button" type="button" onClick={() => setIsSignaturePromptOpen(false)}>Not Now</button>
                <a className="save-remark-button signature-settings-link" href="/settings#email-signature">Go to Signature Settings</a>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
