import { useMemo, useState } from 'react';
import { App, Card, Empty, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useSearchParams } from 'react-router-dom';
import {
  useEnvironments,
  useSetEnvironmentCommentApproval,
} from '../api/queries';
import { errorText } from '../api/errorText';
import { FacebookOperationPolicyEditor } from '../components/FacebookOperationPolicyEditor';
import { QueryError } from '../components/QueryGate';
import { QuotaTierBadge } from '../components/QuotaTierBadge';
import { RiskStatusBadge } from '../components/RiskStatusBadge';
import type {
  AccountCommentApprovalMode,
  EnvironmentAssetView,
  EnvironmentLifecycleState,
} from '../types/api';
import { labelOf, RISK_STATUS_LABEL } from '../types/aidcp-enums';

const PLATFORM_META: Record<string, { text: string; color: string }> = {
  xiaohongshu: { text: '小红书', color: 'magenta' },
  facebook: { text: 'Facebook', color: 'blue' },
  wechat_channels: { text: '视频号', color: 'green' },
};

export const ENVIRONMENT_LIFECYCLE_META: Record<EnvironmentLifecycleState, { text: string; color?: string }> = {
  active: { text: '正常', color: 'green' },
  waiting_edge: { text: '历史删除请求（已停止）', color: 'gold' },
  deleting: { text: '历史删除状态（已停止）', color: 'gold' },
  delete_failed: { text: '历史删除失败', color: 'red' },
  deleted: { text: '已删除' },
};

type LifecycleFilter = 'current' | 'all' | EnvironmentLifecycleState;

export interface EnvironmentAssetFilters {
  lifecycle: LifecycleFilter;
  platform: string;
  account: string;
  risk: string;
  group: string;
  assignee: string;
}

export function filterEnvironmentAssets(
  environments: EnvironmentAssetView[], filters: EnvironmentAssetFilters,
) {
  return environments.filter((environment) => {
    if (filters.lifecycle === 'current' && environment.lifecycle.state === 'deleted') return false;
    if (filters.lifecycle !== 'current' && filters.lifecycle !== 'all'
      && environment.lifecycle.state !== filters.lifecycle) return false;
    if (filters.platform !== 'all' && environment.platform !== filters.platform) return false;
    if (filters.account === '__unbound__' && environment.account) return false;
    if (filters.account !== 'all' && filters.account !== '__unbound__'
      && environment.account?.accountId !== filters.account) return false;
    if (filters.risk === '__unknown__' && environment.account?.riskStatus) return false;
    if (filters.risk !== 'all' && filters.risk !== '__unknown__'
      && environment.account?.riskStatus !== filters.risk) return false;
    if (filters.group === '__ungrouped__' && environment.account?.groupLabel) return false;
    if (filters.group !== 'all' && filters.group !== '__ungrouped__'
      && environment.account?.groupLabel !== filters.group) return false;
    if (filters.assignee === '__unassigned__' && environment.assignees.length) return false;
    if (filters.assignee !== 'all' && filters.assignee !== '__unassigned__'
      && !environment.assignees.some((assignee) => assignee.userId === filters.assignee)) return false;
    return true;
  });
}

function lifecycleTag(environment: EnvironmentAssetView) {
  const meta = ENVIRONMENT_LIFECYCLE_META[environment.lifecycle.state]
    ?? { text: environment.lifecycle.state };
  const tag = environment.lifecycle.resultError
    ? <Tooltip title={environment.lifecycle.resultError}><Tag color={meta.color}>{meta.text}</Tag></Tooltip>
    : <Tag color={meta.color}>{meta.text}</Tag>;
  if (!environment.lifecycle.requestId) return tag;
  return (
    <Space direction="vertical" size={0}>
      {tag}
      {environment.lifecycle.state === 'deleted' ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {environment.lifecycle.resultKind === 'already_missing' ? '历史结果：AdsPower 已不存在' : '历史结果：AdsPower 已删除'}
          {' · '}{fmtTime(environment.lifecycle.resultAt ?? environment.lifecycle.deletedAt)}
        </Typography.Text>
      ) : null}
      {environment.lifecycle.requestedBy ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          操作者：{environment.lifecycle.requestedBy}
        </Typography.Text>
      ) : null}
    </Space>
  );
}

function platformTag(platform: string | null) {
  if (!platform) return <Typography.Text type="secondary">—</Typography.Text>;
  const meta = PLATFORM_META[platform];
  return <Tag color={meta?.color}>{meta?.text ?? platform}</Tag>;
}

