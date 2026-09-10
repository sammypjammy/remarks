const homeGreeting = document.getElementById("homeGreeting");

function renderHomeGreeting() {
  if (!homeGreeting) return;
  const signature = window.PackardSettings?.getEmailSignature();
  homeGreeting.textContent = signature?.name
    ? `Welcome, ${signature.name}.`
    : "Welcome to the Packard Toolkit.";
}

window.addEventListener("packardsettingschange", renderHomeGreeting);
renderHomeGreeting();
