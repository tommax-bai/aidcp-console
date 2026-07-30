import { useState } from 'react';
import { App, Button, Card, Popconfirm, Tag } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, apiPut } from '../api/client';
import { useAccounts } from '../api/queries';
import { QueryError } from '../components/QueryGate';
import {
  AccountsTable,
  FacebookSearchConfig,
  QuotaTierControl,
  RiskStatusControl,
  WechatChannelsReplySettings,
} from '../components';
import { accountName } from '../types/accountDisplay';
import { OPERATOR_STATUS_LABEL, labelOf } from '../types/aidcp-enums';
import type { PanelAccount } from '../types/api';

/** 账号列表（design PAGE 4a）+ pause/resume 写操作（非乐观、诚实文案）。 */
export function AccountsPage() {
  const { data, isLoading, isError, refetch } = useAccounts();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [runtimeAccount, setRuntimeAccount] = useState<PanelAccount | null>(null);

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

  // 分组标签就地编辑（change editable-account-group-label）：非乐观，round-trip 后拉真态；诚实文案。
  const groupCmd = useMutation({
    mutationFn: (v: { accountId: string; groupLabel: string | null }) =>
      apiPut<{ accountId: string; groupLabel: string | null }>(`/api/accounts/${v.accountId}/group-label`, {
        groupLabel: v.groupLabel,
      }),
    onSuccess: (res) => {
      message.success(res.groupLabel ? `已设置分组「${res.groupLabel}」` : '已清除分组');
      void qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: () => message.error('分组保存失败'),
  });

  // 关联联系方式就地编辑（change account-group-chat-injection）：非乐观、verbatim（body 原样透传，不 trim）；诚实文案。
  const contactCmd = useMutation({
    mutationFn: (v: { accountId: string; contactInfo: string | null }) =>
      apiPut<{ accountId: string; contactInfo: string | null }>(`/api/accounts/${v.accountId}/contact-info`, {
        contactInfo: v.contactInfo,
      }),
    onSuccess: (res) => {
      message.success(res.contactInfo ? '已保存关联联系方式' : '已清除关联联系方式');
      void qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: () => message.error('联系方式保存失败'),
  });

  const operatorStatusControl = (account: PanelAccount) => {
    const paused = account.operatorStatus === 'paused';
    return (
      <Popconfirm
        title={`确认${paused ? '恢复' : '暂停'}账号 ${accountName(account)}？`}
        onConfirm={() => cmd.mutate({ accountId: account.accountId, command: paused ? 'resume' : 'pause' })}
      >
        <button
          type="button"
          aria-label={`${paused ? '恢复' : '暂停'}账号 ${accountName(account)}`}
          disabled={cmd.isPending}
          style={{ border: 0, padding: 0, background: 'transparent', cursor: cmd.isPending ? 'wait' : 'pointer' }}
        >
          <Tag color={paused ? undefined : 'green'} style={{ marginInlineEnd: 0 }}>
            {labelOf(OPERATOR_STATUS_LABEL, account.operatorStatus)}
          </Tag>
        </button>
      </Popconfirm>
    );
  };

  if (isError) return <QueryError title="加载账号列表失败" onRetry={() => refetch()} />;

  return (
    <div className="page-stack">
      <Card size="small" title="账号">
        <AccountsTable
          accounts={data?.accounts ?? []}
          loading={isLoading}
          operatorStatusControl={operatorStatusControl}
          riskStatusControl={(account) => <RiskStatusControl account={account} />}
          quotaTierControl={(account) => <QuotaTierControl account={account} />}
          configurationControl={(account) => {
            if (account.platform === 'wechat_channels') {
              return <Button size="small" onClick={() => setRuntimeAccount(account)}>运行控制</Button>;
            }
            if (account.platform === 'facebook') {
              return <FacebookSearchConfig account={account} compactTrigger />;
            }
            return null;
          }}
          onEditGroup={(accountId, groupLabel) => groupCmd.mutate({ accountId, groupLabel })}
          onEditContact={(accountId, contactInfo) => contactCmd.mutate({ accountId, contactInfo })}
        />
      </Card>
      <WechatChannelsReplySettings
        account={runtimeAccount}
        runtimeOnly
        open={runtimeAccount !== null}
        onClose={() => setRuntimeAccount(null)}
      />
    </div>
  );
}
