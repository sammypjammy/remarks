const authStyles = document.createElement('link');
authStyles.rel = 'stylesheet';
authStyles.href = new URL('./toolkit-auth.css', document.currentScript.src).href;
document.head.append(authStyles);
const activePage = document.body.dataset.page || "home";
const routePrefix = activePage === "home" ? "./" : "../";
const routes = {
  home: routePrefix,
  remarks: `${routePrefix}canned-remarks/`,
  medTabs: `${routePrefix}med-tabs-generator/`,
  email: `${routePrefix}welcome-email-sender/`,
  fax: `${routePrefix}fax-sender/`,
  intake: `${routePrefix}intake-checker/`,
  settings: `${routePrefix}settings/`,
  versionHistory: `${routePrefix}version-history/`
};

function renderAppShell() {
  const headerRoot = document.querySelector("[data-app-header]");
  const menuRoot = document.querySelector("[data-app-menu]");
  const footerRoot = document.querySelector("[data-app-footer]");

  if (headerRoot) {
    headerRoot.innerHTML = `
      <header class="app-header">
        <div class="app-header-inner">
          <div class="app-navigation">
            <button id="appMenuToggle" class="app-menu-toggle" type="button" aria-label="Open Packard Toolkit menu" aria-haspopup="dialog" aria-expanded="false" aria-controls="appMenu">
              <span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span>
            </button>
            <a class="app-brand" href="${routes.home}">Packard Toolkit</a>
          </div>
          <div data-toolkit-auth aria-label="Toolkit account"></div>
        </div>
      </header>
    `;
  }

  if (menuRoot) {
    menuRoot.innerHTML = `
      <div id="appMenuBackdrop" class="app-menu-backdrop" hidden></div>
      <aside id="appMenu" class="app-menu" role="dialog" aria-modal="true" aria-labelledby="toolkit-menu-title" hidden>
        <div class="app-menu-header">
          <div>
            <p class="app-menu-eyebrow">Internal tools</p>
            <h2 id="toolkit-menu-title">Packard Toolkit</h2>
          </div>
          <button id="appMenuClose" class="icon-btn" type="button" aria-label="Close Packard Toolkit menu">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
          </button>
        </div>
        <nav id="toolkitNavigation" class="toolkit-navigation" aria-label="Packard Toolkit tools"></nav>
      </aside>
      <div id="toolkitRequestBackdrop" class="toolkit-request-backdrop" hidden></div>
      <section id="toolkitRequestModal" class="toolkit-request-modal" role="dialog" aria-modal="true" aria-labelledby="toolkitRequestTitle" hidden>
        <div class="toolkit-request-header">
          <div><p class="app-menu-eyebrow">Toolkit feedback</p><h2 id="toolkitRequestTitle">Request a Toolkit edit</h2></div>
          <button id="toolkitRequestClose" class="icon-btn" type="button" aria-label="Close request form">&times;</button>
        </div>
        <form id="toolkitRequestForm" class="toolkit-request-form">
          <label>Tool or page<select name="tool" required><option value="">Choose a tool</option><option>Toolkit Home</option><option>Med Tabs</option><option>Canned Remarks</option><option>Welcome Emails</option><option>Fax Sender</option><option>Intake Checker</option><option>Settings</option></select></label>
          <label>Requested edit<textarea name="edit" rows="4" required placeholder="What would you like changed?"></textarea></label>
          <label>Other details <span>(optional)</span><textarea name="details" rows="3" placeholder="Anything else that would help?"></textarea></label>
          <div class="toolkit-request-actions"><button id="toolkitRequestCancel" class="secondary-btn" type="button">Cancel</button><button class="settings-save-button" type="submit">Open Email Draft</button></div>
        </form>
      </section>
    `;
  }

  if (footerRoot) {
    footerRoot.innerHTML = `
      <footer class="app-footer">
        <div class="app-footer-inner">
          <span>&copy; 2026 Packard Law Firm</span>
          <span class="app-footer-divider" aria-hidden="true">&bull;</span>
          <a class="app-footer-link" href="${routes.versionHistory}">${footerRoot.dataset.appVersion || "Packard Toolkit v2.15.0"}</a>
          <span class="app-footer-divider" aria-hidden="true">&bull;</span>
          <span>Internal use only</span>
          <span class="app-footer-divider" aria-hidden="true">&bull;</span>
          <span>Built by Sam Jensen</span>
          <span class="app-footer-links">
            <a class="app-footer-link" href="${routes.versionHistory}">Version history</a>
            <a class="app-footer-link" href="${routes.settings}">Settings</a>
          </span>
        </div>
      </footer>
    `;
  }
}

renderAppShell();
import('./toolkit-auth.js').then(({ mountToolkitAuth }) => mountToolkitAuth(document.querySelector('[data-toolkit-auth]')));

const toolkitNavigationConfig = [
  {
    label: "Packard Toolkit",
    items: [
      { id: "home", label: "Home", url: routes.home },
      { id: "med-tabs", label: "Med Tabs", url: routes.medTabs },
      { id: "remarks", label: "Canned Remarks", url: routes.remarks },
      { id: "email", label: "Welcome Emails", url: routes.email },
      { id: "fax", label: "Fax Sender", url: routes.fax },
      { id: "intake", label: "Intake Checker", url: routes.intake }
    ]
  },
  {
    label: "Other",
    items: [{ id: "settings", label: "Settings", url: routes.settings }, { id: "request", label: "Request a Toolkit edit", request: true }]
  }
];

