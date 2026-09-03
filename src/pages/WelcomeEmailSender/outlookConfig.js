// Microsoft Entra app registration settings.
// See MICROSOFT-OUTLOOK-SETUP.md for the one-time setup steps.
export const outlookConfig = {
  clientId: "25788b60-3e91-4e01-90db-f752411dd74b",
  tenantId: "27201660-f1d1-407c-97d9-c089c4a80cfc",
  // MSAL Browser 5 requires popup responses to return to a redirect-bridge page.
  // Register the resulting absolute URL as an SPA redirect URI in Entra.
  redirectUri: "/auth/callback",

  attachmentsByLanguage: {
    english: {
      "Amanda Zuscar": ["Welcome Packet - Amanda Z. 2024.pdf"],
      "Becky Smith": ["Welcome Packet - Becky S. 2024.pdf"],
      "Carla Vickers": ["Welcome Packet - Carla V. 2024.pdf"],
      "Elisa Medina": ["Welcome Packet - Elisa M. 2024.pdf"],
      "Lesley Lopez": ["Welcome Packet -Lesley.pdf"],
      "Lucia Munoz": ["Welcome Packet - Lucia M. 2024.pdf"],
      "Ross Voigt": ["Welcome Packet - Ross V. 4.14.2025.pdf"],
      "Selena Flores": ["Welcome Packet - Selena.pdf"],
    },
    spanish: {
      "Lesley Lopez": ["Spanish Welcome Packet - Lesley.pdf"],
      "Lucia Munoz": ["Spanish Welcome Packet - Lucia M. 2024.pdf"],
      "Selena Flores": ["Spanish Welcome Packet - Selena.pdf"],
    },
  },
};

export const isOutlookGraphConfigured = Boolean(
  outlookConfig.clientId.trim() &&
  outlookConfig.tenantId.trim(),
);

export function getManagerAttachments(managerName, language = "english") {
  const languageAttachments = outlookConfig.attachmentsByLanguage[language] || {};
  return (languageAttachments[managerName] || []).map((fileName) => ({
    name: fileName,
    path: `/welcome-email-sender/attachments/${encodeURIComponent(fileName)}`,
  }));
}
