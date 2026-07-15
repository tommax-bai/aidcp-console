import { useState, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  App,
  Alert,
  Avatar,
  Button,
  Card,
  Collapse,
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
import {
  DeleteOutlined,
  EditOutlined,
  HeartOutlined,
  LeftOutlined,
  LinkOutlined,
  MessageOutlined,
  RightOutlined,
  StarOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiPost } from '../api/client';
import { useAccounts, useCuratedContents, useCuratedFacets } from '../api/queries';
import type {
  CuratedActionReceipt,
  CuratedContentType,
  CuratedReferenceImage,
  PanelCuratedContent,
  ReferenceVisualAnalysis,
  VisualFrameSpec,
} from '../types/api';
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

function referenceImageUrl(img: CuratedReferenceImage): string {
  return (img.ossUrl || img.sourceUrl || '').trim();
}

function usableReferenceImages(images: CuratedReferenceImage[]): CuratedReferenceImage[] {
  return images.filter((img) => referenceImageUrl(img)).slice(0, 9);
}

const VISUAL_KIND_LABEL: Record<string, string> = {
  portrait_photo: '人物摄影', still_life_photo: '静物/产品摄影', scene_photo: '景色/空间摄影', illustration_3d: '插画/3D',
  text_layout: '文字卡/海报', ui_document: '界面/文档', infographic_chart: '图表/信息图', collage_mixed: '拼贴/混合',
};

function visualAnalysisStatus(analysis: ReferenceVisualAnalysis | undefined): { text: string; color?: string } {
  if (!analysis) return { text: '未分析' };
  if (analysis.status === 'analyzed') return { text: '已反推', color: 'green' };
  if (analysis.status === 'partial') return { text: '部分反推', color: 'orange' };
  if (analysis.status === 'unavailable') return { text: '反推不可用', color: 'red' };
  if (analysis.status === 'disabled') return { text: '反推关闭' };
  return { text: '无可用图' };
}

function frameDetailsText(frame: VisualFrameSpec): string[] {
  return Object.entries(frame.details)
    .filter(([key]) => key !== 'family')
    .flatMap(([key, value]) => {
      if (value == null) return [];
      if (Array.isArray(value)) {
        if (key === 'regions') return [`区域：${value.length} 个视觉分区`];
        return [`${key}：${value.map(String).join('、')}`];
      }
      return [`${key}：${String(value)}`];
    });
}

function VisualAnalysisPanel({ analysis }: { analysis: ReferenceVisualAnalysis | undefined }) {
  const status = visualAnalysisStatus(analysis);
  if (!analysis || (analysis.status !== 'analyzed' && analysis.status !== 'partial')) {
    return (
      <Alert
        type={analysis?.status === 'unavailable' ? 'warning' : 'info'}
        showIcon
        message={`整组视觉反推：${status.text}`}
        description={analysis?.error || '该状态不会被当作已分析，生成时使用既有品类风格兜底。'}
        style={{ marginBottom: 12 }}
      />
    );
  }
  return (
    <Card size="small" title={<Space><span>整组视觉反推</span><Tag color={status.color}>{status.text}</Tag></Space>} style={{ marginBottom: 12 }}>
      <Typography.Paragraph style={{ marginBottom: 6 }}>
        {analysis.setStyleBible?.summary || '无整组风格摘要'}
      </Typography.Paragraph>
      <Typography.Text type="secondary">
        {analysis.provider}/{analysis.model} · {analysis.sourceCount} 张 · {analysis.analyzedAt ? timeText(analysis.analyzedAt) : '无分析时刻'}
      </Typography.Text>
      {analysis.styleClusters?.length ? (
        <div style={{ marginTop: 8 }}>
          {analysis.styleClusters.map((cluster) => <Tag key={cluster.id} color="blue">{cluster.label}（{cluster.frameIndexes.length}）</Tag>)}
        </div>
      ) : null}
      <Collapse
        ghost
        size="small"
        style={{ marginTop: 6 }}
        items={(analysis.frameSpecs ?? []).map((frame) => ({
          key: frame.sourceArrayIndex,
          label: `源图 ${frame.sourceArrayIndex + 1} · ${VISUAL_KIND_LABEL[frame.kind] ?? frame.kind} · 置信 ${Math.round(frame.confidence * 100)}%`,
          children: (
            <Space direction="vertical" size={2}>
              <Typography.Text>主体：{frame.common.subject}</Typography.Text>
              <Typography.Text>构图：{frame.common.composition}</Typography.Text>
              <Typography.Text>色彩/光影：{frame.common.palette.join('、')}；{frame.common.lightingOrContrast}</Typography.Text>
              <Typography.Text>留白/氛围：{frame.common.negativeSpace}；{frame.common.mood}</Typography.Text>
              {frameDetailsText(frame).map((line) => <Typography.Text type="secondary" key={line}>{line}</Typography.Text>)}
            </Space>
          ),
        }))}
      />
      {analysis.error ? <Typography.Paragraph type="warning" style={{ marginBottom: 0 }}>部分分析说明：{analysis.error}</Typography.Paragraph> : null}
    </Card>
  );
}

function ReferenceImageStrip({
  images,
  compact = false,
  onPreview,
}: {
  images: CuratedReferenceImage[];
  compact?: boolean;
  onPreview?: (images: CuratedReferenceImage[], index: number) => void;
}) {
  const usable = usableReferenceImages(images);
  if (usable.length === 0) {
    return compact ? (
      <Typography.Text type="secondary">-</Typography.Text>
    ) : (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无参考图" />
    );
  }
  const size = compact ? 38 : 72;
  return (
    <Space size={compact ? 4 : 8} wrap className="curated-image-strip">
      {usable.map((img, index) => {
        const url = referenceImageUrl(img);
        return (
          <button
            key={`${img.index}-${url}`}
            type="button"
            className="curated-image-strip__item"
            style={{ width: size, height: size }}
            aria-label={`预览参考图 ${index + 1}/${usable.length}`}
            onClick={(e) => {
              e.stopPropagation();
              onPreview?.(usable, index);
            }}
          >
            <img
              src={url}
              alt={img.alt || `reference ${img.index + 1}`}
            />
          </button>
        );
      })}
    </Space>
  );
}

function ReferenceImageThumb({
  images,
  onPreview,
}: {
  images: CuratedReferenceImage[];
  onPreview: (images: CuratedReferenceImage[]) => void;
}) {
  const usable = usableReferenceImages(images);
  const first = usable[0];
  if (!first) {
    return <Typography.Text type="secondary">-</Typography.Text>;
  }
  const url = referenceImageUrl(first);
  return (
    <button
      type="button"
      className="curated-image-thumb"
      aria-label={`查看 ${usable.length} 张参考图`}
      onClick={(e) => {
        e.stopPropagation();
        onPreview(usable);
      }}
    >
      <img src={url} alt={first.alt || 'reference image'} />
      {usable.length > 1 ? <span className="curated-image-thumb__count">{usable.length}</span> : null}
    </button>
  );
}

/**
 * 行级动作「未触发」机器原因码 → 中文提示（change curated-note-actions）。
 * 与 cloud panel 接线层的原因码对齐；未知码原样兜底（诚实：不假装认识陌生码）。
 */
function actionReasonLabel(reason: string | undefined): string {
  switch (reason) {
    case 'empty_body':
      return '该行正文为空（历史/异常壳行），无法作为洗稿参照';
    case 'empty_title':
      return '该行无标题，无法搜索定位目标笔记';
    case 'image_text_only':
      return '只有图文行支持洗稿；视频和评论暂不支持';
    case 'source_post_only':
      return '只有图文或视频源帖支持评论';
    case 'note_only':
      return '仅源帖行支持该动作';
    case 'needs_persona':
      return '该账号未绑定人设——请先到「人设」页设置';
    case 'publish_busy':
      return '生成并发已满，请稍后再试';
    case 'duplicate_source':
      return '该笔记已有一轮洗稿在途——等它出稿后可再洗一版对比';
    case 'publish_capacity':
      return '该账号在途待审草稿已达上限——请先在「内容」页批准或驳回存量草稿';
    case 'publish_unready':
      return '发布触发器未就绪（云端依赖不可用）';
    case 'comment_unready':
      return '评论触发器未就绪（云端依赖不可用）';
    case 'contact_info_missing':
      return '该账号未配置「联系方式」——请先到账号页设置（不会降级为内容评论）';
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
 * - 治理：删单条（按行账号路由防越权）；honest-write 回真实条数、非乐观（重取真态）。
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
  const [createTarget, setCreateTarget] = useState<PanelCuratedContent | null>(null);
  const [createMode, setCreateMode] = useState<'image' | 'text'>('image');
  const [imagePreview, setImagePreview] = useState<{ images: CuratedReferenceImage[]; index: number } | null>(null);
  // 评论弹窗：目标行 + 评论类型（内容评论 / 联系评论）。
  const [commentTarget, setCommentTarget] = useState<PanelCuratedContent | null>(null);
  const [commentKind, setCommentKind] = useState<'content' | 'contact'>('content');

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

  // 洗稿（change curated-note-actions）：触发态回执诚实分支——triggered 才绿，域内拒绝走中文原因、绝不染绿。
  const createPost = useMutation({
    mutationFn: ({ row, useReferenceImages }: { row: PanelCuratedContent; useReferenceImages?: boolean }) => {
      const body =
        typeof useReferenceImages === 'boolean'
          ? { accountId: row.accountId, useReferenceImages }
          : { accountId: row.accountId };
      return apiPost<CuratedActionReceipt>(`/api/curated/contents/${row.id}/create-post`, body);
    },
    onSuccess: (res) => {
      if (res.triggered) message.success('已触发洗稿：生成草稿后将发飞书人审卡，请到飞书完成审核');
      else message.info(actionReasonLabel(res.reason));
    },
    onError: () => message.error('洗稿触发失败'),
  });

  // 评论（内容/带联系方式）：同样只回触发态；终态（评没评上）由飞书结果卡回报。
  const targetedComment = useMutation({
    mutationFn: ({ row, withContact }: { row: PanelCuratedContent; withContact: boolean }) =>
      apiPost<CuratedActionReceipt>(`/api/curated/contents/${row.id}/comment`, { accountId: row.accountId, withContact }),
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

  const createPostState = (row: PanelCuratedContent) => {
    const canCreatePost = row.contentType === 'image_text';
    const hasBody = !!(row.body ?? '').trim();
    const disabled = !canCreatePost || !hasBody;
    const tip = !canCreatePost
      ? row.contentType === 'video'
        ? '视频行暂不支持洗稿'
        : '评论行不支持洗稿'
      : !hasBody
        ? '正文为空（壳行），无法作参照'
        : '';
    return { disabled, tip };
  };

  const openCreatePost = (row: PanelCuratedContent) => {
    if (usableReferenceImages(row.referenceImages).length > 0) {
      setCreateTarget(row);
      setCreateMode('image');
      return;
    }
    createPost.mutate({ row });
  };

  const openCommentModal = (row: PanelCuratedContent) => {
    setCommentKind('content');
    setCommentTarget(row);
  };

  const openImagePreview = (images: CuratedReferenceImage[], index: number) => {
    setImagePreview({ images, index });
  };

  // 全账号视图下前置「账号」列，标明每行精选归属（单账号视图不显示）。
  const accountColumn: ColumnsType<PanelCuratedContent>[number] = {
    title: '账号',
    dataIndex: 'accountId',
    width: 104,
    className: 'curated-compact-cell',
    // 账号 = 纯标签展示（Tag），不可点：账号是「归属」标注、非导航目标。
    // 窄列内单行省略 + Tooltip 看全名（不换行的表格设计标准）。
    render: (id: string) => {
      const label = namer(id);
      return (
        <Tooltip title={label}>
          <Tag className="curated-account-tag">{label}</Tag>
        </Tooltip>
      );
    },
  };

  const columns: ColumnsType<PanelCuratedContent> = [
    {
      title: '类型',
      dataIndex: 'contentType',
      width: 54,
      render: (v: CuratedContentType) => <Tag color={curatedTypeColor(v)}>{curatedTypeLabel(v)}</Tag>,
    },
    {
      title: '标题',
      dataIndex: 'title',
      width: 330,
      className: 'curated-title-cell',
      render: (v: string | null) =>
        v ? (
          <Tooltip title={v}>
            <Typography.Text className="curated-ellipsis-text">{v}</Typography.Text>
          </Tooltip>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: '图片',
      dataIndex: 'referenceImages',
      width: 50,
      className: 'curated-image-cell',
      render: (images: CuratedReferenceImage[]) => (
        <ReferenceImageThumb images={images ?? []} onPreview={(previewImages) => setImagePreview({ images: previewImages, index: 0 })} />
      ),
    },
    {
      title: '视觉',
      dataIndex: 'visualAnalysis',
      width: 92,
      render: (analysis: ReferenceVisualAnalysis | undefined) => {
        const status = visualAnalysisStatus(analysis);
        return <Tag color={status.color}>{status.text}</Tag>;
      },
    },
    {
      title: '作者',
      dataIndex: 'author',
      width: 96,
      render: (v: string | null) =>
        v ? (
          <Tooltip title={v}>
            <Typography.Text className="curated-ellipsis-text">{v}</Typography.Text>
          </Tooltip>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    { title: '赞', dataIndex: 'likeCount', width: 54, render: countCell },
    { title: '藏', dataIndex: 'collectCount', width: 54, render: countCell },
    {
      title: 'AI',
      key: 'marks',
      width: 60,
      className: 'curated-compact-cell',
      render: (_, row) => (
        <Space size={3} className="curated-ai-actions">
          {row.botLiked ? <Tag color="magenta">赞</Tag> : null}
          {row.botCollected ? <Tag color="gold">藏</Tag> : null}
          {!row.botCollected && !row.botLiked ? <Typography.Text type="secondary">—</Typography.Text> : null}
        </Space>
      ),
    },
    {
      title: '原因',
      dataIndex: 'admitReason',
      width: 64,
      className: 'curated-compact-cell',
      onCell: () => ({ style: { whiteSpace: 'nowrap' } }),
      // 中文文案，悬浮显示原始机器码（便于排查）。
      render: (v: string | null) => {
        const label = v ? admitReasonLabel(v) : null;
        return label ? (
          <Tooltip title={v}>
            <Typography.Text className="curated-ellipsis-text">{label}</Typography.Text>
          </Tooltip>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        );
      },
    },
    {
      title: '更新时刻',
      dataIndex: 'updatedAt',
      width: 116,
      onCell: () => ({ style: { whiteSpace: 'nowrap' } }),
      render: (v: number) => <span style={{ whiteSpace: 'nowrap' }}>{timeText(v)}</span>,
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      className: 'curated-action-cell',
      // 操作列内部一律 stopPropagation：按钮点击不触发整行的「打开详情」。
      render: (_, row) => {
        const canComment = isSourcePost(row);
        const writeState = createPostState(row);
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <Space size={6} className="curated-row-actions">
              {/* 洗稿：仅图文行且有正文；视频和评论暂不支持。 */}
              <Tooltip title={writeState.tip}>
                <Popconfirm
                  title="以这篇图文洗稿成一篇新笔记？"
                  description={`由「${namer(row.accountId)}」参照本图文写一篇草稿（借选题结构、人设口吻重写、禁逐句照抄），生成后走飞书人审，审核通过才发布。`}
                  okText="触发洗稿"
                  onConfirm={() => openCreatePost(row)}
                  disabled={writeState.disabled}
                >
                  <Button size="small" icon={<EditOutlined />} loading={createPost.isPending} disabled={writeState.disabled}>
                    洗稿
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
                <Button size="small" danger icon={<DeleteOutlined />} loading={del.isPending} aria-label="删除" />
              </Popconfirm>
            </Space>
          </div>
        );
      },
    },
  ];

  const previewImage = imagePreview?.images[imagePreview.index];
  const previewUrl = previewImage ? referenceImageUrl(previewImage) : '';
  const previewCount = imagePreview?.images.length ?? 0;

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
            tableLayout="fixed"
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

      <Modal
        open={!!imagePreview}
        title={imagePreview ? `参考图 ${imagePreview.index + 1}/${imagePreview.images.length}` : '参考图'}
        footer={null}
        width={720}
        onCancel={() => setImagePreview(null)}
      >
        {imagePreview && previewImage ? (
          <div className="curated-image-preview">
            <div className="curated-image-preview__frame">
              <img src={previewUrl} alt={previewImage.alt || `reference ${imagePreview.index + 1}`} />
            </div>
            <div className="curated-image-preview__controls">
              <Button
                icon={<LeftOutlined />}
                disabled={previewCount <= 1}
                onClick={() =>
                  setImagePreview((prev) =>
                    prev ? { ...prev, index: (prev.index + prev.images.length - 1) % prev.images.length } : prev,
                  )
                }
              >
                上一张
              </Button>
              <Typography.Text type="secondary">
                {imagePreview.index + 1} / {previewCount}
              </Typography.Text>
              <Button
                icon={<RightOutlined />}
                disabled={previewCount <= 1}
                onClick={() =>
                  setImagePreview((prev) => (prev ? { ...prev, index: (prev.index + 1) % prev.images.length } : prev))
                }
              >
                下一张
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* 参考创作弹窗：有原帖图片时允许运营选择带图参考或仅文本参考。 */}
      <Modal
        open={!!createTarget}
        title="参考创作"
        okText="触发创作"
        cancelText="取消"
        confirmLoading={createPost.isPending}
        onOk={() => {
          if (!createTarget) return;
          createPost.mutate(
            { row: createTarget, useReferenceImages: createMode === 'image' },
            {
              onSuccess: (res) => {
                if (res.triggered) {
                  setCreateTarget(null);
                  setViewing(null);
                }
              },
            },
          );
        }}
        onCancel={() => setCreateTarget(null)}
        width={520}
      >
        {createTarget && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Radio.Group value={createMode} onChange={(e) => setCreateMode(e.target.value as 'image' | 'text')}>
              <Space direction="vertical">
                <Radio value="image">带图参考</Radio>
                <Radio value="text">仅文本参考</Radio>
              </Space>
            </Radio.Group>
            <ReferenceImageStrip images={createTarget.referenceImages} onPreview={openImagePreview} />
            <Alert type="info" showIcon message="参考图只用于生成阶段理解画面，不会直接复用或发布原图。" />
          </Space>
        )}
      </Modal>

      <Modal
        open={!!commentTarget}
        title="评论"
        okText="触发评论"
        cancelText="取消"
        confirmLoading={targetedComment.isPending}
        onOk={() => {
          if (commentTarget) targetedComment.mutate({ row: commentTarget, withContact: commentKind === 'contact' });
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
              onChange={(e) => setCommentKind(e.target.value as 'content' | 'contact')}
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
                value="contact"
                className={`curated-comment-option${commentKind === 'contact' ? ' curated-comment-option--active' : ''}`}
              >
                <span className="curated-comment-option__body">
                  <span className="curated-comment-option__title">联系评论</span>
                  <span className="curated-comment-option__desc">在自然评论后追加该账号的联系方式；未配置会拒绝触发。</span>
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

            <div style={{ marginBottom: 12 }}>
              <ReferenceImageStrip images={viewing.referenceImages} onPreview={openImagePreview} />
            </div>

            <VisualAnalysisPanel analysis={viewing.visualAnalysis} />

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
                    title="以这篇图文洗稿成一篇新笔记？"
                    description={`由「${namer(viewing.accountId)}」参照本图文写一篇草稿（借选题结构、人设口吻重写、禁逐句照抄），生成后走飞书人审，审核通过才发布。`}
                    okText="触发洗稿"
                    onConfirm={() => openCreatePost(viewing)}
                    disabled={createPostState(viewing).disabled}
                  >
                    <Button
                      type="primary"
                      icon={<EditOutlined />}
                      loading={createPost.isPending}
                      disabled={createPostState(viewing).disabled}
                    >
                      洗稿
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
