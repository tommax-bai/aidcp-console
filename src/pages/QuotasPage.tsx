import { useMemo, useState } from 'react';
import { App, Button, Card, Form, InputNumber, Modal, Skeleton, Table, Tag, Typography, Alert } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPut } from '../api/client';
import { useQuotaConfig } from '../api/queries';
import type { QuotaConfigRow, QuotaConfigCatalog, QuotaTier, QuotaAction } from '../types/api';

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

/**
 * 安全限额配置页（change safety-quota-config，stream D）。
 * - 三档（保守/正常/激进）× 7 动作 × 三窗口（每日/每分钟/每小时）的限额数字后台可改。
 * - 改完即时生效（热加载，无需重启）；库缺行处显示的是派生写死默认（= 当前真生效），保存即写覆盖。
 * - 写非乐观——round-trip 后 invalidate 重取真态；非法数字由服务端整块拒，绝不部分落库。
 * - 不碰风控状态机（normal→warned→restricted→frozen 与档位）——本页只改限额数字。
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

  if (isLoading || !data) {
    return (
      <div className="page-stack">
        <Card size="small" title="安全限额">
          <Skeleton active />
        </Card>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <Card size="small" title="安全限额">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="按档位（保守/正常/激进）× 动作配置每日 / 每分钟 / 每小时三个限额。改完即时生效、无需重启。0=禁止该动作。仅改限额数字，不影响风控状态（封号/限流仍由风控自动判定）。"
        />
        <Table<QuotaConfigRow>
          size="small"
          rowKey={rowKey}
          columns={columns}
          dataSource={rows}
          pagination={false}
        />
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
    </div>
  );
}
