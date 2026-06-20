import { App, Button, Card, Popconfirm, Space } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '../api/client';
import { useAccounts } from '../api/queries';
import { AccountsTable, RiskControls } from '../components';
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
      if (v.command === 'resume') message.success(`resumed — ${res.resumedEdges ?? 0} edges`);
      else message.success('paused (durable)');
      void qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: () => message.error('command failed'),
  });

  const actions = (a: PanelAccount) => (
    <Space size={4}>
      {a.operatorStatus === 'paused' ? (
        <Popconfirm
          title={`Resume ${a.accountId}?`}
          onConfirm={() => cmd.mutate({ accountId: a.accountId, command: 'resume' })}
        >
          <Button size="small" loading={cmd.isPending}>
            Resume
          </Button>
        </Popconfirm>
      ) : (
        <Popconfirm
          title={`Pause ${a.accountId}?`}
          onConfirm={() => cmd.mutate({ accountId: a.accountId, command: 'pause' })}
        >
          <Button size="small" danger loading={cmd.isPending}>
            Pause
          </Button>
        </Popconfirm>
      )}
      <RiskControls account={a} />
    </Space>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card size="small" title="Accounts">
        <AccountsTable accounts={data?.accounts ?? []} loading={isLoading} actionsColumn={actions} />
      </Card>
    </div>
  );
}
