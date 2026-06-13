import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /\/api\/thumb/,
            handler: 'CacheFirst',
            options: { cacheName: 'thumbnails', expiration: { maxEntries: 1000, maxAgeSeconds: 30 * 24 * 60 * 60 } }
          },
          {
            urlPattern: /\/api\/dl/,
            handler: 'CacheFirst',
            options: { cacheName: 'media-cache', expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 } }
          },
          {
            urlPattern: /\/api\/(ls|search|sync)/,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-cache', expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 } }
          }
        ]
      },
      manifest: {
        name: 'Personal Cloud',
        short_name: 'Cloud',
        description: 'Self-hosted file stream',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      }
    })
  ]
});
