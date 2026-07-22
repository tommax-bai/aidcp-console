import { useMemo, useState } from 'react';
import {
  App,
  Alert,
  Button,
  Card,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Popover,
  Segmented,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPut } from '../api/client';
import { errorText } from '../api/errorText';
import { useContentSchedule, useContentScheduleGlobal, useSessionLimits } from '../api/queries';
import { QueryError } from '../components/QueryGate';
import type {
  ContentScheduleRow,
  ContentSchedulePatch,
  ContentScheduleCatalog,
  ContentScheduleActionMode,
  ContentScheduleAutomationAction,
  ContentScheduleAvailableAction,
} from '../types/api';
import {
  WeekActiveGrid,
  EMPTY_MASK,
  FULL_ACTIVE_MASK,
  cellIdx,
  countActive,
  isValidMask,
  setCell,
  workdayMask,
} from '../components/WeekActiveGrid';

/** 浏览活跃掩码 fail-open：null / 非法（未配）= 全天活跃（与 cloud 回落同口径）。 */
const browseMaskForEdit = (m: string | null | undefined) => (m && isValidMask(m) ? m : FULL_ACTIVE_MASK);
/** 内容掩码 fail-closed：null / 非法（未配）= 全 0（不自动），与浏览掩码刻意相反。 */
const contentMaskForEdit = (m: string | null | undefined) => (m && isValidMask(m) ? m : EMPTY_MASK);
/** 结构约束：内容位 ⊆ 活跃位（休眠格的自动标记一律裁掉）。 */
const clampContent = (browse: string, content: string) =>
  Array.from(content, (c, i) => (c === '1' && browse[i] === '1' ? '1' : '0')).join('');

function ScheduleGridEditor(props: {
  browseMask: string;
  contentMask: string;
  onChange: (browseMask: string, contentMask: string) => void;
}) {
  const update = (browseMask: string, contentMask: string) =>
    props.onChange(browseMask, clampContent(browseMask, contentMask));

  /** 点格三态循环：休眠 → 活跃 → 活跃+自动 → 休眠。 */
  const cycleCell = (day: number, hour: number) => {
    const i = cellIdx(day, hour);
    const browseOn = props.browseMask[i] === '1';
    const contentOn = props.contentMask[i] === '1';
    if (!browseOn) update(setCell(props.browseMask, day, hour, true), props.contentMask);
    else if (!contentOn) update(props.browseMask, setCell(props.contentMask, day, hour, true));
    else update(setCell(props.browseMask, day, hour, false), setCell(props.contentMask, day, hour, false));
  };

  /** 行 / 列整体推进：有休眠 → 全活跃；无休眠但有未标自动 → 全自动；全自动 → 全休眠。 */
  const cycleGroup = (cells: Array<[number, number]>) => {
    const anyDormant = cells.some(([d, h]) => props.browseMask[cellIdx(d, h)] !== '1');
    const anyUnmarked = cells.some(([d, h]) => props.contentMask[cellIdx(d, h)] !== '1');
    let browse = props.browseMask;
    let content = props.contentMask;
    for (const [day, hour] of cells) {
      if (anyDormant) browse = setCell(browse, day, hour, true);
      else if (anyUnmarked) content = setCell(content, day, hour, true);
      else {
        browse = setCell(browse, day, hour, false);
        content = setCell(content, day, hour, false);
      }
    }
    update(browse, content);
  };

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Space wrap>
        <Button size="small" onClick={() => update(FULL_ACTIVE_MASK, props.contentMask)}>
          全部活跃
        </Button>
        <Button size="small" onClick={() => update(workdayMask(), props.contentMask)}>
          工作时间
        </Button>
        <Button size="small" onClick={() => update(EMPTY_MASK, EMPTY_MASK)}>
          全部休眠
        </Button>
        <Button size="small" onClick={() => update(props.browseMask, EMPTY_MASK)}>
          清空自动位
        </Button>
        <Typography.Text type="secondary">
          活跃 {countActive(props.browseMask)} / 168，其中可自动 {countActive(clampContent(props.browseMask, props.contentMask))}
        </Typography.Text>
      </Space>
      <WeekActiveGrid
        mask={props.browseMask}
        overlayMask={clampContent(props.browseMask, props.contentMask)}
        overlayTitle="可自动发内容"
        onToggleCell={cycleCell}
        onToggleRow={(day) => cycleGroup(Array.from({ length: 24 }, (_, hour) => [day, hour] as [number, number]))}
        onToggleCol={(hour) => cycleGroup(Array.from({ length: 7 }, (_, day) => [day, hour] as [number, number]))}
      />
    </Space>
  );
}

