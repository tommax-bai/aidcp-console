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
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CloseOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, apiPut } from '../api/client';
import { errorText } from '../api/errorText';
import { usePublished, useContentQueue, useAccounts } from '../api/queries';
import { ProfileLink } from '../components';
import { QueryError } from '../components/QueryGate';
import type { PanelImageReferenceAudit, PanelPublish, PanelPublishSourceReference } from '../types/api';
import { accountDisplayName } from '../types/accountDisplay';

const PUBLISH_STATUS_LABEL: Record<string, string> = {
  published: '已发布',
  failed: '失败',
  pending_approval: '待审',
  needs_review: '已否决',
  draft: '草稿',
};

type SnapshotRecord = Record<string, unknown>;
type QueueStageState = 'done' | 'active' | 'pending';

interface QueueStageField {
  key: string;
  label: string;
}

interface QueueStageDefinition {
  key: string;
  label: string;
  fields: QueueStageField[];
}

interface QueueStageView {
  key: string;
  label: string;
  state: QueueStageState;
  presentLabels: string[];
  fact: string | null;
}

interface QueueDraftSummary {
  title: string;
  sourceTitle: string | null;
  accountId: string | null;
  author: string | null;
  facts: string[];
}

const QUEUE_STATUS_LABEL: Record<string, string> = {
  idle: '空闲',
  running: '生成中',
  completed: '已完成',
  failed: '失败',
  timeout: '超时',
};

const QUEUE_STATUS_COLOR: Record<string, string> = {
  idle: 'default',
  running: 'processing',
  completed: 'success',
  failed: 'error',
  timeout: 'warning',
};

const STAGE_STATE_LABEL: Record<QueueStageState, string> = {
  done: '已完成',
  active: '进行中',
  pending: '未开始',
};

const STAGE_STATE_COLOR: Record<QueueStageState, string> = {
  done: 'green',
  active: 'blue',
  pending: 'default',
};

const QUEUE_STAGE_DEFINITIONS: QueueStageDefinition[] = [
  {
    key: 'source',
    label: '来源/触发',
    fields: [{ key: 'trigger', label: '触发输入' }],
  },
  {
    key: 'draft',
    label: '洗稿/正文',
    fields: [
      { key: 'referenceAnalysis', label: '原稿分析' },
      { key: 'faithfulRewritePlan', label: '改写规划' },
      { key: 'faithfulDraft', label: '洗稿草稿' },
      { key: 'fidelityAuditReport', label: '忠实度审核' },
      { key: 'scoutDecision', label: '选题判断' },
      { key: 'createdContent', label: '正文草稿' },
    ],
  },
  {
    key: 'quality',
    label: '质检/清洗',
    fields: [
      { key: 'cleanedContent', label: '去 AI 味' },
      { key: 'aiFlavorScore', label: 'AI 味分' },
      { key: 'qualityReport', label: '质量分' },
      { key: 'assembledContent', label: '终稿组装' },
      { key: 'titleSelection', label: '标题定稿' },
    ],
  },
  {
    key: 'media',
    label: '配图/元数据',
    fields: [
      { key: 'postCategory', label: '品类' },
      { key: 'imageSetPlan', label: '图集规划' },
      { key: 'imagePlan', label: '生图指令' },
      { key: 'imageDirective', label: '配图结果' },
      { key: 'coverSelection', label: '封面' },
      { key: 'topicCandidates', label: '话题候选' },
      { key: 'topicSelection', label: '话题' },
      { key: 'mentionSelection', label: '@ 提及' },
      { key: 'locationSelection', label: '地点' },
      { key: 'collectionSelection', label: '合集' },
      { key: 'visibilityDecision', label: '可见范围' },
      { key: 'permissionDecision', label: '权限' },
      { key: 'publishModeDecision', label: '发布方式' },
      { key: 'complianceDecision', label: '合规声明' },
      { key: 'publishMetadata', label: '元数据汇总' },
    ],
  },
  {
    key: 'review',
    label: '人审/下发',
    fields: [
      { key: 'gateDecision', label: '人审裁决' },
      { key: 'publishResult', label: '发布结果' },
      { key: 'pipelineAbort', label: '中止原因' },
    ],
  },
];

