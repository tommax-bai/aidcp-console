/**
 * 边缘客户端（AIDCP Edge 桌面应用）安装包下载配置。
 *
 * 地址写死在前端：**发布新包时改这一处 + 重新构建部署 console**。
 * 包托管在与后台同机的 Nginx 静态目录 `/downloads/`（见 `deploy/aidcp-console.conf`，
 * 物理目录约定 `/opt/aidcp/downloads/`，与 isales 隔离）。
 *
 * 发布新包步骤（mac 分发包走 CI 签名+公证，交付走中控仓脚本；本文件由脚本自动改）：
 *   1) 定版本号：改 aidcp-edge/package.json version → 推 master；
 *   2) CI 出包：`gh workflow run build-desktop.yml --ref master -f cloud_default_env=ol`
 *      （Developer ID 签名 + Apple 公证，装完不被 Gatekeeper 拦；本机无证书打的是 unsigned 自测包）；
 *   3) 交付：中控仓 `scripts/release-desktop-macos <版本> [--yes]` —— 自动下载 dmg + 静态校验
 *      + 改本文件的 version/file + scp 到 ECS `/opt/aidcp/downloads/` + 构建部署 console + 验活。
 *   Windows 仍走本机 `npm run electron:build:win`（自包含打包尚未接 CI）。
 *   手动逐步与红线见 aidcp-edge/docs/release-desktop.md。
 */

export const EDGE_DOWNLOAD = {
  /** 当前发布版本（显示用；改包时一并改）。 */
  version: '0.3.20',
  /** 同机 Nginx 静态目录前缀（相对路径=同源，无需写域名/端口）。 */
  base: '/downloads',
  /**
   * 各平台安装包（文件名须与 `/opt/aidcp/downloads/` 下实际文件一致）。
   * mac 0.3.20（2026-07-12）：GitHub Actions CI **签名 + 公证**（Developer ID + notarytool），
   * 用户下载安装不再被 Gatekeeper 拦成「非法软件」；该包默认连 ol（线上），界面可切。
   * win 仍 0.3.5（未随此次重打；Windows 自包含打包尚未接 CI）。
   */
  items: [
    { key: 'mac-arm64', label: 'macOS · Apple 芯片（M 系列）', file: 'AIDCP-0.3.20-arm64.dmg' },
    { key: 'mac-x64', label: 'macOS · Intel', file: 'AIDCP-0.3.20.dmg' },
    { key: 'win-x64', label: 'Windows · x64', file: 'AIDCP Setup 0.3.5.exe' },
  ],
} as const;

/** 拼出某安装包的下载 URL（同源 /downloads）。 */
export function edgeDownloadUrl(file: string): string {
  return `${EDGE_DOWNLOAD.base}/${encodeURIComponent(file)}`;
}
