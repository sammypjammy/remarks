import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";

broadcastResponseToMainFrame().catch((error) => {
  console.error("Microsoft authentication callback failed:", error);
  document.body.textContent = "Microsoft sign-in could not be completed. You can close this window and try again.";
});
