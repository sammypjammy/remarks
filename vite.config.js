import { resolve } from "node:path";
import { cpSync, mkdirSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function authCallbackRoute(server) {
  server.middlewares.use((request, _response, next) => {
    if (request.url?.split("?")[0] === "/auth/callback") {
      request.url = "/auth/callback.html";
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
        mkdirSync(resolve(outputDirectory, "assets"), { recursive: true });
        mkdirSync(resolve(outputDirectory, "pages"), { recursive: true });
        cpSync(resolve(import.meta.dirname, "assets"), resolve(outputDirectory, "assets"), { recursive: true });
        cpSync(resolve(import.meta.dirname, "pages/remarks.html"), resolve(outputDirectory, "pages/remarks.html"));
      }
    }
  ],
  build: {
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, "index.html"),
        remarks: resolve(import.meta.dirname, "remarks/index.html"),
        medTabs: resolve(import.meta.dirname, "med-tabs/index.html"),
        email: resolve(import.meta.dirname, "email/index.html"),
        settings: resolve(import.meta.dirname, "settings/index.html"),
        authCallback: resolve(import.meta.dirname, "auth/callback.html")
      }
    }
  }
});
