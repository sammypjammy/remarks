# Packard Toolkit

Run `npm install`, then `npm run dev` to start the toolkit. Use `npm run build` for a production build and `npm run preview` to preview it.

- `index.html` and `home.js`: toolkit homepage.
- `canned-remarks/`: remarks page and its JavaScript.
- `med-tabs-generator/`: medical tabs page, styles, parser, and JavaScript.
- `welcome-email-sender/`: email page, React components, Outlook integration, authentication callback, styles, and PDF attachments.
- `settings/`: settings page, styles, and JavaScript.
- `settings/shared/`: shared styles, navigation, favicon, and settings storage, including the React settings adapter.
- `pages/`: compatibility redirect for the old remarks URL.

The tools use common files from `settings/shared/`. Dependencies and build configuration are managed at the project root. Vite copies the standalone scripts and PDF attachments into `dist/` during builds. The `/auth/callback` URL is preserved by Vite and Vercel routing so the Microsoft redirect registration can remain unchanged.
