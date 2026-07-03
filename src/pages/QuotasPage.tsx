import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { App, Button, Card, Form, InputNumber, Modal, Skeleton, Table, Tag, Typography, Alert, theme } from 'antd';
import type { ColumnsType, ColumnType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPut } from '../api/client';
import { useQuotaConfig, useSessionLimits, useResumeConfig } from '../api/queries';
import type {
  QuotaConfigRow,
  QuotaConfigCatalog,
  QuotaTier,
  QuotaAction,
  SessionLimitView,
  SessionInteractionBudget,
  ResumeConfigView,
} from '../types/api';

const QUOTA_MAX = 100_000;

const TIER_LABEL: Record<QuotaTier, { text: string; color: string; order: number }> = {
  conservative: { text: '保守', color: 'green', order: 1 },
  normal: { text: '正常', color: 'blue', order: 2 },
  aggressive: { text: '激进', color: 'orange', order: 3 },
};
const ACTION_LABEL: Record<QuotaAction, { text: string; order: number }> = {
  view: { text: '浏览', order: 1 },
  like: { text: '点赞', order: 2 },
  collect: { text: '收藏', order: 3 },
  comment: { text: '评论', order: 4 },
  comment_like: { text: '评论赞', order: 5 },
  follow: { text: '关注', order: 6 },
  publish: { text: '发布', order: 7 },
};

const rowKey = (r: { tier: string; action: string }) => `${r.tier}:${r.action}`;

/** 单场互动预算六项 + 中文标签（顺序即展示顺序，与 cloud SessionInteractionBudget 对齐）。 */
const SL_BUDGET_FIELDS: Array<{ key: keyof SessionInteractionBudget; label: string }> = [
  { key: 'likes', label: '点赞' },
  { key: 'collects', label: '收藏' },
  { key: 'follows', label: '关注' },
  { key: 'searches', label: '搜索' },
  { key: 'comments', label: '评论' },
  { key: 'comment_likes', label: '评论赞' },
];

/** 单行全局表的稳定 key（全局配置只有一行）。 */
const GLOBAL_ROW_KEY = 'global';

// ── 「可活跃时间」周历掩码（change weekly-active-window）：7 天 × 24 小时 = 168 格 ──
// 掩码为 168 长的 '0'/'1' 串：'1'=该小时活跃（允许开/续浏览会话）、'0'=休眠。
// 索引 = 天 × 24 + 小时；天 0..6 = 周一..周日（与 cloud mondayBasedDayIndex 一致）。按服务器本地时间。
// 编辑逻辑已并入「排期」页（change content-schedule-auto-publish），此处只留只读预览所需 helper。
const WEEK_MASK_LEN = 168;
const WEEK_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const FULL_ACTIVE_MASK = '1'.repeat(WEEK_MASK_LEN); // 全周全天活跃（= 不限）
const cellIdx = (day: number, hour: number) => day * 24 + hour;
const isCellActive = (mask: string, day: number, hour: number) => mask[cellIdx(day, hour)] === '1';
const countActive = (mask: string) => mask.split('').filter((c) => c === '1').length;
const isValidMask = (m: string) => m.length === WEEK_MASK_LEN && /^[01]+$/.test(m);
/** 视图掩码 → 预览串：null / 非法（未配置）一律视作全天活跃（与 cloud 回落同口径）。 */
const maskForEdit = (m: string | null) => (m && isValidMask(m) ? m : FULL_ACTIVE_MASK);

/**
 * 周历活跃时段网格（7 天 × 24 小时）。绿=活跃、灰=休眠。
 * 只读（卡片预览）或可编辑（弹窗）：点格切该小时、点「天」名切整天、点小时号切整列。
 */
