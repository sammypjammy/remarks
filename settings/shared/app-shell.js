const activePage = document.body.dataset.page || "home";
const routePrefix = activePage === "home" ? "./" : "../";
const routes = {
  home: routePrefix,
  remarks: `${routePrefix}canned-remarks/`,
  medTabs: `${routePrefix}med-tabs-generator/`,
  email: `${routePrefix}welcome-email-sender/`,
  settings: `${routePrefix}settings/`
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
    `;
  }

  if (footerRoot) {
    footerRoot.innerHTML = `
      <footer class="app-footer">
        <div class="app-footer-inner">
          <span>&copy; 2026 Packard Law Firm</span>
          <span class="app-footer-divider" aria-hidden="true">&bull;</span>
          <span>Packard Toolkit v1.0.0</span>
          <span class="app-footer-divider" aria-hidden="true">&bull;</span>
          <span>Internal use only</span>
          <span class="app-footer-divider" aria-hidden="true">&bull;</span>
          <span>Built by Sam Jensen</span>
          <span class="app-footer-links">
            <a class="app-footer-link" href="https://github.com/sammypjammy/remarks/commits/main/" target="_blank" rel="noopener noreferrer">Version history</a>
            <a class="app-footer-link" href="${routes.settings}">Settings</a>
          </span>
        </div>
      </footer>
    `;
  }
}

renderAppShell();

const toolkitNavigationConfig = [
  {
    label: "Packard Toolkit",
    items: [
      { id: "home", label: "Home", url: routes.home },
      { id: "med-tabs", label: "Med Tabs", url: routes.medTabs },
      { id: "remarks", label: "Canned Remarks", url: routes.remarks },
      { id: "email", label: "Welcome Emails", url: routes.email },
      { label: "Fax Sender", disabledLabel: "Coming soon" }
    ]
  },
  {
    label: "Other",
    items: [{ id: "settings", label: "Settings", url: routes.settings }]
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
    if (!toggle || !menu || !closeButton || !backdrop) return;
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
      if (event.key === "Escape" && !menu.hidden) {
        event.preventDefault();
        this.close(true);
      }
    });
  }
};

appNavigation.render();
appNavigation.bind();
