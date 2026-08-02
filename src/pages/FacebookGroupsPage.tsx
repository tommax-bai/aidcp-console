import { useMemo, useState } from 'react';
import { Alert, App, Button, Card, Empty, Segmented, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { LinkOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { apiGet, apiPatch, apiPost, apiPut } from '../api/client';
import { useDashboardSummary } from '../api/queries';
import { makeAccountNamer } from '../types/accountDisplay';
import type {
  FacebookGroupAccountProgress,
  FacebookGroupAccountScopeFilter,
  FacebookGroupAccountScopeMode,
  FacebookGroupImportResult,
  FacebookGroupMembershipRow,
  FacebookGroupMembershipStatus,
  FacebookGroupTargetFacets,
  FacebookGroupTargetList,
  FacebookGroupTargetListRow,
  FacebookGroupTargetRow,
  FacebookGroupTargetScopeReplaceResult,
} from '../types/api';
import { FacebookGroupImportPanel, type FacebookGroupImportMode } from './FacebookGroupImportPanel';
import { FacebookRegionCommentTemplates } from './FacebookRegionCommentTemplates';
import type { FacebookGroupImportItem } from './facebookGroupImportParser';
import { facebookGroupListPath, GROUP_PAGE_SIZE } from './facebookGroupsQuery';

type StatusFilter = 'all' | 'unassigned' | FacebookGroupMembershipStatus;
type EnabledFilter = 'all' | 'true' | 'false';
type ScopeFilter = 'all' | FacebookGroupAccountScopeFilter;

const STATUS_META: Record<StatusFilter, { text: string; color: string }> = {
  all: { text: '全部', color: 'default' },
  unassigned: { text: '未分配', color: 'default' },
  assigned: { text: '已分配', color: 'blue' },
  joining: { text: '加入中', color: 'geekblue' },
  joined: { text: '已加入', color: 'green' },
  pending: { text: '待审批', color: 'gold' },
  gated: { text: '需审批', color: 'orange' },
  no_button: { text: '无入口', color: 'default' },
  checkpoint: { text: '账号受阻', color: 'volcano' },
  failed: { text: '失败', color: 'red' },
  left: { text: '已离开', color: 'default' },
};

const GATING_META = {
  unknown: { text: '未知', color: 'default' },
  instant: { text: '可直入', color: 'green' },
  gated: { text: '需审批', color: 'orange' },
} as const;

const statusOptions: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'unassigned', label: '未分配' },
  { value: 'assigned', label: '已分配' },
  { value: 'joining', label: '加入中' },
  { value: 'joined', label: '已加入' },
  { value: 'pending', label: '待审批' },
  { value: 'gated', label: '需审批' },
  { value: 'no_button', label: '无入口' },
  { value: 'checkpoint', label: '账号受阻' },
  { value: 'failed', label: '失败' },
  { value: 'left', label: '已离开' },
];

function statusTag(status: StatusFilter | string | null) {
  const key = (status ?? 'unassigned') as StatusFilter;
  const meta = STATUS_META[key] ?? { text: String(status ?? '未分配'), color: 'default' };
  return <Tag color={meta.color}>{meta.text}</Tag>;
}

function timeText(value: string | null) {
  return value ? dayjs(value).format('MM-DD HH:mm') : '—';
}

function groupPath(groupUrl: string) {
  try {
    return new URL(groupUrl).pathname;
  } catch {
    return groupUrl;
  }
}