function fmtTime(value: number | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

export function EnvironmentsPage() {
  const { message } = App.useApp();
  const [params] = useSearchParams();
  const query = useEnvironments();
  const setCommentApproval = useSetEnvironmentCommentApproval();
  const linkedAccount = params.get('account')?.trim() ?? '';
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>('current');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState(linkedAccount || 'all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');

  const rows = useMemo(() => {
    const all = query.data?.environments ?? [];
    return filterEnvironmentAssets(all, {
      lifecycle: lifecycleFilter,
      platform: platformFilter,
      account: accountFilter,
      risk: riskFilter,
      group: groupFilter,
      assignee: assigneeFilter,
    });
  }, [accountFilter, assigneeFilter, groupFilter, lifecycleFilter, platformFilter, query.data, riskFilter]);

  const filterOptions = useMemo(() => {
    const all = query.data?.environments ?? [];
    const unique = (values: Array<string | null | undefined>) => [...new Set(values.filter((value): value is string => !!value))]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return {
      platforms: unique(all.map((environment) => environment.platform)),
      accounts: unique(all.map((environment) => environment.account?.accountId)),
      risks: unique(all.map((environment) => environment.account?.riskStatus)),
      groups: unique(all.map((environment) => environment.account?.groupLabel)),
      assignees: [...new Map(all.flatMap((environment) => environment.assignees)
        .map((assignee) => [assignee.userId, assignee.name])).entries()]
        .sort((a, b) => a[1].localeCompare(b[1], 'zh-CN')),
    };
  }, [query.data]);

  const columns: ColumnsType<EnvironmentAssetView> = [
    {
      title: '环境', key: 'environment', width: 220,
      render: (_, environment) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{environment.environmentName}</Typography.Text>
          <Typography.Text type="secondary" copyable>{environment.envKey}</Typography.Text>
        </Space>
      ),
    },
    { title: '平台', dataIndex: 'platform', width: 100, render: platformTag },
    {
      title: '挂载账号', key: 'account', width: 210,
      render: (_, environment) => environment.account ? (
        <Space direction="vertical" size={0}>
          <Typography.Text>{environment.account.displayName}</Typography.Text>
          <Typography.Text type="secondary" ellipsis={{ tooltip: environment.account.accountId }}>
            {environment.account.accountId}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {environment.bindingObservedAt ? `上次确认挂载：${fmtTime(environment.bindingObservedAt)}` : '挂载确认时间未知'}
          </Typography.Text>
        </Space>
      ) : <Typography.Text type="secondary">未挂载</Typography.Text>,
    },
    {
      title: '风控', key: 'risk', width: 90,
      render: (_, environment) => environment.account?.riskStatus
        ? <RiskStatusBadge status={environment.account.riskStatus} />
        : <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '档位', key: 'quota', width: 90,
      render: (_, environment) => environment.account?.riskQuotaLevel
        ? <QuotaTierBadge tier={environment.account.riskQuotaLevel} />
        : <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '所属分组', key: 'group', width: 120,
      render: (_, environment) => environment.account?.groupLabel ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '端用户', key: 'assignee', width: 140,
      render: (_, environment) => environment.assignees.length
        ? environment.assignees.map((assignee) => <Tag key={assignee.userId}>{assignee.name}</Tag>)
        : <Typography.Text type="secondary">未分配</Typography.Text>,
    },
    {
      title: '客户端', key: 'installation', width: 128,
      render: (_, environment) => environment.installation ? (
        <Tooltip title={`最后观测：${fmtTime(environment.installation.lastSeenAt)}`}>
          <Tag color={environment.installation.online ? 'green' : undefined}>
            {environment.installation.online ? '在线' : '离线'}
          </Tag>
        </Tooltip>
      ) : <Tag>未观测</Tag>,
    },
    {
      title: 'Facebook 运行策略', key: 'facebookOperationPolicy', width: 350,
      render: (_, environment) => {
        if (environment.platform !== 'facebook') {
          return <Typography.Text type="secondary">不适用</Typography.Text>;
        }
        if (environment.lifecycle.state !== 'active') {
          return <Typography.Text type="secondary">当前状态不可操作</Typography.Text>;
        }
        return <FacebookOperationPolicyEditor envKey={environment.envKey} />;
      },
    },
    {
      title: '评论审批', key: 'commentApproval', width: 230,
      render: (_, environment) => {
        if (environment.lifecycle.state !== 'active') {
          return <Typography.Text type="secondary">当前状态不可操作</Typography.Text>;
        }
        const policy = environment.commentApproval;
        if (!policy || policy.envKey !== environment.envKey) {
          return <Tag color="gold">状态未知</Tag>;
        }
        const pending = setCommentApproval.isPending
          && setCommentApproval.variables?.envKey === environment.envKey;
        const hasCurrentExecutor = policy.boundAccountId != null
          && policy.boundAccountId === environment.account?.accountId;
        return (
          <Space direction="vertical" size={0}>
            <Select<AccountCommentApprovalMode>
              aria-label={`评论审批 ${environment.envKey}`}
              size="small"
              style={{ width: 142 }}
              value={policy.mode}
              loading={pending}
              disabled={setCommentApproval.isPending}
              options={[
                { value: 'source_rules', label: '按来源规则' },
                { value: 'auto_approve_all', label: '全局免审' },
              ]}
              onChange={(mode) => {
                setCommentApproval.mutate(
                  { envKey: environment.envKey, mode },
                  {
                    onSuccess: () => message.success(
                      mode === 'auto_approve_all' ? '环境全局免审已开启' : '环境已恢复按来源规则审批',
                    ),
                    onError: (error) => message.error(errorText(error, '环境评论审批保存失败，原配置未改变')),
                  },
                );
              }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {hasCurrentExecutor
                ? `作用于环境，由当前挂载账号 ${environment.account!.displayName} 执行`
                : `${policy.configured ? '已保存，' : ''}当前没有执行对象`}
            </Typography.Text>
          </Space>
        );
      },
    },
    { title: '状态', key: 'lifecycle', width: 150, render: (_, environment) => lifecycleTag(environment) },
  ];

  if (query.isError) return <QueryError title="加载环境列表失败" onRetry={() => query.refetch()} />;
  return (
    <div className="page-stack">
      <Card
        size="small"
        title={linkedAccount ? '环境（来自账号页）' : '环境'}
        extra={<Typography.Text type="secondary">环境资产、Facebook 运行策略与评论审批</Typography.Text>}
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            aria-label="生命周期筛选"
            value={lifecycleFilter}
            onChange={setLifecycleFilter}
            style={{ width: 160 }}
            options={[
              { value: 'current', label: '当前环境（不含已删除）' },
              { value: 'all', label: '全部生命周期' },
              ...Object.entries(ENVIRONMENT_LIFECYCLE_META).map(([value, meta]) => ({ value, label: meta.text })),
            ]}
          />
          <Select
            aria-label="平台筛选"
            value={platformFilter}
            onChange={setPlatformFilter}
            style={{ width: 130 }}
            options={[{ value: 'all', label: '全部平台' }, ...filterOptions.platforms.map((value) => ({
              value, label: PLATFORM_META[value]?.text ?? value,
            }))]}
          />
          <Select
            aria-label="账号筛选"
            value={accountFilter}
            onChange={setAccountFilter}
            style={{ width: 190 }}
            showSearch
            optionFilterProp="label"
            options={[
              { value: 'all', label: '全部挂载账号' },
              { value: '__unbound__', label: '未挂载账号' },
              ...filterOptions.accounts.map((value) => ({ value, label: value })),
            ]}
          />
          <Select
            aria-label="风控筛选"
            value={riskFilter}
            onChange={setRiskFilter}
            style={{ width: 130 }}
            options={[
              { value: 'all', label: '全部风控状态' },
              { value: '__unknown__', label: '风控未知' },
              ...filterOptions.risks.map((value) => ({
                value, label: labelOf(RISK_STATUS_LABEL, value),
              })),
            ]}
          />
          <Select
            aria-label="分组筛选"
            value={groupFilter}
            onChange={setGroupFilter}
            style={{ width: 150 }}
            options={[
              { value: 'all', label: '全部分组' },
              { value: '__ungrouped__', label: '未分组' },
              ...filterOptions.groups.map((value) => ({ value, label: value })),
            ]}
          />
          <Select
            aria-label="端用户筛选"
            value={assigneeFilter}
            onChange={setAssigneeFilter}
            style={{ width: 150 }}
            options={[
              { value: 'all', label: '全部端用户' },
              { value: '__unassigned__', label: '未分配' },
              ...filterOptions.assignees.map(([value, label]) => ({ value, label })),
            ]}
          />
        </Space>
        <Table
          rowKey="envKey"
          columns={columns}
          dataSource={rows}
          loading={query.isLoading}
          scroll={{ x: 1900 }}
          locale={{ emptyText: <Empty description="当前筛选下没有环境" /> }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
        />
      </Card>
    </div>
  );
}
