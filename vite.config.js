import { resolve } from "node:path";
import { cpSync, mkdirSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
        cannedRemarks: resolve(import.meta.dirname, "canned-remarks/index.html"),
        medTabsGenerator: resolve(import.meta.dirname, "med-tabs-generator/index.html"),
        welcomeEmailSender: resolve(import.meta.dirname, "welcome-email-sender/index.html"),
        settings: resolve(import.meta.dirname, "settings/index.html"),
        authCallback: resolve(import.meta.dirname, "welcome-email-sender/callback.html")
      }
    }
  }
});
