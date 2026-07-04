import { useState, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  App,
  Alert,
  Avatar,
  Button,
  Card,
  Divider,
  Empty,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, HeartOutlined, LinkOutlined, MessageOutlined, StarOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiPost } from '../api/client';
import { useAccounts, useCuratedContents, useCuratedFacets } from '../api/queries';
import type { CuratedActionReceipt, CuratedContentType, PanelCuratedContent } from '../types/api';
import { accountDisplayName, makeAccountNamer } from '../types/accountDisplay';

const PAGE_SIZE = 20;

/** 账号筛选哨兵：选「全部账号」时不带 accountId（全账号合并视图）。 */
const ALL_ACCOUNTS = '__all__';

function CountText({ value }: { value: number | null }) {
  return value == null ? (
    <Typography.Text type="secondary" className="curated-count-text">
      未抓到
    </Typography.Text>
  ) : (
    <span className="curated-count-text tabular-nums">{value}</span>
  );
}

/** 计数单元：诚实区分 null（边端未抓到）与 0（真实为零）。 */
function countCell(v: number | null) {
  return <CountText value={v} />;
}

/** 详情浮层里的互动数据单元：图标 + 数值（诚实区分 未抓到/0）+ 文案。 */
function Stat({ icon, value, label }: { icon: ReactNode; value: number | null; label: string }) {
  return (
    <Space size={4} className="curated-stat">
      {icon}
      <CountText value={value} />
      <Typography.Text type="secondary" className="curated-stat__label">
        {label}
      </Typography.Text>
    </Space>
  );
}

function timeText(ms: number | null): string {
  return ms == null ? '—' : new Date(ms).toLocaleString();
}

function curatedTypeLabel(type: CuratedContentType): string {
  if (type === 'comment') return '评论';
  if (type === 'video') return '视频';
  return '图文';
}

function curatedTypeColor(type: CuratedContentType): string {
  if (type === 'comment') return 'purple';
  if (type === 'video') return 'geekblue';
  return 'blue';
}

function isSourcePost(row: PanelCuratedContent): boolean {
  return row.contentType === 'image_text' || row.contentType === 'video';
}

/**
 * 行级动作「未触发」机器原因码 → 中文提示（change curated-note-actions）。
 * 与 cloud panel 接线层的原因码对齐；未知码原样兜底（诚实：不假装认识陌生码）。
 */
function actionReasonLabel(reason: string | undefined): string {
  switch (reason) {
    case 'empty_body':
      return '该行正文为空（历史/异常壳行），无法作为写笔记参照';
    case 'empty_title':
      return '该行无标题，无法搜索定位目标笔记';
    case 'image_text_only':
      return '只有图文行支持写笔记；视频和评论暂不支持';
    case 'source_post_only':
      return '只有图文或视频源帖支持评论';
    case 'note_only':
      return '仅源帖行支持该动作';
    case 'needs_persona':
      return '该账号未绑定人设——请先到「人设」页设置';
    case 'publish_busy':
      return '发布链路正在生成其它草稿（全局串行），请稍后再试';
    case 'publish_unready':
      return '发布触发器未就绪（云端依赖不可用）';
    case 'comment_unready':
      return '评论触发器未就绪（云端依赖不可用）';
    case 'group_code_missing':
      return '该账号未配置「关联群聊信息」——请先到账号页设置（不会降级为内容评论）';
    case 'running':
      return '该账号已有评论任务在跑，请等其结束';
    case 'already_commented':
      return '该账号已评论过这篇笔记，不重复评论';
    case 'edge_offline':
      return '该账号暂无在线边端';
    case 'account_required':
    case 'bad_target':
      return '目标信息不完整，无法触发';
    default:
      return reason ? `未触发（${reason}）` : '未触发';
  }
}

/**
 * 「纳入原因」机器码 → 中文友好文案（云端 evaluateAdmission / markBotAction / archiveComment 产出的码）。
 * 未知码原样兜底（诚实：不假装认识陌生码）；历史 content_missing 标注「未抓到正文」（壳行）。
 */
