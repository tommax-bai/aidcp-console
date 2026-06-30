/**
 * 边缘客户端（AIDCP Edge 桌面应用）安装包下载配置。
 *
 * 地址写死在前端：**发布新包时改这一处 + 重新构建部署 console**。
 * 包托管在与后台同机的 Nginx 静态目录 `/downloads/`（见 `deploy/aidcp-console.conf`，
 * 物理目录约定 `/opt/aidcp/downloads/`，与 isales 隔离）。
 *
 * 发布新包步骤：
 *   1) 在 aidcp-edge 跑 `npm run electron:build:mac` / `:win` 出包；
 *   2) rsync 安装包到 ECS `/opt/aidcp/downloads/`（dmg / exe，按需 zip）；
 *   3) 改下面 `VERSION` + 各 `file` 文件名；
 *   4) 重新构建部署 console（前端静态）。
 */

export const EDGE_DOWNLOAD = {
  /** 当前发布版本（显示用；改包时一并改）。 */
  version: '0.2.0',
  /** 同机 Nginx 静态目录前缀（相对路径=同源，无需写域名/端口）。 */
  base: '/downloads',
  /**
   * 各平台安装包（文件名须与 `/opt/aidcp/downloads/` 下实际文件一致）。
   * 三平台均 0.2.0（2026-06-30：Windows 本地重打；mac dmg 经 GitHub Actions
   * 的 macOS runner 构建，见 aidcp-edge/.github/workflows/build-desktop.yml）。
   */
  items: [
    { key: 'mac-arm64', label: 'macOS · Apple 芯片（M 系列）', file: 'AIDCP-0.2.0-arm64.dmg' },
    { key: 'mac-x64', label: 'macOS · Intel', file: 'AIDCP-0.2.0.dmg' },
    { key: 'win-x64', label: 'Windows · x64', file: 'AIDCP Setup 0.2.0.exe' },
  ],
} as const;

/** 拼出某安装包的下载 URL（同源 /downloads）。 */
export function edgeDownloadUrl(file: string): string {
  return `${EDGE_DOWNLOAD.base}/${encodeURIComponent(file)}`;
}
