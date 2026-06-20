import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 面板后端（aidcp-cloud 的 panel API 层）地址；本地开发反代 /api 与 /ws。
// 生产由 Nginx 反代静态 + /api + /ws 到 127.0.0.1:AIDCP_PANEL_PORT，前端不直连边缘。
const apiTarget = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8090';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/ws': { target: apiTarget.replace(/^http/, 'ws'), ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
