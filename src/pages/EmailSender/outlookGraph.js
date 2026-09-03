import {
  InteractionRequiredAuthError,
  LogLevel,
  PublicClientApplication,
} from "@azure/msal-browser";
import { getManagerAttachments, outlookConfig } from "./outlookConfig.js";

const GRAPH_SCOPES = ["Mail.ReadWrite"];
const MAX_SIMPLE_ATTACHMENT_BYTES = 3_000_000;
const UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;
let msalInstance;
let initializationPromise;
let interactiveAuthInProgress = false;
const isDevelopment = import.meta.env?.DEV ?? false;

function authLog(message, details) {
  if (!isDevelopment) return;
  if (details === undefined) {
    console.debug(`[Outlook auth] ${message}`);
  } else {
    console.debug(`[Outlook auth] ${message}`, details);
  }
}

function getRedirectUri() {
  if (window.location.protocol === "file:") {
    throw new Error("Microsoft sign-in requires this app to run from an HTTPS site or localhost.");
  }

  const configuredUri = outlookConfig.redirectUri.trim();
  return new URL(configuredUri || "/auth/callback", window.location.origin).href;
}

async function getMsalInstance() {
  if (!outlookConfig.clientId.trim() || !outlookConfig.tenantId.trim()) {
    throw new Error("Microsoft Outlook integration has not been configured yet.");
  }

  if (!msalInstance) {
    msalInstance = new PublicClientApplication({
      auth: {
        clientId: outlookConfig.clientId.trim(),
        authority: `https://login.microsoftonline.com/${outlookConfig.tenantId.trim()}`,
        redirectUri: getRedirectUri(),
      },
      cache: {
        cacheLocation: "sessionStorage",
      },
      system: {
        loggerOptions: {
          logLevel: LogLevel.Verbose,
          piiLoggingEnabled: false,
          loggerCallback(level, message, containsPii) {
            if (!isDevelopment || containsPii) return;
            if (level === LogLevel.Error) console.error(`[MSAL] ${message}`);
            else if (level === LogLevel.Warning) console.warn(`[MSAL] ${message}`);
            else console.debug(`[MSAL] ${message}`);
          },
        },
      },
    });
    initializationPromise = msalInstance.initialize();
  }

  await initializationPromise;
  authLog("Initialization complete", { redirectUri: getRedirectUri() });
  return msalInstance;
}

async function runInteractiveRequest(request) {
  if (interactiveAuthInProgress) {
    const error = new Error("A Microsoft sign-in request is already in progress.");
    error.errorCode = "interaction_in_progress";
    throw error;
  }

  interactiveAuthInProgress = true;
  try {
    return await request();
  } finally {
    interactiveAuthInProgress = false;
  }
}

export async function getGraphAccessToken() {
  const app = await getMsalInstance();
  let account = app.getActiveAccount() || app.getAllAccounts()[0];
  authLog(account ? "Existing account found" : "No existing account found");

  if (!account) {
    authLog("loginPopup started");
    const loginResult = await runInteractiveRequest(() =>
      app.loginPopup({ scopes: GRAPH_SCOPES }),
    );
    authLog("loginPopup completed");
    account = loginResult.account;
    if (!account) throw new Error("Microsoft sign-in did not return an account.");
    app.setActiveAccount(account);

    // loginPopup requested the Graph scopes, so its token can normally be used
    // directly. This avoids opening a second popup immediately after sign-in.
    if (loginResult.accessToken) {
      authLog("Token acquired from loginPopup");
      return loginResult.accessToken;
    }
  } else if (app.getActiveAccount() !== account) {
    app.setActiveAccount(account);
  }

  try {
    authLog("acquireTokenSilent started");
    const result = await app.acquireTokenSilent({ scopes: GRAPH_SCOPES, account });
    authLog("acquireTokenSilent completed; token acquired");
    return result.accessToken;
  } catch (error) {
    if (!(error instanceof InteractionRequiredAuthError)) throw error;
    authLog("acquireTokenPopup fallback started");
    const result = await runInteractiveRequest(() =>
      app.acquireTokenPopup({ scopes: GRAPH_SCOPES, account }),
    );
    authLog("acquireTokenPopup completed; token acquired");
    return result.accessToken;
  }
}

