# aidcp-console

AIDCP 内部运营管理后台（统一 Web 控制台）。aidcp\* 家族第 4 个仓，与 `aidcp` / `aidcp-edge` / `aidcp-cloud` 同级。

> 设计基线（见中控仓 `aidcp/docs/product-dashboard.md` 与 `aidcp/openspec/changes/aidcp-console-panel-mvp/design-ui.md`）：
> **面板只读云端聚合状态、经面板 API 下发指令，绝不直连边缘（aidcp-edge）**。
> 所有数据来自 aidcp-cloud 进程内的 **panel API 层**（`/api` + `/ws`）。

## 技术栈（契约固定）

React + Vite + TypeScript · Ant Design v5 · echarts-for-react · TanStack Query · react-router · vitest。

## 红线（UI 即正确性，不是品味）

- **两个独立徽标**：风控 STATUS（normal/warned/restricted/frozen，filled warm）与 QUOTA-TIER（conservative/normal/aggressive，outlined cool）永远分开，绝不合并。
- **写操作不乐观**：按钮 loading → round-trip → 渲染服务端真态；结果文案 `written`/`already decided`/`refused`/`recorded, N edges online`，**绝不** `published`/`done`。
- **归因待补**：按账号切片在 MVP 标「all accounts / attribution pending」（由 API `unattributed` flag 驱动）。
- **edge 三态**：online / stale / offline，绝不二元。
- 枚举值与颜色以 cloud `/api/version` 为唯一源（`src/types/aidcp-enums.ts` 镜像 + 漂移测试）。

## 开发

```bash
npm install
cp .env.example .env      # 按需改 VITE_API_TARGET
npm run dev               # 本地开发，反代 /api /ws 到面板后端
npm run typecheck
npm run test
npm run build             # tsc --noEmit + vite build → dist/
```

## 部署

`vite build` → `dist/` rsync 到 ECS `/opt/aidcp/console`，由 Nginx 反代静态 + `/api` + `/ws` 到 `127.0.0.1:AIDCP_PANEL_PORT`（与 isales / 8787 隔离，见中控仓 change task 7）。
