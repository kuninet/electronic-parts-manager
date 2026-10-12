import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { execSync } from 'node:child_process'

const NO_STORE_PATHS = new Set(['/', '/index.html', '/sw.js', '/manifest.webmanifest', '/version.json']);
const NO_STORE_VALUE = 'no-cache, no-store, must-revalidate';

function noStoreShellPlugin() {
  return {
    name: 'epm-no-store-shell',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url || '').split('?')[0];
        if (NO_STORE_PATHS.has(pathname)) {
          const writeHead = res.writeHead;
          res.writeHead = function (...args) {
            res.setHeader('Cache-Control', NO_STORE_VALUE);
            // writeHead(code, headers) の headers 側の Cache-Control も上書きする
            const headers = args.find((a) => a && typeof a === 'object');
            if (headers) {
              for (const key of Object.keys(headers)) {
                if (key.toLowerCase() === 'cache-control') headers[key] = NO_STORE_VALUE;
              }
            }
            return writeHead.apply(this, args);
          };
        }
        next();
      });
    }
  };
}

function resolveBuildId() {
  let hash = 'nogit';
  try {
    hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) {}
  return `${hash}-${new Date().toISOString()}`;
}

function versionFilePlugin(buildId) {
  return {
    name: 'epm-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId }) });
    }
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // HTTPS有効化（スマホからのカメラ使用に必要）
  const useHttps = env.VITE_HTTPS !== 'false'; // デフォルトで有効
  const buildId = resolveBuildId();

  return {
    define: {
      __APP_BUILD_ID__: JSON.stringify(buildId)
    },
    plugins: [
      vue(),
      // HTTPS自己署名証明書（iOS Safariのカメラ許可に必要）
      ...(useHttps ? [basicSsl()] : []),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false, // D3: 登録は src/pwa/registerServiceWorker.js が行う
        includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
        manifest: {
          name: '電子パーツ管理',
          short_name: 'パーツ管理',
          description: '電子部品の在庫管理アプリ',
          theme_color: '#0e0f12',
          background_color: '#0e0f12',
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
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          globIgnores: ['**/noto-sans-jp-*.woff2'],
          navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//, /^\/version\.json$/],
          runtimeCaching: [{
            urlPattern: ({ url }) => /\/assets\/noto-sans-jp-.*\.woff2$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'epm-fonts-jp', expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 365 } }
          }]
        }
      }),
      versionFilePlugin(buildId),
      noStoreShellPlugin()
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
    preview: {
      host: true,
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
