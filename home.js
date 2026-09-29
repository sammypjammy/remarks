const homeGreeting = document.getElementById("homeGreeting");
const homeNamePrompt = document.getElementById("homeNamePrompt");
const homeCards = new Map([...document.querySelectorAll("[data-home-tool]")].map(card => [card.dataset.homeTool, card]));

function renderHomepageTools() {
  const preferences = window.PackardSettings?.getHomepagePreferences();
  if (!preferences) return;
  const grid = document.querySelector(".tool-grid");
  const orderHomepageToolIds = window.PackardSettings?.orderHomepageToolIds
    || (ids => [...preferences.order.filter(id => ids.includes(id)), ...ids.filter(id => !preferences.order.includes(id))]);
  for (const id of orderHomepageToolIds([...homeCards.keys()])) {
    const card = homeCards.get(id);
    if (!card) continue;
    card.hidden = preferences.hidden.includes(id);
    grid.appendChild(card);
  }
}

function renderHomeGreeting() {
  if (!homeGreeting) return;
  const name = window.PackardSettings?.getHomepagePreferences().name || "";
  homeGreeting.textContent = name ? `Welcome, ${name}.` : "Welcome to the Packard Toolkit.";
  if (homeNamePrompt) homeNamePrompt.hidden = Boolean(name);
}

window.addEventListener("packardsettingschange", renderHomeGreeting);
window.addEventListener("packardsettingschange", renderHomepageTools);
renderHomeGreeting();
renderHomepageTools();
