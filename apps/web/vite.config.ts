import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Tailwind v4 via the Vite plugin (2026-05-30 audit C1): replaces the
// previous CDN runtime in index.html. The plugin auto-scans the project
// for utility usage; no separate `content` array needed.

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Audit 9.2 — split vendor groups for better cache hits across deploys.
    // Editing app code shouldn't bust the cached React/Supabase chunks.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vite's dynamic-import helper (and Rollup's CJS interop) must not
          // land inside a lazy vendor group: whatever chunk holds them is
          // pulled into the entry. It sat in vendor-export once, which put the
          // whole PDF/Word library (~265 KB gz) on every landing-page load.
          if (id.includes('vite/preload-helper') || id.includes('commonjsHelpers')) return 'runtime';
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('scheduler')) return 'vendor-react';
            if (id.includes('@supabase')) return 'vendor-supabase';
            if (id.includes('@radix-ui')) return 'vendor-radix';
            if (id.includes('sonner') || id.includes('lucide-react') || id.includes('date-fns')) return 'vendor-ui';
            if (id.includes('html2canvas') || id.includes('jspdf') || id.includes('docx') || id.includes('file-saver')) return 'vendor-export';
            // NOTE: don't include `disposable-email-domains` here — it's
            // dynamically imported by emailValidator.ts and we want it to stay
            // a lazy chunk (2.3 MB of JSON loaded only on signup).
            // Separate groups: the landing page's login form needs the tiny
            // email check, while the ~40 KB phone library is only used by
            // signed-in screens (lazy). One shared group made every visitor
            // download the phone library.
            if (id.includes('libphonenumber-js')) return 'vendor-phone';
            if (id.includes('validator')) return 'vendor-validator';
            if (id.includes('fuse.js')) return 'vendor-search';
          }
        },
      },
    },
  },
});
