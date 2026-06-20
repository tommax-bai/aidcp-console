import { Card, Empty, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
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

/** 内容管理（design PAGE 5）：in-flight 队列 + 已发布历史。审批写见 task 6.6 / task 4。 */
export function ContentPage() {
  const published = usePublished();
  const queue = useContentQueue();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card size="small" title="In-flight publish queue">
        <Typography.Text>
          status: <Tag>{queue.data?.status ?? '—'}</Tag>
        </Typography.Text>
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
