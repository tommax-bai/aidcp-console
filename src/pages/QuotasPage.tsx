import { useMemo, useState } from 'react';
import { App, Button, Card, Form, InputNumber, Modal, Select, Skeleton, Table, Tag, Typography, Alert } from 'antd';
import type { ColumnsType, ColumnType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPut } from '../api/client';
import { useQuotaConfig, useSessionLimits, useHotLeadConfig, useResumeConfig, useRestrictedPolicy, usePacingConfig } from '../api/queries';
import { QueryError } from '../components/QueryGate';
import type {
  QuotaConfigRow,
  QuotaConfigCatalog,
  QuotaTier,
  QuotaAction,
  SessionLimitView,
  SessionInteractionBudget,
  HotLeadConfigView,
  ResumeConfigView,
  RestrictedPolicyMode,
  RestrictedPolicyView,
  PacingConfigRow,
  PacingConfigView,
  PacingOperation,
} from '../types/api';
import { RISK_QUOTA_COLOR, RISK_QUOTA_LABEL, RISK_ACTION_LABEL, labelOf } from '../types/aidcp-enums';

const QUOTA_MAX = 100_000;

// 档位/动作的中文标签与配色复用全站公用枚举（change console-cloud-panel-hardening #36：
// 档位用冷色系 RISK_QUOTA_COLOR，与风控状态暖色徽标构造级分离；本页不再私自用绿/橙暖色，
// 那会与「全站绿=正常状态」语义冲突）。公用枚举无展示排序，故本页仅保留 order 附加。
const TIER_ORDER: Record<QuotaTier, number> = { conservative: 1, normal: 2, aggressive: 3 };
const ACTION_ORDER: Record<QuotaAction, number> = {
  view: 1, search: 2, like: 3, collect: 4, comment: 5, comment_like: 6, dm_reply: 7, join_group: 8, follow: 9, publish: 10,
};
const actionOrder = (action: string): number => ACTION_ORDER[action as QuotaAction] ?? Number.MAX_SAFE_INTEGER;

const rowKey = (r: { tier: string; action: string }) => `${r.tier}:${r.action}`;

/** 单场行为预算七项 + 中文标签（顺序即展示顺序，与 cloud SessionInteractionBudget 对齐）。 */
const SL_BUDGET_FIELDS: Array<{ key: keyof SessionInteractionBudget; label: string }> = [
  { key: 'likes', label: '点赞' },
  { key: 'collects', label: '收藏' },
  { key: 'follows', label: '关注' },
  { key: 'searches', label: '搜索' },
  { key: 'comments', label: '评论' },
  { key: 'comment_likes', label: '评论赞' },
  { key: 'join_groups', label: '加群' },
];

/** 单行全局表的稳定 key（全局配置只有一行）。 */
const GLOBAL_ROW_KEY = 'global';

// ── 节奏兜底（change pacing-floor-config-min-interval）──────────────────────────
// 前台动作 gate 保持 15s 小上限；阅读停留类按内容模型允许更长，权威夹逼仍在云端读出口。
const PACING_CAP_MS = 15_000;
const PACING_OP_CAP_MS: Record<PacingOperation, number> = {
  action: PACING_CAP_MS,
  scroll: PACING_CAP_MS,
  card_gap: PACING_CAP_MS,
  detail_dwell: PACING_CAP_MS,
  feed_card_read: 30_000,
  content_glance: 90_000,
  content_read: 90_000,
};
const PACING_OP_ORDER: Record<PacingOperation, number> = {
  action: 1,
  feed_card_read: 2,
  content_glance: 3,
  content_read: 4,
  scroll: 5,
  card_gap: 6,
  detail_dwell: 7,
};
const PACING_OP_LABEL: Record<PacingOperation, string> = {
  action: '互动动作',
  feed_card_read: 'Feed卡片阅读',
  content_glance: '正文扫读',
  content_read: '正文阅读',
  scroll: '评论滚动',
  card_gap: '图片翻页',
  detail_dwell: '详情停留下限',
};
const PACING_OP_DESC: Record<PacingOperation, string> = {
  action: '打开笔记/主页、点赞/收藏/关注/评论前的操作间隔',
  feed_card_read: 'Feed翻页前看完本批新卡；最小值按每张新卡计，最大值是本批封顶',
  content_glance: '详情页图片/评论等子动作前，按正文量级计算的轻量扫读停留',
  content_read: '详情页返回/关闭前，按正文量级计算的完整阅读停留',
  scroll: '评论区滚动前；也覆盖详情内连续滚评论的子动作',
  card_gap: '详情页图片翻页前；也覆盖详情内连续翻图的子动作',
  detail_dwell: '详情页离页前的兜底停留下限；内容驱动阅读由正文扫读/正文阅读控制',
};


