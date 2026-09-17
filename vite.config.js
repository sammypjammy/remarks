import { resolve } from "node:path";
import { cpSync, mkdirSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import sendFax from "./api/send-fax.js";
import faxStatus from "./api/fax-status.js";
import ringcentralContacts from "./api/ringcentral-contacts.js";

function localFaxApi(server) {
  // Server process only. Existing process variables take precedence, then root .env.local.
  const env = {
    ...loadEnv(server.config.mode, resolve(import.meta.dirname, "fax-sender"), "RC_"),
    ...loadEnv(server.config.mode, import.meta.dirname, "RC_")
  };
  for (const key of ["RC_CLIENT_ID", "RC_CLIENT_SECRET", "RC_USER_JWT"]) {
    if (!process.env[key] && env[key]) process.env[key] = env[key];
  }
  server.middlewares.use((req, res, next) => {
    const path = req.url?.split("?")[0];
    const handler = ["/api/send-fax", "/api/send-fax.js"].includes(path) ? sendFax :
      ["/api/fax-status", "/api/fax-status.js"].includes(path) ? faxStatus :
      ["/api/ringcentral-contacts", "/api/ringcentral-contacts.js"].includes(path) ? ringcentralContacts : null;
    if (!handler) return next();
    res.status = code => { res.statusCode = code; return res; };
    res.json = data => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); };
    return handler(req, res);
  });
}

function authCallbackRoute(server) {
  server.middlewares.use((request, _response, next) => {
    if (["/auth/callback", "/auth/callback.html"].includes(request.url?.split("?")[0])) {
      request.url = request.url.replace(/^\/auth\/callback(?:\.html)?/, "/welcome-email-sender/callback.html");
    }
    next();
  });
}

export default defineConfig({
  plugins: [
    react(),
    { name: "local-fax-api", configureServer: localFaxApi },
    {
      name: "auth-callback-route",
      configureServer: authCallbackRoute,
      configurePreviewServer: authCallbackRoute
    },
    {
      name: "copy-static-toolkit-files",
      closeBundle() {
        const outputDirectory = resolve(import.meta.dirname, "dist");
        const staticPaths = [
          "settings/shared", "settings/settings.js", "home.js",
          "canned-remarks/remarks.js", "med-tabs-generator/parser.js",
          "med-tabs-generator/index.js", "welcome-email-sender/attachments",
          "pages/canned-remarks.html"
        ];
        for (const path of staticPaths) {
          const destination = resolve(outputDirectory, path);
          mkdirSync(resolve(destination, ".."), { recursive: true });
          cpSync(resolve(import.meta.dirname, path), destination, { recursive: true });
        }
      }
    }
  ],
  build: {
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, "index.html"),
        faxSender: resolve(import.meta.dirname, "fax-sender/index.html"),
        intakeChecker: resolve(import.meta.dirname, "intake-checker/index.html"),
        cannedRemarks: resolve(import.meta.dirname, "canned-remarks/index.html"),
        medTabsGenerator: resolve(import.meta.dirname, "med-tabs-generator/index.html"),
        welcomeEmailSender: resolve(import.meta.dirname, "welcome-email-sender/index.html"),
        settings: resolve(import.meta.dirname, "settings/index.html"),
        versionHistory: resolve(import.meta.dirname, "version-history/index.html"),
        authCallback: resolve(import.meta.dirname, "welcome-email-sender/callback.html")
      }
    }
  }
});
