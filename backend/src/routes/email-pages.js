import { readFile } from 'node:fs/promises';

// The links in our emails (APP_BASE_URL/verify-email?token=..., /reset-password?token=...)
// open in a browser, wherever the app runs: the API serves these small pages itself.
const PAGES = new URL('../pages/', import.meta.url);

const HEADERS = {
  // Only our own script and style: an injected <script> or inline handler would not run
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
    "form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  // The URL carries a single-use token: never send it to another site in a Referer header
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
};

const FILES = {
  '/verify-email': ['verify-email.html', 'text/html; charset=utf-8'],
  '/reset-password': ['reset-password.html', 'text/html; charset=utf-8'],
  '/pages/email-pages.js': ['email-pages.js', 'text/javascript; charset=utf-8'],
  '/pages/email-pages.css': ['email-pages.css', 'text/css; charset=utf-8'],
};

export default async function emailPagesRoutes(app) {
  for (const [path, [file, type]] of Object.entries(FILES)) {
    // Read at startup: a missing file stops the API instead of failing on the first click
    const content = await readFile(new URL(file, PAGES), 'utf8');
    app.get(path, { schema: { hide: true } }, async (_request, reply) =>
      reply.headers(HEADERS).type(type).send(content),
    );
  }
}
