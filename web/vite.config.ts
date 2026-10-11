import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** تزریق CSP فقط در build تولیدی — در حالت توسعه تزریق نمی‌شود تا HMR سالم بماند.
 *  سیاست: همه‌چیز از same-origin؛ بدون object/frame؛ بدون base؛ بدون فرم خارجی.
 *  مرجع: OWASP CSP Cheatsheet (owasp.org/www-project-secure-headers) */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

const injectCsp = (): Plugin => ({
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml(html: string) {
    return html.replace(
      '</title>',
      '</title>\n    <meta http-equiv="Content-Security-Policy" content="' + CSP + '">',
    );
  },
});

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'production' ? [injectCsp()] : [])],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
}));
