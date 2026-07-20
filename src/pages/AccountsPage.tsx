import { useState } from 'react';
import { App, Button, Card, Popconfirm, Space, Tag, Tooltip } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiPost, apiPut } from '../api/client';
import { loadEffectiveReplyConfig } from '../api/interactionReplyConfig';
import { useAccounts } from '../api/queries';
import { QueryError } from '../components/QueryGate';
import { AccountsTable, RiskControls, FacebookSearchConfig, WechatChannelsReplySettings } from '../components';
import { accountName } from '../types/accountDisplay';
import type { PanelAccount } from '../types/api';

function WechatStrategyActions({ account, onRuntime }: { account: PanelAccount; onRuntime: () => void }) {
  const navigate = useNavigate();
  const effective = useQuery({
    queryKey: ['effective-reply-config', account.accountId],
    queryFn: ({ signal }) => loadEffectiveReplyConfig(account.accountId, signal),
  });
  const data = effective.data?.data;
  const scopedSource = data?.source.type === 'default' ? '默认策略' : data?.source.groupLabel ?? '分组策略';
  const source = data?.mode === 'legacy' ? '账号旧策略' : data?.mode === 'shadow' ? '影子比对' : scopedSource;
  const status = data?.status === 'published' ? '已生效' : data?.status === 'draft_only' ? '仅草稿' : '未配置';
  const detail = data?.reason === 'group_config_missing'
    ? '该账号的分组策略缺失，不会回退默认策略'
    : data?.reason === 'default_config_missing' ? '未分组账号的默认策略缺失' : data?.mode === 'legacy'
      ? `当前仍执行账号旧策略；目标来源为${scopedSource}`
      : data?.mode === 'shadow' ? `当前仍执行账号旧策略；正在与${scopedSource}影子比对` : `${source} · ${status}`;

  return (
    <Space size={4}>
      <Tooltip title={effective.isError ? '策略来源读取失败' : detail}>
        <Tag color={data?.status === 'published' ? 'green' : data?.status === 'draft_only' ? 'gold' : undefined}>
          {effective.isLoading ? '策略读取中' : effective.isError ? '策略未知' : source}
        </Tag>
      </Tooltip>
      <Button size="small" onClick={() => navigate(`/wechat-strategies?accountId=${encodeURIComponent(account.accountId)}`)}>查看策略</Button>
      <Button size="small" onClick={onRuntime}>运行控制</Button>
    </Space>
  );
}

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
      {a.platform === 'facebook' ? <FacebookSearchConfig account={a} /> : null}
      {a.platform === 'wechat_channels' ? (
        <WechatStrategyActions account={a} onRuntime={() => setRuntimeAccount(a)} />
      ) : null}
    </Space>
  );

  if (isError) return <QueryError title="加载账号列表失败" onRetry={() => refetch()} />;

  return (
    <div className="page-stack">
      <Card size="small" title="账号">
        <AccountsTable
          accounts={data?.accounts ?? []}
          loading={isLoading}
          actionsColumn={actions}
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
