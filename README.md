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
- **归因到账号**：归因按账号切片（`interaction.occurred` 携带 `accountId`），展示真实的按账号数据；`attributionPending` 永远为 false（遗留兼容）。
- **edge 三态**：online / stale / offline，绝不二元。
- 枚举【值】以 cloud `/api/version` 为唯一源（`src/types/aidcp-enums.ts` 镜像 + 漂移测试）；颜色映射是 console 本地约定。

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

**部署前测试闸（change console-cloud-panel-hardening #32）**：直接部署路径 MUST 先 `npm test`（vitest 须全绿）+ `npm run typecheck`，再 `vite build`——坏改动不得静默过构建进 `dist/`（typecheck 抓不到行为回归，尤其审批 CAS 链）。经 `land-change` 集成时已跑测试，此闸补「不走 land-change 的直接部署路径」。

`npm test` → `npm run typecheck` → `vite build` → `dist/` rsync 到目标 ECS `/opt/aidcp/console`，由该目标本机 Nginx 反代静态 + `/api` + `/ws` 到 `127.0.0.1:AIDCP_PANEL_PORT`（与 isales 服务隔离，且绝不暴露 8787 边↔云 WebSocket——8787 是 edge↔cloud 的 ws，不是 isales 端口）。

部署前在中控仓运行 `scripts/deploy-target <dev|ol> --check`。`dev=121.89.85.150` 用于主干高频验证；`ol=123.56.253.183` 只部署 release 分支/tag 或 exact clean SHA。ol console 的 `/api` 和 `/ws` 必须反代到 ol 本机 panel API，不能误指向 dev。
