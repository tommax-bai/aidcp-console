import { useState } from 'react';
import { App, Button, Card, Empty, Input, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation } from '@tanstack/react-query';
import { apiPost } from '../api/client';
import { usePublished, useContentQueue } from '../api/queries';
import type { PanelPublish } from '../types/api';

const PUBLISH_STATUS_LABEL: Record<string, string> = { published: '已发布', failed: '失败' };

const columns: ColumnsType<PanelPublish> = [
  { title: '标题', dataIndex: 'title', render: (v: string | null) => v ?? '—' },
  {
    title: '状态',
    dataIndex: 'status',
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
      v ? <Typography.Link>{v}</Typography.Link> : <Typography.Text type="secondary">无回执</Typography.Text>,
  },
  {
    title: '发布时间',
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
    // 诚实文案：已写入 / 已决定（first-writer-wins），**绝不显示已发布**
    onSuccess: (res) => {
      if (res.written) message.success('已写入');
      else message.info(`已决定：${res.alreadyDecided ? '通过' : '驳回'}`);
    },
    onError: () => message.error('审批失败'),
  });

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

      <Card size="small" title="已发布历史">
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
          <Empty description={published.isLoading ? '加载中…' : '暂无已发布内容'} />
        )}
      </Card>
    </div>
  );
}
