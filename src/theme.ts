import { theme, type ThemeConfig } from 'antd';

/**
 * AntD ConfigProvider 主题 —— 视觉语言对齐 isales-web（参照
 * ~/isales-web/src/styles/design-tokens.css 与 STYLE_GUIDE.md）。
 *
 * 与 src/styles/app.css 的 `--aidcp-*` 令牌同源：近黑主色 #030213、圆角
 * （小 6 / 中 8 / 大 12）、14px 中文密致基线、PingFang SC 字体栈、淡灰边框、
 * 极浅灰底。状态/告警色保留各 badge 的 AntD 预设（本就是浅底彩字胶囊、
 * 已贴近 isales 状态色族），故此处只收口结构性 token。
 */
const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, Arial, sans-serif';

export const aidcpTheme: ThemeConfig = {
  cssVar: true,
  hashed: true,
  // 弃 compact —— isales 偏舒朗 14px 基线；表格仍各自 size="small" 保持数据密度
  algorithm: [theme.defaultAlgorithm],
  token: {
    colorPrimary: '#030213',
    colorInfo: '#030213',
    colorLink: '#030213',
    borderRadius: 8,
    borderRadiusLG: 12,
    borderRadiusSM: 6,
    fontSize: 14,
    fontFamily: FONT_FAMILY,
    wireframe: false,
    // isales 近黑文本 + 灰副文 + 淡边框 + 极浅灰底
    colorText: '#242424',
    colorTextSecondary: '#767676',
    colorBorder: '#e8e8e8',
    colorBorderSecondary: '#f0f0f0',
    colorBgLayout: '#f7f7f7',
    // 语义状态色对齐 isales 700 档（较 AntD 默认更沉稳）
    colorSuccess: '#16a34a',
    colorWarning: '#d97706',
    colorError: '#dc2626',
  },
  components: {
    Card: { borderRadiusLG: 12, headerFontSize: 15, paddingLG: 20 },
    Table: { headerBg: '#fafafa', rowHoverBg: '#f7f7f7', headerColor: '#767676', fontSize: 13, borderColor: '#eee' },
    Tag: { borderRadiusSM: 6 },
    Button: { fontWeight: 500 },
  },
};
