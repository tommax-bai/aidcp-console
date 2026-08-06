/**
 * 表头吸顶（sticky header）的统一口径。
 *
 * - 偏移量 = 应用顶栏高度（app.css 的 `--aidcp-topnav-height: 56px`，顶栏本身 position: sticky top:0），
 *   否则吸顶表头会钻到顶栏底下被盖住。改顶栏高度时这里要一起改。
 * - 滚动容器就是 window（外壳 `.app-main` 不做内层滚动），所以不传 getContainer。
 * - 吸顶天然只在表格自身范围内生效：position: sticky 被表格容器裁住，表格滚出视口时表头随之离开。
 */
export const STICKY_TABLE_HEADER_OFFSET = 56;

/** 直接传给 antd Table 的 `sticky` 值。 */
export const STICKY_TABLE_HEADER = { offsetHeader: STICKY_TABLE_HEADER_OFFSET } as const;
