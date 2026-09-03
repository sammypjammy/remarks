const activePage = document.body.dataset.page || "home";
const routePrefix = activePage === "home" ? "./" : "../";
const routes = {
  home: routePrefix,
  remarks: `${routePrefix}remarks/`,
  medTabs: `${routePrefix}med-tabs/`,
  email: `${routePrefix}email/`,
  settings: `${routePrefix}settings/`
};

function renderAppShell() {
  const headerRoot = document.querySelector("[data-app-header]");
  const menuRoot = document.querySelector("[data-app-menu]");

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

          <div class="theme-picker">
            <button id="themeToggle" class="theme-toggle" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="themeMenu">
              <svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1.5a1.5 1.5 0 0 0 0-3H12a2 2 0 0 1 0-4h2.5A6.5 6.5 0 0 0 21 7.5C21 5 17 3 12 3Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="9.5" cy="6.5" r="1"/><circle cx="14" cy="6.2" r="1"/><circle cx="17.2" cy="9" r="1"/></svg>
              <span id="themeLabel">Theme</span>
              <svg class="theme-menu-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>
            </button>
            <div id="themeMenu" class="theme-menu" role="menu" aria-label="Choose theme" hidden>
              ${["light", "dark", "system"].map((theme) => `
                <button class="theme-option" type="button" role="menuitemradio" aria-checked="false" data-theme-option="${theme}">
                  <span class="theme-swatch swatch-${theme}" aria-hidden="true"></span>
                  <span>${theme[0].toUpperCase()}${theme.slice(1)}</span>
                  <span class="theme-check" aria-hidden="true">&#10003;</span>
                </button>
              `).join("")}
            </div>
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
}

renderAppShell();

const themeController = {
  themes: ["light", "dark", "system"],

  getInitialTheme() {
    const savedTheme = window.PackardSettings?.getSetting("theme");
    return this.themes.includes(savedTheme) ? savedTheme : "system";
  },

  apply(theme, persist = false) {
    const selectedTheme = this.themes.includes(theme) ? theme : "system";
    if (persist) window.PackardSettings?.setSetting("theme", selectedTheme);
    else window.PackardSettings?.applyPreferences();
    document.querySelectorAll("[data-theme-option]").forEach((option) => {
      const isActive = option.dataset.themeOption === selectedTheme;
      option.setAttribute("aria-checked", String(isActive));
      option.tabIndex = isActive ? 0 : -1;
    });
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

    toggle.addEventListener("click", () => {
      if (menu.hidden) {
        appNavigation.close();
        this.open();
      } else {
        this.close(true);
      }
    });
    toggle.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        appNavigation.close();
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
    window.addEventListener("packardsettingschange", () => this.apply(this.getInitialTheme()));
  }
};

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
        themeController.close();
        this.open();
      } else {
        this.close(true);
      }
    });
    toggle.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        themeController.close();
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

themeController.apply(themeController.getInitialTheme());
themeController.bind();
appNavigation.render();
appNavigation.bind();
