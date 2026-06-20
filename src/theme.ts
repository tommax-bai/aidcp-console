import { theme, type ThemeConfig } from 'antd';

/**
 * AntD ConfigProvider 主题（design-ui §2.7）。
 * 内部工具：compact 密度、中性蓝品牌色、白天模式。所有 enum 颜色见 aidcp-enums.ts。
 */
export const aidcpTheme: ThemeConfig = {
  cssVar: true,
  hashed: true,
  algorithm: [theme.defaultAlgorithm, theme.compactAlgorithm],
  token: {
    colorPrimary: '#1677ff',
    borderRadius: 4,
    controlHeight: 28,
    controlHeightSM: 24,
    fontSize: 13,
    sizeStep: 3,
    sizeUnit: 4,
    wireframe: false,
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
  },
  components: {
    Table: { headerBg: '#fafafa', rowHoverBg: '#f5f5f5', fontSize: 13 },
    Layout: { headerHeight: 48, headerPadding: '0 16px' },
  },
};
