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
  return settingsStorage.getToolkitNavigation().map(section => ({
    label: section.label,
    items: section.items.map(tool => ({
      id: tool.id, label: tool.label, href: `/${tool.path}`,
      ...(tool.id === "email" && !isSettingsPage ? { current: true } : {}),
      ...(tool.id === "settings" ? { current: isSettingsPage } : {})
    }))
  }));
}