/** 排期 catalog 同样只消费 Cloud 的统一展示名；旧 DTO 回落 accountId。 */
const displayName = (r: ContentScheduleRow) => r.displayName?.trim() || r.accountId;

const ACTION_MODE_LABELS: Record<ContentScheduleActionMode, string> = {
  off: '关',
  review: '开',
  auto_approve: '免审',
};

const PLATFORM_LABELS: Record<string, string> = {
  xiaohongshu: '小红书',
  facebook: 'Facebook',
  wechat_channels: '视频号',
};

const PLATFORM_COLORS: Record<string, string> = {
  xiaohongshu: 'red',
  facebook: 'blue',
  wechat_channels: 'green',
};

const KNOWN_PLATFORM_OPTIONS = ['xiaohongshu', 'facebook', 'wechat_channels'] as const;

const platformLabel = (platform: string) => PLATFORM_LABELS[platform] ?? platform;

const isActionModeOn = (mode: ContentScheduleActionMode) => mode !== 'off';

interface ActionUiConfig {
  label: string;
  enabled: (row: ContentScheduleRow) => boolean;
  mode: (row: ContentScheduleRow) => ContentScheduleActionMode;
  dailyCap: (row: ContentScheduleRow) => number;
  modePatch: (mode: ContentScheduleActionMode) => ContentSchedulePatch;
  capPatch: (dailyCap: number) => ContentSchedulePatch;
  requiresContact?: boolean;
}

/** 动作字段适配，不表达任何平台支持关系；平台能力只认 availableActions。 */
const actionUi: Record<ContentScheduleAutomationAction, ActionUiConfig> = {
  post: {
    label: '自动发帖',
    enabled: (row) => row.postEnabled,
    mode: (row) => row.postMode,
    dailyCap: (row) => row.postDailyCap,
    modePatch: (mode) => ({ postMode: mode }),
    capPatch: (dailyCap) => ({ postDailyCap: dailyCap }),
  },
  comment: {
    label: '自动评论',
    enabled: (row) => row.commentEnabled,
    mode: (row) => row.commentMode,
    dailyCap: (row) => row.commentDailyCap,
    modePatch: (mode) => ({ commentMode: mode }),
    capPatch: (dailyCap) => ({ commentDailyCap: dailyCap }),
  },
  contact_comment: {
    label: '自动联系评论',
    enabled: (row) => row.contactCommentEnabled,
    mode: (row) => row.contactCommentMode,
    dailyCap: (row) => row.contactCommentDailyCap,
    modePatch: (mode) => ({ contactCommentMode: mode }),
    capPatch: (dailyCap) => ({ contactCommentDailyCap: dailyCap }),
    requiresContact: true,
  },
};

const actionIds = Object.keys(actionUi) as ContentScheduleAutomationAction[];

const actionMetadata = (row: ContentScheduleRow, action: ContentScheduleAutomationAction) =>
  row.availableActions.find((item) => item.action === action);

const isStoredActionConfigured = (row: ContentScheduleRow, action: ContentScheduleAutomationAction) => {
  const config = actionUi[action];
  return config.enabled(row) || isActionModeOn(config.mode(row)) || config.dailyCap(row) > 0;
};

const hasUnsupportedActionConfig = (row: ContentScheduleRow) =>
  actionIds.some((action) => {
    const metadata = actionMetadata(row, action);
    if (!metadata) return isStoredActionConfigured(row, action);
    const mode = actionUi[action].mode(row);
    return (
      (isActionModeOn(mode) && !metadata.allowedModes.includes(mode as Exclude<ContentScheduleActionMode, 'off'>)) ||
      actionUi[action].dailyCap(row) > metadata.maxDailyCap
    );
  });

const enabledActionSummary = (row: ContentScheduleRow) => {
  if (!row.autoEnabled) return ['总开关关闭'];
  return row.availableActions.flatMap((metadata) => {
    const config = actionUi[metadata.action];
    const mode = config.mode(row);
    if (!isActionModeOn(mode) || !metadata.allowedModes.includes(mode as Exclude<ContentScheduleActionMode, 'off'>)) {
      return [];
    }
    return [`${config.label} · ${ACTION_MODE_LABELS[mode]} · ${config.dailyCap(row)}/日`];
  });
};

