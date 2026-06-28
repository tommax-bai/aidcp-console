import { useState, useMemo } from 'react';
import {
  App,
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiPost } from '../api/client';
import { useAccounts, useCuratedContents, useCuratedFacets } from '../api/queries';
import type { PanelCuratedContent } from '../types/api';
import { accountDisplayName, makeAccountNamer } from '../types/accountDisplay';

const PAGE_SIZE = 20;

/** 账号筛选哨兵：选「全部账号」时不带 accountId（全账号合并视图）。 */
const ALL_ACCOUNTS = '__all__';

/** 计数单元：诚实区分 null（边端未抓到）与 0（真实为零）。 */
function countCell(v: number | null) {
  return v == null ? <Typography.Text type="secondary">未抓到</Typography.Text> : <span>{v}</span>;
}

function timeText(ms: number | null): string {
  return ms == null ? '—' : new Date(ms).toLocaleString();
}

/**
 * 精选内容池管理页（change curated-content-admin-page）。
 * - 默认「全部账号」合并视图（每行带账号列、服务端分页）查看精选创作灵感语料，可在右上切到单个账号。
 * - 治理：删单条（按行账号路由防越权）、一键清空正文壳行（按单账号执行，全账号视图下禁用）；honest-write 回真实条数、非乐观（重取真态）。
 * - 删除仅清当前快照：之后再浏览到且仍达标会重新纳入（准入不查史）——确认文案如实告知，绝不谎称永久移除。
 */
