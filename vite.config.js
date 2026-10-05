import { resolve } from "node:path";
import { cpSync, mkdirSync, writeFileSync, existsSync, createReadStream } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import sendFax from "./api/send-fax.js";
import faxStatus from "./api/fax-status.js";
import ringcentralContacts from "./api/ringcentral-contacts.js";
import { createAuthHandler } from './server/auth/service.js';

function localToolkitAuth(server) {
  const env = loadEnv(server.config.mode, import.meta.dirname, '');
  for (const key of ['DATABASE_URL', 'ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'TOOLKIT_ORIGIN']) {
    if (!process.env[key] && env[key]) process.env[key] = env[key];
  }
  const handlers = Object.fromEntries(['login', 'callback', 'session', 'logout'].map(action => [`/api/auth/${action}`, createAuthHandler(action)]));
  server.middlewares.use((req, res, next) => {
    const handler = handlers[req.url?.split('?')[0]];
    if (!handler) return next();
    // Keep callback codes/state out of Vite request-error diagnostics.
    res.status = code => { res.statusCode = code; return res; };
    res.json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
    return handler(req, res);
  });
}

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

function ssaOcrAssets() {
  const source = resolve(import.meta.dirname, 'ssa-intake-assistant/public/ocr');
  return {
    name: 'ssa-local-ocr-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = /^\/ssa-intake-assistant\/ocr\/([A-Za-z0-9._-]+)$/.exec(request.url?.split('?')[0] || '')?.[1];
        if (!name) return next();
        const file = resolve(source, name);
        if (!existsSync(file)) return next();
        response.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        createReadStream(file).pipe(response);
      });
    },
    closeBundle() {
      if (!existsSync(source)) throw new Error('SSA local OCR assets are missing. Run npm run prepare-ssa-ocr.');
      const destination = resolve(import.meta.dirname, 'dist/ssa-intake-assistant/ocr');
      mkdirSync(destination, { recursive: true });
      cpSync(source, destination, { recursive: true });
    }
  };
}

// Preserve compatibility URLs independently of their source-file locations.
const legacySharedStyles = '@import "/shared/style.css";\n@import "/home/styles.css";\n@import "/canned-remarks/styles.css";\n';

function compatibilityRoutes(server) {
  server.middlewares.use((request, response, next) => {
    const pathname = request.url?.split('?')[0];
    if (pathname === '/settings/shared/style.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end(legacySharedStyles);
      return;
    } else if (pathname === '/pages/canned-remarks.html') {
      request.url = request.url.replace(pathname, '/canned-remarks/legacy-redirect.html');
    } else if (pathname === '/home.js') {
      request.url = request.url.replace(pathname, '/home/home.js');
    } else if (pathname?.startsWith('/settings/shared/')) {
      request.url = request.url.replace('/settings/shared/', '/shared/');
    }
    next();
  });
}

export default defineConfig({
  server: { port: 5173, strictPort: true },
  plugins: [
    react(),
    ssaOcrAssets(),
    { name: 'compatibility-routes', configureServer: compatibilityRoutes },
    { name: 'local-toolkit-auth', configureServer: localToolkitAuth },
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
          "shared", "settings/settings.js", "home/home.js",
          "canned-remarks/remarks.js", "canned-remarks/sections.js", "med-tabs-generator/parser.js",
          "med-tabs-generator/index.js", "welcome-email-sender/attachments",
          "home/styles.css", "canned-remarks/styles.css"
        ];
        for (const path of staticPaths) {
          const destination = resolve(outputDirectory, path);
          mkdirSync(resolve(destination, ".."), { recursive: true });
          cpSync(resolve(import.meta.dirname, path), destination, { recursive: true });
        }
        for (const [source, target] of [
          ['canned-remarks/legacy-redirect.html', 'pages/canned-remarks.html'],
          ['home/home.js', 'home.js'],
          ['shared', 'settings/shared']
        ]) {
          const destination = resolve(outputDirectory, target);
          mkdirSync(resolve(destination, '..'), { recursive: true });
          cpSync(resolve(import.meta.dirname, source), destination, { recursive: true });
        }
        writeFileSync(resolve(outputDirectory, 'settings/shared/style.css'), legacySharedStyles);
      }
    }
  ],
  build: {
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, "index.html"),
        faxSender: resolve(import.meta.dirname, "fax-sender/index.html"),
        intakeChecker: resolve(import.meta.dirname, "intake-checker/index.html"),
        ssaIntakeAssistant: resolve(import.meta.dirname, "ssa-intake-assistant/index.html"),
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
