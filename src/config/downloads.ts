/**
 * 边缘客户端（AIDCP Edge 桌面应用）安装包下载（change downloads-manifest-from-host）。
 *
 * **这里不再写死版本号与文件名。** 那个数字描述的是「**这台机器的 `/opt/aidcp/downloads/` 里放了
 * 哪个包**」——一个每台机器各不相同的部署状态。写进源码，就保证了它对除了一台之外的所有机器都是谎话：
 * 主干指向 ol 的包 → dev 下载页给出指向不存在文件的死链；主干停在 dev 的包 → 部署 ol 时把线上下载页回退。
 *
 * 现在清单由云端面板 `GET /api/downloads` **现扫该机目录**得出：页面只可能提供确实存在的文件。
 * 发布新包 = 把包放到那台机器上，页面自动跟上——不改代码、不重新构建 console。
 *
 * 拿不到清单（API 失败 / 目录空 / 无可识别包）时 MUST 显示「暂无可用安装包」，
 * **绝不回落到一个写死的版本号**（那正是本 change 要根除的形态：宁缺毋假）。
 */

/** 同机 Nginx 静态目录前缀（相对路径=同源，无需写域名/端口）。 */
export const DOWNLOAD_BASE = '/downloads';

/** 拼出某安装包的下载 URL（同源 /downloads）。文件名可能含空格（Windows 包），必须转义。 */
export function edgeDownloadUrl(file: string): string {
  return `${DOWNLOAD_BASE}/${encodeURIComponent(file)}`;
}