export function CuratedContentPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const accounts = useAccounts();

  // 默认「全部账号」：全账号合并视图，每行带归属账号、删除按行账号路由。可在右上切到单个账号。
  const [accountId, setAccountId] = useState<string>(ALL_ACCOUNTS);
  const [contentType, setContentType] = useState<'note' | 'comment' | undefined>(undefined);
  const [admitReason, setAdmitReason] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<PanelCuratedContent | null>(null);

  const effectiveAccountId = accountId === ALL_ACCOUNTS ? undefined : accountId;
  const allAccountsView = effectiveAccountId === undefined;
  const namer = makeAccountNamer(accounts.data?.accounts ?? []);

  const offset = (page - 1) * PAGE_SIZE;
  const list = useCuratedContents(effectiveAccountId, { contentType, admitReason, limit: PAGE_SIZE, offset });
  const facets = useCuratedFacets(effectiveAccountId);

  // 切账号 / 筛选时回到第一页。
  const resetTo = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const invalidateCurated = () => {
    void qc.invalidateQueries({ queryKey: ['curated'] });
  };

  const del = useMutation({
    // 删除按行账号路由（全账号视图下每行账号不同），account_id 进 query 防越权。
    mutationFn: (row: PanelCuratedContent) =>
      apiDelete<{ deleted: number }>(`/api/curated/contents/${row.id}?accountId=${encodeURIComponent(row.accountId)}`),
    // honest：删 1 才「已删除」；删 0 如实告知已不存在，绝不笼统报成功。
    onSuccess: (res) => {
      if (res.deleted === 1) message.success('已删除（仅清当前快照）');
      else message.info('该行已不存在（可能已被淘汰或他人删除）');
      invalidateCurated();
    },
    onError: () => message.error('删除失败'),
  });

  const clearEmpty = useMutation({
    mutationFn: () => apiPost<{ deleted: number }>(`/api/curated/contents/clear-empty`, { accountId: effectiveAccountId }),
    onSuccess: (res) => {
      message.success(`已清理 ${res.deleted} 条空正文壳行`);
      invalidateCurated();
    },
    onError: () => message.error('清理失败'),
  });

  const accountOptions = [
    { label: '全部账号', value: ALL_ACCOUNTS },
    ...(accounts.data?.accounts ?? []).map((a) => ({
      label: accountDisplayName(a.nickname, a.label, a.accountId),
      value: a.accountId,
    })),
  ];

  const reasonOptions = useMemo(() => {
    const opts = (facets.data?.admitReasons ?? []).map((r) => ({
      label: `${r.admitReason ?? '（无原因）'}（${r.count}）`,
      value: r.admitReason ?? '',
    }));
    return [{ label: '全部原因', value: '' }, ...opts];
  }, [facets.data]);

  // 空正文壳行预览数：纳入原因含 content_missing 的行（清理只删正文为空的行）。
  const emptyShellEstimate = useMemo(
    () =>
      (facets.data?.admitReasons ?? [])
        .filter((r) => (r.admitReason ?? '').includes('content_missing'))
        .reduce((sum, r) => sum + r.count, 0),
    [facets.data],
  );

  // 全账号视图下前置「账号」列，标明每行精选归属（单账号视图不显示）。
  const accountColumn: ColumnsType<PanelCuratedContent>[number] = {
    title: '账号',
    dataIndex: 'accountId',
    width: 130,
    render: (id: string) => <span>{namer(id)}</span>,
  };

  const columns: ColumnsType<PanelCuratedContent> = [
    {
      title: '类型',
      dataIndex: 'contentType',
      width: 70,
      render: (v: string) => <Tag color={v === 'comment' ? 'purple' : 'blue'}>{v === 'comment' ? '评论' : '笔记'}</Tag>,
    },
    { title: '标题', dataIndex: 'title', width: 160, render: (v: string | null) => v ?? <Typography.Text type="secondary">—</Typography.Text> },
    {
      title: '正文',
      dataIndex: 'body',
      render: (v: string | null) =>
        v ? (
          <Typography.Text style={{ maxWidth: 320 }} ellipsis={{ tooltip: v }}>
            {v}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">空（壳行）</Typography.Text>
        ),
    },
    { title: '作者', dataIndex: 'author', width: 110, render: (v: string | null) => v ?? <Typography.Text type="secondary">—</Typography.Text> },
    { title: '赞', dataIndex: 'likeCount', width: 70, render: countCell },
    { title: '藏', dataIndex: 'collectCount', width: 70, render: countCell },
    { title: '评', dataIndex: 'commentCount', width: 70, render: countCell },
    {
      title: '机器人动作',
      key: 'marks',
      width: 130,
      render: (_, row) => (
        <Space size={4}>
          {row.botCollected ? <Tag color="gold">已收藏</Tag> : null}
          {row.botLiked ? <Tag color="magenta">已点赞</Tag> : null}
          {!row.botCollected && !row.botLiked ? <Typography.Text type="secondary">—</Typography.Text> : null}
        </Space>
      ),
    },
    { title: '纳入原因', dataIndex: 'admitReason', width: 150, render: (v: string | null) => v ?? <Typography.Text type="secondary">—</Typography.Text> },
    { title: '更新时刻', dataIndex: 'updatedAt', width: 170, render: (v: number) => timeText(v) },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_, row) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => setViewing(row)}>
            查看
          </Button>
          <Popconfirm
            title="删除这条精选灵感？"
            description="仅清当前快照：之后再浏览到且仍达标会重新纳入，历史点赞/收藏标记不恢复；删后不再进入下次发帖创作素材。"
            okText="删除"
            okButtonProps={{ danger: true }}
            onConfirm={() => del.mutate(row)}
          >
            <Button size="small" type="link" danger loading={del.isPending}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <Alert
        type="info"
        showIcon
        message="精选内容池为发帖创作的正向素材来源；表内为第三方笔记/评论内容，仅供创作参考，每账号保留上限 1000 条。"
      />

      <Card
        size="small"
        title="精选内容池"
        extra={
          <Space wrap>
            <Select
              size="small"
              style={{ width: 180 }}
              placeholder="选择账号"
              value={accountId}
              onChange={(v) => resetTo(() => setAccountId(v))}
              options={accountOptions}
            />
            <Select
              size="small"
              style={{ width: 120 }}
              value={contentType ?? ''}
              onChange={(v) => resetTo(() => setContentType((v || undefined) as 'note' | 'comment' | undefined))}
              options={[
                { label: '全部类型', value: '' },
                { label: '笔记', value: 'note' },
                { label: '评论', value: 'comment' },
              ]}
            />
            <Select
              size="small"
              style={{ width: 200 }}
              value={admitReason ?? ''}
              onChange={(v) => resetTo(() => setAdmitReason(v || undefined))}
              options={reasonOptions}
            />
          </Space>
        }
      >
        {list.data && list.data.items.length > 0 ? (
          <Table
            size="small"
            bordered
            rowKey="id"
            columns={allAccountsView ? [accountColumn, ...columns] : columns}
            dataSource={list.data.items}
            loading={list.isLoading}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total: list.data.total,
              onChange: setPage,
              showSizeChanger: false,
              showTotal: (t) => `共 ${t} 条`,
            }}
          />
        ) : (
          <Empty
            description={
              list.isLoading
                ? '加载中…'
                : list.isError
                  ? '服务不可用'
                  : allAccountsView
                    ? '暂无精选内容'
                    : '该账号暂无精选内容'
            }
          />
        )}
      </Card>

      <Card size="small" title="清理">
        <Space wrap>
          <Popconfirm
            title="清空该账号所有「正文为空的壳行」？"
            description={`将按"正文为空"清理（约 ${emptyShellEstimate} 条），不影响有正文的优质素材；清理后显示真实条数。`}
            okText="清理"
            okButtonProps={{ danger: true }}
            onConfirm={() => clearEmpty.mutate()}
            disabled={allAccountsView}
          >
            <Button size="small" danger loading={clearEmpty.isPending} disabled={allAccountsView}>
              清空正文壳行（约 {emptyShellEstimate} 条）
            </Button>
          </Popconfirm>
          <Typography.Text type="secondary">
            {allAccountsView
              ? '清理按单账号执行，请先在上方切到具体账号再清理。'
              : '壳行＝机器人收藏过但同次访问没抓到正文的行；正文为空、对创作无贡献。按「正文为空」清理，刻意不按纳入原因（避免误删高权重好素材）。'}
          </Typography.Text>
        </Space>
      </Card>

      <Drawer
        title={viewing?.title ?? '精选内容详情'}
        width={560}
        open={!!viewing}
        onClose={() => setViewing(null)}
        extra={
          viewing?.sourceUrl ? (
            <Button type="primary" href={viewing.sourceUrl} target="_blank" rel="noopener noreferrer">
              打开来源
            </Button>
          ) : (
            <Button disabled>无链接</Button>
          )
        }
      >
        {viewing && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="类型">{viewing.contentType === 'comment' ? '评论' : '笔记'}</Descriptions.Item>
            <Descriptions.Item label="作者">
              {viewing.author ?? <Typography.Text type="secondary">—</Typography.Text>}
            </Descriptions.Item>
            <Descriptions.Item label="赞 / 藏 / 评">
              <Space>
                {countCell(viewing.likeCount)} / {countCell(viewing.collectCount)} / {countCell(viewing.commentCount)}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="机器人动作">
              <Space size={4}>
                {viewing.botCollected ? <Tag color="gold">已收藏</Tag> : null}
                {viewing.botLiked ? <Tag color="magenta">已点赞</Tag> : null}
                {!viewing.botCollected && !viewing.botLiked ? <Typography.Text type="secondary">无</Typography.Text> : null}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="纳入原因">
              {viewing.admitReason ?? <Typography.Text type="secondary">—</Typography.Text>}
            </Descriptions.Item>
            <Descriptions.Item label="话题">
              {viewing.topics.length > 0 ? (
                viewing.topics.map((t) => <Tag key={t}>{t}</Tag>)
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="采集时刻">{timeText(viewing.countsCapturedAt)}</Descriptions.Item>
            <Descriptions.Item label="首次纳入">{timeText(viewing.firstSeenAt)}</Descriptions.Item>
            <Descriptions.Item label="更新时刻">{timeText(viewing.updatedAt)}</Descriptions.Item>
            <Descriptions.Item label="正文">
              {viewing.body ? (
                <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                  {viewing.body}
                </Typography.Paragraph>
              ) : (
                <Typography.Text type="secondary">空（壳行）</Typography.Text>
              )}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
}
