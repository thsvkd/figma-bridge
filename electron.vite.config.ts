import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const alias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  renderer: {
    resolve: { alias },
    plugins: [
      {
        // The dev server injects CSS as <style> tags, which the strict production CSP blocks.
        // Production builds link a CSS file, so only the dev server needs inline styles.
        name: 'dev-inline-style-csp',
        apply: 'serve',
        transformIndexHtml: (html) => html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'"),
      },
    ],
  },
})