function applySchedulePatch(row: ContentScheduleRow, patch: ContentSchedulePatch): ContentScheduleRow {
  const next: ContentScheduleRow = { ...row, ...patch };
  if (patch.postMode !== undefined) next.postEnabled = isActionModeOn(patch.postMode);
  if (patch.commentMode !== undefined) next.commentEnabled = isActionModeOn(patch.commentMode);
  if (patch.contactCommentMode !== undefined) next.contactCommentEnabled = isActionModeOn(patch.contactCommentMode);
  // 兼容旧 boolean patch：旧调用面仍映射到 review/off。
  if (patch.postEnabled !== undefined && patch.postMode === undefined) next.postMode = patch.postEnabled ? 'review' : 'off';
  if (patch.commentEnabled !== undefined && patch.commentMode === undefined) next.commentMode = patch.commentEnabled ? 'review' : 'off';
  if (patch.contactCommentEnabled !== undefined && patch.contactCommentMode === undefined)
    next.contactCommentMode = patch.contactCommentEnabled ? 'review' : 'off';
  return next;
}

function ActionModeControl(props: {
  label: string;
  value: ContentScheduleActionMode;
  allowedModes: ContentScheduleAvailableAction['allowedModes'];
  disabled?: boolean;
  onChange: (mode: ContentScheduleActionMode) => void;
}) {
  const options = [
    { label: ACTION_MODE_LABELS.off, value: 'off' as const },
    ...props.allowedModes.map((value) => ({ label: ACTION_MODE_LABELS[value], value })),
  ];
  return (
    <Segmented<ContentScheduleActionMode>
      aria-label={props.label}
      className="content-schedule-mode"
      size="small"
      options={options}
      value={props.value}
      disabled={props.disabled}
      onChange={props.onChange}
      style={{ minWidth: 112 }}
    />
  );
}

/**
 * 排期页缺失联系方式的快速补齐入口。
 *
 * 只复用账号主数据的权威写端点，不把联系方式正文复制进排期 DTO。保存前不乐观解锁：
 * 服务端明确回传非空 contactInfo 后，才更新 hasContactInfo 派生徽标并重取两份目录真态。
 */
