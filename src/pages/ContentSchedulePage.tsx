import { useMemo, useState } from 'react';
import {
  App,
  Alert,
  Button,
  Card,
  InputNumber,
  Modal,
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
import { useContentSchedule, useContentScheduleGlobal } from '../api/queries';
import type { ContentScheduleRow, ContentSchedulePatch } from '../types/api';
import {
  WeekActiveGrid,
  EMPTY_MASK,
  FULL_ACTIVE_MASK,
  countActive,
  isValidMask,
  setCell,
  workdayMask,
} from '../components/WeekActiveGrid';

const CAP_MAX = 50;

/** 内容网格 fail-closed：null / 非法（未配）一律视作全 0（不自动），与浏览掩码 null=全天活跃刻意相反。 */
const maskForEdit = (m: string | null) => (m && isValidMask(m) ? m : EMPTY_MASK);

/** 展示名回落：nickname → label → accountId。 */
const displayName = (r: ContentScheduleRow) => r.nickname || r.label || r.accountId;

/**
 * 内容排期页（change content-schedule-auto-publish，Phase 1 只做发帖）。
 * - Card1：全局「内容可自动时段」网格——治「何时允许自动发帖」，与安全页那张「治浏览会话」的网格独立。
 * - Card2：每账号策略表——总开关 / 发帖开关 + 日上限 / 时段来源（跟随全局）。账号变多只加行。
 * 铁律：到点只自动生成草稿→飞书人审→通过才发（绝不自动发送）；手动 /publish 不受时段限制；
 *       格子=「何时允许自动尝试」非「保证发出」（无素材可诚实空槽、日上限/人审仍拦）。
 * 写非乐观——round-trip 后 invalidate 重取真态；非法值由服务端整块拒，绝不部分落库。
 */
export function ContentSchedulePage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const global = useContentScheduleGlobal();
  const catalog = useContentSchedule();

  // ── 全局内容格编辑弹窗 ──
  const [gridOpen, setGridOpen] = useState(false);
  const [gridMask, setGridMask] = useState(EMPTY_MASK);

  const saveGlobal = useMutation({
    mutationFn: (contentActiveMask: string) =>
      apiPut<unknown>('/api/content-schedule/global', { contentActiveMask }),
    onSuccess: () => {
      message.success('已保存，下场排期即生效（热加载、无需重启）');
      setGridOpen(false);
      qc.invalidateQueries({ queryKey: ['config', 'content-schedule'] });
    },
    onError: (e) => message.error(`保存失败：${(e as Error).message}`),
  });

  const openGridEditor = () => {
    setGridMask(maskForEdit(global.data?.contentActiveMask ?? null));
    setGridOpen(true);
  };

  // ── 每账号策略写入（非乐观：成功后 invalidate 重取） ──
  const patchAccount = useMutation({
    mutationFn: ({ accountId, patch }: { accountId: string; patch: ContentSchedulePatch }) =>
      apiPut<unknown>(`/api/content-schedule/${encodeURIComponent(accountId)}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config', 'content-schedule'] }),
    onError: (e) => message.error(`保存失败：${(e as Error).message}`),
  });

  // 日上限本地草稿（编辑中未提交值）；onBlur 提交。
  const [capDraft, setCapDraft] = useState<Record<string, number | null>>({});

  const commitCap = (r: ContentScheduleRow) => {
    const draft = capDraft[r.accountId];
    if (draft == null || draft === r.postDailyCap) {
      setCapDraft((d) => {
        const { [r.accountId]: _drop, ...rest } = d;
        return rest;
      });
      return;
    }
    patchAccount.mutate({ accountId: r.accountId, patch: { postDailyCap: draft } });
    setCapDraft((d) => {
      const { [r.accountId]: _drop, ...rest } = d;
      return rest;
    });
  };

  const previewMask = maskForEdit(global.data?.contentActiveMask ?? null);

  const columns: ColumnsType<ContentScheduleRow> = useMemo(
    () => [
      {
        title: '账号',
        key: 'account',
        render: (_: unknown, r) => (
          <Space direction="vertical" size={0}>
            <span>{displayName(r)}</span>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} className="tabular-nums">
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
        width: 130,
        render: (_: unknown, r) => (
          <Switch
            checked={r.postEnabled}
            disabled={!r.autoEnabled}
            onChange={(v) => patchAccount.mutate({ accountId: r.accountId, patch: { postEnabled: v } })}
          />
        ),
      },
      {
        title: '发帖日上限',
        key: 'cap',
        width: 130,
        render: (_: unknown, r) => (
          <InputNumber
            min={0}
            max={CAP_MAX}
            precision={0}
            disabled={!r.autoEnabled || !r.postEnabled}
            value={capDraft[r.accountId] ?? r.postDailyCap}
            onChange={(v) => setCapDraft((d) => ({ ...d, [r.accountId]: v }))}
            onBlur={() => commitCap(r)}
            onPressEnter={() => commitCap(r)}
            style={{ width: 88 }}
          />
        ),
      },
      {
        title: '时段',
        key: 'window',
        width: 120,
        render: (_: unknown, r) =>
          r.maskSource === 'override' ? (
            <Tag color="blue">自定义</Tag>
          ) : (
            <Tag>跟随全局</Tag>
          ),
      },
      {
        title: '最近修改',
        key: 'audit',
        width: 160,
        render: (_: unknown, r) =>
          r.configured && r.updatedAt ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {r.updatedBy ?? '—'} · {new Date(r.updatedAt).toLocaleString()}
            </Typography.Text>
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

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="定时自动发帖（仍走人审）"
        description="到点由云端自动生成帖子草稿 → 发飞书人审 → 通过才真发，绝不自动发送。手动 /publish 不受此页时段限制、随时可发。格子=「何时允许自动尝试」，非保证发出（无新素材会诚实空槽、日上限与人审仍会拦）。需在云端开启自动排期（AIDCP_CONTENT_SCHEDULE_AUTO）后本页配置才驱动触发。"
      />

      <Card
        size="small"
        title="内容可自动时段（全局）"
        extra={
          <Button size="small" onClick={openGridEditor} disabled={global.isLoading}>
            编辑
          </Button>
        }
      >
        {global.isLoading ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space>
              {global.data?.overridden ? (
                <Tag color="green">已配置</Tag>
              ) : (
                <Tag>未配置（全休眠 = 不自动）</Tag>
              )}
              <Typography.Text type="secondary">
                可自动 {countActive(previewMask)} / 168 小时
              </Typography.Text>
            </Space>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
              绿=该小时允许账号自动发帖（仍逐条人审）、灰=不自动。此网格治「自动发帖」，与「安全」页那张治「浏览会话」的网格相互独立。缺省 / 未配 = 全休眠 = 完全不自动。
            </Typography.Paragraph>
            <WeekActiveGrid mask={previewMask} readOnly />
          </Space>
        )}
      </Card>

      <Card size="small" title="账号内容自动化">
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          每账号：总开关（默认关）→ 自动发帖开关 + 日上限。账号触发时刻在活跃小时内按账号错峰打散。默认时段跟随全局内容格。
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
        title="编辑内容可自动时段（全局）"
        open={gridOpen}
        onCancel={() => setGridOpen(false)}
        onOk={() => {
          if (!isValidMask(gridMask)) {
            message.error('掩码非法（须 168 位 0/1）');
            return;
          }
          saveGlobal.mutate(gridMask);
        }}
        confirmLoading={saveGlobal.isPending}
        width={760}
        okText="保存"
        cancelText="取消"
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            点格切该小时、点「天」名切整天、点小时号切整列。绿=允许自动发帖、灰=不自动。全休眠 = 完全不自动。
          </Typography.Text>
          <Space>
            <Button size="small" onClick={() => setGridMask(workdayMask())}>
              工作时间
            </Button>
            <Button size="small" onClick={() => setGridMask(FULL_ACTIVE_MASK)}>
              全开
            </Button>
            <Button size="small" onClick={() => setGridMask(EMPTY_MASK)}>
              全关
            </Button>
            <Typography.Text type="secondary">可自动 {countActive(gridMask)} / 168 小时</Typography.Text>
          </Space>
          <WeekActiveGrid
            mask={gridMask}
            onToggleCell={(d, h) => setGridMask((m) => setCell(m, d, h, m[d * 24 + h] !== '1'))}
            onToggleRow={(d) => {
              const allOn = Array.from({ length: 24 }, (_, h) => gridMask[d * 24 + h] === '1').every(Boolean);
              setGridMask((m) => {
                let s = m;
                for (let h = 0; h < 24; h++) s = setCell(s, d, h, !allOn);
                return s;
              });
            }}
            onToggleCol={(h) => {
              const allOn = Array.from({ length: 7 }, (_, d) => gridMask[d * 24 + h] === '1').every(Boolean);
              setGridMask((m) => {
                let s = m;
                for (let d = 0; d < 7; d++) s = setCell(s, d, h, !allOn);
                return s;
              });
            }}
          />
        </Space>
      </Modal>
    </Space>
  );
}
