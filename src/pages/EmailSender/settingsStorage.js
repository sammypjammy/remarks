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
} = settingsStorage;
