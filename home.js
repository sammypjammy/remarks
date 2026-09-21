const homeGreeting = document.getElementById("homeGreeting");
const homeCards = new Map([...document.querySelectorAll("[data-home-tool]")].map(card => [card.dataset.homeTool, card]));

function renderHomepageTools() {
  const preferences = window.PackardSettings?.getHomepagePreferences();
  if (!preferences) return;
  const grid = document.querySelector(".tool-grid");
  for (const id of preferences.order) {
    const card = homeCards.get(id);
    if (!card) continue;
    card.hidden = preferences.hidden.includes(id);
    grid.appendChild(card);
  }
}

function renderHomeGreeting() {
  if (!homeGreeting) return;
  const signature = window.PackardSettings?.getEmailSignature();
  homeGreeting.textContent = signature?.name
    ? `Welcome, ${signature.name}.`
    : "Welcome to the Packard Toolkit.";
}

window.addEventListener("packardsettingschange", renderHomeGreeting);
window.addEventListener("packardsettingschange", renderHomepageTools);
renderHomeGreeting();
renderHomepageTools();
