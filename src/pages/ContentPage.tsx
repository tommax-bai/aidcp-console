import { useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Drawer, Empty, Input, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, apiPut, ApiError } from '../api/client';
import { usePublished, useContentQueue, useAccounts } from '../api/queries';
import { ProfileLink } from '../components';
import type { PanelPublish } from '../types/api';
import { accountDisplayName } from '../types/accountDisplay';

const PUBLISH_STATUS_LABEL: Record<string, string> = {
  published: '已发布',
  failed: '失败',
  pending_approval: '待审',
  needs_review: '已否决',
  draft: '草稿',
};

/** 编辑/审批的可区分拒因 → 说人话文案（change edit-note-draft-before-publish）。 */
function reasonMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    switch (err.message) {
      case 'version_conflict':
        return '内容已被他处修改，请刷新后重试';
      case 'version_stale':
        return '内容已更新，请刷新后重新审批';
      case 'already_decided':
        return '该草稿正在审批处理中，请刷新';
      case 'not_pending':
        return '该草稿已不可编辑（非待审态）';
      case 'not_found':
        return '草稿不存在';
      case 'missing_visibility':
        return '可见范围不能为空';
      case 'invalid_title':
        return '标题不能为空';
      default:
        return fallback;
    }
  }
  return fallback;
}

/** 生命周期标签：待审 / 已编辑待审(琥珀，飞书卡片已失效) / 已发布 / 失败 / 已否决。 */
function lifecycleTag(row: Pick<PanelPublish, 'status' | 'contentVersion'>) {
  if (row.status === 'pending_approval') {
    return row.contentVersion > 0 ? (
      <Tag color="gold">已编辑待审 · v{row.contentVersion}</Tag>
    ) : (
      <Tag color="blue">待审</Tag>
    );
  }
  const color = row.status === 'published' ? 'green' : row.status === 'failed' ? 'red' : 'default';
  return <Tag color={color}>{PUBLISH_STATUS_LABEL[row.status] ?? row.status}</Tag>;
}

function buildColumns(onOpen: (row: PanelPublish) => void): ColumnsType<PanelPublish> {
  return [
    {
      title: '账号',
      dataIndex: 'accountLabel',
      width: 140,
      render: (v: string, row) => (
        <Tag>
          <ProfileLink userId={row.accountId}>{v || row.accountId}</ProfileLink>
        </Tag>
      ),
    },
    { title: '标题', dataIndex: 'title', render: (v: string | null) => v ?? '—' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (_: string, row) => lifecycleTag(row),
    },
    {
      title: '回执',
      dataIndex: 'platformPostId',
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
      width: 100,
      render: (_, row) => (
        <Button size="small" type="link" onClick={() => onOpen(row)}>
          {row.status === 'pending_approval' ? '编辑 / 审批' : '查看'}
        </Button>
      ),
    },
  ];
}

/**
 * 内容管理：in-flight 队列 + 已发布/待审历史 + 待审草稿就地编辑与审批（change edit-note-draft-before-publish）。
 * 待审草稿在抽屉内改标题/正文后「保存并批准」；审批的 requestId 由行 `publish-<id>` 派生（不再手贴）；
 * 授权携带抽屉打开时快照的内容版本号（「审=发」凭证），版本不符由后端拒。
 */
