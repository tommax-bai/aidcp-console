import { App, Badge, Button, Popconfirm, Space, Tooltip, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '../api/client';
import type { DispatchResult } from '../types/api';

/**
 * 调度引擎启停（V1 task 10.2，接 9.4 的 POST /api/accounts/:id/dispatch）。
 *
 * 诚实边界：当前后端是**单全局 RoleDispatcher**（非 per-edge）——这是一个全局决策引擎开关，
 * 不是按账号的调度（per-edge 多路复用拆分见 design 步骤 8）。故此控件是全局的，
 * 不放进按账号操作列（避免「每行一个按钮却都改全局」的假按账号语义）。
 * 非乐观——round-trip 后才显示真态；回报真实在线 edge 数；no-op 以 changed=false 诚实可辨。
 */
export function DispatchControl({ active }: { active: boolean | null }) {
  const { message } = App.useApp();
  const qc = useQueryClient();

  const dispatch = useMutation({
    // 单账号现实：对保留键 default 下发（accountId 信息性）。
    mutationFn: (action: 'start' | 'stop') =>
      apiPost<DispatchResult>('/api/accounts/default/dispatch', { action }),
    onSuccess: (res) => {
      if (res.changed) message.success(`dispatch ${res.dispatch} — ${res.edgesOnline} edges online`);
      else message.info(`already ${res.dispatch} — ${res.edgesOnline} edges online`);
      void qc.invalidateQueries({ queryKey: ['dashboard', 'summary'] });
    },
    onError: () => message.error('dispatch control failed'),
  });

  const badge =
    active == null ? (
      <Badge status="default" text="unknown" />
    ) : active ? (
      <Badge status="processing" text="dispatching" />
    ) : (
      <Badge status="default" text="stopped" />
    );

  return (
    <Space>
      <Tooltip title="Global decision engine (single dispatcher). Per-account dispatch lands with the per-edge split.">
        <Typography.Text type="secondary">Decision engine:</Typography.Text>
      </Tooltip>
      {badge}
      {active ? (
        <Popconfirm
          title="Stop the decision engine? Browsing halts until restarted."
          onConfirm={() => dispatch.mutate('stop')}
        >
          <Button size="small" danger loading={dispatch.isPending}>
            Stop
          </Button>
        </Popconfirm>
      ) : (
        <Button size="small" loading={dispatch.isPending} onClick={() => dispatch.mutate('start')}>
          Start
        </Button>
      )}
    </Space>
  );
}