/**
 * 安全配置页（安全 tab）。三块全局配置，自上而下：
 * 1. 单场会话上限（全局单例）；2. 自动续场与看门狗（全局单例）；3. 安全限额（档位×动作）。
 * - 单场上限 / 续场看门狗已从「按账号」收敛为「全局通用单例」（对所有账号生效，无 default、无按账号覆盖）。
 * - 改完即时 / 下场会话即生效（热加载，无需重启）；库缺行处显示的是内置写死默认（= 当前真生效），保存即写覆盖。
 * - 写非乐观——round-trip 后 invalidate 重取真态；非法数字由服务端整块拒，绝不部分落库。
 * - 不碰风控状态机（normal→warned→restricted→frozen 与档位）——本页只改限额 / 配置数字。
 */
export function QuotasPage() {
  const { data, isLoading, isError, refetch } = useQuotaConfig();
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
            TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
            actionOrder(a.action) - actionOrder(b.action),
        ),
    [data],
  );

  const validNum = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 0 && n <= QUOTA_MAX;
  const canSave = validNum(daily) && validNum(perMinute) && validNum(perHour);

  const columns: ColumnsType<QuotaConfigRow> = [
    { title: '档位', dataIndex: 'tier', width: 90, render: (t: QuotaTier) => <Tag color={RISK_QUOTA_COLOR[t]}>{labelOf(RISK_QUOTA_LABEL, t)}</Tag> },
    { title: '动作', dataIndex: 'action', width: 110, render: (a: QuotaAction) => labelOf(RISK_ACTION_LABEL, a) },
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
    join_groups: null,
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

  // ── 内容热度过滤（全局单例，change feed-hot-lead-group-comment）─────────────────
  // 判定「涨得快的热帖线索」的三道客观闸：帖龄上限（小时）+ 每小时点赞速率下限 + 最小点赞绝对数。
  // 独立于账号限频表（那是本账号动作节流，语义不同），走独立 /api/hot-lead-config 端点。
  const hotLead = useHotLeadConfig();
  const [editingHotLead, setEditingHotLead] = useState(false);
  const [hlPostAge, setHlPostAge] = useState<number | null>(null);
  const [hlVelocity, setHlVelocity] = useState<number | null>(null);
  const [hlMinLike, setHlMinLike] = useState<number | null>(null);

  const openEditHotLead = (row: HotLeadConfigView) => {
    setEditingHotLead(true);
    setHlPostAge(row.postAgeMaxHours);
    setHlVelocity(row.velocityMin);
    setHlMinLike(row.minLikeFloor);
  };

  const saveHotLead = useMutation({
    mutationFn: (v: { postAgeMaxHours: number; velocityMin: number; minLikeFloor: number }) =>
      apiPut<HotLeadConfigView>('/api/hot-lead-config', v),
    onSuccess: () => {
      message.success('已保存，内容热度过滤即时生效（无需重启）');
      setEditingHotLead(false);
      void qc.invalidateQueries({ queryKey: ['config', 'hot-lead-config'] });
    },
    onError: (e) => {
      const msg = (e as Error).message;
      message.error(
        msg === 'invalid_value'
          ? '数字非法（三项均须为 ≥1 的正整数），未保存'
          : msg === 'no_valid_fields'
            ? '未填写任何可改字段，未保存'
            : '保存失败',
      );
    },
  });

  const hlValid = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 1 && n <= QUOTA_MAX;
  const canSaveHotLead = hlValid(hlPostAge) && hlValid(hlVelocity) && hlValid(hlMinLike);

  const hotLeadRows = hotLead.data ? [hotLead.data] : [];

  const hotLeadColumns: ColumnsType<HotLeadConfigView> = [
    { title: '帖龄上限（小时）', dataIndex: 'postAgeMaxHours', width: 150, render: (n: number) => <span className="tabular-nums">{n}</span> },
    { title: '每小时点赞阈值', dataIndex: 'velocityMin', width: 150, render: (n: number) => <span className="tabular-nums">{n}</span> },
    { title: '最小点赞数', dataIndex: 'minLikeFloor', width: 120, render: (n: number) => <span className="tabular-nums">{n}</span> },
    { title: '来源', dataIndex: 'overridden', width: 100, render: (ov: boolean) => (ov ? <Tag color="green">已覆盖</Tag> : <Tag>系统默认</Tag>) },
    {
      title: '操作',
      width: 80,
      render: (_: unknown, row: HotLeadConfigView) => (
        <Button size="small" onClick={() => openEditHotLead(row)}>
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

  // ── 受限处置策略（全局单例，change restricted-policy-global-config）───────────
  // 枚举值与云端逐字对齐（browse_only / full_pause）；写非乐观（round-trip 后 invalidate 重取真态）。
  const rp = useRestrictedPolicy();
  const [editingRP, setEditingRP] = useState(false);
  const [rpMode, setRpMode] = useState<RestrictedPolicyMode | null>(null);
  const [rpHours, setRpHours] = useState<number | null>(null);

  const RP_MODE_LABEL: Record<RestrictedPolicyMode, string> = {
    browse_only: '只浏览（互动暂停）',
    full_pause: '浏览也暂停',
  };

  const openEditRP = (row: RestrictedPolicyView) => {
    setEditingRP(true);
    setRpMode(row.mode);
    setRpHours(row.recoveryHours);
  };

  const saveRP = useMutation({
    mutationFn: (v: { mode: RestrictedPolicyMode; recoveryHours: number }) =>
      apiPut<RestrictedPolicyView>('/api/restricted-policy', v),
    onSuccess: () => {
      message.success('已保存，受限处置策略即时生效（热加载、无需重启）');
      setEditingRP(false);
      void qc.invalidateQueries({ queryKey: ['config', 'restricted-policy'] });
    },
    onError: (e) => {
      const msg = (e as Error).message;
      message.error(msg === 'invalid_value' ? '取值非法（未知模式或小时数不是 1–720 的整数），未保存' : msg === 'no_valid_fields' ? '未填写任何可改字段，未保存' : '保存失败');
    },
  });

  const canSaveRP =
    (rpMode === 'browse_only' || rpMode === 'full_pause') &&
    rpHours !== null && Number.isInteger(rpHours) && rpHours >= 1 && rpHours <= 720;

  const rpRows = rp.data ? [rp.data] : [];

  const rpColumns: ColumnsType<RestrictedPolicyView> = [
    { title: '处置模式', dataIndex: 'mode', width: 160, render: (m: RestrictedPolicyMode) => (m === 'full_pause' ? <Tag color="orange">{labelOf(RP_MODE_LABEL, m)}</Tag> : <Tag>{labelOf(RP_MODE_LABEL, m)}</Tag>) },
    { title: '自动恢复（小时）', dataIndex: 'recoveryHours', width: 130, render: (n: number) => <span className="tabular-nums">{n}</span> },
    { title: '来源', dataIndex: 'overridden', width: 96, render: (ov: boolean) => (ov ? <Tag color="green">已覆盖</Tag> : <Tag>系统默认</Tag>) },
    { title: '操作', width: 72, render: (_: unknown, row: RestrictedPolicyView) => <Button size="small" onClick={() => openEditRP(row)}>编辑</Button> },
  ];

  // ── 节奏兜底（全局一套，change pacing-floor-config-min-interval）─────────────
  // 每类操作两次动作之间的「最小间隔」兜底区间（毫秒）；写非乐观（round-trip 后 invalidate 重取真态）。
  // 生效边界=连接级：各边缘节点下次重连后才拉到新快照。detail_dwell 仅兜底下限、内容驱动停留由云端算。
  const pacing = usePacingConfig();
  const [editingPacing, setEditingPacing] = useState<PacingConfigRow | null>(null);
  const [pcMin, setPcMin] = useState<number | null>(null);
  const [pcMax, setPcMax] = useState<number | null>(null);

  const openEditPacing = (row: PacingConfigRow) => {
    setEditingPacing(row);
    setPcMin(row.minMs);
    setPcMax(row.maxMs);
  };

  const savePacing = useMutation({
    mutationFn: (v: { operation: PacingOperation; minMs: number; maxMs: number }) =>
      apiPut<PacingConfigView>('/api/pacing', v),
    onSuccess: () => {
      message.success('已保存，节奏兜底在各边缘下次重连后生效（无需重启）');
      setEditingPacing(null);
      void qc.invalidateQueries({ queryKey: ['config', 'pacing'] });
    },
    onError: (e) => {
      const msg = (e as Error).message;
      message.error(
        msg === 'invalid_value'
          ? '数字非法（须为该类别允许范围内的整数，且最大 ≥ 最小×1.5），未保存'
          : msg === 'unknown_operation'
            ? '未知操作类别，未保存'
            : msg === 'no_valid_fields'
              ? '未填写任何可改字段，未保存'
              : '保存失败',
      );
    },
  });

  const pacingCapMs = editingPacing ? PACING_OP_CAP_MS[editingPacing.operation] : PACING_CAP_MS;

  // 本地闸：与服务端拒绝规则同构（非负整数、≤类别 CAP、max≥min×1.5 最小展宽）；服务端二次校验 + 读出口夹逼为权威。
  const pcValid = (n: number | null): n is number =>
    n !== null && Number.isInteger(n) && n >= 0 && n <= pacingCapMs;
  const canSavePacing = pcValid(pcMin) && pcValid(pcMax) && (pcMax as number) >= (pcMin as number) * 1.5;

  const pacingRows = useMemo(
    () =>
      (pacing.data?.pacing ?? [])
        .slice()
        .sort((a, b) => PACING_OP_ORDER[a.operation] - PACING_OP_ORDER[b.operation]),
    [pacing.data],
  );

  const pacingColumns: ColumnsType<PacingConfigRow> = [
    { title: '操作类别', dataIndex: 'operation', width: 120, render: (op: PacingOperation) => labelOf(PACING_OP_LABEL, op) },
    {
      title: '覆盖场景',
      dataIndex: 'operation',
      key: 'desc',
      render: (op: PacingOperation) => <Typography.Text type="secondary">{PACING_OP_DESC[op]}</Typography.Text>,
    },
    { title: '最小(ms)', dataIndex: 'minMs', width: 96, render: (n: number) => <span className="tabular-nums">{n}</span> },
    { title: '最大(ms)', dataIndex: 'maxMs', width: 96, render: (n: number) => <span className="tabular-nums">{n}</span> },
    {
      title: '来源',
      dataIndex: 'overridden',
      width: 100,
      render: (ov: boolean) => (ov ? <Tag color="green">已覆盖</Tag> : <Tag>系统默认</Tag>),
    },
    {
      title: '操作',
      width: 80,
      render: (_: unknown, row: PacingConfigRow) => (
        <Button size="small" onClick={() => openEditPacing(row)}>
          编辑
        </Button>
      ),
    },
  ];

  // 「可活跃时间」卡已整体移出本页（change content-schedule-auto-publish，2026-07-03 用户拍板）：
  // 活跃时段与可自动发内容位统一在「排期」页的三态周历编辑 / 查看，本页专注限额与看门狗数字。

  // 任一读查询首次加载失败 → 诚实报错 + 重试全部（否则各卡永久骨架屏）。
  if (isError || sl.isError || hotLead.isError || rc.isError || pacing.isError) {
    return (
      <QueryError
        title="加载安全配置失败"
        onRetry={() => {
          void refetch();
          void sl.refetch();
          void hotLead.refetch();
          void rc.refetch();
          void pacing.refetch();
        }}
      />
    );
  }

  return (
    <div className="page-stack">
      <Card size="small" title="单场会话上限（全局）">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="配置对所有账号生效的全局单场会话时长（分钟）与单场行为预算（点赞/收藏/关注/搜索/评论/评论赞/加群）。改完下场会话即生效（热加载、无需重启）。未配置时用系统内置默认（= 当前真生效）。此项原按账号，现已收敛为全局通用单例。"
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

      <Card size="small" title="内容热度过滤（全局）">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="对所有账号生效的「涨得快的热帖」判定阈值——三道客观闸共同决定一条帖是否算「热」。帖龄上限（小时）：超过这个时长的帖不再算「涨得快」（建议 24–48）。每小时点赞阈值：达到这个每小时点赞速率才算热帖。最小点赞数：绝对点赞低于此不算，挡掉小基数的假热。改完即时生效（热加载、无需重启）。未配置时用内置默认（= 当前真生效）。此项与账号限频表物理隔离（那是本账号动作节流、非候选帖热度）。"
        />
        {hotLead.isLoading || !hotLead.data ? (
          <Skeleton active />
        ) : (
          <Table<HotLeadConfigView>
            size="small"
            rowKey={() => GLOBAL_ROW_KEY}
            columns={hotLeadColumns}
            dataSource={hotLeadRows}
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

      <Card size="small" title="受限处置策略（全局）">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="对所有账号生效：风控进入「受限」后的处置力度。只浏览（默认）＝互动全停、纯浏览养号照常；浏览也暂停＝连浏览都停、账号让出浏览器槽位彻底静默。自动恢复：受限满 N 小时（默认 72）且无新风控信号自动回「警告」档，警告满 7 天回正常；冻结不受此影响、仍需人工处理。客户端「解除受限」与运营手动操作不等 N 小时、立即生效。改完即时生效（热加载、无需重启）。"
        />
        {rp.isLoading || !rp.data ? (
          <Skeleton active />
        ) : (
          <Table<RestrictedPolicyView>
            size="small"
            rowKey={() => GLOBAL_ROW_KEY}
            columns={rpColumns}
            dataSource={rpRows}
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

      <Card size="small" title="节奏兜底（全局）">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="配置每类操作两次动作之间的「最小间隔」兜底区间（毫秒）。语义为最小间隔：距上次操作已够久则立即执行、不够只补差额，绝不在云端往返之上再累加等待。三条运营须知：① 新配置在各边缘节点【下次重连后才生效】（连接级快照，稳定 fleet 可能数小时才全部铺满、灰度期各节点行为不一致）；② detail_dwell【仅是详情页停留的兜底下限】，真正由内容驱动的停留时长仍由云端按内容计算；③ 若 fleet 混版，本配置【仅对新版边缘生效】，旧版边缘忽略并沿用其内置默认。改完无需重启；过低的值会被系统自动抬到内置非零下限（绝不零延迟）。未配置时显示的是内置默认（= 当前真生效）。"
        />
        {pacing.isLoading || !pacing.data ? (
          <Skeleton active />
        ) : (
          <Table<PacingConfigRow>
            size="small"
            rowKey={(r) => r.operation}
            columns={pacingColumns}
            dataSource={pacingRows}
            pagination={false}
          />
        )}
      </Card>

      <Modal
        title={editing ? `编辑限额：${labelOf(RISK_QUOTA_LABEL, editing.tier)} · ${labelOf(RISK_ACTION_LABEL, editing.action)}` : ''}
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
            join_groups: slBudget.join_groups as number,
          })
        }
        okText="保存"
        cancelText="取消"
      >
        {editingSL && (
          <Form layout="vertical" requiredMark={false}>
            <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
              对所有账号生效。单场时长须为 ≥1 的整数（分钟）；各项行为预算须为 ≥0 的整数；均 ≤100000。保存前服务端会再校验。
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
        title="编辑内容热度过滤"
        open={editingHotLead}
        onCancel={() => setEditingHotLead(false)}
        confirmLoading={saveHotLead.isPending}
        okButtonProps={{ disabled: !canSaveHotLead }}
        onOk={() =>
          canSaveHotLead &&
          saveHotLead.mutate({
            postAgeMaxHours: hlPostAge as number,
            velocityMin: hlVelocity as number,
            minLikeFloor: hlMinLike as number,
          })
        }
        okText="保存"
        cancelText="取消"
      >
        {editingHotLead && (
          <Form layout="vertical" requiredMark={false}>
            <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
              对所有账号生效。三项均须为 ≥1 的整数。帖龄上限（小时）建议 24–48：超过这个时长的帖不再算「涨得快」；每小时点赞阈值是热帖的最低点赞速率；最小点赞数挡掉小基数的假热。保存前服务端会再校验。
            </Typography.Paragraph>
            <Form.Item label="帖龄上限（小时）">
              <InputNumber value={hlPostAge ?? undefined} onChange={(v) => setHlPostAge(v ?? null)} min={1} max={QUOTA_MAX} precision={0} style={{ width: 200 }} />
            </Form.Item>
            <Form.Item label="每小时点赞阈值">
              <InputNumber value={hlVelocity ?? undefined} onChange={(v) => setHlVelocity(v ?? null)} min={1} max={QUOTA_MAX} precision={0} style={{ width: 200 }} />
            </Form.Item>
            <Form.Item label="最小点赞数">
              <InputNumber value={hlMinLike ?? undefined} onChange={(v) => setHlMinLike(v ?? null)} min={1} max={QUOTA_MAX} precision={0} style={{ width: 200 }} />
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

      <Modal
        title="编辑受限处置策略"
        open={editingRP}
        onCancel={() => setEditingRP(false)}
        confirmLoading={saveRP.isPending}
        okButtonProps={{ disabled: !canSaveRP }}
        onOk={() =>
          canSaveRP &&
          saveRP.mutate({
            mode: rpMode as RestrictedPolicyMode,
            recoveryHours: rpHours as number,
          })
        }
        okText="保存"
        cancelText="取消"
      >
        {editingRP && (
          <Form layout="vertical" requiredMark={false}>
            <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
              对所有账号生效。「浏览也暂停」下受限账号连浏览都停、让出浏览器槽位；两种模式下都会在满恢复时长后自动回「警告」档。恢复时长须为 1–720 的整数（小时）。保存前服务端会再校验。
            </Typography.Paragraph>
            <Form.Item label="处置模式">
              <Select<RestrictedPolicyMode>
                value={rpMode ?? undefined}
                onChange={(v) => setRpMode(v)}
                style={{ width: 240 }}
                options={[
                  { value: 'browse_only', label: RP_MODE_LABEL.browse_only },
                  { value: 'full_pause', label: RP_MODE_LABEL.full_pause },
                ]}
              />
            </Form.Item>
            <Form.Item label="自动恢复时长（小时）">
              <InputNumber value={rpHours ?? undefined} onChange={(v) => setRpHours(v ?? null)} min={1} max={720} precision={0} style={{ width: 200 }} />
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title={editingPacing ? `编辑节奏兜底：${labelOf(PACING_OP_LABEL, editingPacing.operation)}` : ''}
        open={!!editingPacing}
        onCancel={() => setEditingPacing(null)}
        confirmLoading={savePacing.isPending}
        okButtonProps={{ disabled: !canSavePacing }}
        onOk={() =>
          editingPacing &&
          canSavePacing &&
          savePacing.mutate({
            operation: editingPacing.operation,
            minMs: pcMin as number,
            maxMs: pcMax as number,
          })
        }
        okText="保存"
        cancelText="取消"
      >
        {editingPacing && (
          <Form layout="vertical" requiredMark={false}>
            <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
              最小 / 最大间隔均须为 0–{pacingCapMs} 的整数（毫秒），且最大 ≥ 最小×1.5（留出足够展宽避免节奏机械化）。
              Feed卡片阅读的最小值按每张新卡计，阅读类表示目标停留护栏；执行端仍按已停留时长只补差额。保存前服务端会再校验，各边缘下次重连后生效。
            </Typography.Paragraph>
            <Form.Item label="最小间隔（毫秒）">
              <InputNumber value={pcMin ?? undefined} onChange={(v) => setPcMin(v ?? null)} min={0} max={pacingCapMs} precision={0} style={{ width: 200 }} />
            </Form.Item>
            <Form.Item label="最大间隔（毫秒，须 ≥ 最小×1.5）">
              <InputNumber value={pcMax ?? undefined} onChange={(v) => setPcMax(v ?? null)} min={0} max={pacingCapMs} precision={0} style={{ width: 200 }} />
            </Form.Item>
          </Form>
        )}
      </Modal>

    </div>
  );
}
