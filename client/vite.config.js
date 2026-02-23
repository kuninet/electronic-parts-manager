import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // HTTPS有効化（スマホからのカメラ使用に必要）
  const useHttps = env.VITE_HTTPS !== 'false'; // デフォルトで有効

  return {
    plugins: [
      vue(),
      // HTTPS自己署名証明書（iOS Safariのカメラ許可に必要）
      ...(useHttps ? [basicSsl()] : []),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
        manifest: {
          name: '電子パーツ管理',
          short_name: 'パーツ管理',
          description: '電子部品の在庫管理アプリ',
          theme_color: '#1e293b',
          background_color: '#0f172a',
          display: 'standalone',
          orientation: 'portrait',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png'
            }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']
        }
      })
    ],
    server: {
      host: true, // Listen on all network interfaces
      port: parseInt(env.VITE_PORT) || 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
        '/uploads': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        }
      }
    },
  };
})