export function ContentPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [accountFilter, setAccountFilter] = useState<string | undefined>(undefined);
  // 抽屉当前打开的记录（含快照 contentVersion）；编辑态本地字段。
  const [viewing, setViewing] = useState<PanelPublish | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  const accounts = useAccounts();
  const published = usePublished(accountFilter);
  const queue = useContentQueue();

  const isEditable = viewing?.status === 'pending_approval';

  const openDrawer = (row: PanelPublish) => {
    setViewing(row);
    setEditTitle(row.title ?? '');
    setEditContent(row.content ?? '');
  };

  const refreshPublished = () => qc.invalidateQueries({ queryKey: ['content', 'published'] });

  // 编辑草稿：就地改标题/正文（乐观 CAS，携带打开时快照版本）。返回写后真态（含自增版本 + 收口后的标题）。
  const editDraft = useMutation({
    mutationFn: (v: { id: number; expectedVersion: number; title: string; content: string }) =>
      apiPut<{ recordId: number; contentVersion: number; title: string | null; content: string }>(
        `/api/publish/${v.id}/draft`,
        { expectedVersion: v.expectedVersion, title: v.title, content: v.content },
      ),
  });

  // 审批（通过/驳回）：requestId 由行派生；授权携带内容版本快照。返回 written/alreadyDecided，绝不 published。
  const approve = useMutation({
    mutationFn: (v: { id: number; approved: boolean; contentVersion: number }) =>
      apiPost<{ written?: boolean; alreadyDecided?: boolean }>(`/api/publish/publish-${v.id}/approve`, {
        approved: v.approved,
        contentVersion: v.contentVersion,
      }),
  });

  const busy = editDraft.isPending || approve.isPending;

  // 保存草稿：改完留待审（回读真态刷新抽屉与列表）。
  const onSaveDraft = async () => {
    if (!viewing) return;
    try {
      const res = await editDraft.mutateAsync({ id: viewing.id, expectedVersion: viewing.contentVersion, title: editTitle, content: editContent });
      setViewing({ ...viewing, title: res.title, content: res.content ?? editContent, contentVersion: res.contentVersion });
      setEditTitle(res.title ?? '');
      setEditContent(res.content ?? editContent);
      refreshPublished();
      if (res.title !== editTitle) message.warning('标题超长已自动截断，请确认');
      else message.success('已保存');
    } catch (err) {
      message.error(reasonMessage(err, '保存失败'));
    }
  };

  // 保存并批准：先编辑，再据「标题是否被截断」决定是否自动批准（截断则中止、要求就截断后版本再确认一次）。
  const onSaveAndApprove = async () => {
    if (!viewing) return;
    let edited: { recordId: number; contentVersion: number; title: string | null; content: string };
    try {
      edited = await editDraft.mutateAsync({ id: viewing.id, expectedVersion: viewing.contentVersion, title: editTitle, content: editContent });
    } catch (err) {
      message.error(reasonMessage(err, '保存失败'));
      return;
    }
    // 回读真态先落抽屉（无论是否继续批准，都用后端真值）。
    setViewing({ ...viewing, title: edited.title, content: edited.content ?? editContent, contentVersion: edited.contentVersion });
    setEditTitle(edited.title ?? '');
    setEditContent(edited.content ?? editContent);
    refreshPublished();
    if (edited.title !== editTitle) {
      // 标题被 clampTitle 收口 → 中止自动批准，要求人就截断后的字节再点一次批准（绝不批前发后）。
      message.warning('标题超长已自动截断，请确认截断后的标题后再点「批准」');
      return;
    }
    try {
      const res = await approve.mutateAsync({ id: edited.recordId, approved: true, contentVersion: edited.contentVersion });
      if (res.written) {
        message.success('已授权发布');
        setViewing(null);
      } else {
        message.info(`已决定：${res.alreadyDecided ? '通过' : '驳回'}`);
      }
      refreshPublished();
    } catch (err) {
      message.error(reasonMessage(err, '审批失败'));
    }
  };

  // 驳回：终态否决（携带版本快照）。
  const onReject = async () => {
    if (!viewing) return;
    try {
      const res = await approve.mutateAsync({ id: viewing.id, approved: false, contentVersion: viewing.contentVersion });
      if (res.written) message.success('已驳回');
      else message.info(`已决定：${res.alreadyDecided ? '通过' : '驳回'}`);
      refreshPublished();
      setViewing(null);
    } catch (err) {
      message.error(reasonMessage(err, '驳回失败'));
    }
  };

  const accountOptions = [
    { label: '全部账号', value: '' },
    ...(accounts.data?.accounts ?? []).map((a) => ({
      label: accountDisplayName(a.nickname, a.label, a.accountId),
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

      <Card
        size="small"
        title="发布内容（待审可编辑 / 已发布历史）"
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
            columns={buildColumns(openDrawer)}
            dataSource={published.data.items}
            loading={published.isLoading}
          />
        ) : (
          <Empty description={published.isLoading ? '加载中…' : '暂无内容'} />
        )}
      </Card>

      <Drawer
        title={isEditable ? '编辑并审批（待审草稿）' : viewing?.title ?? '已发布内容'}
        width={560}
        open={!!viewing}
        onClose={() => setViewing(null)}
        extra={
          !isEditable && viewing?.postUrl ? (
            <Button type="primary" href={viewing.postUrl} target="_blank" rel="noreferrer">
              打开小红书详情页
            </Button>
          ) : !isEditable ? (
            <Button disabled>无链接</Button>
          ) : null
        }
        footer={
          isEditable ? (
            <Space>
              <Button onClick={onSaveDraft} loading={busy}>
                保存草稿
              </Button>
              <Popconfirm title="保存并授权发布此条？" onConfirm={onSaveAndApprove}>
                <Button type="primary" loading={busy}>
                  保存并批准
                </Button>
              </Popconfirm>
              <Popconfirm title="确认驳回此条发布？" onConfirm={onReject}>
                <Button danger loading={busy}>
                  驳回
                </Button>
              </Popconfirm>
            </Space>
          ) : null
        }
      >
        {viewing && isEditable && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {viewing.contentVersion > 0 && (
              <Alert
                type="warning"
                showIcon
                message={`此草稿已在控制台修改（第 ${viewing.contentVersion} 版），原飞书审核卡片已失效，请在此审批`}
              />
            )}
            <div>
              <Typography.Text type="secondary">账号</Typography.Text>
              <div>
                <ProfileLink userId={viewing.accountId}>{viewing.accountLabel || viewing.accountId}</ProfileLink>
              </div>
            </div>
            <div>
              <Typography.Text type="secondary">标题（过长将由服务端自动截断至 18 字素）</Typography.Text>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="标题" />
            </div>
            <div>
              <Typography.Text type="secondary">正文</Typography.Text>
              <Input.TextArea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                autoSize={{ minRows: 8, maxRows: 24 }}
                placeholder="正文"
              />
            </div>
            <Typography.Text type="secondary">
              可见范围 / 话题本期在此不可改（保留原值）；「保存并批准」= 存改动后立即授权，标题被截断则需再确认一次。
            </Typography.Text>
          </Space>
        )}
        {viewing && !isEditable && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="账号">
              <ProfileLink userId={viewing.accountId}>{viewing.accountLabel || viewing.accountId}</ProfileLink>
            </Descriptions.Item>
            <Descriptions.Item label="状态">{lifecycleTag(viewing)}</Descriptions.Item>
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
