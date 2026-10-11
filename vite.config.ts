import path from 'path'
import fs from 'fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createRequire } from 'module'

// 普通版（VITE_EDITION=community）把联机页别名到空桩，bundle 中不含任何陶瓦联机代码
const isCommunity = process.env.VITE_EDITION === 'community'

// 构建后把 Tailwind v4 的 color-mix/oklch 降级为 Chromium 108（Electron 22 / Win7）支持的写法
const require = createRequire(import.meta.url)
const { processFile } = require('./scripts/css-legacy-fallback.cjs') as { processFile: (f: string) => unknown }
const cssLegacyPlugin = (): Plugin => ({
  name: 'css-legacy-fallback',
  closeBundle() {
    if (process.env.SKIP_CSS_LEGACY === '1') return
    const dir = path.resolve(__dirname, 'dist/assets')
    if (!fs.existsSync(dir)) return
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.css')) processFile(path.join(dir, f))
  },
})

export default defineConfig({
  plugins: [react(), tailwindcss(), cssLegacyPlugin()],
  resolve: {
    alias: [
      ...(isCommunity
        ? [
            { find: '@/pages/MultiplayerPage/MultiplayerPage', replacement: path.resolve(__dirname, './src/pages/MultiplayerPage/MultiplayerPage.stub.tsx') },
            { find: '@/pages/LanPage/LanPage', replacement: path.resolve(__dirname, './src/pages/LanPage/LanPage.stub.tsx') },
            { find: '@/pages/ServerPage/ServerPage', replacement: path.resolve(__dirname, './src/pages/ServerPage/ServerPage.stub.tsx') },
          ]
        : []),
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: '@lark-apaas/client-toolkit-lite', replacement: path.resolve(__dirname, './src/shims/lark-apaas.tsx') },
      { find: '@lark-apaas/client-toolkit-lite/styles.css', replacement: path.resolve(__dirname, './src/shims/lark-apaas-styles.css') },
    ],
  },
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // 锁定 Chromium 108（Electron 22 / Win7）：esbuild 会把 skinview3d、three examples
    // 等依赖一并降级到该基线，避免新语法在老内核报错
    target: 'chrome108',
  },
})