function WeekActiveGrid({
  mask,
  readOnly,
  onToggleCell,
  onToggleRow,
  onToggleCol,
}: {
  mask: string;
  readOnly?: boolean;
  onToggleCell?: (day: number, hour: number) => void;
  onToggleRow?: (day: number) => void;
  onToggleCol?: (hour: number) => void;
}) {
  const { token } = theme.useToken();
  // 格子横向**铺满卡片宽度**（flex 等分），不再用固定小尺寸挤在左侧；窄屏低于最小宽度时容器横向滚动。
  const cellH = readOnly ? 18 : 26; // px：高度固定
  const cellMinW = readOnly ? 14 : 18; // px：单格最小宽（决定何时出现横向滚动）
  const labelW = 52; // px：星期标签列固定宽
  const minWidth = labelW + 24 * cellMinW + 8;
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const cellFlex = { flex: '1 1 0', minWidth: cellMinW } as const;
  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <div style={{ width: '100%', minWidth, userSelect: 'none' }}>
        {/* 小时表头（偶数小时标号；可编辑时点号切整列）。gap 与下方天行一致，保证小时号与格子列对齐。 */}
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
              return (
                <div
                  key={h}
                  onClick={readOnly ? undefined : () => onToggleCell?.(day, h)}
                  title={`${label} ${String(h).padStart(2, '0')}:00 — ${on ? '活跃' : '休眠'}`}
                  style={{
                    ...cellFlex,
                    height: cellH,
                    boxSizing: 'border-box',
                    borderRadius: 2,
                    border: `1px solid ${on ? token.colorSuccess : token.colorBorderSecondary}`,
                    background: on ? token.colorSuccess : token.colorFillSecondary,
                    cursor: readOnly ? 'default' : 'pointer',
                    transition: 'background 0.12s',
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 安全配置页（安全 tab）。三块全局配置，自上而下：
 * 1. 单场会话上限（全局单例）；2. 自动续场与看门狗（全局单例）；3. 安全限额（档位×动作）。
 * - 单场上限 / 续场看门狗已从「按账号」收敛为「全局通用单例」（对所有账号生效，无 default、无按账号覆盖）。
 * - 改完即时 / 下场会话即生效（热加载，无需重启）；库缺行处显示的是内置写死默认（= 当前真生效），保存即写覆盖。
 * - 写非乐观——round-trip 后 invalidate 重取真态；非法数字由服务端整块拒，绝不部分落库。
 * - 不碰风控状态机（normal→warned→restricted→frozen 与档位）——本页只改限额 / 配置数字。
 */
export function QuotasPage() {
  const { data, isLoading } = useQuotaConfig();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [editing, setEditing] = useState<QuotaConfigRow | null>(null);
  const [daily, setDaily] = useState<number | null>(null);
  const [perMinute, setPerMinute] = useState<number | null>(null);
  const [perHour, setPerHour] = useState<number | null>(null);

  const openEdit = (row: QuotaConfigRow) => {
    setEditing(row);
    setDaily(row.daily);
    setPerMinute(row.perMinute);
    setPerHour(row.perHour);
  };

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['config', 'quotas'] });
  };

  const save = useMutation({
    mutationFn: (v: { tier: QuotaTier; action: QuotaAction; daily: number; perMinute: number; perHour: number }) =>
      apiPut<QuotaConfigCatalog>('/api/quotas', v),
    onSuccess: () => {
      message.success('已保存，限额即时生效（无需重启）');
      setEditing(null);
      invalidate();
    },
    onError: (e) => {
      const msg = (e as Error).message;
      message.error(
        msg === 'invalid_value'
          ? '数字非法（须为 0 到 10 万的整数），未保存'
          : msg === 'unknown_tier' || msg === 'unknown_action'
            ? '未知档位 / 动作，未保存'
            : '保存失败',
      );
    },
  });

  const rows = useMemo(
    () =>
      (data?.quotas ?? [])
        .slice()
        .sort(
          (a, b) =>
            TIER_LABEL[a.tier].order - TIER_LABEL[b.tier].order ||
            ACTION_LABEL[a.action].order - ACTION_LABEL[b.action].order,
        ),
    [data],
  );

  const validNum = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 0 && n <= QUOTA_MAX;
  const canSave = validNum(daily) && validNum(perMinute) && validNum(perHour);

  const columns: ColumnsType<QuotaConfigRow> = [
    { title: '档位', dataIndex: 'tier', width: 90, render: (t: QuotaTier) => <Tag color={TIER_LABEL[t].color}>{TIER_LABEL[t].text}</Tag> },
    { title: '动作', dataIndex: 'action', width: 110, render: (a: QuotaAction) => ACTION_LABEL[a].text },
    { title: '每日', dataIndex: 'daily', width: 90, render: (n: number) => <span className="tabular-nums">{n}</span> },
    { title: '每分钟', dataIndex: 'perMinute', width: 90, render: (n: number) => <span className="tabular-nums">{n}</span> },
    { title: '每小时', dataIndex: 'perHour', width: 90, render: (n: number) => <span className="tabular-nums">{n}</span> },
    {
      title: '来源',
      dataIndex: 'overridden',
      width: 110,
      render: (ov: boolean) => (ov ? <Tag color="green">已覆盖</Tag> : <Tag>系统默认</Tag>),
    },
    {
      title: '操作',
      width: 80,
      render: (_: unknown, row) => (
        <Button size="small" onClick={() => openEdit(row)}>
          编辑
        </Button>
      ),
    },
  ];

  // ── 单场会话上限（全局单例）─────────────────────────────────────────────────
  const sl = useSessionLimits();
  const [editingSL, setEditingSL] = useState(false);
  const [slDuration, setSlDuration] = useState<number | null>(null);
  const [slBudget, setSlBudget] = useState<Record<keyof SessionInteractionBudget, number | null>>({
    likes: null,
    collects: null,
    follows: null,
    searches: null,
    comments: null,
    comment_likes: null,
  });

  const openEditSL = (row: SessionLimitView) => {
    setEditingSL(true);
    setSlDuration(row.maxDurationMin);
    setSlBudget({ ...row.budget });
  };

  const saveSL = useMutation({
    mutationFn: (v: { maxDurationMin: number } & SessionInteractionBudget) =>
      apiPut<SessionLimitView>('/api/session-limits', v),
    onSuccess: () => {
      message.success('已保存，单场上限下场会话即生效（无需重启）');
      setEditingSL(false);
      void qc.invalidateQueries({ queryKey: ['config', 'session-limits'] });
    },
    onError: (e) => {
      const msg = (e as Error).message;
      message.error(
        msg === 'invalid_value'
          ? '数字非法（时长≥1、各预算≥0，均须为 ≤10 万整数），未保存'
          : msg === 'no_valid_fields'
            ? '未填写任何可改字段，未保存'
            : '保存失败',
      );
    },
  });

  const slValidBudget = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 0 && n <= QUOTA_MAX;
  const slValidDuration = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 1 && n <= QUOTA_MAX;
  const canSaveSL = slValidDuration(slDuration) && SL_BUDGET_FIELDS.every((f) => slValidBudget(slBudget[f.key]));

  const slRows = sl.data ? [sl.data] : [];

  const slColumns: ColumnsType<SessionLimitView> = [
    { title: '单场时长(分钟)', dataIndex: 'maxDurationMin', width: 130, render: (n: number) => <span className="tabular-nums">{n}</span> },
    ...SL_BUDGET_FIELDS.map(
      (f): ColumnType<SessionLimitView> => ({
        title: f.label,
        key: f.key,
        width: 76,
        render: (_: unknown, row: SessionLimitView) => <span className="tabular-nums">{row.budget[f.key]}</span>,
      }),
    ),
    { title: '来源', dataIndex: 'overridden', width: 100, render: (ov: boolean) => (ov ? <Tag color="green">已覆盖</Tag> : <Tag>系统默认</Tag>) },
    {
      title: '操作',
      width: 80,
      render: (_: unknown, row: SessionLimitView) => (
        <Button size="small" onClick={() => openEditSL(row)}>
          编辑
        </Button>
      ),
    },
  ];

  // ── 互动质量阈值（全局单例，change engagement-ratio-config）：复用 /api/session-limits 同表同接口 ──
  // 收藏门槛 = 收藏:赞 ≥ 1:N（N=collectSaveLikeDenom）；关注门槛 = 粉丝:赞藏 ≥ 1:N（N=followFansDenom）。N 越大越宽松。
  const [editingRatio, setEditingRatio] = useState(false);
  const [ratioCollect, setRatioCollect] = useState<number | null>(null);
  const [ratioFollow, setRatioFollow] = useState<number | null>(null);

  const openEditRatio = (row: SessionLimitView) => {
    setEditingRatio(true);
    setRatioCollect(row.collectSaveLikeDenom);
    setRatioFollow(row.followFansDenom);
  };

  const saveRatio = useMutation({
    mutationFn: (v: { collectSaveLikeDenom: number; followFansDenom: number }) =>
      apiPut<SessionLimitView>('/api/session-limits', v),
    onSuccess: () => {
      message.success('已保存，互动质量阈值下场会话即生效（无需重启）');
      setEditingRatio(false);
      void qc.invalidateQueries({ queryKey: ['config', 'session-limits'] });
    },
    onError: (e) => {
      const msg = (e as Error).message;
      message.error(
        msg === 'invalid_value'
          ? '分母非法（须为 ≥1 的整数），未保存'
          : msg === 'no_valid_fields'
            ? '未填写任何可改字段，未保存'
            : '保存失败',
      );
    },
  });

  const ratioValidDenom = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 1 && n <= QUOTA_MAX;
  const canSaveRatio = ratioValidDenom(ratioCollect) && ratioValidDenom(ratioFollow);

  const ratioColumns: ColumnsType<SessionLimitView> = [
    { title: '收藏门槛（收藏:赞 ≥）', key: 'collect', width: 180, render: (_: unknown, r: SessionLimitView) => <span className="tabular-nums">1 : {r.collectSaveLikeDenom}</span> },
    { title: '关注门槛（粉丝:赞藏 ≥）', key: 'follow', width: 190, render: (_: unknown, r: SessionLimitView) => <span className="tabular-nums">1 : {r.followFansDenom}</span> },
    { title: '来源', dataIndex: 'overridden', width: 100, render: (ov: boolean) => (ov ? <Tag color="green">已覆盖</Tag> : <Tag>系统默认</Tag>) },
    {
      title: '操作',
      width: 80,
      render: (_: unknown, row: SessionLimitView) => (
        <Button size="small" onClick={() => openEditRatio(row)}>
          编辑
        </Button>
      ),
    },
  ];

  // ── 自动续场护栏 + 看门狗阈值（全局单例）─────────────────────────────────────
  // 看门狗阈值在 UI 以「分钟」编辑（更友好），保存时 ×60000 转毫秒；GET 回来的 ms ÷60000 显示。
  const rc = useResumeConfig();
  const [editingRC, setEditingRC] = useState(false);
  const [rcRest, setRcRest] = useState<number | null>(null);
  const [rcWinStart, setRcWinStart] = useState<number | null>(null);
  const [rcWinEnd, setRcWinEnd] = useState<number | null>(null);
  const [rcDailySessions, setRcDailySessions] = useState<number | null>(null);
  const [rcDailyMinutes, setRcDailyMinutes] = useState<number | null>(null);
  const [rcNudgeMin, setRcNudgeMin] = useState<number | null>(null);
  const [rcEndMin, setRcEndMin] = useState<number | null>(null);

  const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const winLabel = (s: number, e: number) => (s === e || (s <= 0 && e >= 1440) ? '全天不限' : `${fmtMin(s)}–${fmtMin(e)}`);

  const openEditRC = (row: ResumeConfigView) => {
    setEditingRC(true);
    setRcRest(row.restRatioPct);
    setRcWinStart(row.activeWindowStartMin);
    setRcWinEnd(row.activeWindowEndMin);
    setRcDailySessions(row.dailyMaxSessions);
    setRcDailyMinutes(row.dailyMaxMinutes);
    setRcNudgeMin(Math.round(row.idleNudgeMs / 60_000));
    setRcEndMin(Math.round(row.idleEndMs / 60_000));
  };

  const saveRC = useMutation({
    mutationFn: (v: {
      restRatioPct: number;
      activeWindowStartMin: number;
      activeWindowEndMin: number;
      dailyMaxSessions: number;
      dailyMaxMinutes: number;
      idleNudgeMs: number;
      idleEndMs: number;
    }) => apiPut<ResumeConfigView>('/api/resume-config', v),
    onSuccess: () => {
      message.success('已保存，续场/看门狗配置下场会话即生效（无需重启）');
      setEditingRC(false);
      void qc.invalidateQueries({ queryKey: ['config', 'resume-config'] });
    },
    onError: (e) => {
      const msg = (e as Error).message;
      message.error(msg === 'invalid_value' ? '数字非法（见各项范围），未保存' : msg === 'no_valid_fields' ? '未填写任何可改字段，未保存' : '保存失败');
    },
  });

  const rcInt = (n: number | null, min: number, max: number): n is number => n !== null && Number.isInteger(n) && n >= min && n <= max;
  const canSaveRC =
    rcInt(rcRest, 0, 1000) &&
    rcInt(rcWinStart, 0, 1440) &&
    rcInt(rcWinEnd, 0, 1440) &&
    rcInt(rcDailySessions, 0, 100_000) &&
    rcInt(rcDailyMinutes, 0, 100_000) &&
    rcInt(rcNudgeMin, 2, 1440) &&
    rcInt(rcEndMin, 2, 1440) &&
    (rcEndMin as number) > (rcNudgeMin as number);

  const rcRows = rc.data ? [rc.data] : [];

  const rcColumns: ColumnsType<ResumeConfigView> = [
    { title: '休息比例', dataIndex: 'restRatioPct', width: 90, render: (n: number) => <span className="tabular-nums">{n}%</span> },
    { title: '活跃时段', key: 'win', width: 130, render: (_: unknown, r: ResumeConfigView) => <span className="tabular-nums">{winLabel(r.activeWindowStartMin, r.activeWindowEndMin)}</span> },
    { title: '每日场数', dataIndex: 'dailyMaxSessions', width: 90, render: (n: number) => <span className="tabular-nums">{n === 0 ? '不限' : n}</span> },
    { title: '每日分钟', dataIndex: 'dailyMaxMinutes', width: 90, render: (n: number) => <span className="tabular-nums">{n === 0 ? '不限' : n}</span> },
    { title: '轻推(分)', dataIndex: 'idleNudgeMs', width: 86, render: (n: number) => <span className="tabular-nums">{Math.round(n / 60_000)}</span> },
    { title: '放弃(分)', dataIndex: 'idleEndMs', width: 86, render: (n: number) => <span className="tabular-nums">{Math.round(n / 60_000)}</span> },
    { title: '来源', dataIndex: 'overridden', width: 96, render: (ov: boolean) => (ov ? <Tag color="green">已覆盖</Tag> : <Tag>系统默认</Tag>) },
    { title: '操作', width: 72, render: (_: unknown, row: ResumeConfigView) => <Button size="small" onClick={() => openEditRC(row)}>编辑</Button> },
  ];

  // ── 可活跃时间（全局周历，change weekly-active-window）：本卡已只读化（change content-schedule-auto-publish）。
  // 编辑入口并入「排期」页的三态网格（活跃层与自动发内容位一处编辑），此处仅保留预览，防两处可写互相改乱。

  return (
    <div className="page-stack">
      <Card size="small" title="可活跃时间（全局）">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="按周 × 天 × 小时的「允许活跃」时段，对所有账号生效（按服务器本地时间）。绿=活跃（允许开 / 续浏览会话）、灰=休眠（不开；会话运行中跨入休眠时段则结束当前会话）。未配置 = 全周全天活跃（不限）。本卡为只读预览——编辑已并入「排期」页（一张网格同时管活跃时段与可自动发内容的白点标记）。"
        />
        {sl.isLoading || !sl.data ? (
          <Skeleton active />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {sl.data.activeWeekMask ? <Tag color="green">已配置</Tag> : <Tag>全天活跃（未配置）</Tag>}
              <Typography.Text type="secondary">
                活跃 {countActive(maskForEdit(sl.data.activeWeekMask))} / 168 小时
              </Typography.Text>
              <Link to="/content-schedule">
                <Button size="small">去「排期」页编辑</Button>
              </Link>
            </div>
            <WeekActiveGrid mask={maskForEdit(sl.data.activeWeekMask)} readOnly />
          </div>
        )}
      </Card>

      <Card size="small" title="单场会话上限（全局）">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="配置对所有账号生效的全局单场会话时长（分钟）与单场互动预算（点赞/收藏/关注/搜索/评论/评论赞）。改完下场会话即生效（热加载、无需重启）。未配置时用系统内置默认（= 当前真生效）。此项原按账号，现已收敛为全局通用单例。"
        />
        {sl.isLoading || !sl.data ? (
          <Skeleton active />
        ) : (
          <Table<SessionLimitView>
            size="small"
            rowKey={() => GLOBAL_ROW_KEY}
            columns={slColumns}
            dataSource={slRows}
            pagination={false}
          />
        )}
      </Card>

      <Card size="small" title="互动质量阈值（全局）">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="对所有账号生效的「收藏 / 关注」质量门槛——在 AI 判断之上再加一道客观比例下限。收藏门槛：仅当笔记「收藏数 : 点赞数 ≥ 1:N」才收藏（默认 1:3；N 越大越宽松，挡掉赞高藏低的泛娱乐笔记）。关注门槛：仅当作者「粉丝数 : 获赞与收藏 ≥ 1:N」才关注（默认 1:8；挡掉靠爆款堆赞藏却转化差的号）。改完下场会话即生效（热加载、无需重启）。未配置时用内置默认（= 当前真生效）。"
        />
        {sl.isLoading || !sl.data ? (
          <Skeleton active />
        ) : (
          <Table<SessionLimitView>
            size="small"
            rowKey={() => GLOBAL_ROW_KEY}
            columns={ratioColumns}
            dataSource={slRows}
            pagination={false}
          />
        )}
      </Card>

      <Card size="small" title="自动续场与看门狗（全局）">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="对所有账号生效的全局续场/看门狗配置。单场正常结束后，按「休息比例」歇一会儿（=单场时长×比例）自动续刷；仅在「活跃时段」内续、受「每日上限」约束、撞风控不续。看门狗：浏览卡住超「轻推」分钟先发恢复滚动，超「放弃」分钟才结束会话。改完下场即生效（热加载）。未配置时用内置默认（休息10% / 全天 / 不限 / 轻推≈2分 / 放弃60分）。"
        />
        {rc.isLoading || !rc.data ? (
          <Skeleton active />
        ) : (
          <Table<ResumeConfigView>
            size="small"
            rowKey={() => GLOBAL_ROW_KEY}
            columns={rcColumns}
            dataSource={rcRows}
            pagination={false}
          />
        )}
      </Card>

      <Card size="small" title="安全限额">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="按档位（保守/正常/激进）× 动作配置每日 / 每分钟 / 每小时三个限额。改完即时生效、无需重启。0=禁止该动作。仅改限额数字，不影响风控状态（封号/限流仍由风控自动判定）。"
        />
        {isLoading || !data ? (
          <Skeleton active />
        ) : (
          <Table<QuotaConfigRow>
            size="small"
            rowKey={rowKey}
            columns={columns}
            dataSource={rows}
            pagination={false}
          />
        )}
      </Card>

      <Modal
        title={editing ? `编辑限额：${TIER_LABEL[editing.tier].text} · ${ACTION_LABEL[editing.action].text}` : ''}
        open={!!editing}
        onCancel={() => setEditing(null)}
        confirmLoading={save.isPending}
        okButtonProps={{ disabled: !canSave }}
        onOk={() =>
          editing &&
          canSave &&
          save.mutate({
            tier: editing.tier,
            action: editing.action,
            daily: daily as number,
            perMinute: perMinute as number,
            perHour: perHour as number,
          })
        }
        okText="保存"
        cancelText="取消"
      >
        {editing && (
          <Form layout="vertical" requiredMark={false}>
            <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
              三个窗口都需为 0–100000 的整数；0 表示禁止该动作。保存前服务端会再校验。
            </Typography.Paragraph>
            <Form.Item label="每日上限">
              <InputNumber value={daily ?? undefined} onChange={(v) => setDaily(v ?? null)} min={0} max={QUOTA_MAX} precision={0} style={{ width: 200 }} />
            </Form.Item>
            <Form.Item label="每分钟突发上限">
              <InputNumber value={perMinute ?? undefined} onChange={(v) => setPerMinute(v ?? null)} min={0} max={QUOTA_MAX} precision={0} style={{ width: 200 }} />
            </Form.Item>
            <Form.Item label="每小时突发上限">
              <InputNumber value={perHour ?? undefined} onChange={(v) => setPerHour(v ?? null)} min={0} max={QUOTA_MAX} precision={0} style={{ width: 200 }} />
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title="编辑全局单场上限"
        open={editingSL}
        onCancel={() => setEditingSL(false)}
        confirmLoading={saveSL.isPending}
        okButtonProps={{ disabled: !canSaveSL }}
        onOk={() =>
          canSaveSL &&
          saveSL.mutate({
            maxDurationMin: slDuration as number,
            likes: slBudget.likes as number,
            collects: slBudget.collects as number,
            follows: slBudget.follows as number,
            searches: slBudget.searches as number,
            comments: slBudget.comments as number,
            comment_likes: slBudget.comment_likes as number,
          })
        }
        okText="保存"
        cancelText="取消"
      >
        {editingSL && (
          <Form layout="vertical" requiredMark={false}>
            <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
              对所有账号生效。单场时长须为 ≥1 的整数（分钟）；各项互动预算须为 ≥0 的整数；均 ≤100000。保存前服务端会再校验。
            </Typography.Paragraph>
            <Form.Item label="单场时长（分钟）">
              <InputNumber value={slDuration ?? undefined} onChange={(v) => setSlDuration(v ?? null)} min={1} max={QUOTA_MAX} precision={0} style={{ width: 200 }} />
            </Form.Item>
            {SL_BUDGET_FIELDS.map((f) => (
              <Form.Item key={f.key} label={`单场${f.label}上限`}>
                <InputNumber
                  value={slBudget[f.key] ?? undefined}
                  onChange={(v) => setSlBudget((prev) => ({ ...prev, [f.key]: v ?? null }))}
                  min={0}
                  max={QUOTA_MAX}
                  precision={0}
                  style={{ width: 200 }}
                />
              </Form.Item>
            ))}
          </Form>
        )}
      </Modal>

      <Modal
        title="编辑互动质量阈值"
        open={editingRatio}
        onCancel={() => setEditingRatio(false)}
        confirmLoading={saveRatio.isPending}
        okButtonProps={{ disabled: !canSaveRatio }}
        onOk={() =>
          canSaveRatio &&
          saveRatio.mutate({
            collectSaveLikeDenom: ratioCollect as number,
            followFansDenom: ratioFollow as number,
          })
        }
        okText="保存"
        cancelText="取消"
      >
        {editingRatio && (
          <Form layout="vertical" requiredMark={false}>
            <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
              对所有账号生效。填「1:N」里的 N（≥1 的整数，N 越大门槛越宽松）。收藏门槛默认 3（1:3）；关注门槛默认 8（1:8）。保存前服务端会再校验。
            </Typography.Paragraph>
            <Form.Item label="收藏门槛分母 N（收藏:赞 ≥ 1:N）">
              <InputNumber value={ratioCollect ?? undefined} onChange={(v) => setRatioCollect(v ?? null)} min={1} max={QUOTA_MAX} precision={0} style={{ width: 200 }} />
            </Form.Item>
            <Form.Item label="关注门槛分母 N（粉丝:赞藏 ≥ 1:N）">
              <InputNumber value={ratioFollow ?? undefined} onChange={(v) => setRatioFollow(v ?? null)} min={1} max={QUOTA_MAX} precision={0} style={{ width: 200 }} />
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title="编辑全局续场/看门狗"
        open={editingRC}
        onCancel={() => setEditingRC(false)}
        confirmLoading={saveRC.isPending}
        okButtonProps={{ disabled: !canSaveRC }}
        onOk={() =>
          canSaveRC &&
          saveRC.mutate({
            restRatioPct: rcRest as number,
            activeWindowStartMin: rcWinStart as number,
            activeWindowEndMin: rcWinEnd as number,
            dailyMaxSessions: rcDailySessions as number,
            dailyMaxMinutes: rcDailyMinutes as number,
            idleNudgeMs: (rcNudgeMin as number) * 60_000,
            idleEndMs: (rcEndMin as number) * 60_000,
          })
        }
        okText="保存"
        cancelText="取消"
      >
        {editingRC && (
          <Form layout="vertical" requiredMark={false}>
            <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
              对所有账号生效。休息比例 0–1000（%）；活跃时段为自午夜分钟数 0–1440（起=止 或 0–1440 视作全天不限）；每日上限 0=不限；看门狗轻推/放弃以分钟计，放弃须大于轻推。保存前服务端会再校验。
            </Typography.Paragraph>
            <Form.Item label="休息比例（% of 单场时长）">
              <InputNumber value={rcRest ?? undefined} onChange={(v) => setRcRest(v ?? null)} min={0} max={1000} precision={0} style={{ width: 200 }} />
            </Form.Item>
            <Form.Item label="活跃时段起（自午夜分钟数，0=00:00 / 480=08:00）">
              <InputNumber value={rcWinStart ?? undefined} onChange={(v) => setRcWinStart(v ?? null)} min={0} max={1440} precision={0} style={{ width: 200 }} />
            </Form.Item>
            <Form.Item label="活跃时段止（自午夜分钟数，1440=24:00）">
              <InputNumber value={rcWinEnd ?? undefined} onChange={(v) => setRcWinEnd(v ?? null)} min={0} max={1440} precision={0} style={{ width: 200 }} />
            </Form.Item>
            <Form.Item label="每日续场场数上限（0=不限）">
              <InputNumber value={rcDailySessions ?? undefined} onChange={(v) => setRcDailySessions(v ?? null)} min={0} max={QUOTA_MAX} precision={0} style={{ width: 200 }} />
            </Form.Item>
            <Form.Item label="每日续场累计分钟上限（0=不限）">
              <InputNumber value={rcDailyMinutes ?? undefined} onChange={(v) => setRcDailyMinutes(v ?? null)} min={0} max={QUOTA_MAX} precision={0} style={{ width: 200 }} />
            </Form.Item>
            <Form.Item label="看门狗恢复轻推（分钟，≥2）">
              <InputNumber value={rcNudgeMin ?? undefined} onChange={(v) => setRcNudgeMin(v ?? null)} min={2} max={1440} precision={0} style={{ width: 200 }} />
            </Form.Item>
            <Form.Item label="看门狗放弃结束（分钟，须 > 轻推）">
              <InputNumber value={rcEndMin ?? undefined} onChange={(v) => setRcEndMin(v ?? null)} min={2} max={1440} precision={0} style={{ width: 200 }} />
            </Form.Item>
          </Form>
        )}
      </Modal>

    </div>
  );
}
