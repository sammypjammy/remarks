const settingsStorage = window.PackardSettings;

if (!settingsStorage) {
  throw new Error("Packard settings storage was not loaded.");
}

export const {
  getSetting,
  setSetting,
  getCustomRemarks,
  saveCustomRemarks,
  getEmailSignature,
  saveEmailSignature,
  getEmailTemplates,
  saveEmailTemplates,
  getCustomCaseManagers,
  saveCustomCaseManagers,
  getHomepagePreferences,
  orderHomepageToolIds,
  saveHomepagePreferences,
  resetHomepagePreferences,
  homepageTools,
} = settingsStorage;

export function getToolkitNavigation(isSettingsPage = false) {
  const tools = homepageTools.map((tool) => ({
    id: tool.id,
    label: tool.label,
    href: `/${tool.path}`,
    ...(tool.id === "email" && !isSettingsPage ? { current: true } : {}),
  }));
  const orderedIds = orderHomepageToolIds(tools.map((tool) => tool.id));
  return [
    {
      label: "Packard Toolkit",
      items: [
        { id: "home", label: "Home", href: "/" },
        ...orderedIds.map((id) => tools.find((tool) => tool.id === id)).filter(Boolean),
      ],
    },
    {
      label: "Other",
      items: [{ id: "settings", label: "Settings", href: "/settings/", current: isSettingsPage }],
    },
  ];
}
