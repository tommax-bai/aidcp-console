import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  App,
  Avatar,
  Button,
  Card,
  Collapse,
  Descriptions,
  Divider,
  Empty,
  Image,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, apiPut } from '../api/client';
import { errorText } from '../api/errorText';
import { usePublished, useContentQueue, useAccounts } from '../api/queries';
import { ProfileLink } from '../components';
import { QueryError } from '../components/QueryGate';
import type { PanelPublish, PanelPublishSourceReference } from '../types/api';
import { accountDisplayName } from '../types/accountDisplay';

const PUBLISH_STATUS_LABEL: Record<string, string> = {
  published: '已发布',
  failed: '失败',
  pending_approval: '待审',
  needs_review: '已否决',
  draft: '草稿',
};

/**
 * 编辑/审批的可区分拒因 → 说人话文案（change edit-note-draft-before-publish）。
 * 收口于集中映射 errorText（change console-cloud-panel-hardening #31）：保留本函数签名与调用点，
 * 内部委托到统一的错误码→中文映射，不再各页写死 switch。
 */
function reasonMessage(err: unknown, fallback: string): string {
  return errorText(err, fallback);
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

function sourceTitle(ref: PanelPublishSourceReference): string {
  return ref.title || ref.sourceId;
}

function buildColumns(openSource: (ref: PanelPublishSourceReference) => void): ColumnsType<PanelPublish> {
  return [
    {
      title: '账号',
      dataIndex: 'accountLabel',
      width: 140,
      // 账号链接可独立点击（stopPropagation：点昵称跳主页，不触发整行的「打开详情」）。
      render: (v: string, row) => (
        <Tag onClick={(e) => e.stopPropagation()}>
          <ProfileLink userId={row.accountId}>{v || row.accountId}</ProfileLink>
        </Tag>
      ),
    },
    { title: '标题', dataIndex: 'title', render: (v: string | null) => v ?? '—' },
    {
      title: '来源',
      dataIndex: 'sourceReference',
      width: 180,
      render: (ref: PanelPublishSourceReference | null) =>
        ref ? (
          <Button
            size="small"
            type="link"
            onClick={(e) => {
              e.stopPropagation();
              openSource(ref);
            }}
            style={{ padding: 0, maxWidth: 160 }}
          >
            <Space size={4}>
              <Tag color="purple" style={{ marginInlineEnd: 0 }}>洗稿</Tag>
              <Typography.Text ellipsis style={{ maxWidth: 96 }}>
                {sourceTitle(ref)}
              </Typography.Text>
            </Space>
          </Button>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (_: string, row) => lifecycleTag(row),
    },
    {
      title: '发布时间',
      dataIndex: 'publishedAt',
      width: 180,
      render: (v: number) => new Date(v).toLocaleString(),
    },
  ];
}

/** 过期配图占位（灰底斜叉）：历史行存的是生图厂商约 24h 过期的临时签名 URL，加载失败属预期、非故障。 */
const IMG_FALLBACK =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#f0f0f0"/><g stroke="#bfbfbf" stroke-width="2"><line x1="32" y1="32" x2="64" y2="64"/><line x1="64" y1="32" x2="32" y2="64"/></g></svg>',
  );

/** 配图栏（查看/编辑共用）：缩略图 + 点击大图预览；诚实标注「实际附着张数」与死链可能。 */
function ImagesStrip({ row }: { row: PanelPublish }) {
  // 防御旧负载：云端未升级/缓存数据无 images 字段时按无图处理，不白屏。
  const images = row.images ?? [];
  if (images.length === 0) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <Image.PreviewGroup>
        <Space wrap size={8}>
          {images.map((src, i) => (
            <Image
              key={`${row.id}-${i}`}
              src={src}
              alt={`配图 ${i + 1}`}
              width={96}
              height={96}
              style={{ objectFit: 'cover', borderRadius: 8 }}
              fallback={IMG_FALLBACK}
            />
          ))}
        </Space>
      </Image.PreviewGroup>
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          配图 {images.length} 张
          {row.imagesAttachedCount > 0 ? `（发布时实际附着 ${row.imagesAttachedCount} 张）` : ''}
          ；较早记录的图片链接可能已过期，无法加载属正常。
        </Typography.Text>
      </div>
    </div>
  );
}