function admitReasonLabel(raw: string | null): string {
  if (raw == null || raw === '') return '—';
  const missing = raw.includes('content_missing');
  if (raw.startsWith('confirmed_like')) {
    const suffix = raw.slice('confirmed_like'.length).replace(/^:/, '').trim();
    return suffix ? `点赞评论（${suffix}）` : '点赞评论';
  }
  if (raw.startsWith('bot_collect')) {
    return missing ? '收藏（未抓到正文）' : '收藏';
  }
  switch (raw) {
    case 'llm_eval':
      return '评估入选';
    case 'collect_floor':
      return '高收藏';
    case 'collect_ratio':
      return '高收藏比率';
    default:
      return raw;
  }
}

/**
 * 精选内容池管理页（change curated-content-admin-page）。
 * - 默认「全部账号」合并视图（每行带账号列、服务端分页）查看精选创作灵感语料，可在右上切到单个账号。
 * - 治理：删单条（按行账号路由防越权）、一键清空历史/异常正文壳行（按单账号执行，全账号视图下禁用）；honest-write 回真实条数、非乐观（重取真态）。
 * - 删除仅清当前快照：之后再浏览到且仍达标会重新纳入（准入不查史）——确认文案如实告知，绝不谎称永久移除。
 * - 整行可点：点击任意行打开「笔记详情」浮层（简化版小红书详情页）看正文/作者/赞藏评；操作列只留删除（删除点击不触发浮层）。
 */
