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
export function DispatchControl({
  active,
  unknownReason,
}: {
  active: boolean | null;
  /** `active` 为 null 时的具名原因（云端 task 1.3a）。只作展示，MUST NOT 参与任何判定。 */
  unknownReason?: string | null;
}) {
  const { message } = App.useApp();
  const qc = useQueryClient();

  const dispatch = useMutation({
    // retire-default-account：决策引擎是单一全局开关；用保留键 __global__ 下发（云端按 URL 形状匹配、不读账号表，accountId 信息性），绝不用已退役的 default。
    mutationFn: (action: 'start' | 'stop') =>
      apiPost<DispatchResult>('/api/accounts/__global__/dispatch', { action }),
    onSuccess: (res) => {
      const label = res.dispatch === 'started' ? '已启动' : '已停止';
      if (res.changed) message.success(`调度${label} — ${res.edgesOnline} 个边缘端在线`);
      else message.info(`已处于${label} — ${res.edgesOnline} 个边缘端在线`);
      void qc.invalidateQueries({ queryKey: ['dashboard', 'summary'] });
    },
    // 用户 2026-07-31 拍板：按钮在「未知」态下仍可点，**点了失败要给明确提示**。
    // 云端把给人看的文案放在 `error`、机器码放在 `reason`，客户端已把前者收进 `message`。
    // 所以这里直接上屏它，**不要**换成一句固定的「操作失败」——那样运营看不出该去查什么。
    onError: (err: unknown) => {
      const detail = err instanceof Error && err.message ? err.message : '';
      message.error(detail ? `调度下发失败：${detail}` : '调度下发失败（原因未知）');
    },
  });

  const badge =
    active == null ? (
      // 「未知」不等于「已停止」：前者要人去查，后者什么都不用做。原因挂 tooltip 上，
      // 因为光说「未知」对运营没有可操作性——是没接通道、对面没起来，还是令牌不对？
      <Tooltip title={unknownReason ? `读不到调度引擎：${unknownReason}` : '读不到调度引擎'}>
        <Badge status="warning" text="未知" />
      </Tooltip>
    ) : active ? (
      <Badge status="processing" text="调度中" />
    ) : (
      <Badge status="default" text="已停止" />
    );

  return (
    <Space>
      <Tooltip title="全局决策引擎（单一调度器）。按账号调度将随多边缘端拆分一并上线。">
        <Typography.Text type="secondary">决策引擎：</Typography.Text>
      </Tooltip>
      {badge}
      {active ? (
        <Popconfirm
          title="停止决策引擎？浏览将暂停，直至重新启动。"
          onConfirm={() => dispatch.mutate('stop')}
        >
          <Button size="small" danger loading={dispatch.isPending}>
            停止
          </Button>
        </Popconfirm>
      ) : (
        <Button size="small" loading={dispatch.isPending} onClick={() => dispatch.mutate('start')}>
          启动
        </Button>
      )}
    </Space>
  );
}