function SourceReferenceModal({
  source,
  onClose,
}: {
  source: PanelPublishSourceReference | null;
  onClose: () => void;
}) {
  return (
    <Modal open={!!source} onCancel={onClose} footer={null} width={520} title={null}>
      {source && (
        <div>
          <Space align="center" style={{ marginBottom: 12 }}>
            <Avatar style={{ backgroundColor: '#722ed1', verticalAlign: 'middle' }}>
              {(source.author ?? source.title ?? '来').slice(0, 1)}
            </Avatar>
            <div>
              <div style={{ fontWeight: 600 }}>
                {source.author ?? <Typography.Text type="secondary">匿名作者</Typography.Text>}
              </div>
              <Tag color="purple" style={{ marginTop: 2 }}>洗稿来稿</Tag>
            </div>
          </Space>

          {source.title ? (
            <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 8 }}>
              {source.title}
            </Typography.Title>
          ) : (
            <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 8 }}>
              {source.sourceId}
            </Typography.Title>
          )}

          {source.body ? (
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>
              {source.body}
            </Typography.Paragraph>
          ) : (
            <Typography.Paragraph type="secondary">无正文快照</Typography.Paragraph>
          )}

          {source.topics.length > 0 ? (
            <div style={{ marginBottom: 12 }}>
              {source.topics.map((t) => (
                <Tag key={t}>#{t}</Tag>
              ))}
            </div>
          ) : null}

          <Divider style={{ margin: '12px 0' }} />

          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Typography.Text type="secondary">
              源笔记：<Typography.Text copyable>{source.sourceId}</Typography.Text>
            </Typography.Text>
            <Typography.Text type="secondary">快照时间：{new Date(source.capturedAt).toLocaleString()}</Typography.Text>
          </Space>

          <div style={{ marginTop: 16, textAlign: 'right' }}>
            {source.sourceUrl ? (
              <Button type="primary" href={source.sourceUrl} target="_blank" rel="noopener noreferrer">
                打开来源
              </Button>
            ) : (
              <Button disabled>无来源链接</Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * 内容管理：in-flight 队列 + 已发布/待审历史 + 待审草稿就地编辑与审批（change edit-note-draft-before-publish）。
 * 查看/编辑交互对齐精选页（用户 2026-07-04 要求）：整行可点，打开「笔记详情」浮层（简化版小红书详情页：
 * 账号头像行 / 标题 / 正文(pre-wrap) / 配图 / 元信息）；待审草稿在同一布局里就地改标题/正文后「保存并批准」。
 * 审批的 requestId 由行 `publish-<id>` 派生；授权携带浮层打开时快照的内容版本号（「审=发」凭证），版本不符由后端拒。
 */
export function ContentPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  // #17：账号筛选进 URL query（?account=<id>），可分享/刷新保持；空/全部时删除该参数（其它 query 保留）。
  const [searchParams, setSearchParams] = useSearchParams();
  const accountFilter = searchParams.get('account') ?? undefined;
  const setAccountFilter = (id: string | undefined) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('account', id);
    else next.delete('account');
    setSearchParams(next);
  };
  const [pendingOnly, setPendingOnly] = useState(false); // #18：只看待审筛选
  // 浮层当前打开的记录（含快照 contentVersion）；编辑态本地字段。
  const [viewing, setViewing] = useState<PanelPublish | null>(null);
  const [sourceViewing, setSourceViewing] = useState<PanelPublishSourceReference | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  const accounts = useAccounts();
  const published = usePublished(accountFilter);
  const queue = useContentQueue();

  const isEditable = viewing?.status === 'pending_approval';
  const columns = buildColumns(setSourceViewing);

  const openModal = (row: PanelPublish) => {
    setViewing(row);
    setEditTitle(row.title ?? '');
    setEditContent(row.content ?? '');
  };

  const refreshContent = () => {
    void qc.invalidateQueries({ queryKey: ['content', 'published'] });
    void qc.invalidateQueries({ queryKey: ['content', 'queue'] });
  };

  const patchPublishedRow = (id: number, patch: Partial<PanelPublish>) => {
    qc.setQueriesData<{ items: PanelPublish[] }>({ queryKey: ['content', 'published'] }, (old) =>
      old
        ? {
            ...old,
            items: old.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
          }
        : old,
    );
  };

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

  // 保存草稿：改完留待审（回读真态刷新浮层与列表）。
  const onSaveDraft = async () => {
    if (!viewing) return;
    try {
      const res = await editDraft.mutateAsync({ id: viewing.id, expectedVersion: viewing.contentVersion, title: editTitle, content: editContent });
      setViewing({ ...viewing, title: res.title, content: res.content ?? editContent, contentVersion: res.contentVersion });
      setEditTitle(res.title ?? '');
      setEditContent(res.content ?? editContent);
      patchPublishedRow(viewing.id, { title: res.title, content: res.content ?? editContent, contentVersion: res.contentVersion });
      refreshContent();
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
    // 回读真态先落浮层（无论是否继续批准，都用后端真值）。
    setViewing({ ...viewing, title: edited.title, content: edited.content ?? editContent, contentVersion: edited.contentVersion });
    setEditTitle(edited.title ?? '');
    setEditContent(edited.content ?? editContent);
    patchPublishedRow(viewing.id, { title: edited.title, content: edited.content ?? editContent, contentVersion: edited.contentVersion });
    refreshContent();
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
      refreshContent();
    } catch (err) {
      message.error(reasonMessage(err, '审批失败'));
    }
  };

  // 驳回：终态否决（携带版本快照）。
  const onReject = async () => {
    if (!viewing) return;
    try {
      const res = await approve.mutateAsync({ id: viewing.id, approved: false, contentVersion: viewing.contentVersion });
      if (res.written || res.alreadyDecided === false) {
        message.success('已驳回');
        patchPublishedRow(viewing.id, { status: 'needs_review' });
      } else {
        message.info(`已决定：${res.alreadyDecided ? '通过' : '驳回'}`);
      }
      refreshContent();
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
        {/* #18：展开生成管道快照（选题/正文/配图等中间产物），排查卡在哪一阶段，不必翻服务器日志。 */}
        {queue.data?.snapshot != null && typeof queue.data.snapshot === 'object' ? (
          <Collapse
            size="small"
            ghost
            style={{ marginTop: 'var(--aidcp-space-2)' }}
            items={[
              {
                key: 'snapshot',
                label: '生成管道快照',
                children: (
                  <Descriptions size="small" column={1} bordered>
                    {Object.entries(queue.data.snapshot as Record<string, unknown>).map(([k, v]) => (
                      <Descriptions.Item key={k} label={k}>
                        <Typography.Text style={{ fontSize: 12, wordBreak: 'break-all' }}>
                          {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                        </Typography.Text>
                      </Descriptions.Item>
                    ))}
                  </Descriptions>
                ),
              },
            ]}
          />
        ) : null}
      </Card>

      <Card
        size="small"
        title="发布内容（待审可编辑 / 已发布历史）"
        extra={
          <Space>
            <Switch
              size="small"
              checkedChildren="只看待审"
              unCheckedChildren="全部"
              checked={pendingOnly}
              onChange={setPendingOnly}
            />
            <Select
              size="small"
              style={{ width: 180 }}
              value={accountFilter ?? ''}
              onChange={(v) => setAccountFilter(v || undefined)}
              options={accountOptions}
            />
          </Space>
        }
      >
        {published.data && published.data.items.length > 0 ? (
          <Table
            size="small"
            bordered
            rowKey="id"
            pagination={false}
            columns={columns}
            dataSource={
              pendingOnly
                ? published.data.items.filter((it) => it.status === 'pending_approval')
                : published.data.items
            }
            loading={published.isLoading}
            // 整行可点（对齐精选页）：打开「笔记详情」浮层；待审行进入可编辑态。
            onRow={(row) => ({
              onClick: () => openModal(row),
              style: { cursor: 'pointer' },
            })}
          />
        ) : published.isError ? (
          <QueryError title="加载发布内容失败" onRetry={() => published.refetch()} />
        ) : (
          <Empty description={published.isLoading ? '加载中…' : '暂无内容'} />
        )}
      </Card>

      {/* 详情浮层：简化版小红书笔记详情页（对齐精选页布局：账号头像行 / 标题 / 正文 / 配图 / 元信息）。
          待审草稿共用同一布局，标题/正文换成输入框就地编辑，底部给 保存/批准/驳回。 */}
      <Modal
        open={!!viewing}
        onCancel={() => setViewing(null)}
        width={560}
        title={null}
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
        {viewing && (
          <div>
            {/* 账号行（发布方视角=作者行） */}
            <Space align="center" style={{ marginBottom: 12 }}>
              <Avatar style={{ backgroundColor: '#ff2442', verticalAlign: 'middle' }}>
                {(viewing.accountLabel || viewing.accountId).slice(0, 1)}
              </Avatar>
              <div>
                <div style={{ fontWeight: 600 }}>
                  <ProfileLink userId={viewing.accountId}>{viewing.accountLabel || viewing.accountId}</ProfileLink>
                </div>
                <div style={{ marginTop: 2 }}>{lifecycleTag(viewing)}</div>
              </div>
            </Space>

            {viewing.sourceReference ? (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message={
                  <Space wrap>
                    <Typography.Text>洗稿来源：{sourceTitle(viewing.sourceReference)}</Typography.Text>
                    <Button size="small" onClick={() => setSourceViewing(viewing.sourceReference)}>
                      查看来稿件
                    </Button>
                  </Space>
                }
              />
            ) : null}

            {isEditable ? (
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {viewing.contentVersion > 0 && (
                  <Alert
                    type="warning"
                    showIcon
                    message={`此草稿已在控制台修改（第 ${viewing.contentVersion} 版），原飞书审核卡片已失效，请在此审批`}
                  />
                )}
                <div>
                  <Typography.Text type="secondary">标题（过长将由服务端自动截断至 18 字素）</Typography.Text>
                  <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="标题" />
                </div>
                <ImagesStrip row={viewing} />
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
                  可见范围 / 话题 / 配图本期在此不可改（保留原值）；「保存并批准」= 存改动后立即授权，标题被截断则需再确认一次。
                </Typography.Text>
              </Space>
            ) : (
              <>
                {/* 标题 */}
                {viewing.title ? (
                  <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 8 }}>
                    {viewing.title}
                  </Typography.Title>
                ) : null}

                {/* 配图（在标题下、正文上，贴合小红书图文顺序） */}
                <ImagesStrip row={viewing} />

                {/* 正文（保留换行） */}
                {viewing.content ? (
                  <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>
                    {viewing.content}
                  </Typography.Paragraph>
                ) : (
                  <Typography.Paragraph type="secondary">无正文</Typography.Paragraph>
                )}

                <Divider style={{ margin: '12px 0' }} />

                {/* 元信息（管理用，次要） */}
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Typography.Text type="secondary">
                    回执：
                    {viewing.platformPostId ? (
                      <Typography.Text copyable>{viewing.platformPostId}</Typography.Text>
                    ) : (
                      '无回执'
                    )}
                  </Typography.Text>
                  <Typography.Text type="secondary">发布时间：{new Date(viewing.publishedAt).toLocaleString()}</Typography.Text>
                </Space>

                {/* 来源 */}
                <div style={{ marginTop: 16, textAlign: 'right' }}>
                  {viewing.postUrl ? (
                    <Button type="primary" href={viewing.postUrl} target="_blank" rel="noopener noreferrer">
                      打开小红书详情页
                    </Button>
                  ) : (
                    <Button disabled>无链接</Button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
      <SourceReferenceModal source={sourceViewing} onClose={() => setSourceViewing(null)} />
    </div>
  );
}