export function CuratedContentPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const accounts = useAccounts();

  // 默认「全部账号」：全账号合并视图，每行带归属账号、删除按行账号路由。可在右上切到单个账号。
  // #17：账号筛选进 URL query（?account=<id>），可分享/刷新保持；全部账号时删除该参数（其它 query 保留）。
  const [searchParams, setSearchParams] = useSearchParams();
  const accountId = searchParams.get('account') ?? ALL_ACCOUNTS;
  const setAccountId = (id: string) => {
    const next = new URLSearchParams(searchParams);
    if (id && id !== ALL_ACCOUNTS) next.set('account', id);
    else next.delete('account');
    setSearchParams(next);
  };
  const [contentType, setContentType] = useState<CuratedContentType | undefined>(undefined);
  const [admitReason, setAdmitReason] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<PanelCuratedContent | null>(null);
  // 评论弹窗：目标行 + 评论类型（内容评论 / 带群评论）。
  const [commentTarget, setCommentTarget] = useState<PanelCuratedContent | null>(null);
  const [commentKind, setCommentKind] = useState<'content' | 'group'>('content');

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
      message.success(`已清理 ${res.deleted} 条历史/异常空正文壳行`);
      invalidateCurated();
    },
    onError: () => message.error('清理失败'),
  });

  // 写笔记（change curated-note-actions）：触发态回执诚实分支——triggered 才绿，域内拒绝走中文原因、绝不染绿。
  const createPost = useMutation({
    mutationFn: (row: PanelCuratedContent) =>
      apiPost<CuratedActionReceipt>(`/api/curated/contents/${row.id}/create-post`, { accountId: row.accountId }),
    onSuccess: (res) => {
      if (res.triggered) message.success('已触发写笔记：生成草稿后将发飞书人审卡，请到飞书完成审核');
      else message.info(actionReasonLabel(res.reason));
    },
    onError: () => message.error('写笔记触发失败'),
  });

  // 评论（内容/带群）：同样只回触发态；终态（评没评上）由飞书结果卡回报。
  const targetedComment = useMutation({
    mutationFn: ({ row, withGroup }: { row: PanelCuratedContent; withGroup: boolean }) =>
      apiPost<CuratedActionReceipt>(`/api/curated/contents/${row.id}/comment`, { accountId: row.accountId, withGroup }),
    onSuccess: (res) => {
      if (res.triggered) {
        message.success('已触发评论：搜索定位目标源帖后撰写，评论文案将发飞书人审、通过才发出；结果以飞书卡片回报');
        setCommentTarget(null);
      } else {
        message.info(actionReasonLabel(res.reason));
      }
    },
    onError: () => message.error('评论触发失败'),
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
      // 标签中文化、原始码保留为 value（API 按原始码精确过滤，不能改 value）。
      label: `${admitReasonLabel(r.admitReason)}（${r.count}）`,
      value: r.admitReason ?? '',
    }));
    return [{ label: '全部原因', value: '' }, ...opts];
  }, [facets.data]);

  // 历史空正文壳行预览数：纳入原因含 content_missing 的行（清理只删正文为空的行）。
  const emptyShellEstimate = useMemo(
    () =>
      (facets.data?.admitReasons ?? [])
        .filter((r) => (r.admitReason ?? '').includes('content_missing'))
        .reduce((sum, r) => sum + r.count, 0),
    [facets.data],
  );

  const createPostState = (row: PanelCuratedContent) => {
    const canCreatePost = row.contentType === 'image_text';
    const hasBody = !!(row.body ?? '').trim();
    const disabled = !canCreatePost || !hasBody;
    const tip = !canCreatePost
      ? row.contentType === 'video'
        ? '视频行暂不支持写笔记'
        : '评论行不支持写笔记'
      : !hasBody
        ? '正文为空（壳行），无法作参照'
        : '';
    return { disabled, tip };
  };

  const openCommentModal = (row: PanelCuratedContent) => {
    setCommentKind('content');
    setCommentTarget(row);
  };

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
      render: (v: CuratedContentType) => <Tag color={curatedTypeColor(v)}>{curatedTypeLabel(v)}</Tag>,
    },
    {
      title: '标题',
      dataIndex: 'title',
      ellipsis: true,
      render: (v: string | null) => v ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    { title: '作者', dataIndex: 'author', width: 120, render: (v: string | null) => v ?? <Typography.Text type="secondary">—</Typography.Text> },
    { title: '赞', dataIndex: 'likeCount', width: 80, render: countCell },
    { title: '藏', dataIndex: 'collectCount', width: 80, render: countCell },
    {
      title: 'AI 动作',
      key: 'marks',
      width: 130,
      render: (_, row) => (
        <Space size={4}>
          {row.botCollected ? <Tag color="gold">收藏</Tag> : null}
          {row.botLiked ? <Tag color="magenta">点赞</Tag> : null}
          {!row.botCollected && !row.botLiked ? <Typography.Text type="secondary">—</Typography.Text> : null}
        </Space>
      ),
    },
    {
      title: '纳入原因',
      dataIndex: 'admitReason',
      width: 160,
      // 中文文案，悬浮显示原始机器码（便于排查）。
      render: (v: string | null) =>
        v ? <Tooltip title={v}>{admitReasonLabel(v)}</Tooltip> : <Typography.Text type="secondary">—</Typography.Text>,
    },
    { title: '更新时刻', dataIndex: 'updatedAt', width: 170, render: (v: number) => timeText(v) },
    {
      title: '操作',
      key: 'action',
      width: 190,
      // 操作列内部一律 stopPropagation：按钮点击不触发整行的「打开详情」。
      render: (_, row) => {
        const canComment = isSourcePost(row);
        const writeState = createPostState(row);
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <Space size={8}>
              {/* 写笔记：仅图文行且有正文；视频和评论暂不支持。 */}
              <Tooltip title={writeState.tip}>
                <Popconfirm
                  title="以这篇图文写一篇新笔记？"
                  description={`由「${namer(row.accountId)}」参照本图文写一篇草稿（借选题结构、人设口吻重写、禁逐句照抄），生成后走飞书人审，审核通过才发布。`}
                  okText="触发写笔记"
                  onConfirm={() => createPost.mutate(row)}
                  disabled={writeState.disabled}
                >
                  <Button size="small" icon={<EditOutlined />} loading={createPost.isPending} disabled={writeState.disabled}>
                    写笔记
                  </Button>
                </Popconfirm>
              </Tooltip>
              <Tooltip title={!canComment ? '评论行不支持（未存源帖目标）' : ''}>
                <Button
                  size="small"
                  icon={<MessageOutlined />}
                  disabled={!canComment}
                  onClick={() => openCommentModal(row)}
                >
                  评论
                </Button>
              </Tooltip>
              <Popconfirm
                title="删除这条精选灵感？"
                description="仅清当前快照：之后再浏览到且仍达标会重新纳入，历史点赞/收藏标记不恢复；删后不再进入下次发帖创作素材。"
                okText="删除"
                okButtonProps={{ danger: true }}
                onConfirm={() => del.mutate(row)}
              >
                <Button size="small" danger icon={<DeleteOutlined />} loading={del.isPending}>
                  删除
                </Button>
              </Popconfirm>
            </Space>
          </div>
        );
      },
    },
  ];

  return (
    <div className="page-stack">
      <Alert
        type="info"
        showIcon
        message="精选内容池为发帖创作的正向素材来源；表内为第三方图文、视频和评论内容，仅供创作参考，每账号保留上限 1000 条。"
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
              onChange={(v) => resetTo(() => setContentType((v || undefined) as CuratedContentType | undefined))}
              options={[
                { label: '全部类型', value: '' },
                { label: '图文', value: 'image_text' },
                { label: '视频', value: 'video' },
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
            // 整行可点：打开「笔记详情」浮层。
            onRow={(row) => ({
              onClick: () => setViewing(row),
              style: { cursor: 'pointer' },
            })}
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

      <Card size="small" title="历史清理">
        <Space wrap>
          <Popconfirm
            title="清空该账号历史/异常「正文为空」行？"
            description={`将按"正文为空"清理旧版本或异常写入留下的壳行（约 ${emptyShellEstimate} 条），不影响有正文的优质素材；清理后显示真实条数。`}
            okText="清理"
            okButtonProps={{ danger: true }}
            onConfirm={() => clearEmpty.mutate()}
            disabled={allAccountsView}
          >
            <Button size="small" danger loading={clearEmpty.isPending} disabled={allAccountsView}>
              清理历史空正文行（约 {emptyShellEstimate} 条）
            </Button>
          </Popconfirm>
          <Typography.Text type="secondary">
            {allAccountsView
              ? '清理按单账号执行，请先在上方切到具体账号再清理。'
              : '当前版本抓不到正文不会再新建精选壳行；这里用于处理旧版本或异常写入留下的空正文行。按「正文为空」清理，不按纳入原因（避免误删有正文素材）。'}
          </Typography.Text>
        </Space>
      </Card>

      {/* 评论弹窗：选类型（内容评论 / 带群评论）后触发；执行账号固定为该行归属账号。 */}
      <Modal
        open={!!commentTarget}
        title="评论"
        okText="触发评论"
        cancelText="取消"
        confirmLoading={targetedComment.isPending}
        onOk={() => {
          if (commentTarget) targetedComment.mutate({ row: commentTarget, withGroup: commentKind === 'group' });
        }}
        onCancel={() => setCommentTarget(null)}
        width={460}
      >
        {commentTarget && (
          <div className="curated-comment-modal">
            <div className="curated-comment-target">
              <Typography.Text type="secondary" className="curated-comment-target__label">
                目标源帖
              </Typography.Text>
              <Typography.Text strong className="curated-comment-target__title">
                {commentTarget.title ?? '—'}
              </Typography.Text>
              <Typography.Text type="secondary" className="curated-comment-target__meta">
                执行账号：{namer(commentTarget.accountId)}
              </Typography.Text>
            </div>
            <Radio.Group
              className="curated-comment-options"
              value={commentKind}
              onChange={(e) => setCommentKind(e.target.value as 'content' | 'group')}
            >
              <Radio
                value="content"
                className={`curated-comment-option${commentKind === 'content' ? ' curated-comment-option--active' : ''}`}
              >
                <span className="curated-comment-option__body">
                  <span className="curated-comment-option__title">内容评论</span>
                  <span className="curated-comment-option__desc">基于源帖内容生成一条自然评论。</span>
                </span>
              </Radio>
              <Radio
                value="group"
                className={`curated-comment-option${commentKind === 'group' ? ' curated-comment-option--active' : ''}`}
              >
                <span className="curated-comment-option__body">
                  <span className="curated-comment-option__title">带群评论</span>
                  <span className="curated-comment-option__desc">在自然评论后追加该账号的群聊信息；未配置会拒绝触发。</span>
                </span>
              </Radio>
            </Radio.Group>
            <Alert
              type="info"
              showIcon
              className="curated-comment-flow"
              message="搜索定位目标源帖 → 撰写评论 → 飞书人审通过后发出；搜不到会如实报告，不评论相似内容。"
            />
          </div>
        )}
      </Modal>

      {/* 详情浮层：简化版小红书笔记详情页（作者 / 标题 / 正文 / 赞藏评 / 元信息）。 */}
      <Modal open={!!viewing} onCancel={() => setViewing(null)} footer={null} width={520} title={null}>
        {viewing && (
          <div>
            {/* 作者行 */}
            <Space align="center" style={{ marginBottom: 12 }}>
              <Avatar style={{ backgroundColor: '#ff2442', verticalAlign: 'middle' }}>
                {(viewing.author ?? '·').slice(0, 1)}
              </Avatar>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {viewing.author ?? <Typography.Text type="secondary">匿名作者</Typography.Text>}
                </div>
                <Tag color={curatedTypeColor(viewing.contentType)} style={{ marginTop: 2 }}>
                  {curatedTypeLabel(viewing.contentType)}
                </Tag>
              </div>
            </Space>

            {/* 标题 */}
            {viewing.title ? (
              <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 8 }}>
                {viewing.title}
              </Typography.Title>
            ) : null}

            {/* 正文 */}
            {viewing.body ? (
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>
                {viewing.body}
              </Typography.Paragraph>
            ) : (
              <Typography.Paragraph type="secondary">正文为空（历史/异常壳行）</Typography.Paragraph>
            )}

            {/* 话题 */}
            {viewing.topics.length > 0 ? (
              <div style={{ marginBottom: 12 }}>
                {viewing.topics.map((t) => (
                  <Tag key={t}>#{t}</Tag>
                ))}
              </div>
            ) : null}

            {/* 互动数据条：赞 / 藏（评论数全链路未采集，刻意不展示） */}
            <Space size="large">
              <Stat icon={<HeartOutlined style={{ color: '#ff2442' }} />} value={viewing.likeCount} label="赞" />
              <Stat icon={<StarOutlined style={{ color: '#ffb800' }} />} value={viewing.collectCount} label="藏" />
            </Space>

            <Divider style={{ margin: '12px 0' }} />

            {/* 元信息（管理用，次要） */}
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Typography.Text type="secondary">
                AI 动作：
                {viewing.botCollected ? <Tag color="gold">收藏</Tag> : null}
                {viewing.botLiked ? <Tag color="magenta">点赞</Tag> : null}
                {!viewing.botCollected && !viewing.botLiked ? '无' : null}
              </Typography.Text>
              <Typography.Text type="secondary">
                纳入原因：{admitReasonLabel(viewing.admitReason)}
              </Typography.Text>
              <Typography.Text type="secondary">采集时刻：{timeText(viewing.countsCapturedAt)}</Typography.Text>
              <Typography.Text type="secondary">更新时刻：{timeText(viewing.updatedAt)}</Typography.Text>
            </Space>

            {/* 上下文动作：从阅读详情进入写作或评论，评论会关闭详情浮层。 */}
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <Space wrap>
                <Tooltip title={createPostState(viewing).tip}>
                  <Popconfirm
                    title="以这篇图文写一篇新笔记？"
                    description={`由「${namer(viewing.accountId)}」参照本图文写一篇草稿（借选题结构、人设口吻重写、禁逐句照抄），生成后走飞书人审，审核通过才发布。`}
                    okText="触发写笔记"
                    onConfirm={() =>
                      createPost.mutate(viewing, {
                        onSuccess: (res) => {
                          if (res.triggered) setViewing(null);
                        },
                      })
                    }
                    disabled={createPostState(viewing).disabled}
                  >
                    <Button
                      type="primary"
                      icon={<EditOutlined />}
                      loading={createPost.isPending}
                      disabled={createPostState(viewing).disabled}
                    >
                      写笔记
                    </Button>
                  </Popconfirm>
                </Tooltip>
                <Tooltip title={!isSourcePost(viewing) ? '评论行不支持（未存源帖目标）' : ''}>
                  <Button
                    icon={<MessageOutlined />}
                    disabled={!isSourcePost(viewing)}
                    onClick={() => {
                      openCommentModal(viewing);
                      setViewing(null);
                    }}
                  >
                    评论
                  </Button>
                </Tooltip>
                {viewing.sourceUrl ? (
                  <Button icon={<LinkOutlined />} href={viewing.sourceUrl} target="_blank" rel="noopener noreferrer">
                    来源
                  </Button>
                ) : (
                  <Button icon={<LinkOutlined />} disabled>
                    来源
                  </Button>
                )}
              </Space>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
