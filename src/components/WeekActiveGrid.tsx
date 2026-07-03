/**
 * 周历活跃时段网格（7 天 × 24 小时 = 168 格）+ 掩码 helper。
 *
 * 掩码为 168 长的 '0'/'1' 串：'1'=该格活跃、'0'=休眠。索引 = 天 × 24 + 小时；
 * 天 0..6 = 周一..周日（与 cloud mondayBasedDayIndex 一致），按服务器本地时间。
 *
 * 语义中立：本组件只画「活跃/休眠」两态，具体含义（浏览会话 / 自动发帖）由使用页决定。
 * 抽自 QuotasPage 早期内嵌版；后「可活跃时间」整块从安全页移到内容排期页（change content-schedule-auto-publish，
 * commit 7d2c66f 一并删掉安全页的内嵌网格 + 掩码 helper），故当前唯一使用方为内容排期页，安全页已无内嵌网格需去重。
 */
import { theme } from 'antd';

export const WEEK_MASK_LEN = 168;
export const WEEK_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const FULL_ACTIVE_MASK = '1'.repeat(WEEK_MASK_LEN);
export const EMPTY_MASK = '0'.repeat(WEEK_MASK_LEN);

export const cellIdx = (day: number, hour: number) => day * 24 + hour;
export const isCellActive = (mask: string, day: number, hour: number) =>
  mask[cellIdx(day, hour)] === '1';
export const setCell = (mask: string, day: number, hour: number, on: boolean) => {
  const i = cellIdx(day, hour);
  return mask.slice(0, i) + (on ? '1' : '0') + mask.slice(i + 1);
};
export const countActive = (mask: string) => mask.split('').filter((c) => c === '1').length;
export const isValidMask = (m: string) => m.length === WEEK_MASK_LEN && /^[01]+$/.test(m);
/** 预设：工作日（周一–周五）09:00–22:00 活跃，其余休眠。 */
export const workdayMask = () => {
  let s = '';
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) s += d <= 4 && h >= 9 && h < 22 ? '1' : '0';
  return s;
};

/**
 * 周历活跃时段网格（7 天 × 24 小时）。绿=活跃、灰=休眠。
 * 只读（卡片预览）或可编辑（弹窗）：点格切该小时、点「天」名切整天、点小时号切整列。
 */
export function WeekActiveGrid({
  mask,
  overlayMask,
  overlayTitle,
  readOnly,
  onToggleCell,
  onToggleRow,
  onToggleCol,
}: {
  mask: string;
  /**
   * 叠加层掩码（168 位 '0'/'1'，可选）：'1' 且底层活跃 → 格内画标记点（三态渲染：休眠/活跃/活跃+标记）。
   * change content-schedule-auto-publish：内容排期「可自动发」位直接标在活跃格里（用户拍板的格内标记形态）。
   */
  overlayMask?: string;
  /** 标记位的悬浮文案（如「可自动发内容」）。 */
  overlayTitle?: string;
  readOnly?: boolean;
  onToggleCell?: (day: number, hour: number) => void;
  onToggleRow?: (day: number) => void;
  onToggleCol?: (hour: number) => void;
}) {
  const { token } = theme.useToken();
  // 格子横向铺满卡片宽度（flex 等分）；窄屏低于最小宽度时容器横向滚动。
  const cellH = readOnly ? 18 : 26; // px：高度固定
  const cellMinW = readOnly ? 14 : 18; // px：单格最小宽（决定何时出现横向滚动）
  const labelW = 52; // px：星期标签列固定宽
  const minWidth = labelW + 24 * cellMinW + 8;
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const cellFlex = { flex: '1 1 0', minWidth: cellMinW } as const;
  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <div style={{ width: '100%', minWidth, userSelect: 'none' }}>
        {/* 小时表头（偶数小时标号；可编辑时点号切整列）。 */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, marginBottom: 3 }}>
          <div style={{ flex: `0 0 ${labelW}px` }} />
          {hours.map((h) => (
            <div
              key={h}
              onClick={readOnly ? undefined : () => onToggleCol?.(h)}
              title={readOnly ? undefined : `切换所有天的 ${String(h).padStart(2, '0')}:00`}
              style={{
                ...cellFlex,
                textAlign: 'center',
                fontSize: 11,
                lineHeight: '14px',
                color: token.colorTextSecondary,
                cursor: readOnly ? 'default' : 'pointer',
              }}
            >
              {h % 2 === 0 ? h : ''}
            </div>
          ))}
        </div>
        {/* 7 天 × 24 小时格 */}
        {WEEK_DAYS.map((label, day) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 2 }}>
            <div
              onClick={readOnly ? undefined : () => onToggleRow?.(day)}
              title={readOnly ? undefined : `切换整天：${label}`}
              style={{
                flex: `0 0 ${labelW}px`,
                fontSize: 12,
                paddingRight: 6,
                textAlign: 'right',
                color: token.colorText,
                cursor: readOnly ? 'default' : 'pointer',
              }}
            >
              {label}
            </div>
            {hours.map((h) => {
              const on = isCellActive(mask, day, h);
              const marked = on && overlayMask ? isCellActive(overlayMask, day, h) : false;
              const stateLabel = !on ? '休眠' : marked ? `活跃 + ${overlayTitle ?? '标记'}` : '活跃';
              return (
                <div
                  key={h}
                  onClick={readOnly ? undefined : () => onToggleCell?.(day, h)}
                  title={`${label} ${String(h).padStart(2, '0')}:00 — ${stateLabel}`}
                  style={{
                    ...cellFlex,
                    height: cellH,
                    boxSizing: 'border-box',
                    borderRadius: 2,
                    border: `1px solid ${on ? token.colorSuccess : token.colorBorderSecondary}`,
                    background: on ? token.colorSuccess : token.colorFillSecondary,
                    cursor: readOnly ? 'default' : 'pointer',
                    transition: 'background 0.12s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {marked ? (
                    <span
                      style={{
                        width: Math.max(4, Math.floor(cellH / 4)),
                        height: Math.max(4, Math.floor(cellH / 4)),
                        borderRadius: '50%',
                        background: '#fff',
                        boxShadow: '0 0 0 1px rgba(0,0,0,0.25)',
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
