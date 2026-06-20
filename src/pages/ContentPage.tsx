import { useState } from 'react';
import { App, Button, Card, Empty, Input, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation } from '@tanstack/react-query';
import { apiPost } from '../api/client';
import { usePublished, useContentQueue } from '../api/queries';
import type { PanelPublish } from '../types/api';

const columns: ColumnsType<PanelPublish> = [
  { title: 'Title', dataIndex: 'title', render: (v: string | null) => v ?? '—' },
  {
    title: 'Status',
    dataIndex: 'status',
    render: (v: string) => (
      <Tag color={v === 'published' ? 'green' : v === 'failed' ? 'red' : 'default'}>{v}</Tag>
    ),
  },
  {
    title: 'Receipt',
    dataIndex: 'platformPostId',
    // 诚实回执：published 但无 platform_post_id → 'no receipt'，绝不恒显 ok（design 修正）
    render: (v: string | null) =>
      v ? <Typography.Link>{v}</Typography.Link> : <Typography.Text type="secondary">no receipt</Typography.Text>,
  },
  {
    title: 'Published at',
    dataIndex: 'publishedAt',
    render: (v: number) => new Date(v).toLocaleString(),
  },
];

/** 内容管理（design PAGE 5）：in-flight 队列 + 审批 approve/reject + 已发布历史。 */
export function ContentPage() {
  const published = usePublished();
  const queue = useContentQueue();
  const { message } = App.useApp();
  const [requestId, setRequestId] = useState('');

  const approve = useMutation({
    mutationFn: (v: { requestId: string; approved: boolean }) =>
      apiPost<{ written?: boolean; alreadyDecided?: boolean }>(`/api/publish/${v.requestId}/approve`, {
        approved: v.approved,
      }),
    // 诚实文案：written / already decided（first-writer-wins），**绝不 published**
    onSuccess: (res) => {
      if (res.written) message.success('written');
      else message.info(`already decided: ${res.alreadyDecided ? 'approved' : 'rejected'}`);
    },
    onError: () => message.error('approval failed'),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card size="small" title="In-flight publish queue">
        <Typography.Text>
          status: <Tag>{queue.data?.status ?? '—'}</Tag>
        </Typography.Text>
      </Card>

      <Card size="small" title="审批 approve / reject（非乐观，written / already-decided 文案）">
        <Space wrap>
          <Input
            size="small"
            placeholder="requestId"
            value={requestId}
            onChange={(e) => setRequestId(e.target.value)}
            style={{ width: 280 }}
            allowClear
          />
          <Popconfirm
            title="Approve this publish?"
            onConfirm={() => approve.mutate({ requestId, approved: true })}
            disabled={!requestId}
          >
            <Button size="small" type="primary" loading={approve.isPending} disabled={!requestId}>
              Approve
            </Button>
          </Popconfirm>
          <Popconfirm
            title="Reject this publish?"
            onConfirm={() => approve.mutate({ requestId, approved: false })}
            disabled={!requestId}
          >
            <Button size="small" danger loading={approve.isPending} disabled={!requestId}>
              Reject
            </Button>
          </Popconfirm>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          first-writer-wins：二次决定返回 already decided、绝不覆盖。pending requestId 自动来源待 V1 接 queue snapshot。
        </Typography.Paragraph>
      </Card>

      <Card size="small" title="Published history">
        {published.data && published.data.items.length > 0 ? (
          <Table
            size="small"
            bordered
            rowKey="id"
            pagination={false}
            columns={columns}
            dataSource={published.data.items}
            loading={published.isLoading}
          />
        ) : (
          <Empty description={published.isLoading ? 'loading…' : 'no published notes yet'} />
        )}
      </Card>
    </div>
  );
}
