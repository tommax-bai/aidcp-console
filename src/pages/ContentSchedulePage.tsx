import { useMemo, useState } from 'react';
import {
  App,
  Alert,
  Button,
  Card,
  InputNumber,
  Modal,
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
import type { ContentScheduleRow, ContentSchedulePatch, ContentScheduleCatalog, ContentScheduleActionMode } from '../types/api';
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

const CAP_MAX = 50;

/** 浏览活跃掩码 fail-open：null / 非法（未配）= 全天活跃（与 cloud 回落同口径）。 */
const browseMaskForEdit = (m: string | null | undefined) => (m && isValidMask(m) ? m : FULL_ACTIVE_MASK);
/** 内容掩码 fail-closed：null / 非法（未配）= 全 0（不自动），与浏览掩码刻意相反。 */
const contentMaskForEdit = (m: string | null | undefined) => (m && isValidMask(m) ? m : EMPTY_MASK);
/** 结构约束：内容位 ⊆ 活跃位（休眠格的自动标记一律裁掉）。 */
const clampContent = (browse: string, content: string) =>
  Array.from(content, (c, i) => (c === '1' && browse[i] === '1' ? '1' : '0')).join('');

/** 排期 catalog 同样只消费 Cloud 的统一展示名；旧 DTO 回落 accountId。 */
const displayName = (r: ContentScheduleRow) => r.displayName?.trim() || r.accountId;

const ACTION_MODE_OPTIONS: Array<{ label: string; value: ContentScheduleActionMode }> = [
  { label: '关', value: 'off' },
  { label: '开', value: 'review' },
  { label: '免审', value: 'auto_approve' },
];

const isActionModeOn = (mode: ContentScheduleActionMode) => mode !== 'off';

function modePatch(kind: 'post' | 'comment' | 'contact', mode: ContentScheduleActionMode): ContentSchedulePatch {
  if (kind === 'post') return { postMode: mode };
  if (kind === 'comment') return { commentMode: mode };
  return { contactCommentMode: mode };
}

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
  disabled?: boolean;
  onChange: (mode: ContentScheduleActionMode) => void;
}) {
  return (
    <Segmented<ContentScheduleActionMode>
      aria-label={props.label}
      className="content-schedule-mode"
      size="small"
      options={ACTION_MODE_OPTIONS}
      value={props.value}
      disabled={props.disabled}
      onChange={props.onChange}
      style={{ minWidth: 112 }}
    />
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

  // ── 三态网格编辑弹窗：browse（活跃层）+ content（自动位，⊆ browse） ──
  const [gridOpen, setGridOpen] = useState(false);
  const [browseMask, setBrowseMask] = useState(FULL_ACTIVE_MASK);
  const [contentMask, setContentMask] = useState(EMPTY_MASK);

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

  /** 点格三态循环：休眠 → 活跃 → 活跃+自动 → 休眠。 */
  const cycleCell = (day: number, hour: number) => {
    const i = cellIdx(day, hour);
    const b = browseMask[i] === '1';
    const c = contentMask[i] === '1';
    if (!b) {
      setBrowseMask((m) => setCell(m, day, hour, true)); // 休眠 → 活跃
    } else if (!c) {
      setContentMask((m) => setCell(m, day, hour, true)); // 活跃 → 活跃+自动
    } else {
      setBrowseMask((m) => setCell(m, day, hour, false)); // 活跃+自动 → 休眠（自动位随之裁掉）
      setContentMask((m) => setCell(m, day, hour, false));
    }
  };

  /** 行 / 列整体推进（同一三态循环）：有休眠 → 全活跃；无休眠但有未标自动 → 全活跃+自动；全自动 → 全休眠。 */
  const cycleGroup = (cells: Array<[number, number]>) => {
    const anyDormant = cells.some(([d, h]) => browseMask[cellIdx(d, h)] !== '1');
    const anyUnmarked = cells.some(([d, h]) => contentMask[cellIdx(d, h)] !== '1');
    let b = browseMask;
    let c = contentMask;
    for (const [d, h] of cells) {
      if (anyDormant) {
        b = setCell(b, d, h, true);
      } else if (anyUnmarked) {
        c = setCell(c, d, h, true);
      } else {
        b = setCell(b, d, h, false);
        c = setCell(c, d, h, false);
      }
    }
    setBrowseMask(b);
    setContentMask(clampContent(b, c));
  };

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

  // 日上限本地草稿（编辑中未提交值）；onBlur 提交。key = `${accountId}:${'post'|'comment'}`（两动作各自独立）。
  const [capDraft, setCapDraft] = useState<Record<string, number | null>>({});

  const commitCap = (r: ContentScheduleRow, kind: 'post' | 'comment' | 'contact') => {
    const key = `${r.accountId}:${kind}`;
    const current = kind === 'post' ? r.postDailyCap : kind === 'comment' ? r.commentDailyCap : r.contactCommentDailyCap;
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
      patch:
        kind === 'post'
          ? { postDailyCap: draft }
          : kind === 'comment'
            ? { commentDailyCap: draft }
            : { contactCommentDailyCap: draft },
    });
    setCapDraft((d) => {
      const { [key]: _drop, ...rest } = d;
      return rest;
    });
  };

  const previewBrowse = browseMaskForEdit(sl.data?.activeWeekMask);
  const previewContent = clampContent(previewBrowse, contentMaskForEdit(global.data?.contentActiveMask));
  const loadingGrid = sl.isLoading || global.isLoading;

  // 子开关（发帖/评论/联系评论）显示「有效态」= 总开关 && 本开关：总开关关时统一显示为关，与云端
  // 「总开关关=整账号不自动」（content-scheduler 账号级闸）一致；且不写库、保留各子开关记忆值，
  // 重开总开关即恢复。——消除「总开关关后子开关仍显示开却灰掉、关不掉」的假象（红线：不骗用户）。
  const columns: ColumnsType<ContentScheduleRow> = useMemo(
    () => [
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
        title: '自动发帖',
        key: 'post',
        width: 132,
        render: (_: unknown, r) => (
          <ActionModeControl
            label={`自动发帖 ${r.accountId}`}
            value={r.autoEnabled ? r.postMode : 'off'}
            disabled={!r.autoEnabled}
            onChange={(mode) => patchAccount.mutate({ accountId: r.accountId, patch: modePatch('post', mode) })}
          />
        ),
      },
      {
        title: '发帖日上限',
        key: 'cap',
        width: 96,
        render: (_: unknown, r) => (
          <InputNumber
            min={0}
            max={CAP_MAX}
            precision={0}
            disabled={!r.autoEnabled || !isActionModeOn(r.postMode)}
            value={capDraft[`${r.accountId}:post`] ?? r.postDailyCap}
            onChange={(v) => setCapDraft((d) => ({ ...d, [`${r.accountId}:post`]: v }))}
            onBlur={() => commitCap(r, 'post')}
            onPressEnter={() => commitCap(r, 'post')}
            style={{ width: 60 }}
          />
        ),
      },
      {
        title: '自动评论',
        key: 'comment',
        width: 132,
        render: (_: unknown, r) => (
          <ActionModeControl
            label={`自动评论 ${r.accountId}`}
            value={r.autoEnabled ? r.commentMode : 'off'}
            disabled={!r.autoEnabled}
            onChange={(mode) => patchAccount.mutate({ accountId: r.accountId, patch: modePatch('comment', mode) })}
          />
        ),
      },
      {
        title: '评论日上限',
        key: 'commentCap',
        width: 96,
        render: (_: unknown, r) => (
          <InputNumber
            min={0}
            max={CAP_MAX}
            precision={0}
            disabled={!r.autoEnabled || !isActionModeOn(r.commentMode)}
            value={capDraft[`${r.accountId}:comment`] ?? r.commentDailyCap}
            onChange={(v) => setCapDraft((d) => ({ ...d, [`${r.accountId}:comment`]: v }))}
            onBlur={() => commitCap(r, 'comment')}
            onPressEnter={() => commitCap(r, 'comment')}
            style={{ width: 60 }}
          />
        ),
      },
      {
        title: '自动联系评论',
        key: 'contact',
        width: 176,
        render: (_: unknown, r) => (
          <Space size={6}>
            <ActionModeControl
              label={`自动联系评论 ${r.accountId}`}
              value={r.autoEnabled && r.hasContactInfo ? r.contactCommentMode : 'off'}
              disabled={!r.autoEnabled || !r.hasContactInfo}
              onChange={(mode) => patchAccount.mutate({ accountId: r.accountId, patch: modePatch('contact', mode) })}
            />
            {!r.hasContactInfo ? <Tag color="red">未配联系方式</Tag> : null}
          </Space>
        ),
      },
      {
        title: '联系评论日上限',
        key: 'contactCap',
        width: 120,
        render: (_: unknown, r) => (
          <InputNumber
            min={0}
            max={10}
            precision={0}
            disabled={!r.autoEnabled || !r.hasContactInfo || !isActionModeOn(r.contactCommentMode)}
            value={capDraft[`${r.accountId}:contact`] ?? r.contactCommentDailyCap}
            onChange={(v) => setCapDraft((d) => ({ ...d, [`${r.accountId}:contact`]: v }))}
            onBlur={() => commitCap(r, 'contact')}
            onPressEnter={() => commitCap(r, 'contact')}
            style={{ width: 60 }}
          />
        ),
      },
      {
        title: '最近修改',
        key: 'audit',
        width: 170,
        render: (_: unknown, r) =>
          r.configured && r.updatedAt ? (
            <Space direction="vertical" size={0}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {r.updatedBy ?? '—'}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                {new Date(r.updatedAt).toLocaleString()}
              </Typography.Text>
            </Space>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              未配（不自动）
            </Typography.Text>
          ),
      },
    ],
    [capDraft, patchAccount, commitCap],
  );

  const rows = catalog.data?.rows ?? [];

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
        description="一张周历管两层：绿格=账号活跃（允许浏览会话）；绿格里的白点=该小时还允许自动发内容。每个动作可选「关 / 开 / 免审」：开=生成后发飞书审批，免审=不等审批、发飞书通知后直接进入发布/评论步骤。休眠格绝不自动（云端强制）。手动 /publish、/comment 不受时段限制。点=「允许自动尝试」，非保证发出（无新素材、日上限、风控、页面核对仍会拦）。需云端开启 AIDCP_CONTENT_SCHEDULE_AUTO 后排期才驱动触发。"
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

      <Card size="small" title="账号内容自动化">
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          每账号：总开关（默认关）→ 自动发帖 / 自动评论 / 自动联系评论各自选择关、开或免审，并配置日上限。触发时刻在「可自动」小时内按「账号 × 动作」错峰打散、逐日变化。自动评论 / 自动联系评论都是「尝试」——自行搜索目标、可能 0 产出（如实回卡）；选择免审时只跳过飞书审批等待，不跳过风控配额、去重、页面核对和结果回执。联系评论额外规矩：开启须先配联系方式（未配硬拒）；建议**一码一号**——同一联系方式配多账号仍可开启，但会提示防关联封号风险；日上限=每日自动尝试数（被拒/无目标也占额度），硬上限 10、建议 ≤3；改联系方式后请自查一码一号。
        </Typography.Paragraph>
        {catalog.isLoading ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : (
          <Table<ContentScheduleRow>
            rowKey="accountId"
            size="small"
            columns={columns}
            dataSource={rows}
            pagination={false}
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
          <Space wrap>
            <Button size="small" onClick={() => { setBrowseMask(FULL_ACTIVE_MASK); setContentMask((c) => clampContent(FULL_ACTIVE_MASK, c)); }}>
              全部活跃
            </Button>
            <Button size="small" onClick={() => { const b = workdayMask(); setBrowseMask(b); setContentMask((c) => clampContent(b, c)); }}>
              工作时间
            </Button>
            <Button size="small" onClick={() => { setBrowseMask(EMPTY_MASK); setContentMask(EMPTY_MASK); }}>
              全部休眠
            </Button>
            <Button size="small" onClick={() => setContentMask(EMPTY_MASK)}>
              清空自动位
            </Button>
            <Typography.Text type="secondary">
              活跃 {countActive(browseMask)} / 168，其中可自动 {countActive(clampContent(browseMask, contentMask))}
            </Typography.Text>
          </Space>
          <WeekActiveGrid
            mask={browseMask}
            overlayMask={clampContent(browseMask, contentMask)}
            overlayTitle="可自动发内容"
            onToggleCell={cycleCell}
            onToggleRow={(d) => cycleGroup(Array.from({ length: 24 }, (_, h) => [d, h] as [number, number]))}
            onToggleCol={(h) => cycleGroup(Array.from({ length: 7 }, (_, d) => [d, h] as [number, number]))}
          />
        </Space>
      </Modal>
    </Space>
  );
}
