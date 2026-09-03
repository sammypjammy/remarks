import { useEffect, useMemo, useRef, useState } from "react";
import { caseManagers } from "./caseManagers.js";
import { buildWelcomeEmail, buildWelcomeSubject, mergeEmailTemplates } from "./emailTemplate.js";
import { getManagerAttachments, isOutlookGraphConfigured } from "./outlookConfig.js";
import { createOutlookDraft, getOutlookErrorMessage } from "./outlookGraph.js";
import { getCustomCaseManagers, getEmailSignature, getEmailTemplates, getSetting } from "./settingsStorage.js";

const MANAGER_STORAGE_KEY = "packard-selected-case-manager";
const LANGUAGE_STORAGE_KEY = "packard-welcome-email-language";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OUTLOOK_WEB_HOSTS = new Set([
  "outlook.office.com",
  "outlook.office365.com",
  "outlook.cloud.microsoft",
]);
function getToolkitNavigation(isSettingsPage) {
  return [
  {
    label: "Packard Toolkit",
    items: [
      { id: "home", label: "Home", href: "/" },
      { id: "med-tabs", label: "Med Tabs", href: "/med-tabs/" },
      { id: "remarks", label: "Canned Remarks", href: "/remarks/" },
      { id: "email", label: "Welcome Emails", href: "/email/", current: !isSettingsPage },
      { id: "fax", label: "Fax Sender", status: "Coming soon" },
    ],
  },
  {
    label: "Other",
    items: [{ id: "settings", label: "Settings", href: "/settings/", current: isSettingsPage }],
  },
  ];
}
const themes = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
  { id: "sepia", label: "Sepia" },
  { id: "forest", label: "Forest" },
  { id: "blossom", label: "Blossom" },
];

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
    const savedManager = localStorage.getItem(MANAGER_STORAGE_KEY);
    const customManagerNames = getCustomCaseManagers().map((manager) => manager.fullName);
    return savedManager && (caseManagers[savedManager] || customManagerNames.includes(savedManager)) ? savedManager : "";
  } catch {
    return "";
  }
}

function getSavedTheme() {
  const savedTheme = getSetting("theme");
  return themes.some(({ id }) => id === savedTheme) ? savedTheme : "system";
}

function getSavedLanguage() {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY) === "spanish" ? "spanish" : "english";
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