function MissingContactQuickConfig({ accountId }: { accountId: string }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const saveContact = useMutation({
    mutationFn: async (contactInfo: string) => {
      const result = await apiPut<{ accountId: string; contactInfo: string | null }>(
        `/api/accounts/${encodeURIComponent(accountId)}/contact-info`,
        { contactInfo },
      );
      if (!result.contactInfo) throw new Error('contact_info_not_confirmed');
      return result;
    },
    onSuccess: () => {
      // 回执确认后先定点解除本行的「缺失联系方式」门禁，再后台重取 JOIN 派生真态。
      qc.setQueryData<ContentScheduleCatalog>(['config', 'content-schedule'], (old) =>
        old
          ? {
              ...old,
              rows: old.rows.map((row) =>
                row.accountId === accountId ? { ...row, hasContactInfo: true } : row,
              ),
            }
          : old,
      );
      setOpen(false);
      setDraft('');
      message.success('已保存关联联系方式');
      void qc.invalidateQueries({ queryKey: ['config', 'content-schedule'], exact: true });
      void qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (error) => {
      const detail =
        error instanceof Error && error.message === 'contact_info_not_confirmed'
          ? '服务端未确认联系方式已保存，请重试'
          : errorText(error, '请稍后重试');
      message.error(`联系方式保存失败：${detail}`);
    },
  });

  const submit = () => {
    if (draft.trim() === '') {
      message.warning('请输入联系方式');
      return;
    }
    // 与账号页一致：trim 只用于判空，非空正文 verbatim 下发，保留 emoji、换行与首尾空白。
    saveContact.mutate(draft);
  };

  const editor = (
    <Space direction="vertical" size={8} style={{ width: 300 }}>
      <Typography.Text>为账号 {accountId} 添加联系方式</Typography.Text>
      <Input.TextArea
        aria-label={`账号 ${accountId} 联系方式`}
        autoFocus
        autoSize={{ minRows: 2, maxRows: 8 }}
        value={draft}
        disabled={saveContact.isPending}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="粘贴联系方式（原样保存，含 emoji/换行）"
      />
      <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
        <Button
          aria-label="取消添加联系方式"
          size="small"
          disabled={saveContact.isPending}
          onClick={() => setOpen(false)}
        >
          取消
        </Button>
        <Button
          aria-label="保存联系方式"
          size="small"
          type="primary"
          loading={saveContact.isPending}
          onClick={submit}
        >
          {saveContact.isPending ? '保存中' : '保存'}
        </Button>
      </Space>
    </Space>
  );

  return (
    <Popover
      content={editor}
      open={open}
      trigger="click"
      placement="bottomRight"
      destroyOnHidden
      onOpenChange={(nextOpen) => {
        if (!saveContact.isPending) setOpen(nextOpen);
      }}
    >
      <Tag
        color="red"
        role="button"
        tabIndex={0}
        title="点击添加联系方式"
        style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        未配联系方式（点击添加）
      </Tag>
    </Popover>
  );
}

/**
 * 内容排期页（change content-schedule-auto-publish，Phase 1 只做发帖）。
 * 三态合一网格（用户拍板形态）：一张周历、点格循环 休眠 → 活跃 → 活跃+可自动 → 休眠；
 * 底层仍是两个独立字段（浏览掩码 fail-open / 内容掩码 fail-closed），一次保存串行写两端点、诚实非乐观。
 * 活跃层与「安全」页的「可活跃时间」是同一份数据——在这里改活跃格 = 改浏览会话时段（安全页已只读化）。
 * 铁律：自动 ⊆ 活跃（休眠格绝不自动，云端另有强制闸）；开=飞书审批，免审=通知后提交；手动不受时段限制。
 */
export function ContentSchedulePage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const sl = useSessionLimits();
  const global = useContentScheduleGlobal();
  const catalog = useContentSchedule();
  const [platformFilter, setPlatformFilter] = useState('all');

  // ── 三态网格编辑弹窗：browse（活跃层）+ content（自动位，⊆ browse） ──
  const [gridOpen, setGridOpen] = useState(false);
  const [browseMask, setBrowseMask] = useState(FULL_ACTIVE_MASK);
  const [contentMask, setContentMask] = useState(EMPTY_MASK);
  const [accountGridRow, setAccountGridRow] = useState<ContentScheduleRow | null>(null);
  const [accountBrowseMask, setAccountBrowseMask] = useState(FULL_ACTIVE_MASK);
  const [accountContentMask, setAccountContentMask] = useState(EMPTY_MASK);

  const saveGrid = useMutation({
    // 串行双写（两字段各有拥有端点，非原子）：任一失败诚实报错并整体重取真态；
    // 中间态无安全风险——云端「自动 ⊆ 活跃」闸兜底，UI 不一致只影响显示、重试即收敛。
    mutationFn: async ({ browse, content }: { browse: string; content: string }) => {
      await apiPut<unknown>('/api/session-limits', { activeWeekMask: browse });
      await apiPut<unknown>('/api/content-schedule/global', { contentActiveMask: content });
    },
    onSuccess: () => {
      message.success('已保存：活跃时段 + 可自动时段。下场会话 / 下个排期槽即生效（热加载）');
      setGridOpen(false);
      void qc.invalidateQueries({ queryKey: ['config', 'session-limits'] });
      void qc.invalidateQueries({ queryKey: ['config', 'content-schedule'] });
    },
    onError: (e) => {
      message.error(`保存失败：${errorText(e)}（已重取服务器真实状态）`);
      void qc.invalidateQueries({ queryKey: ['config', 'session-limits'] });
      void qc.invalidateQueries({ queryKey: ['config', 'content-schedule'] });
    },
  });

  const openGridEditor = () => {
    const b = browseMaskForEdit(sl.data?.activeWeekMask);
    setBrowseMask(b);
    setContentMask(clampContent(b, contentMaskForEdit(global.data?.contentActiveMask)));
    setGridOpen(true);
  };

  const openAccountGridEditor = (row: ContentScheduleRow) => {
    const browse = browseMaskForEdit(row.effectiveActiveWeekMask);
    setAccountGridRow(row);
    setAccountBrowseMask(browse);
    setAccountContentMask(clampContent(browse, contentMaskForEdit(row.effectiveContentActiveMask)));
  };

  const saveAccountGrid = useMutation({
    mutationFn: ({
      accountId,
      activeWeekMask,
      contentActiveMask,
    }: {
      accountId: string;
      activeWeekMask: string | null;
      contentActiveMask: string | null;
    }) =>
      apiPut(`/api/content-schedule/${encodeURIComponent(accountId)}`, {
        activeWeekMask,
        contentActiveMask,
      }),
    onSuccess: (_data, variables) => {
      const inherited = variables.activeWeekMask === null && variables.contentActiveMask === null;
      message.success(inherited ? '已恢复跟随全局排期' : '已保存账号排期，下场会话 / 下个排期槽即生效');
      setAccountGridRow(null);
      void qc.invalidateQueries({ queryKey: ['config', 'content-schedule'], exact: true });
    },
    onError: (error) => {
      message.error(`账号排期保存失败：${errorText(error)}`);
      void qc.invalidateQueries({ queryKey: ['config', 'content-schedule'], exact: true });
    },
  });

  // ── 每账号策略写入（乐观：点下去即翻，后台对账，失败回滚） ──
  const patchAccount = useMutation({
    mutationFn: ({ accountId, patch }: { accountId: string; patch: ContentSchedulePatch }) =>
      apiPut<{ sharedContactInfoWarning?: boolean }>(
        `/api/content-schedule/${encodeURIComponent(accountId)}`,
        patch,
      ),
    // 乐观：先取消在途重取、快照旧目录、就地把这一行的「改动字段」合并进缓存 → 开关同帧翻，与网络快慢/事件循环脱钩。
    // 铁律：只并 patch 字段（{...r, ...patch}）、绝不整行替换——JOIN 派生列（昵称/联系方式徽标/时段来源/configured）不在 patch 里，须原样保留，否则会把这几列刷空。
    onMutate: async ({ accountId, patch }) => {
      await qc.cancelQueries({ queryKey: ['config', 'content-schedule'] });
      const prev = qc.getQueryData<ContentScheduleCatalog>(['config', 'content-schedule']);
      qc.setQueryData<ContentScheduleCatalog>(['config', 'content-schedule'], (old) =>
        old
          ? { ...old, rows: old.rows.map((r) => (r.accountId === accountId ? applySchedulePatch(r, patch) : r)) }
          : old,
      );
      return { prev };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['config', 'content-schedule'], ctx.prev); // 失败弹回服务器真态
      // 联系评论「无联系方式」拒因 no_contact_info 随 body.reason 下发、error 恒为 'bad_request'；统一走 errorText 按 reason
      // 映射（旧代码读 e.message 恒等于 'bad_request'、msg.includes 永不命中，无联系方式真因被吞成「请求格式有误」）。
      // 联系方式「共用」不再是 error（loosen-group-comment-shared-code：放行 + onSuccess 警告）。
      message.error(`保存失败：${errorText(e)}`); // #31：兜底走中文映射，不上屏英文机器码
    },
    // 一码一号放松（loosen-group-comment-shared-code）：共用联系方式开联系评论已放行，但云端回带 sharedContactInfoWarning——
    // 如实弹一条防关联封号风险提示（非错误、非阻断），绝不静默把关联风险咽下去。
    onSuccess: (data) => {
      if (data?.sharedContactInfoWarning) {
        message.warning('已开启自动联系评论：该联系方式与其它账号共用，一码一号是防关联封号建议，建议尽快改用独立联系方式');
      }
    },
    // 成/败都回后台对一次账（exact:true 只重取本目录、不误伤前缀子键 …/'global'）。开关已乐观翻好，此 GET 不在关键路径、用户无感。
    onSettled: () => qc.invalidateQueries({ queryKey: ['config', 'content-schedule'], exact: true }),
  });

  // 日上限本地草稿（编辑中未提交值）；onBlur 提交。key = `${accountId}:${action}`。
  const [capDraft, setCapDraft] = useState<Record<string, number | null>>({});

  const commitCap = (r: ContentScheduleRow, action: ContentScheduleAutomationAction) => {
    const key = `${r.accountId}:${action}`;
    const config = actionUi[action];
    const current = config.dailyCap(r);
    const draft = capDraft[key];
    if (draft == null || draft === current) {
      setCapDraft((d) => {
        const { [key]: _drop, ...rest } = d;
        return rest;
      });
      return;
    }
    patchAccount.mutate({
      accountId: r.accountId,
      patch: config.capPatch(draft),
    });
    setCapDraft((d) => {
      const { [key]: _drop, ...rest } = d;
      return rest;
    });
  };

  const previewBrowse = browseMaskForEdit(sl.data?.activeWeekMask);
  const previewContent = clampContent(previewBrowse, contentMaskForEdit(global.data?.contentActiveMask));
  const loadingGrid = sl.isLoading || global.isLoading;

  const rows = catalog.data?.rows ?? [];
  const platformOptions = useMemo(() => {
    const known = new Set<string>(KNOWN_PLATFORM_OPTIONS);
    const unknown = rows
      .map((row) => row.platform)
      .filter((platform) => platform && !known.has(platform))
      .filter((platform, index, all) => all.indexOf(platform) === index)
      .sort();
    return [
      { label: '全部平台', value: 'all' },
      ...KNOWN_PLATFORM_OPTIONS.map((value) => ({ label: platformLabel(value), value })),
      ...unknown.map((value) => ({ label: value, value })),
    ];
  }, [rows]);
  const filteredRows = useMemo(
    () => (platformFilter === 'all' ? rows : rows.filter((row) => row.platform === platformFilter)),
    [platformFilter, rows],
  );
  const visibleActionIds = useMemo(() => {
    const seen = new Set<ContentScheduleAutomationAction>();
    const ordered: ContentScheduleAutomationAction[] = [];
    for (const row of filteredRows) {
      for (const metadata of row.availableActions) {
        if (!seen.has(metadata.action)) {
          seen.add(metadata.action);
          ordered.push(metadata.action);
        }
      }
    }
    return ordered;
  }, [filteredRows]);

  // 子开关（发帖/评论/联系评论）显示「有效态」= 总开关 && 本开关：总开关关时统一显示为关，与云端
  // 「总开关关=整账号不自动」（content-scheduler 账号级闸）一致；且不写库、保留各子开关记忆值，
  // 重开总开关即恢复。——消除「总开关关后子开关仍显示开却灰掉、关不掉」的假象（红线：不骗用户）。
  const columns: ColumnsType<ContentScheduleRow> = useMemo(() => {
    const platformColumn: ColumnsType<ContentScheduleRow>[number] = {
      title: '平台',
      key: 'platform',
      width: 110,
      render: (_: unknown, row) => <Tag color={PLATFORM_COLORS[row.platform]}>{platformLabel(row.platform)}</Tag>,
    };
    const commonColumns: ColumnsType<ContentScheduleRow> = [
      platformColumn,
      {
        title: '账号',
        key: 'account',
        width: 200,
        render: (_: unknown, r) => (
          <Space direction="vertical" size={0}>
            <span>{displayName(r)}</span>
            <Typography.Text
              type="secondary"
              style={{ fontSize: 12, whiteSpace: 'nowrap' }}
              className="tabular-nums"
            >
              {r.accountId}
            </Typography.Text>
          </Space>
        ),
      },
      {
        title: '账号分组',
        key: 'group',
        width: 120,
        render: (_: unknown, row) =>
          row.groupLabel ? row.groupLabel : <Typography.Text type="secondary">未分组</Typography.Text>,
      },
      {
        title: '总开关',
        key: 'auto',
        width: 90,
        render: (_: unknown, r) => (
          <Switch
            checked={r.autoEnabled}
            onChange={(v) => patchAccount.mutate({ accountId: r.accountId, patch: { autoEnabled: v } })}
          />
        ),
      },
      {
        title: '排期',
        key: 'schedule',
        width: 126,
        render: (_: unknown, r) => {
          const customized = r.hasActiveOverrideMask || r.hasContentOverrideMask;
          return (
            <Space direction="vertical" size={4}>
              <Tag color={customized ? 'blue' : 'default'}>{customized ? '账号自定义' : '跟随全局'}</Tag>
              <Button
                size="small"
                aria-label={`${customized ? '编辑' : '添加'}账号排期 ${r.accountId}`}
                onClick={() => openAccountGridEditor(r)}
              >
                {customized ? '编辑' : '添加排期'}
              </Button>
            </Space>
          );
        },
      },
    ];
    const auditColumn: ColumnsType<ContentScheduleRow>[number] = {
      title: '最近修改',
      key: 'audit',
      width: 170,
      render: (_: unknown, r) => (
        <Space direction="vertical" size={0}>
          {hasUnsupportedActionConfig(r) ? <Tag color="red">存在不支持的历史动作配置</Tag> : null}
          {r.configured && r.updatedAt ? (
            <>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {r.updatedBy ?? '—'}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                {new Date(r.updatedAt).toLocaleString()}
              </Typography.Text>
            </>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              未配（不自动）
            </Typography.Text>
          )}
        </Space>
      ),
    };

    if (platformFilter === 'all') {
      return [
        ...commonColumns,
        {
          title: '已启用动作',
          key: 'summary',
          width: 240,
          render: (_: unknown, row) => {
            const summaries = enabledActionSummary(row);
            if (row.availableActions.length === 0) {
              return <Typography.Text type="secondary">暂无可配置自动化动作</Typography.Text>;
            }
            if (summaries.length === 0) return <Typography.Text type="secondary">暂无已启用动作</Typography.Text>;
            return (
              <Space direction="vertical" size={2}>
                {summaries.map((summary) => <Tag key={summary}>{summary}</Tag>)}
              </Space>
            );
          },
        },
        auditColumn,
      ];
    }

    if (visibleActionIds.length === 0) {
      return [
        ...commonColumns,
        {
          title: '自动化动作',
          key: 'empty-actions',
          width: 220,
          render: () => <Typography.Text type="secondary">暂无可配置自动化动作</Typography.Text>,
        },
        auditColumn,
      ];
    }

    const actionColumns: ColumnsType<ContentScheduleRow> = visibleActionIds.map((action) => ({
      title: actionUi[action].label,
      key: action,
      width: actionUi[action].requiresContact ? 230 : 190,
      render: (_: unknown, row) => {
        const metadata = actionMetadata(row, action);
        if (!metadata) return <Typography.Text type="secondary">此账号不可配置</Typography.Text>;
        const config = actionUi[action];
        const storedMode = config.mode(row);
        const modeSupported =
          storedMode === 'off' || metadata.allowedModes.includes(storedMode as Exclude<ContentScheduleActionMode, 'off'>);
        const contactReady = !config.requiresContact || row.hasContactInfo;
        const effectiveMode = row.autoEnabled && contactReady && modeSupported ? storedMode : 'off';
        const capKey = `${row.accountId}:${action}`;
        return (
          <Space direction="vertical" size={6}>
            <Space size={6}>
              <ActionModeControl
                label={`${config.label} ${row.accountId}`}
                value={effectiveMode}
                allowedModes={metadata.allowedModes}
                disabled={!row.autoEnabled || !contactReady}
                onChange={(mode) =>
                  patchAccount.mutate({ accountId: row.accountId, patch: config.modePatch(mode) })
                }
              />
              {config.requiresContact && !row.hasContactInfo ? (
                <MissingContactQuickConfig accountId={row.accountId} />
              ) : null}
            </Space>
            <Space size={4}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>日上限</Typography.Text>
              <InputNumber
                aria-label={`${config.label}日上限 ${row.accountId}`}
                min={0}
                max={metadata.maxDailyCap}
                precision={0}
                disabled={!row.autoEnabled || !contactReady || !isActionModeOn(effectiveMode)}
                value={capDraft[capKey] ?? config.dailyCap(row)}
                onChange={(value) => setCapDraft((draft) => ({ ...draft, [capKey]: value }))}
                onBlur={() => commitCap(row, action)}
                onPressEnter={() => commitCap(row, action)}
                status={config.dailyCap(row) > metadata.maxDailyCap ? 'error' : undefined}
                style={{ width: 64 }}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>/ {metadata.maxDailyCap}</Typography.Text>
            </Space>
            {!modeSupported ? <Tag color="red">当前模式不受支持，请关闭后重配</Tag> : null}
          </Space>
        );
      },
    }));
    return [...commonColumns, ...actionColumns, auditColumn];
  }, [capDraft, commitCap, openAccountGridEditor, patchAccount, platformFilter, visibleActionIds]);

  // 读失败：不回落到编造的默认周历掩码（fail-open 全活跃会被当真实配置展示）——诚实报错 + 重试全部。
  // 与「真的读到空配置」（掩码为 null）区分：那种仍走 fail-open/fail-closed 默认，只有读失败才不许伪造。
  if (sl.isError || global.isError || catalog.isError) {
    return (
      <QueryError
        title="加载内容排期失败"
        onRetry={() => {
          void sl.refetch();
          void global.refetch();
          void catalog.refetch();
        }}
      />
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="活跃时段与内容自动化"
        description="全局周历是所有账号的默认值；账号表可单独添加排期，账号自定义优先，恢复全局后立即重新继承。每张周历都管两层：绿格=账号活跃（允许浏览会话）；绿格里的白点=该小时还允许自动发内容。每个动作可选「关 / 开 / 免审」；休眠格绝不自动（云端强制）。手动 /publish、/comment 不受时段限制。点=「允许自动尝试」，非保证发出（无新素材、日上限、风控、页面核对仍会拦）。需云端开启 AIDCP_CONTENT_SCHEDULE_AUTO 后排期才驱动触发。"
      />

      <Card
        size="small"
        title="活跃与内容排期（全局周历）"
        extra={
          <Button size="small" onClick={openGridEditor} disabled={loadingGrid}>
            编辑
          </Button>
        }
      >
        {loadingGrid ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space>
              <Tag color="green">活跃 {countActive(previewBrowse)} / 168 小时</Tag>
              <Tag color={countActive(previewContent) > 0 ? 'blue' : 'default'}>
                其中可自动发 {countActive(previewContent)} 小时
              </Tag>
            </Space>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
              绿=活跃（允许浏览；即「安全」页的可活跃时间，此处为唯一编辑入口）、绿+白点=活跃且允许自动发内容、灰=休眠（不浏览、绝不自动）。
            </Typography.Paragraph>
            <WeekActiveGrid mask={previewBrowse} overlayMask={previewContent} overlayTitle="可自动发内容" readOnly />
          </Space>
        )}
      </Card>

      <Card size="small" title="账号自动化">
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          默认“全部平台”只看跨平台公共摘要；选择单个平台后，才按 Cloud 声明展示该平台真实支持的动作、模式和日上限。“跟随全局”使用上方默认周历，账号自定义排期优先。触发时刻仍在可自动小时内按“账号 × 动作”错峰打散；免审只跳过审批等待，不跳过风控、去重、页面核对和结果回执。
        </Typography.Paragraph>
        <Space wrap style={{ marginBottom: 12 }}>
          <Segmented<string>
            aria-label="平台筛选"
            value={platformFilter}
            options={platformOptions}
            onChange={setPlatformFilter}
          />
          <Typography.Text type="secondary" data-testid="platform-filter-count">
            当前 {filteredRows.length} / 全部 {rows.length} 个账号
          </Typography.Text>
        </Space>
        {catalog.isLoading ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : (
          <Table<ContentScheduleRow>
            rowKey="accountId"
            size="small"
            columns={columns}
            dataSource={filteredRows}
            pagination={false}
            locale={{
              emptyText:
                platformFilter === 'all'
                  ? '暂无账号'
                  : `${platformLabel(platformFilter)}暂无账号`,
            }}
          />
        )}
      </Card>

      <Modal
        title="编辑活跃与内容排期（全局）"
        open={gridOpen}
        onCancel={() => setGridOpen(false)}
        onOk={() => {
          if (!isValidMask(browseMask) || !isValidMask(contentMask)) {
            message.error('掩码非法（须 168 位 0/1）');
            return;
          }
          saveGrid.mutate({ browse: browseMask, content: clampContent(browseMask, contentMask) });
        }}
        confirmLoading={saveGrid.isPending}
        width={760}
        okText="保存"
        cancelText="取消"
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            点格循环三态：休眠 → 活跃 → 活跃+可自动（白点）→ 休眠。点「天」名 / 小时号对整行 / 整列做同样推进。
            改绿格即改浏览会话时段（与「安全」页同一份数据）。自动位只能落在活跃格上，格子转休眠时自动位随之清除。
          </Typography.Text>
          <ScheduleGridEditor
            browseMask={browseMask}
            contentMask={contentMask}
            onChange={(browse, content) => {
              setBrowseMask(browse);
              setContentMask(content);
            }}
          />
        </Space>
      </Modal>

      <Modal
        title={`编辑账号排期${accountGridRow ? `：${displayName(accountGridRow)}` : ''}`}
        open={accountGridRow !== null}
        onCancel={() => {
          if (!saveAccountGrid.isPending) setAccountGridRow(null);
        }}
        onOk={() => {
          if (!accountGridRow) return;
          if (!isValidMask(accountBrowseMask) || !isValidMask(accountContentMask)) {
            message.error('掩码非法（须 168 位 0/1）');
            return;
          }
          saveAccountGrid.mutate({
            accountId: accountGridRow.accountId,
            activeWeekMask: accountBrowseMask,
            contentActiveMask: clampContent(accountBrowseMask, accountContentMask),
          });
        }}
        confirmLoading={saveAccountGrid.isPending}
        width={760}
        okText="保存账号排期"
        cancelText="取消"
      >
        {accountGridRow ? (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              message="仅影响当前社媒账号"
              description="保存后该账号的活跃与内容排期优先于全局；总开关、动作模式和日上限保持不变。"
            />
            {accountGridRow.hasActiveOverrideMask || accountGridRow.hasContentOverrideMask ? (
              <Popconfirm
                title="恢复跟随全局排期？"
                description="将同时清空该账号的活跃与内容时段覆盖，其它自动化开关不变。"
                okText="恢复全局"
                cancelText="取消"
                onConfirm={() =>
                  saveAccountGrid.mutate({
                    accountId: accountGridRow.accountId,
                    activeWeekMask: null,
                    contentActiveMask: null,
                  })
                }
              >
                <Button danger size="small" loading={saveAccountGrid.isPending}>
                  恢复全局
                </Button>
              </Popconfirm>
            ) : (
              <Typography.Text type="secondary">当前跟随全局；编辑器已按当前全局生效值初始化。</Typography.Text>
            )}
            <Typography.Text type="secondary">
              点格循环三态：休眠 → 活跃 → 活跃+可自动（白点）→ 休眠。自动位只能落在活跃格上。
            </Typography.Text>
            <ScheduleGridEditor
              browseMask={accountBrowseMask}
              contentMask={accountContentMask}
              onChange={(browse, content) => {
                setAccountBrowseMask(browse);
                setAccountContentMask(content);
              }}
            />
          </Space>
        ) : null}
      </Modal>
    </Space>
  );
}