const appNavigation = {
  render() {
    const navigation = document.getElementById("toolkitNavigation");
    if (!navigation) return;
    navigation.innerHTML = toolkitNavigationConfig.map((section) => `
      <section class="toolkit-nav-section" aria-labelledby="nav-${section.label.toLowerCase().replaceAll(" ", "-")}">
        <h3 id="nav-${section.label.toLowerCase().replaceAll(" ", "-")}" class="toolkit-nav-label">${section.label}</h3>
        ${section.items.map((item) => {
          const isCurrent = item.id === activePage;
          if (isCurrent) return `<span class="toolkit-nav-item active" aria-current="page"><span>${item.label}</span><span class="toolkit-nav-status">Current</span></span>`;
          if (item.request) return `<button class="toolkit-nav-item toolkit-request-trigger" type="button" data-toolkit-request>${item.label}</button>`;
          if (!item.url) return `<span class="toolkit-nav-item disabled" aria-disabled="true"><span>${item.label}</span><span class="toolkit-nav-status">${item.disabledLabel}</span></span>`;
          return `<a class="toolkit-nav-item" href="${item.url}"><span>${item.label}</span></a>`;
        }).join("")}
      </section>
    `).join("");
  },

  open() {
    const toggle = document.getElementById("appMenuToggle");
    const menu = document.getElementById("appMenu");
    const backdrop = document.getElementById("appMenuBackdrop");
    if (!toggle || !menu || !backdrop) return;
    menu.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add("menu-open");
    toggle.setAttribute("aria-expanded", "true");
    document.getElementById("appMenuClose")?.focus();
  },

  close(returnFocus = false) {
    const toggle = document.getElementById("appMenuToggle");
    const menu = document.getElementById("appMenu");
    const backdrop = document.getElementById("appMenuBackdrop");
    if (!toggle || !menu || !backdrop) return;
    menu.hidden = true;
    backdrop.hidden = true;
    document.body.classList.remove("menu-open");
    toggle.setAttribute("aria-expanded", "false");
    if (returnFocus) toggle.focus();
  },

  bind() {
    const toggle = document.getElementById("appMenuToggle");
    const menu = document.getElementById("appMenu");
    const closeButton = document.getElementById("appMenuClose");
    const backdrop = document.getElementById("appMenuBackdrop");
    const requestModal = document.getElementById("toolkitRequestModal");
    const requestBackdrop = document.getElementById("toolkitRequestBackdrop");
    const requestForm = document.getElementById("toolkitRequestForm");
    if (!toggle || !menu || !closeButton || !backdrop) return;
    const closeRequest = (returnFocus = false) => {
      requestModal.hidden = true;
      requestBackdrop.hidden = true;
      document.body.classList.remove("menu-open");
      if (returnFocus) toggle.focus();
    };
    const openRequest = () => {
      this.close();
      requestModal.hidden = false;
      requestBackdrop.hidden = false;
      document.body.classList.add("menu-open");
      requestModal.querySelector("select")?.focus();
    };
    document.addEventListener("click", event => { if (event.target.closest("[data-toolkit-request]")) openRequest(); });
    document.getElementById("toolkitRequestClose").addEventListener("click", () => closeRequest(true));
    document.getElementById("toolkitRequestCancel").addEventListener("click", () => closeRequest(true));
    requestBackdrop.addEventListener("click", () => closeRequest(true));
    requestForm.addEventListener("submit", event => {
      event.preventDefault();
      const data = new FormData(requestForm);
      const signature = globalThis.PackardSettings?.getEmailSignatureText?.() || "Not provided";
      const body = [`Tool or page: ${data.get("tool")}`, "", "Requested edit:", data.get("edit"), "", "Other details:", data.get("details") || "None provided", "", "Requester information from Email Signature:", signature].join("\n");
      window.location.href = `mailto:samueljacobjensen@gmail.com?subject=${encodeURIComponent("Toolkit edit request: " + data.get("tool"))}&body=${encodeURIComponent(body)}`;
      requestForm.reset();
      closeRequest();
    });
    toggle.addEventListener("click", () => {
      if (menu.hidden) {
        this.open();
      } else {
        this.close(true);
      }
    });
    toggle.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.open();
      }
    });
    closeButton.addEventListener("click", () => this.close(true));
    backdrop.addEventListener("click", () => this.close(true));
    menu.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const focusable = [...menu.querySelectorAll("button, a[href]")];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Tab" && !requestModal.hidden) {
        const controls = [...requestModal.querySelectorAll("button, select, textarea")];
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      if (event.key === "Escape" && !requestModal.hidden) {
        event.preventDefault();
        closeRequest(true);
      } else if (event.key === "Escape" && !menu.hidden) {
        event.preventDefault();
        this.close(true);
      }
    });
  }
};

appNavigation.render();
appNavigation.bind();