export default function App() {
  const toolkitNavigation = getToolkitNavigation(false);
  const [clientEmail, setClientEmail] = useState(getInitialClientEmail);
  const [selectedManager, setSelectedManager] = useState(getSavedManager);
  const [errors, setErrors] = useState({});
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [theme, setTheme] = useState(getSavedTheme);
  const [language, setLanguage] = useState(getSavedLanguage);
  const [isAppMenuOpen, setIsAppMenuOpen] = useState(false);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [isSignaturePromptOpen, setIsSignaturePromptOpen] = useState(false);
  const [emailSignature, setEmailSignature] = useState(getEmailSignature);
  const draftRequestInProgressRef = useRef(false);
  const emailInputRef = useRef(null);
  const appMenuToggleRef = useRef(null);
  const appDrawerRef = useRef(null);
  const themePickerRef = useRef(null);
  const themeToggleRef = useRef(null);
  const signaturePromptRef = useRef(null);

  const customCaseManagers = useMemo(getCustomCaseManagers, []);
  const allCaseManagers = useMemo(() => ({
    ...caseManagers,
    ...Object.fromEntries(customCaseManagers.map((caseManager) => [caseManager.fullName, caseManager])),
  }), [customCaseManagers]);
  const emailTemplates = useMemo(() => mergeEmailTemplates(getEmailTemplates()), []);
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
  const hasRequiredFields = Boolean(clientEmail.trim() && selectedManager);

  useEffect(() => {
    if (!selectedManager) return;
    try {
      localStorage.setItem(MANAGER_STORAGE_KEY, selectedManager);
    } catch {
      // The app still works if browser storage is unavailable.
    }
  }, [selectedManager]);

  useEffect(() => {
    const syncSettings = () => {
      setTheme(getSavedTheme());
      setEmailSignature(getEmailSignature());
    };
    window.addEventListener("packardsettingschange", syncSettings);
    return () => window.removeEventListener("packardsettingschange", syncSettings);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // The language selector still works if browser storage is unavailable.
    }
  }, [language]);

  useEffect(() => {
    if (!isThemeMenuOpen) return undefined;

    function closeThemeMenu(event) {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "pointerdown" && themePickerRef.current?.contains(event.target)) return;
      setIsThemeMenuOpen(false);
      if (event.type === "keydown") themeToggleRef.current?.focus();
    }

    document.addEventListener("pointerdown", closeThemeMenu);
    document.addEventListener("keydown", closeThemeMenu);
    return () => {
      document.removeEventListener("pointerdown", closeThemeMenu);
      document.removeEventListener("keydown", closeThemeMenu);
    };
  }, [isThemeMenuOpen]);

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

  async function handleSubmit(event) {
    event.preventDefault();
    if (!validate()) return;

    if (!emailSignature) {
      setIsSignaturePromptOpen(true);
      return;
    }

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
        const draft = await createOutlookDraft({
          recipient: clientEmail.trim(),
          subject: emailSubject,
          body: emailBody,
          managerName: selectedManager,
          language,
        });
        setCopyStatus("Draft created with its PDF attachments. Opening Outlook…");
        const composeUrl = getOutlookComposeUrl(draft);
        if (outlookTab) {
          outlookTab.location.href = composeUrl;
        } else {
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
      `?to=${encodeURIComponent(clientEmail.trim())}` +
      `&subject=${encodeURIComponent(emailSubject)}`;

    const openInNewTab = getSetting("openDraftsInNewTab");
    if (openInNewTab) window.open(composeUrl, "_blank", "noopener,noreferrer");

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
    setCopyStatus("");
    if (errors.manager) {
      setErrors((current) => ({ ...current, manager: undefined }));
    }
  }

  function handleLanguageChange(nextLanguage) {
    setLanguage(nextLanguage);
    setCopyStatus("");
    setIsPreviewOpen(false);

    if (selectedManager && !manager?.languages?.includes(nextLanguage)) {
      setSelectedManager("");
      setErrors((current) => ({ ...current, manager: undefined }));
    }
  }

  function handleClear() {
    setClientEmail("");
    setSelectedManager("");
    setErrors({});
    setIsPreviewOpen(false);
    setCopyStatus("");
    emailInputRef.current?.focus();
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
              onClick={() => {
                setIsAppMenuOpen((open) => !open);
                setIsThemeMenuOpen(false);
              }}
            >
              <span aria-hidden="true"></span>
              <span aria-hidden="true"></span>
              <span aria-hidden="true"></span>
            </button>

          </div>
          <a className="app-brand" href="/">Packard Toolkit</a>
          <div className="app-header-actions">
            <div className="theme-picker" ref={themePickerRef}>
            <button
              ref={themeToggleRef}
              className="theme-toggle"
              type="button"
              aria-haspopup="menu"
              aria-expanded={isThemeMenuOpen}
              onClick={() => {
                setIsThemeMenuOpen((open) => !open);
                setIsAppMenuOpen(false);
              }}
            >
              <svg className="control-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3a9 9 0 1 0 0 18h1.5a1.5 1.5 0 0 0 0-3H12a2 2 0 0 1 0-4h2.5A6.5 6.5 0 0 0 21 7.5C21 5 17 3 12 3Z" />
                <circle cx="7.5" cy="10" r="1" /><circle cx="9.5" cy="6.5" r="1" /><circle cx="14" cy="6.2" r="1" /><circle cx="17.2" cy="9" r="1" />
              </svg>
              <span>Theme</span>
              <svg className="theme-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
            </button>

            {isThemeMenuOpen && (
              <div className="theme-menu" role="menu" aria-label="Choose color scheme">
                {themes.map((option) => (
                  <button
                    className="theme-option"
                    type="button"
                    role="menuitemradio"
                    aria-checked={theme === option.id}
                    key={option.id}
                    onClick={() => {
                      setTheme(option.id);
                      window.PackardSettings.setSetting("theme", option.id);
                      setIsThemeMenuOpen(false);
                    }}
                  >
                    <span className={`theme-swatch swatch-${option.id}`} aria-hidden="true"></span>
                    <span>{option.label}</span>
                    <span className="theme-check" aria-hidden="true">&#10003;</span>
                  </button>
                ))}
              </div>
            )}
            </div>
          </div>
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
                        <a className="toolkit-nav-item" href={tool.href} key={tool.id}>{tool.label}</a>
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
              <h1 id="page-title">Welcome Email Sender</h1>
              <p className="subtitle">Prepare a personalized welcome email and open it in Outlook.</p>
            </div>
            <div className="language-selector" role="radiogroup" aria-label="Packet language">
              <button
                className={`language-option ${language === "english" ? "active" : ""}`}
                type="button"
                role="radio"
                aria-checked={language === "english"}
                onClick={() => handleLanguageChange("english")}
              >
                English
              </button>
              <button
                className={`language-option ${language === "spanish" ? "active" : ""}`}
                type="button"
                role="radio"
                aria-checked={language === "spanish"}
                onClick={() => handleLanguageChange("spanish")}
              >
                Spanish
              </button>
            </div>
          </div>

          <form className="sender-card" onSubmit={handleSubmit} noValidate>
          <div className="form-fields">
            <div className="field-group">
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
            </div>

            <div className="field-group">
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
            </div>
          </div>

          <button
            className="preview-toggle"
            type="button"
            onClick={() => setIsPreviewOpen((open) => !open)}
            aria-expanded={isPreviewOpen}
            disabled={!hasRequiredFields}
          >
            {isPreviewOpen ? "Hide preview" : "Preview email"}
            <span aria-hidden="true">{isPreviewOpen ? "\u2212" : "+"}</span>
          </button>

          {isPreviewOpen && (
            <section className="email-preview" aria-label="Email preview">
              <dl>
                <div><dt>To:</dt><dd>{clientEmail.trim()}</dd></div>
                <div><dt>Subject:</dt><dd>{emailSubject}</dd></div>
              </dl>
              <pre>{emailBody}</pre>
            </section>
          )}

          <div className="actions">
            <button className="primary-button" type="submit" disabled={!hasRequiredFields || isCreatingDraft}>
              <span>{isCreatingDraft ? "Creating Draft…" : "Open Outlook Draft"}</span>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M7.5 4.5h8v8M15 5 8.25 11.75M15 10.5v4a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
              </svg>
            </button>
            <button className="clear-button" type="button" onClick={handleClear} disabled={!clientEmail && !selectedManager && !isPreviewOpen}>
              Clear
            </button>
          </div>

          <p className="privacy-note">
            {isOutlookGraphConfigured
              ? !selectedManager
                ? `Choose a case manager to use the ${language === "spanish" ? "Spanish" : "English"} welcome packet.`
                : managerAttachments.length
                ? `${managerAttachments.length} PDF attachment${managerAttachments.length === 1 ? "" : "s"} will be added automatically. Nothing is sent until you review it.`
                : "No PDF is mapped to this case manager yet. The draft will still be created for review."
              : "Outlook attachment setup is pending. Until configured, the email body is copied for you to paste."}
          </p>
          </form>
        </main>
      </div>

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