function isRecord(value: unknown): value is SnapshotRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function objectField(record: SnapshotRecord, key: string): SnapshotRecord | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function stringField(record: SnapshotRecord | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberField(record: SnapshotRecord | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hasSnapshotValue(snapshot: SnapshotRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(snapshot, key) && snapshot[key] != null;
}

function triggerRecord(snapshot: SnapshotRecord): SnapshotRecord | null {
  return objectField(snapshot, 'trigger');
}

function referenceNoteRecord(snapshot: SnapshotRecord): SnapshotRecord | null {
  const trigger = triggerRecord(snapshot);
  const generateInput = trigger ? objectField(trigger, 'generateInput') : null;
  return generateInput ? objectField(generateInput, 'referenceNote') : null;
}

function imageCountFrom(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  return null;
}

function contentLengthFrom(record: SnapshotRecord | null, key: string): number | null {
  const value = stringField(record, key);
  return value ? value.length : null;
}

function compactJson(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '—';
  if (typeof value !== 'object') return String(value);
  return JSON.stringify(value);
}

function queueStageFact(stageKey: string, snapshot: SnapshotRecord, resolveAccountName?: (id: string) => string): string | null {
  const trigger = triggerRecord(snapshot);
  const referenceNote = referenceNoteRecord(snapshot);
  const faithfulDraft = objectField(snapshot, 'faithfulDraft');
  const createdContent = objectField(snapshot, 'createdContent');
  const titleSelection = objectField(snapshot, 'titleSelection');
  const qualityReport = objectField(snapshot, 'qualityReport');
  const aiFlavorScore = objectField(snapshot, 'aiFlavorScore');
  const imageSetPlan = objectField(snapshot, 'imageSetPlan');
  const imagePlan = objectField(snapshot, 'imagePlan');
  const imageDirective = objectField(snapshot, 'imageDirective');
  const publishMetadata = objectField(snapshot, 'publishMetadata');
  const gateDecision = objectField(snapshot, 'gateDecision');
  const publishResult = objectField(snapshot, 'publishResult');

  if (stageKey === 'source') {
    const rawAccountId = stringField(trigger, 'accountId');
    const facts = [
      // 账号显示昵称/标签、绝不裸 id（用户反馈 2026-07-09）。
      rawAccountId ? `账号 ${resolveAccountName?.(rawAccountId) ?? rawAccountId}` : null,
      imageCountFrom(referenceNote?.images) != null ? `参考图 ${imageCountFrom(referenceNote?.images)} 张` : null,
      stringField(referenceNote, 'author') ? `作者 ${stringField(referenceNote, 'author')}` : null,
    ].filter(Boolean);
    return facts.length > 0 ? facts.join(' · ') : null;
  }

  if (stageKey === 'draft') {
    const draftTitle = stringField(faithfulDraft, 'title') ?? stringField(createdContent, 'title');
    const draftLength = contentLengthFrom(faithfulDraft, 'content') ?? contentLengthFrom(createdContent, 'content');
    const audit = objectField(snapshot, 'fidelityAuditReport');
    const facts = [
      draftTitle ? `标题：${draftTitle}` : null,
      draftLength != null ? `正文 ${draftLength} 字` : null,
      numberField(audit, 'score') != null ? `忠实度 ${numberField(audit, 'score')}` : null,
    ].filter(Boolean);
    return facts.length > 0 ? facts.join(' · ') : null;
  }

  if (stageKey === 'quality') {
    const facts = [
      stringField(titleSelection, 'title') ? `定稿标题：${stringField(titleSelection, 'title')}` : null,
      numberField(qualityReport, 'qualityScore') != null ? `质量 ${numberField(qualityReport, 'qualityScore')}` : null,
      numberField(aiFlavorScore, 'aiScore') != null ? `AI 味 ${numberField(aiFlavorScore, 'aiScore')}` : null,
    ].filter(Boolean);
    return facts.length > 0 ? facts.join(' · ') : null;
  }

  if (stageKey === 'media') {
    const generatedImages = imageCountFrom(imageDirective?.imageUrls);
    const plannedImages = numberField(imagePlan, 'imageCount') ?? numberField(imageSetPlan, 'imageCount');
    const topics = imageCountFrom(publishMetadata?.topics);
    const facts = [
      generatedImages != null ? `已生图 ${generatedImages} 张` : plannedImages != null ? `计划配图 ${plannedImages} 张` : null,
      topics != null ? `话题 ${topics} 个` : null,
      stringField(publishMetadata, 'visibility') ? `可见范围 ${stringField(publishMetadata, 'visibility')}` : null,
    ].filter(Boolean);
    return facts.length > 0 ? facts.join(' · ') : null;
  }

  if (stageKey === 'review') {
    const facts = [
      stringField(gateDecision, 'recommendedAction') ? `裁决 ${stringField(gateDecision, 'recommendedAction')}` : null,
      stringField(publishResult, 'status') ? `结果 ${stringField(publishResult, 'status')}` : null,
      numberField(publishResult, 'recordId') != null ? `记录 #${numberField(publishResult, 'recordId')}` : null,
    ].filter(Boolean);
    return facts.length > 0 ? facts.join(' · ') : null;
  }

  return null;
}

function buildQueueStages(snapshot: SnapshotRecord, resolveAccountName?: (id: string) => string): QueueStageView[] {
  const doneFlags = QUEUE_STAGE_DEFINITIONS.map((stage) => stage.fields.some((field) => hasSnapshotValue(snapshot, field.key)));
  const firstPending = doneFlags.findIndex((done) => !done);

  return QUEUE_STAGE_DEFINITIONS.map((stage, index) => {
    const state: QueueStageState = doneFlags[index] ? 'done' : index === firstPending ? 'active' : 'pending';
    return {
      key: stage.key,
      label: stage.label,
      state,
      presentLabels: stage.fields.filter((field) => hasSnapshotValue(snapshot, field.key)).map((field) => field.label),
      fact: queueStageFact(stage.key, snapshot, resolveAccountName),
    };
  });
}

function buildQueueDraftSummary(snapshot: SnapshotRecord, resolveAccountName?: (id: string) => string): QueueDraftSummary {
  const trigger = triggerRecord(snapshot);
  const referenceNote = referenceNoteRecord(snapshot);
  const faithfulDraft = objectField(snapshot, 'faithfulDraft');
  const createdContent = objectField(snapshot, 'createdContent');
  const titleSelection = objectField(snapshot, 'titleSelection');
  const imageDirective = objectField(snapshot, 'imageDirective');
  const title =
    stringField(titleSelection, 'title') ??
    stringField(faithfulDraft, 'title') ??
    stringField(createdContent, 'title') ??
    stringField(referenceNote, 'title') ??
    '进行中稿件';
  const sourceTitle = stringField(referenceNote, 'title');
  const accountId = stringField(trigger, 'accountId') ?? stringField(referenceNote, 'accountId');
  const author = stringField(referenceNote, 'author');
  const referenceImageCount = imageCountFrom(referenceNote?.images);
  const generatedImageCount = imageCountFrom(imageDirective?.imageUrls);
  const facts = [
    // 账号一律显示昵称/标签（用户反馈 2026-07-09），解析不到才回落 id。
    accountId ? `账号 ${resolveAccountName?.(accountId) ?? accountId}` : null,
    author ? `作者 ${author}` : null,
    referenceImageCount != null ? `参考图 ${referenceImageCount} 张` : null,
    generatedImageCount != null ? `生成图 ${generatedImageCount} 张` : null,
  ].filter((value): value is string => Boolean(value));

  return { title, sourceTitle, accountId, author, facts };
}

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
      // 账号 = 纯标签展示（Tag），不可点：账号是「归属」标注、非导航目标。
      // 不再拦截点击——点账号格与点整行一致（打开详情）。
      render: (v: string, row) => <Tag>{v || row.accountId}</Tag>,
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

function imageReferenceAuditText(audit: PanelImageReferenceAudit | null): string | null {
  if (!audit || audit.requestedCount <= 0 || audit.status === 'none') return null;
  const prefix = `参考图 ${audit.requestedCount} 张`;
  switch (audit.status) {
    case 'used':
      return `${prefix}；图片模型已实际使用参考图生成新图。`;
    case 'unsupported':
      return `${prefix}；当前图片厂商不支持参考图，配图已按文本重新生成。`;
    case 'unavailable':
      return `${prefix}；参考图不可用，配图已按文本重新生成。`;
    case 'skipped':
      return `${prefix}；本次未使用参考图，配图已按文本重新生成。`;
    default:
      return null;
  }
}

/** 配图栏（查看/编辑共用）：缩略图 + 点击大图预览；诚实标注「实际附着张数」与死链可能。
    可编辑态（editable + onDelete）每张叠删除角标，走乐观 CAS 删配图（change pending-draft-image-delete）。 */
function ImagesStrip({
  row,
  editable = false,
  onDelete,
  deleting = false,
}: {
  row: PanelPublish;
  editable?: boolean;
  onDelete?: (url: string) => void;
  deleting?: boolean;
}) {
  // 防御旧负载：云端未升级/缓存数据无 images 字段时按无图处理，不白屏。
  const images = row.images ?? [];
  if (images.length === 0) return null;
  const auditText = imageReferenceAuditText(row.imageReferenceAudit ?? null);
  const canDelete = editable && !!onDelete;
  return (
    <div style={{ marginBottom: 12 }}>
      <Image.PreviewGroup>
        <Space wrap size={8}>
          {images.map((src, i) => (
            <div key={`${row.id}-${i}`} style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
              <Image
                src={src}
                alt={`配图 ${i + 1}`}
                width={96}
                height={96}
                style={{ objectFit: 'cover', borderRadius: 8 }}
                fallback={IMG_FALLBACK}
              />
              {canDelete ? (
                <Popconfirm
                  title={images.length === 1 ? '删除最后一张配图？该帖将作为纯文字帖发布' : '删除这张配图？'}
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                  onConfirm={() => onDelete!(src)}
                >
                  <Button
                    size="small"
                    danger
                    type="primary"
                    shape="circle"
                    icon={<CloseOutlined />}
                    loading={deleting}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`删除配图 ${i + 1}`}
                    style={{ position: 'absolute', top: -8, right: -8, zIndex: 2, minWidth: 20, width: 20, height: 20 }}
                  />
                </Popconfirm>
              ) : null}
            </div>
          ))}
        </Space>
      </Image.PreviewGroup>
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          配图 {images.length} 张
          {row.imagesAttachedCount > 0 ? `（发布时实际附着 ${row.imagesAttachedCount} 张）` : ''}
          {canDelete ? '；点右上角 × 删除该张' : ''}
          ；较早记录的图片链接可能已过期，无法加载属正常。
        </Typography.Text>
      </div>
      {auditText ? (
        <Alert
          type={row.imageReferenceAudit?.status === 'used' ? 'success' : 'warning'}
          showIcon
          message={auditText}
          style={{ marginTop: 8 }}
        />
      ) : null}
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
  // 并行多轮切换（2026-07-09 用户反馈）：发布队列卡选中查看哪一轮的阶段详情；null=自动跟随最新启动。
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  // 浮层当前打开的记录（含快照 contentVersion）；编辑态本地字段。
  const [viewing, setViewing] = useState<PanelPublish | null>(null);
  const [sourceViewing, setSourceViewing] = useState<PanelPublishSourceReference | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  const accounts = useAccounts();
  // 只看待审走服务端 status 过滤（change parallel-rewrite-drafts）：老 pending 不被全局 50 窗口挤出；
  // 客户端过滤仍兜底（旧 cloud 忽略参数时回落全量）。
  const published = usePublished(accountFilter, pendingOnly ? 'pending_approval' : undefined);
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

  // 删配图（change pending-draft-image-delete）：走同一 draft CAS 通道，只发 images 保留子集补丁；回读真态含删后 images。
  const deleteImage = useMutation({
    mutationFn: (v: { id: number; expectedVersion: number; images: string[] }) =>
      apiPut<{ recordId: number; contentVersion: number; title: string | null; content: string; images: string[] }>(
        `/api/publish/${v.id}/draft`,
        { expectedVersion: v.expectedVersion, images: v.images },
      ),
  });

  const busy = editDraft.isPending || approve.isPending || deleteImage.isPending;

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

  // 删配图：从当前列表移除该 URL（保留子集），走乐观 CAS；成功用后端回读真态刷新（非乐观），删空提示纯文字帖。
  const onDeleteImage = async (url: string) => {
    if (!viewing) return;
    const kept = (viewing.images ?? []).filter((u) => u !== url);
    try {
      const res = await deleteImage.mutateAsync({ id: viewing.id, expectedVersion: viewing.contentVersion, images: kept });
      setViewing({ ...viewing, images: res.images, contentVersion: res.contentVersion });
      patchPublishedRow(viewing.id, { images: res.images, contentVersion: res.contentVersion });
      refreshContent();
      message.success(res.images.length === 0 ? '已删除；本帖将作为纯文字帖发布' : '已删除该配图');
    } catch (err) {
      message.error(reasonMessage(err, '删除失败'));
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
  const queueStatus = queue.data?.status ?? '—';
  // 并行多轮（change parallel-rewrite-drafts）：runs 可空缺（旧 cloud）——回落旧聚合单快照渲染，绝不白屏。
  const queueRuns = queue.data?.runs ?? [];
  // 队列卡任何账号一律显示昵称/标签、绝不裸 id（用户反馈 2026-07-09）；解析不到才回落 id。
  const resolveAccountName = (id: string) => {
    const a = (accounts.data?.accounts ?? []).find((x) => x.accountId === id);
    return a ? accountDisplayName(a.nickname, a.label, a.accountId) : id;
  };
  // 选中轮可切换：显式选择优先；选中轮已收敛消失则回落最新启动的一轮。
  const latestRun = queueRuns.length > 0 ? queueRuns.reduce((a, b) => (b.startedAt >= a.startedAt ? b : a)) : null;
  const selectedRun = queueRuns.find((r) => r.runId === selectedRunId) ?? latestRun;
  // 详情区数据源：有 runs 用选中轮的快照；无 runs（旧 cloud）回落聚合单快照。
  const queueSnapshot = selectedRun
    ? isRecord(selectedRun.snapshot)
      ? selectedRun.snapshot
      : null
    : isRecord(queue.data?.snapshot)
      ? queue.data.snapshot
      : null;
  const queueStages = queueSnapshot ? buildQueueStages(queueSnapshot, resolveAccountName) : [];
  const queueDraft = queueSnapshot ? buildQueueDraftSummary(queueSnapshot, resolveAccountName) : null;
  const rawSnapshotEntries = queueSnapshot ? Object.entries(queueSnapshot) : [];
  // 「进行中」判定：有在跑轮 / 有生成快照 / 状态正在生成。都没有 = 空闲，卡片主体收起、只留标题栏
  //（消除「标题写『进行中』、状态却『空闲』」的文案冲突）。
  const queueActive = queueRuns.length > 0 || !!queueSnapshot || queueStatus === 'running';

  return (
    <div className="page-stack">
      <Card
        size="small"
        title="发布队列"
        className={queueActive ? undefined : 'publish-queue-card--collapsed'}
        extra={
          <Tag color={QUEUE_STATUS_COLOR[queueStatus] ?? 'default'}>
            {QUEUE_STATUS_LABEL[queueStatus] ?? queueStatus}
          </Tag>
        }
      >
        {/* 空闲（无进行中任务）时收起卡片主体，只留标题栏；有进行中任务才展开状态/阶段/原始字段。 */}
        {queueActive ? (
          <>
        {/* 并行多轮切换（change parallel-rewrite-drafts；2026-07-09 用户反馈：每轮详情可切换，不只最新一轮）。 */}
        {queueRuns.length > 0 ? (
          <div className="publish-queue-runs" style={{ marginBottom: 8 }}>
            {queueRuns.length > 1 ? (
              <Segmented
                size="small"
                value={selectedRun?.runId}
                onChange={(v) => setSelectedRunId(String(v))}
                options={queueRuns.map((run) => {
                  const runSnapshot = isRecord(run.snapshot) ? run.snapshot : null;
                  const runStages = runSnapshot ? buildQueueStages(runSnapshot) : [];
                  const done = runStages.filter((s) => s.state === 'done').length;
                  return {
                    value: run.runId,
                    label: `${resolveAccountName(run.accountId)} · ${run.kind === 'rewrite' ? '洗稿' : '自主'} ${done}/${runStages.length || '—'}`,
                  };
                })}
              />
            ) : null}
            {selectedRun ? (
              <Space wrap size={[6, 6]} style={{ marginTop: queueRuns.length > 1 ? 8 : 0 }}>
                <Tag color={selectedRun.kind === 'rewrite' ? 'blue' : 'purple'}>
                  {selectedRun.kind === 'rewrite' ? '参照洗稿' : '自主创作'}
                </Tag>
                <Typography.Text strong>{resolveAccountName(selectedRun.accountId)}</Typography.Text>
                {selectedRun.sourceId ? (
                  <Typography.Text type="secondary" title={selectedRun.sourceId}>
                    参照稿 {queueDraft?.sourceTitle ?? selectedRun.sourceId}
                  </Typography.Text>
                ) : null}
                {queueRuns.length > 1 ? (
                  <Typography.Text type="secondary">并行 {queueRuns.length} 轮生成中，点上方切换查看</Typography.Text>
                ) : null}
              </Space>
            ) : null}
          </div>
        ) : null}
        {queueSnapshot ? (
          <div className="publish-queue-head">
            <Typography.Text type="secondary">已产出 {rawSnapshotEntries.length} 个管道字段</Typography.Text>
          </div>
        ) : null}

        {queueSnapshot && queueDraft ? (
          <div className="publish-queue-overview">
            <div className="publish-queue-draft">
              <div className="publish-queue-draft__main">
                <Typography.Text type="secondary" className="publish-queue-draft__eyebrow">
                  活跃稿件
                </Typography.Text>
                <Typography.Title level={5} className="publish-queue-draft__title" title={queueDraft.title}>
                  {queueDraft.title}
                </Typography.Title>
                {queueDraft.sourceTitle && queueDraft.sourceTitle !== queueDraft.title ? (
                  <Typography.Text type="secondary" className="publish-queue-draft__source" title={queueDraft.sourceTitle}>
                    来源：{queueDraft.sourceTitle}
                  </Typography.Text>
                ) : null}
              </div>
              {queueDraft.facts.length > 0 ? (
                <Space wrap size={[6, 6]} className="publish-queue-draft__facts">
                  {queueDraft.facts.map((fact) => (
                    <Tag key={fact} color="default">{fact}</Tag>
                  ))}
                </Space>
              ) : null}
            </div>

            <div className="publish-queue-stage-strip" aria-label="发布生成阶段">
              {queueStages.map((stage, index) => {
                const visibleLabels = stage.presentLabels.slice(0, 2);
                const extraCount = stage.presentLabels.length - visibleLabels.length;
                return (
                  <div key={stage.key} className={`publish-queue-stage publish-queue-stage--${stage.state}`}>
                    <div className="publish-queue-stage__top">
                      <span className="publish-queue-stage__index">{index + 1}</span>
                      <Typography.Text strong className="publish-queue-stage__label">{stage.label}</Typography.Text>
                      <Tag color={STAGE_STATE_COLOR[stage.state]} className="publish-queue-stage__tag">
                        {STAGE_STATE_LABEL[stage.state]}
                      </Tag>
                    </div>
                    <Typography.Text type="secondary" className="publish-queue-stage__fields">
                      {visibleLabels.length > 0
                        ? `已产出：${visibleLabels.join('、')}${extraCount > 0 ? ` +${extraCount}` : ''}`
                        : stage.state === 'active'
                          ? '正在等待本阶段产出'
                          : '等待上游'}
                    </Typography.Text>
                    {stage.fact ? (
                      <Typography.Text className="publish-queue-stage__fact" title={stage.fact}>
                        {stage.fact}
                      </Typography.Text>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            className="publish-queue-empty"
            description={queueStatus === 'running' ? '生成管道快照尚未写入' : '暂无进行中生成任务'}
          />
        )}

        {/* #18：保留生成管道原始快照（选题/正文/配图等中间产物），阶段摘要未识别的未来字段仍可排查。 */}
        {queueSnapshot ? (
          <Collapse
            size="small"
            ghost
            className="publish-queue-raw"
            items={[
              {
                key: 'snapshot',
                label: `原始字段（${rawSnapshotEntries.length}）`,
                children: (
                  <Descriptions size="small" column={1} bordered>
                    {rawSnapshotEntries.map(([k, v]) => (
                      <Descriptions.Item key={k} label={k}>
                        <Typography.Text style={{ fontSize: 12, wordBreak: 'break-all' }}>
                          {compactJson(v)}
                        </Typography.Text>
                      </Descriptions.Item>
                    ))}
                  </Descriptions>
                ),
              },
            ]}
          />
        ) : null}
          </>
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
                <ImagesStrip row={viewing} editable onDelete={onDeleteImage} deleting={deleteImage.isPending} />
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
                  配图可删（不可增/换，删空将作为纯文字帖）；可见范围 / 话题本期在此不可改（保留原值）。「保存并批准」= 存改动后立即授权，标题被截断则需再确认一次。
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