export function getOutlookErrorMessage(error) {
  const errorCode = error?.errorCode || error?.code || "";
  const technicalMessage = error?.message || "";

  if (errorCode === "block_nested_popups" || technicalMessage.includes("block_nested_popups")) {
    return "Microsoft sign-in was started more than once. Please try again.";
  }
  if (errorCode === "interaction_in_progress" || technicalMessage.includes("interaction_in_progress")) {
    return "Microsoft sign-in is already in progress.";
  }
  if (errorCode === "timed_out" || technicalMessage.includes("timed_out")) {
    return "Microsoft sign-in did not finish correctly. Please try signing in again.";
  }
  if (
    errorCode === "popup_window_error" ||
    errorCode === "empty_window_error" ||
    /popup (?:window )?(?:was )?blocked/i.test(technicalMessage)
  ) {
    return "Your browser blocked the Microsoft sign-in window. Allow popups for this site and try again.";
  }

  return technicalMessage || "An unexpected error occurred.";
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

async function loadAttachment(attachment) {
  const response = await fetch(attachment.path);
  if (!response.ok) {
    throw new Error(`Could not load ${attachment.name}.`);
  }

  const buffer = await response.arrayBuffer();
  return {
    name: attachment.name,
    buffer,
  };
}

async function graphRequest(url, accessToken, options = {}) {
  authLog("Graph request started", { method: options.method || "GET", url });
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });
  authLog("Graph response received", { method: options.method || "GET", url, status: response.status });

  if (!response.ok) {
    const graphError = await response.json().catch(() => null);
    throw new Error(graphError?.error?.message || "Microsoft Graph request failed.");
  }

  return response;
}

async function addSimpleAttachment(draftId, attachment, accessToken) {
  await graphRequest(
    `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(draftId)}/attachments`,
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: attachment.name,
        contentType: "application/pdf",
        contentBytes: arrayBufferToBase64(attachment.buffer),
      }),
    },
  );
}

async function addLargeAttachment(draftId, attachment, accessToken) {
  const sessionResponse = await graphRequest(
    `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(draftId)}/attachments/createUploadSession`,
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        AttachmentItem: {
          attachmentType: "file",
          name: attachment.name,
          size: attachment.buffer.byteLength,
          contentType: "application/pdf",
        },
      }),
    },
  );
  const { uploadUrl } = await sessionResponse.json();

  for (let start = 0; start < attachment.buffer.byteLength; start += UPLOAD_CHUNK_BYTES) {
    const end = Math.min(start + UPLOAD_CHUNK_BYTES, attachment.buffer.byteLength);
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Range": `bytes ${start}-${end - 1}/${attachment.buffer.byteLength}`,
      },
      body: attachment.buffer.slice(start, end),
    });

    if (!response.ok) throw new Error(`Could not upload ${attachment.name}.`);
  }
}

async function addAttachment(draftId, attachment, accessToken) {
  if (attachment.buffer.byteLength < MAX_SIMPLE_ATTACHMENT_BYTES) {
    await addSimpleAttachment(draftId, attachment, accessToken);
  } else {
    await addLargeAttachment(draftId, attachment, accessToken);
  }
}

export async function createOutlookDraft({ recipient, subject, body, managerName, language }) {
  const configuredAttachments = getManagerAttachments(managerName, language);

  const accessToken = await getGraphAccessToken();
  const attachments = await Promise.all(configuredAttachments.map(loadAttachment));
  const response = await graphRequest(
    "https://graph.microsoft.com/v1.0/me/messages",
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject,
        body: { contentType: "Text", content: body },
        toRecipients: [{ emailAddress: { address: recipient } }],
      }),
    },
  );

  const draft = await response.json();
  for (const attachment of attachments) {
    await addAttachment(draft.id, attachment, accessToken);
  }

  if (!draft.webLink) throw new Error("The draft was created, but Outlook did not return a link to open it.");
  return draft;
}
