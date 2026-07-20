import { useMemo, useState } from 'react';
import { Alert, App, Button, Card, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ensureReplyConfigScope,
  listReplyConfigScopes,
} from '../api/interactionReplyConfig';
import { useAccounts } from '../api/queries';
import { WechatChannelsReplySettings } from '../components';
import { QueryError } from '../components/QueryGate';
import type { PanelAccount } from '../types/api';
import type {
  ReplyConfigScopeSummary,
  ReplyConfigSource,
} from '../types/interactionReplyConfig';

function sourceKey(source: ReplyConfigSource): string {
  return source.type === 'default' ? 'default' : `group:${source.groupLabel ?? ''}`;
}

function sourceLabel(source: ReplyConfigSource): string {
  return source.type === 'default' ? '默认策略（未分组账号）' : `分组：${source.groupLabel}`;
}

function statusTag(scope: ReplyConfigScopeSummary) {
  if (scope.publishedVersion !== null) return <Tag color="green">已发布 v{scope.publishedVersion}</Tag>;
  if (scope.draftVersion !== null) return <Tag color="gold">仅草稿 v{scope.draftVersion}</Tag>;
  return <Tag>未配置</Tag>;
}

export function WechatStrategiesPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const accountsQuery = useAccounts();
  const scopesQuery = useQuery({
    queryKey: ['wechat-reply-config-scopes'],
    queryFn: ({ signal }) => listReplyConfigScopes(signal),
  });
  const [selectedScope, setSelectedScope] = useState<ReplyConfigScopeSummary | null>(null);

  const accounts = useMemo(
    () => (accountsQuery.data?.accounts ?? []).filter((item) => item.platform === 'wechat_channels'),
    [accountsQuery.data?.accounts],
  );
  const scopes = scopesQuery.data?.data.items ?? [];

  const ensureMutation = useMutation({
    mutationFn: (source: ReplyConfigSource) => ensureReplyConfigScope(source),
    onSuccess: (head) => {
      setSelectedScope(head);
      void queryClient.invalidateQueries({ queryKey: ['wechat-reply-config-scopes'] });
    },
    onError: () => message.error('策略作用域创建失败，未打开编辑器'),
  });

  const openScope = (scope: ReplyConfigScopeSummary) => {
    if (scope.scopeId) setSelectedScope(scope);
    else ensureMutation.mutate(scope.source);
  };

  const representativeAccount: PanelAccount | null = selectedScope
    ? accounts.find((item) => selectedScope.source.type === 'default'
      ? item.groupLabel === null
      : item.groupLabel === selectedScope.source.groupLabel) ?? null
    : null;

  const columns: ColumnsType<ReplyConfigScopeSummary> = [
    {
      title: '策略作用域',
      key: 'source',
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{sourceLabel(row.source)}</Typography.Text>
          <Typography.Text type="secondary">
            {row.source.type === 'default' ? '只覆盖 groupLabel 为空的账号' : '按分组名称精确匹配'}
          </Typography.Text>
        </Space>
      ),
    },
    { title: '覆盖账号', dataIndex: 'memberCount', width: 100, render: (value: number) => `${value} 个` },
    { title: '状态', key: 'status', width: 150, render: (_, row) => statusTag(row) },
    {
      title: '最后修改',
      key: 'updated',
      width: 180,
      render: (_, row) => row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—',
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_, row) => (
        <Button size="small" type={row.scopeId ? 'default' : 'primary'} loading={ensureMutation.isPending} onClick={() => openScope(row)}>
          {row.scopeId ? '编辑策略' : '创建策略'}
        </Button>
      ),
    },
  ];

  if (scopesQuery.isError || accountsQuery.isError) {
    return <QueryError title="视频号策略加载失败" onRetry={() => { void scopesQuery.refetch(); void accountsQuery.refetch(); }} />;
  }

  return (
    <div className="page-stack">
      <Alert
        type="info"
        showIcon
        message="视频号回复策略已按账号分组统一配置"
        description="有分组的账号只读取同名分组策略；没有分组的账号读取唯一默认策略。分组策略缺失时会停止生成/发送，不会借用默认策略。账号读取、发送总闸、熔断和风险状态仍在账号页独立管理。"
      />

      <Card size="small" title="视频号策略">
        <Table
          rowKey={(row) => row.scopeId ?? sourceKey(row.source)}
          columns={columns}
          dataSource={scopes}
          loading={scopesQuery.isLoading || accountsQuery.isLoading}
          pagination={false}
        />
      </Card>

      <WechatChannelsReplySettings
        account={null}
        scope={selectedScope}
        previewAccount={representativeAccount}
        open={selectedScope !== null}
        onClose={() => {
          setSelectedScope(null);
          void queryClient.invalidateQueries({ queryKey: ['wechat-reply-config-scopes'] });
        }}
      />
    </div>
  );
}
