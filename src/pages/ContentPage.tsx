import { useState } from 'react';
import { App, Button, Card, Descriptions, Drawer, Empty, Input, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation } from '@tanstack/react-query';
import { apiPost } from '../api/client';
import { usePublished, useContentQueue, useAccounts } from '../api/queries';
import type { PanelPublish } from '../types/api';

const PUBLISH_STATUS_LABEL: Record<string, string> = { published: '已发布', failed: '失败' };

function buildColumns(onView: (row: PanelPublish) => void): ColumnsType<PanelPublish> {
  return [
    // 账号列（change publish-history-account-and-detail）：显示展示名（label ?? account_id）。
    {
      title: '账号',
      dataIndex: 'accountLabel',
      width: 140,
      render: (v: string, row) => <Tag>{v || row.accountId}</Tag>,
    },
    { title: '标题', dataIndex: 'title', render: (v: string | null) => v ?? '—' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) => (
        <Tag color={v === 'published' ? 'green' : v === 'failed' ? 'red' : 'default'}>
          {PUBLISH_STATUS_LABEL[v] ?? v}
        </Tag>
      ),
    },
    {
      title: '回执',
      dataIndex: 'platformPostId',
      // 诚实回执：published 但无 platform_post_id → '无回执'，绝不恒显 ok（design 修正）
      render: (v: string | null) =>
        v ? <Typography.Text copyable>{v}</Typography.Text> : <Typography.Text type="secondary">无回执</Typography.Text>,
    },
    {
      title: '发布时间',
      dataIndex: 'publishedAt',
      width: 180,
      render: (v: number) => new Date(v).toLocaleString(),
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_, row) => (
        <Button size="small" type="link" onClick={() => onView(row)}>
          查看
        </Button>
      ),
    },
  ];
}

/** 内容管理（design PAGE 5）：in-flight 队列 + 审批 approve/reject + 已发布历史（按账号 + 查看正文/详情链接）。 */
export function ContentPage() {
  const { message } = App.useApp();
  const [requestId, setRequestId] = useState('');
  // 账号筛选（change publish-history-account-and-detail）：缺省全部账号。
  const [accountFilter, setAccountFilter] = useState<string | undefined>(undefined);
  // 「查看」抽屉：展示完整正文 + 详情页链接。
  const [viewing, setViewing] = useState<PanelPublish | null>(null);

  const accounts = useAccounts();
  const published = usePublished(accountFilter);
  const queue = useContentQueue();

  const approve = useMutation({
    mutationFn: (v: { requestId: string; approved: boolean }) =>
      apiPost<{ written?: boolean; alreadyDecided?: boolean }>(`/api/publish/${v.requestId}/approve`, {
        approved: v.approved,
      }),
    // 诚实文案：已写入 / 已决定（first-writer-wins），**绝不显示已发布**
    onSuccess: (res) => {
      if (res.written) message.success('已写入');
      else message.info(`已决定：${res.alreadyDecided ? '通过' : '驳回'}`);
    },
    onError: () => message.error('审批失败'),
  });

  const accountOptions = [
    { label: '全部账号', value: '' },
    ...(accounts.data?.accounts ?? []).map((a) => ({
      label: a.label ?? a.accountId,
      value: a.accountId,
    })),
  ];

  return (
    <div className="page-stack">
      <Card size="small" title="发布队列（进行中）">
        <Typography.Text>
          状态：<Tag>{queue.data?.status ?? '—'}</Tag>
        </Typography.Text>
      </Card>

      <Card size="small" title="审批 通过 / 驳回（非乐观，已写入 / 已决定 文案）">
        <Space wrap>
          <Input
            size="small"
            placeholder="请求 ID"
            value={requestId}
            onChange={(e) => setRequestId(e.target.value)}
            style={{ width: 280 }}
            allowClear
          />
          <Popconfirm
            title="确认通过此条发布？"
            onConfirm={() => approve.mutate({ requestId, approved: true })}
            disabled={!requestId}
          >
            <Button size="small" type="primary" loading={approve.isPending} disabled={!requestId}>
              通过
            </Button>
          </Popconfirm>
          <Popconfirm
            title="确认驳回此条发布？"
            onConfirm={() => approve.mutate({ requestId, approved: false })}
            disabled={!requestId}
          >
            <Button size="small" danger loading={approve.isPending} disabled={!requestId}>
              驳回
            </Button>
          </Popconfirm>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          首次写入生效：二次决定返回「已决定」、绝不覆盖。待处理请求 ID 自动来源待 V1 接入队列快照。
        </Typography.Paragraph>
      </Card>

      <Card
        size="small"
        title="已发布历史"
        extra={
          <Select
            size="small"
            style={{ width: 180 }}
            value={accountFilter ?? ''}
            onChange={(v) => setAccountFilter(v || undefined)}
            options={accountOptions}
          />
        }
      >
        {published.data && published.data.items.length > 0 ? (
          <Table
            size="small"
            bordered
            rowKey="id"
            pagination={false}
            columns={buildColumns(setViewing)}
            dataSource={published.data.items}
            loading={published.isLoading}
          />
        ) : (
          <Empty description={published.isLoading ? '加载中…' : '暂无已发布内容'} />
        )}
      </Card>

      <Drawer
        title={viewing?.title ?? '已发布内容'}
        width={520}
        open={!!viewing}
        onClose={() => setViewing(null)}
        extra={
          // 详情页链接：postUrl 为空则禁用并标「无链接」，绝不给打不开的坏链。
          viewing?.postUrl ? (
            <Button type="primary" href={viewing.postUrl} target="_blank" rel="noreferrer">
              打开小红书详情页
            </Button>
          ) : (
            <Button disabled>无链接</Button>
          )
        }
      >
        {viewing && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="账号">{viewing.accountLabel || viewing.accountId}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={viewing.status === 'published' ? 'green' : viewing.status === 'failed' ? 'red' : 'default'}>
                {PUBLISH_STATUS_LABEL[viewing.status] ?? viewing.status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="回执">
              {viewing.platformPostId ?? <Typography.Text type="secondary">无回执</Typography.Text>}
            </Descriptions.Item>
            <Descriptions.Item label="发布时间">{new Date(viewing.publishedAt).toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="正文">
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                {viewing.content ?? <Typography.Text type="secondary">无正文</Typography.Text>}
              </Typography.Paragraph>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
}
