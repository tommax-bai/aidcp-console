import { useMemo, useState } from 'react';
import { App, Button, Card, Empty, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { LinkOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { apiGet, apiPatch, apiPost } from '../api/client';
import { useDashboardSummary } from '../api/queries';
import { makeAccountNamer } from '../types/accountDisplay';
import type {
  FacebookGroupAccountProgress,
  FacebookGroupImportResult,
  FacebookGroupMembershipRow,
  FacebookGroupMembershipStatus,
  FacebookGroupTargetFacets,
  FacebookGroupTargetList,
  FacebookGroupTargetListRow,
  FacebookGroupTargetRow,
} from '../types/api';
import { FacebookGroupImportPanel, type FacebookGroupImportMode } from './FacebookGroupImportPanel';
import type { FacebookGroupImportItem } from './facebookGroupImportParser';
import { facebookGroupListPath } from './facebookGroupsQuery';

type StatusFilter = 'all' | 'unassigned' | FacebookGroupMembershipStatus;
type EnabledFilter = 'all' | 'true' | 'false';

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
  const [page, setPage] = useState(1);

  const groups = useQuery({
    queryKey: ['facebook', 'groups', status, enabled, region, park, direction, page],
    queryFn: () => {
      return apiGet<FacebookGroupTargetList>(facebookGroupListPath({ status, enabled, region, park, direction, page }));
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
    mutationFn: (input: { items: FacebookGroupImportItem[]; mode: FacebookGroupImportMode }) =>
      apiPost<FacebookGroupImportResult>('/api/facebook/groups/import', {
        items: input.items,
        importBatch: `console-${input.mode}-${dayjs().format('YYYYMMDD-HHmmss')}`,
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
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <a
              href={row.groupUrl}
              target="_blank"
              rel="noreferrer"
              title={name}
              style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {name}
              </span>
              <LinkOutlined style={{ flexShrink: 0 }} />
            </a>
            <Typography.Text
              type="secondary"
              copyable={{ text: row.groupUrl }}
              ellipsis={{ tooltip: groupPath(row.groupUrl) }}
              style={{ width: '100%' }}
            >
              {groupPath(row.groupUrl)}
            </Typography.Text>
          </Space>
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
            onImport={(items, mode) => importGroups.mutateAsync({ items, mode }).then(() => undefined)}
          />

          <Space wrap>
            <Select<StatusFilter> value={status} options={statusOptions} style={{ width: 150 }} onChange={(v) => { setStatus(v); setPage(1); }} />
            <Select<EnabledFilter>
              value={enabled}
              style={{ width: 130 }}
              onChange={(v) => { setEnabled(v); setPage(1); }}
              options={[
                { value: 'all', label: '全部启用态' },
                { value: 'true', label: '仅启用' },
                { value: 'false', label: '仅停用' },
              ]}
            />
            <Select
              allowClear
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
              }}
            />
            <Select
              allowClear
              showSearch
              value={park}
              options={parkOptions}
              placeholder="全部园区"
              style={{ width: 190 }}
              disabled={!region}
              loading={facets.isLoading}
              onChange={(v) => { setPark(v); setPage(1); }}
            />
            <Select
              allowClear
              showSearch
              value={direction}
              options={directionOptions}
              placeholder="全部方向"
              style={{ width: 160 }}
              loading={facets.isLoading}
              onChange={(v) => { setDirection(v); setPage(1); }}
            />
          </Space>

          <Table<FacebookGroupTargetListRow>
            size="small"
            rowKey={(r) => r.groupUrl}
            columns={columns}
            dataSource={groups.data?.items ?? []}
            loading={groups.isLoading}
            locale={{ emptyText: <Empty description="暂无群组" /> }}
            scroll={{ x: 1440 }}
            pagination={{
              current: page,
              pageSize: 100,
              total: groups.data?.total ?? 0,
              showSizeChanger: false,
              onChange: setPage,
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
