import { App, Button, Card, Popconfirm, Space } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '../api/client';
import { useAccounts } from '../api/queries';
import { AccountsTable, RiskControls } from '../components';
import { accountName } from '../types/accountDisplay';
import type { PanelAccount } from '../types/api';

/** 账号列表（design PAGE 4a）+ pause/resume 写操作（非乐观、诚实文案）。 */
export function AccountsPage() {
  const { data, isLoading } = useAccounts();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const cmd = useMutation({
    mutationFn: (v: { accountId: string; command: 'pause' | 'resume' }) =>
      apiPost<{ status: string; resumedEdges?: number }>(`/api/accounts/${v.accountId}/command`, {
        command: v.command,
      }),
    // 非乐观：round-trip 后才显示真态；诚实文案（resume 带真实恢复 edge 数）
    onSuccess: (res, v) => {
      if (v.command === 'resume') message.success(`已恢复 — 恢复 ${res.resumedEdges ?? 0} 个边缘端`);
      else message.success('已暂停（已持久化）');
      void qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: () => message.error('调度下发失败'),
  });

  const actions = (a: PanelAccount) => (
    <Space size={4}>
      {a.operatorStatus === 'paused' ? (
        <Popconfirm
          title={`确认恢复账号 ${accountName(a)}？`}
          onConfirm={() => cmd.mutate({ accountId: a.accountId, command: 'resume' })}
        >
          <Button size="small" loading={cmd.isPending}>
            恢复
          </Button>
        </Popconfirm>
      ) : (
        <Popconfirm
          title={`确认暂停账号 ${accountName(a)}？`}
          onConfirm={() => cmd.mutate({ accountId: a.accountId, command: 'pause' })}
        >
          <Button size="small" danger loading={cmd.isPending}>
            暂停
          </Button>
        </Popconfirm>
      )}
      <RiskControls account={a} />
    </Space>
  );

  return (
    <div className="page-stack">
      <Card size="small" title="账号">
        <AccountsTable accounts={data?.accounts ?? []} loading={isLoading} actionsColumn={actions} />
      </Card>
    </div>
  );
}