export function FacebookGroupsPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const summary = useDashboardSummary();
  const nameOf = useMemo(() => makeAccountNamer(summary.data?.accounts ?? []), [summary.data?.accounts]);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [enabled, setEnabled] = useState<EnabledFilter>('all');
  const [region, setRegion] = useState<string | undefined>();
  const [park, setPark] = useState<string | undefined>();
  const [direction, setDirection] = useState<string | undefined>();
  const [accountScopeFilter, setAccountScopeFilter] = useState<ScopeFilter>('all');
  const [accountGroupLabel, setAccountGroupLabel] = useState<string | undefined>();
  const [selectedGroupUrls, setSelectedGroupUrls] = useState<React.Key[]>([]);
  const [scopeDraft, setScopeDraft] = useState<string[]>([]);
  const [scopeModeDraft, setScopeModeDraft] =
    useState<FacebookGroupAccountScopeMode>('restricted');
  const [page, setPage] = useState(1);

  const groups = useQuery({
    queryKey: ['facebook', 'groups', status, enabled, region, park, direction, accountScopeFilter, accountGroupLabel, page],
    queryFn: () => {
      return apiGet<FacebookGroupTargetList>(
        facebookGroupListPath({
          status,
          enabled,
          region,
          park,
          direction,
          ...(accountScopeFilter !== 'all'
            ? { accountScopeMode: accountScopeFilter }
            : {}),
          accountGroupLabel,
          page,
        }),
      );
    },
  });

  const facets = useQuery({
    queryKey: ['facebook', 'groups', 'facets'],
    queryFn: () => apiGet<FacebookGroupTargetFacets>('/api/facebook/groups/facets'),
  });

  const progress = useQuery({
    queryKey: ['facebook', 'groups', 'progress'],
    queryFn: () => apiGet<{ accounts: FacebookGroupAccountProgress[] }>('/api/facebook/groups/progress'),
  });

  const assignments = useQuery({
    queryKey: ['facebook', 'groups', 'assignments'],
    queryFn: () => apiGet<{ assignments: FacebookGroupMembershipRow[] }>('/api/facebook/groups/assignments?limit=100'),
  });

  const invalidateGroups = () => {
    void qc.invalidateQueries({ queryKey: ['facebook', 'groups'] });
  };

  const importGroups = useMutation({
    mutationFn: (input: {
      items: FacebookGroupImportItem[];
      mode: FacebookGroupImportMode;
      accountGroupLabels?: string[];
      accountScopeMode?: FacebookGroupAccountScopeMode;
    }) =>
      apiPost<FacebookGroupImportResult>('/api/facebook/groups/import', {
        items: input.items,
        importBatch: `console-${input.mode}-${dayjs().format('YYYYMMDD-HHmmss')}`,
        ...(input.accountGroupLabels !== undefined ? { accountGroupLabels: input.accountGroupLabels } : {}),
        ...(input.accountScopeMode !== undefined ? { accountScopeMode: input.accountScopeMode } : {}),
      }),
    onSuccess: (res) => {
      message.success(`已导入 ${res.imported} 个，更新 ${res.updated ?? 0} 个，重复 ${res.duplicate} 个，无效 ${res.invalid} 个`);
      setPage(1);
      invalidateGroups();
    },
    onError: () => message.error('导入失败，未写入'),
  });

  const toggleEnabled = useMutation({
    mutationFn: (input: { groupUrl: string; enabled: boolean }) =>
      apiPatch<FacebookGroupTargetRow>('/api/facebook/groups/enabled', input),
    onSuccess: () => invalidateGroups(),
    onError: () => message.error('保存失败，状态未改变'),
  });

  const replaceScopes = useMutation({
    mutationFn: (input: {
      groupUrls: string[];
      accountGroupLabels: string[];
      accountScopeMode: FacebookGroupAccountScopeMode;
    }) =>
      apiPut<FacebookGroupTargetScopeReplaceResult>('/api/facebook/groups/scopes', input),
    onSuccess: (res) => {
      message.success(`已更新 ${res.items.length} 个群组的适用账号分组`);
      setSelectedGroupUrls([]);
      setScopeDraft([]);
      setScopeModeDraft('restricted');
      invalidateGroups();
    },
    onError: () => message.error('适用账号分组保存失败，未改变原配置'),
  });

  const reclaim = useMutation({
    mutationFn: () => apiPost<{ reclaimed: number }>('/api/facebook/groups/reclaim-stale', { ttlMs: 30 * 60_000 }),
    onSuccess: (res) => {
      message.success(`已释放 ${res.reclaimed} 个过期分配`);
      invalidateGroups();
    },
    onError: () => message.error('释放失败'),
  });

  const regionOptions = (facets.data?.regions ?? []).map((item) => ({ value: item.region, label: item.region }));
  const directionOptions = (facets.data?.directions ?? []).map((item) => ({ value: item, label: item }));
  const accountGroupOptions = (facets.data?.accountGroupLabels ?? []).map((item) => ({ value: item, label: item }));
  const parkOptions = region
    ? (facets.data?.regions.find((item) => item.region === region)?.parks ?? []).map((item) => ({ value: item, label: item }))
    : [];

  const columns: ColumnsType<FacebookGroupTargetListRow> = [
    {
      title: '群组',
      dataIndex: 'groupName',
      minWidth: 320,
      render: (_: unknown, row) => {
        const name = row.groupName ?? '待识别群组';
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minWidth: 0 }}>
            <a
              href={row.groupUrl}
              target="_blank"
              rel="noreferrer"
              title={name}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, maxWidth: '100%' }}
            >
              <span style={{ maxWidth: '6em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {name}
              </span>
              <LinkOutlined style={{ flexShrink: 0 }} />
            </a>
            <Typography.Text
              type="secondary"
              copyable={{ text: row.groupUrl }}
              ellipsis={{ tooltip: groupPath(row.groupUrl) }}
              style={{ flex: 1, minWidth: 0 }}
            >
              {groupPath(row.groupUrl)}
            </Typography.Text>
          </div>
        );
      },
    },
    {
      title: '分类',
      dataIndex: 'region',
      minWidth: 220,
      render: (_: unknown, row) => (
        <Space size={[0, 4]} wrap>
          {row.region ? <Tag>{row.region}</Tag> : null}
          {row.park ? <Tag color="blue">{row.park}</Tag> : null}
          {row.direction ? <Tag color="purple">{row.direction}</Tag> : null}
          {!row.region && !row.park && !row.direction ? '—' : null}
        </Space>
      ),
    },
    {
      title: '适用账号分组',
      dataIndex: 'accountGroupLabels',
      minWidth: 190,
      render: (labels: string[], row) =>
        row.accountScopeMode === 'global' ? (
          <Tag color="green">全局分组</Tag>
        ) : labels.length > 0 ? (
          <Space size={[0, 4]} wrap>
            {labels.map((label) => <Tag key={label} color="blue">{label}</Tag>)}
          </Space>
        ) : (
          <Tag color="warning">未设置适用分组</Tag>
        ),
    },
    {
      title: '状态',
      dataIndex: 'membershipStatus',
      width: 100,
      render: (v: FacebookGroupMembershipStatus | null) => statusTag(v),
    },
    {
      title: '加入门槛',
      dataIndex: 'joinGating',
      width: 100,
      render: (v: keyof typeof GATING_META) => {
        const meta = GATING_META[v] ?? { text: v, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '账号',
      dataIndex: 'accountId',
      width: 150,
      render: (v: string | null) => (v ? nameOf(v) : '—'),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 86,
      render: (v: boolean, row) => (
        <Switch
          size="small"
          checked={v}
          loading={toggleEnabled.isPending}
          onChange={(next) => toggleEnabled.mutate({ groupUrl: row.groupUrl, enabled: next })}
        />
      ),
    },
    { title: '加入时间', dataIndex: 'joinedAt', width: 110, render: timeText },
    { title: '最近评论', dataIndex: 'lastCommentedAt', width: 110, render: timeText },
    { title: '评论数', dataIndex: 'commentsTotal', width: 80, render: (n: number) => <span className="tabular-nums">{n}</span> },
    {
      title: '原因',
      dataIndex: 'lastReason',
      width: 160,
      ellipsis: true,
      render: (v: string | null) => v ?? '—',
    },
  ];

  const progressColumns: ColumnsType<FacebookGroupAccountProgress> = [
    { title: '账号', dataIndex: 'accountId', render: (v: string) => nameOf(v) },
    { title: '已加入', dataIndex: 'joined', render: (n: number) => <span className="tabular-nums">{n}</span> },
    { title: '已分配', dataIndex: 'assigned', render: (n: number) => <span className="tabular-nums">{n}</span> },
    { title: '待审批', dataIndex: 'pending', render: (n: number) => <span className="tabular-nums">{n}</span> },
    { title: '需审批', dataIndex: 'gated', render: (n: number) => <span className="tabular-nums">{n}</span> },
    { title: '异常', dataIndex: 'failed', render: (n: number) => <span className="tabular-nums">{n}</span> },
    { title: '最近加入', dataIndex: 'lastJoinedAt', render: timeText },
    { title: '最近评论', dataIndex: 'lastCommentedAt', render: timeText },
  ];

  const assignmentColumns: ColumnsType<FacebookGroupMembershipRow> = [
    { title: '账号', dataIndex: 'accountId', render: (v: string) => nameOf(v) },
    {
      title: '群组',
      dataIndex: 'groupUrl',
      render: (v: string) => (
        <Typography.Text copyable={{ text: v }}>
          {groupPath(v)}
        </Typography.Text>
      ),
    },
    { title: '状态', dataIndex: 'status', width: 100, render: (v: FacebookGroupMembershipStatus) => statusTag(v) },
    { title: '尝试', dataIndex: 'attempts', width: 80, render: (n: number) => <span className="tabular-nums">{n}</span> },
    { title: '最近尝试', dataIndex: 'lastAttemptAt', width: 120, render: timeText },
    { title: '更新时间', dataIndex: 'updatedAt', width: 120, render: timeText },
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card
        size="small"
        title="Facebook 群组"
        extra={
          <Space>
            <Tag>Shadow 未接入</Tag>
            <Button icon={<ReloadOutlined />} onClick={invalidateGroups}>
              刷新
            </Button>
            <Button loading={reclaim.isPending} onClick={() => reclaim.mutate()}>
              释放过期分配
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <FacebookGroupImportPanel
            facets={facets.data}
            facetsLoading={facets.isLoading}
            importing={importGroups.isPending}
            onImport={(items, mode, accountGroupLabels, accountScopeMode) =>
              importGroups
                .mutateAsync({ items, mode, accountGroupLabels, accountScopeMode })
                .then(() => undefined)
            }
          />

          <FacebookRegionCommentTemplates
            regions={facets.data?.regions ?? []}
            regionsLoading={facets.isLoading}
          />

          {(facets.data?.unscopedTargetCount ?? 0) > 0 ? (
            <Alert
              type="warning"
              showIcon
              message={`有 ${facets.data?.unscopedTargetCount ?? 0} 个群组未设置适用账号分组`}
              description="这些群组不会被账号自动加群选中。可在下方勾选群组后批量设置范围。"
            />
          ) : null}

          {(facets.data?.globalTargetCount ?? 0) > 0 ? (
            <Alert
              type="info"
              showIcon
              message={`有 ${facets.data?.globalTargetCount ?? 0} 个全局群组`}
              description="全局群组允许任意 Facebook 账号加入，不依赖账号当前分组。"
            />
          ) : null}

          <Space wrap>
            <Select<StatusFilter>
              aria-label="群组状态筛选"
              value={status}
              options={statusOptions}
              style={{ width: 150 }}
              onChange={(v) => { setStatus(v); setPage(1); setSelectedGroupUrls([]); }}
            />
            <Select<EnabledFilter>
              value={enabled}
              style={{ width: 130 }}
              aria-label="群组启用态筛选"
              onChange={(v) => { setEnabled(v); setPage(1); setSelectedGroupUrls([]); }}
              options={[
                { value: 'all', label: '全部启用态' },
                { value: 'true', label: '仅启用' },
                { value: 'false', label: '仅停用' },
              ]}
            />
            <Select
              allowClear
              aria-label="群组区域筛选"
              showSearch
              value={region}
              options={regionOptions}
              placeholder="全部区域"
              style={{ width: 160 }}
              loading={facets.isLoading}
              onChange={(v) => {
                setRegion(v);
                setPark(undefined);
                setPage(1);
                setSelectedGroupUrls([]);
              }}
            />
            <Select
              allowClear
              aria-label="群组园区筛选"
              showSearch
              value={park}
              options={parkOptions}
              placeholder="全部园区"
              style={{ width: 190 }}
              disabled={!region}
              loading={facets.isLoading}
              onChange={(v) => { setPark(v); setPage(1); setSelectedGroupUrls([]); }}
            />
            <Select
              allowClear
              aria-label="群组方向筛选"
              showSearch
              value={direction}
              options={directionOptions}
              placeholder="全部方向"
              style={{ width: 160 }}
              loading={facets.isLoading}
              onChange={(v) => { setDirection(v); setPage(1); setSelectedGroupUrls([]); }}
            />
            <Select
              aria-label="适用范围模式筛选"
              value={accountScopeFilter}
              options={[
                { value: 'all', label: '全部适用范围' },
                { value: 'global', label: '全局分组' },
                { value: 'restricted', label: '指定账号分组' },
                { value: 'unscoped', label: '未设置适用分组' },
              ]}
              style={{ width: 170 }}
              onChange={(value) => {
                setAccountScopeFilter(value);
                if (value !== 'restricted') setAccountGroupLabel(undefined);
                setPage(1);
                setSelectedGroupUrls([]);
              }}
            />
            <Select
              aria-label="适用账号分组筛选"
              allowClear
              showSearch
              optionFilterProp="label"
              value={accountGroupLabel}
              options={accountGroupOptions}
              placeholder="全部账号分组"
              style={{ width: 190 }}
              loading={facets.isLoading}
              onChange={(v) => {
                setAccountGroupLabel(v);
                if (v) setAccountScopeFilter('restricted');
                setPage(1);
                setSelectedGroupUrls([]);
              }}
            />
          </Space>

          <Space wrap>
            <Typography.Text>已选 {selectedGroupUrls.length} 个群组</Typography.Text>
            <Segmented<FacebookGroupAccountScopeMode>
              aria-label="批量适用范围模式"
              value={scopeModeDraft}
              options={[
                { value: 'restricted', label: '指定账号分组' },
                { value: 'global', label: '全局分组' },
              ]}
              onChange={(value) => {
                setScopeModeDraft(value);
                if (value === 'global') setScopeDraft([]);
              }}
            />
            <Select
              aria-label="批量适用账号分组"
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              value={scopeDraft}
              options={accountGroupOptions}
              placeholder="选择一个或多个账号分组"
              style={{ minWidth: 280 }}
              loading={facets.isLoading}
              disabled={scopeModeDraft === 'global'}
              onChange={setScopeDraft}
            />
            <Button
              type="primary"
              danger={scopeModeDraft === 'restricted' && scopeDraft.length === 0}
              loading={replaceScopes.isPending}
              disabled={selectedGroupUrls.length === 0}
              onClick={() =>
                replaceScopes.mutate({
                  groupUrls: selectedGroupUrls.map(String),
                  accountGroupLabels: scopeModeDraft === 'global' ? [] : scopeDraft,
                  accountScopeMode: scopeModeDraft,
                })
              }
            >
              {scopeModeDraft === 'global'
                ? '设为全局分组'
                : scopeDraft.length === 0
                  ? '清空所选群组范围'
                  : '替换所选群组范围'}
            </Button>
            <Typography.Text type="secondary">
              {scopeModeDraft === 'global'
                ? '全局分组面向任意 Facebook 账号。'
                : '留空并保存会清空范围，群组将不再参与自动加群。'}
            </Typography.Text>
          </Space>

          <Table<FacebookGroupTargetListRow>
            size="small"
            rowKey={(r) => r.groupUrl}
            columns={columns}
            dataSource={groups.data?.items ?? []}
            rowSelection={{
              selectedRowKeys: selectedGroupUrls,
              preserveSelectedRowKeys: false,
              onChange: setSelectedGroupUrls,
            }}
            loading={groups.isLoading}
            locale={{ emptyText: <Empty description="暂无群组" /> }}
            scroll={{ x: 1640 }}
            pagination={{
              current: page,
              pageSize: GROUP_PAGE_SIZE,
              total: groups.data?.total ?? 0,
              showSizeChanger: false,
              onChange: (nextPage) => {
                setPage(nextPage);
                setSelectedGroupUrls([]);
              },
            }}
          />
        </Space>
      </Card>

      <Card size="small" title="账号进度">
        <Table<FacebookGroupAccountProgress>
          size="small"
          rowKey={(r) => r.accountId}
          columns={progressColumns}
          dataSource={progress.data?.accounts ?? []}
          loading={progress.isLoading || summary.isLoading}
          pagination={false}
          locale={{ emptyText: <Empty description="暂无 Facebook 账号" /> }}
        />
      </Card>

      <Card size="small" title="分配视图">
        <Table<FacebookGroupMembershipRow>
          size="small"
          rowKey={(r) => `${r.accountId}:${r.groupUrl}`}
          columns={assignmentColumns}
          dataSource={assignments.data?.assignments ?? []}
          loading={assignments.isLoading || summary.isLoading}
          pagination={false}
          scroll={{ x: 760 }}
          locale={{ emptyText: <Empty description="暂无分配" /> }}
        />
      </Card>
    </Space>
  );
}
