import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  Alert,
  App,
  Avatar,
  Button,
  Card,
  Collapse,
  DatePicker,
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
import { apiPost } from '../api/client';
import { errorText } from '../api/errorText';
import { usePublished, useContentQueue, useAccounts } from '../api/queries';
import { ProfileLink } from '../components';
import { QueryError } from '../components/QueryGate';
import type {
  PanelContentVisualCategoryBrief,
  DelegatedTaskDraftReceipt,
  PanelImageReferenceAudit,
  PanelPublish,
  PanelPublishSourceReference,
  PanelVisualReferenceAudit,
  ContentQueueJourney,
  ContentQueueJourneyStatus,
  ContentQueueStageState,
} from '../types/api';
import { accountDisplayName } from '../types/accountDisplay';
import { labelOf } from '../types/aidcp-enums';

const PUBLISH_STATUS_LABEL: Record<string, string> = {
  published: '已发布',
  scheduled: '已定时，待公开',
  submitted: '已提交，待链接确认',
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

const LIFECYCLE_STATUS_LABEL: Record<string, string> = {
  idle: '无活跃稿件',
  running: '执行中',
  waiting_human: '等待人工',
};

const LIFECYCLE_STATUS_COLOR: Record<string, string> = {
  idle: 'default',
  running: 'processing',
  waiting_human: 'warning',
};

const JOURNEY_STATUS_LABEL: Record<ContentQueueJourneyStatus, string> = {
  generating: '生成中',
  waiting_approval: '等待审批',
  dispatching: '平台下发中',
  scheduled: '已定时待公开',
  published: '已发布',
  submitted: '已提交待确认',
  failed: '失败',
  rejected: '已驳回',
  draft: '草稿',
  skipped: '已跳过',
};

const JOURNEY_STATUS_COLOR: Record<ContentQueueJourneyStatus, string> = {
  generating: 'processing',
  waiting_approval: 'warning',
  dispatching: 'processing',
  scheduled: 'cyan',
  published: 'success',
  submitted: 'gold',
  failed: 'error',
  rejected: 'default',
  draft: 'default',
  skipped: 'default',
};

const LIFECYCLE_STAGE_STATE_LABEL: Record<ContentQueueStageState, string> = {
  pending: '未开始',
  running: '进行中',
  retrying: '重试中',
  waiting_human: '等待人工',
  completed: '已完成',
  partial: '部分完成',
  failed: '失败',
  skipped: '已跳过',
};

const LIFECYCLE_STAGE_STATE_COLOR: Record<ContentQueueStageState, string> = {
  pending: 'default',
  running: 'blue',
  retrying: 'orange',
  waiting_human: 'gold',
  completed: 'green',
  partial: 'gold',
  failed: 'red',
  skipped: 'default',
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
      { key: 'referenceVisualAnalysis', label: '整组视觉反推' },
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

function recentAlertType(status: ContentQueueJourneyStatus): 'success' | 'info' | 'warning' | 'error' {
  if (status === 'published') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'submitted' || status === 'scheduled') return 'warning';
  return 'info';
}

function LifecycleJourneyOverview(props: {
  journey: ContentQueueJourney;
  resolveAccountName: (id: string) => string;
}) {
  const { journey, resolveAccountName } = props;
  return (
    <div className="publish-queue-overview">
      {!journey.active ? (
        <Alert
          showIcon
          type={recentAlertType(journey.status)}
          message={`最近结果 · ${labelOf(JOURNEY_STATUS_LABEL, journey.status)}`}
          description={journey.statusSummary}
          className="publish-queue-result-alert"
        />
      ) : null}
      <div className={`publish-queue-draft${journey.active ? '' : ' publish-queue-draft--recent'}`}>
        <div className="publish-queue-draft__main">
          <Typography.Text type="secondary" className="publish-queue-draft__eyebrow">
            {journey.active ? '活跃稿件' : '最近结果'}
          </Typography.Text>
          <Typography.Title level={5} className="publish-queue-draft__title" title={journey.title}>
            {journey.title}
          </Typography.Title>
          {journey.sourceTitle && journey.sourceTitle !== journey.title ? (
            <Typography.Text type="secondary" className="publish-queue-draft__source" title={journey.sourceTitle}>
              来源：{journey.sourceTitle}
            </Typography.Text>
          ) : null}
        </div>
        <Space wrap size={[6, 6]} className="publish-queue-draft__facts">
          <Tag>{resolveAccountName(journey.accountId)}</Tag>
          <Tag color={JOURNEY_STATUS_COLOR[journey.status]}>{labelOf(JOURNEY_STATUS_LABEL, journey.status)}</Tag>
          {journey.recordId != null ? <Tag>记录 #{journey.recordId}</Tag> : null}
        </Space>
      </div>

      <div className="publish-queue-stage-strip publish-queue-stage-strip--lifecycle" aria-label="发布生命周期八阶段">
        {journey.stages.map((stage, index) => (
          <div key={stage.key} className={`publish-queue-stage publish-queue-stage--${stage.state}`}>
            <div className="publish-queue-stage__top">
              <span className="publish-queue-stage__index">{index + 1}</span>
              <Typography.Text strong className="publish-queue-stage__label">{stage.label}</Typography.Text>
              <Tag color={LIFECYCLE_STAGE_STATE_COLOR[stage.state]} className="publish-queue-stage__tag">
                {labelOf(LIFECYCLE_STAGE_STATE_LABEL, stage.state)}
              </Tag>
            </div>
            <Typography.Text type="secondary" className="publish-queue-stage__fields" title={stage.summary}>
              {stage.summary}
            </Typography.Text>
            {stage.facts.length > 0 ? (
              <Typography.Text className="publish-queue-stage__fact" title={stage.facts.join(' · ')}>
                {stage.facts.join(' · ')}
              </Typography.Text>
            ) : null}
            {stage.progress ? (
              <Typography.Text type="secondary" className="publish-queue-stage__progress">
                进度 {stage.progress.current}/{stage.progress.total}
              </Typography.Text>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 编辑/审批的可区分拒因 → 说人话文案（change edit-note-draft-before-publish）。
 * 收口于集中映射 errorText（change console-cloud-panel-hardening #31）：保留本函数签名与调用点，
 * 内部委托到统一的错误码→中文映射，不再各页写死 switch。
 */
function reasonMessage(err: unknown, fallback: string): string {
  return errorText(err, fallback);
}

/** 生命周期标签：待审 / 已编辑待审(琥珀，飞书卡片已失效) / 已提交待链接确认 / 已发布 / 失败 / 已否决。 */
function lifecycleTag(row: Pick<PanelPublish, 'status' | 'contentVersion'>) {
  if (row.status === 'pending_approval') {
    return row.contentVersion > 0 ? (
      <Tag color="gold">已编辑待审 · v{row.contentVersion}</Tag>
    ) : (
      <Tag color="blue">待审</Tag>
    );
  }
  const color = row.status === 'published'
    ? 'green'
    : row.status === 'scheduled'
      ? 'cyan'
      : row.status === 'submitted'
        ? 'gold'
        : row.status === 'failed'
          ? 'red'
          : 'default';
  return <Tag color={color}>{labelOf(PUBLISH_STATUS_LABEL, row.status)}</Tag>;
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

const VISUAL_STATUS_TEXT: Record<string, string> = {
  passed: '保真核验通过', failed: '核验失败', discarded: '重试后丢弃', unverified: '未经视觉核验', skipped: '未执行核验',
};

const VISUAL_SLOT_ROLE_TEXT: Record<string, string> = {
  cover_hook: '封面钩子', context: '交代语境', problem: '呈现问题', explanation: '解释机制', evidence: '提供依据',
  process: '展示过程', contrast: '形成对比', action: '推动行动', conclusion: '收束结论',
};

const VISUAL_AUDIT_MODE_TEXT: Record<string, string> = {
  reference_fidelity: '参考保真', content_alignment: '正文与类型核验', skipped: '未核验',
};

const VISUAL_ROUTE_TEXT: Record<string, string> = {
  generative: '生成式', deterministic_text_card: '确定性文字卡', specialized_generative: '类型专用生成', region_guided_generative: '分区引导生成',
};

export function visualCategoryPresentation(category: PanelContentVisualCategoryBrief): { label: string; lines: string[] } {
  switch (category.kind) {
    case 'portrait_photo':
      return {
        label: '人物摄影',
        lines: [
          `人物表演：${category.facialExpression}；${category.gazeDirection}；${category.headAngle}；${category.bodyLanguage}`,
          `手势与姿态：${category.gesture}；${category.poseEnergy}`,
        ],
      };
    case 'text_layout':
      return {
        label: '文字卡/海报',
        lines: [
          `核心信息：${category.coreMessage}；层级：${category.informationHierarchy.join(' → ') || '未提供'}`,
          `强调：${category.emphasisTerms.join('、') || '无'}；阅读：${category.readingOrder}；密度与结构：${category.informationDensity}；${category.cardStructure}`,
        ],
      };
    case 'infographic_chart':
      return {
        label: '图表信息图',
        lines: [
          `信息主张：${category.claim}；关系：${category.relationship}；对象：${category.entities.join('、') || '未提供'}`,
          `表达路径：${category.direction}；${category.steps.join(' → ') || '无步骤'}；数据边界：${category.dataPolicy}`,
        ],
      };
    case 'scene_photo':
      return {
        label: '场景摄影',
        lines: [
          `场景：${category.timeAndWeather}；${category.location}；人物：${category.humanPresence}`,
          `事件与空间：${category.eventTrace}；${category.spatialRelationship}；动态：${category.motionLevel}`,
        ],
      };
    case 'still_life_photo':
      return {
        label: '静物摄影',
        lines: [
          `核心物件：${category.primaryObjects.join('、') || '未提供'}；使用状态：${category.usageState}`,
          `物件关系：${category.objectRelationship}；生活痕迹：${category.lifeTrace}；材质与互动：${category.materialFocus}；${category.handInteraction}`,
        ],
      };
    case 'illustration_3d':
      return {
        label: '插画/3D',
        lines: [
          `核心隐喻：${category.coreMetaphor}；角色关系：${category.characterRelationship}；象征物：${category.symbols.join('、') || '无'}`,
          `叙事动势：${category.motionDirection}；夸张度：${category.exaggerationLevel}；阶段：${category.storyStage}`,
        ],
      };
    case 'ui_document':
      return {
        label: 'UI/文档',
        lines: [
          `用户任务：${category.userTask}；界面状态：${category.interfaceState}；重点：${category.informationFocus}`,
          `组件与路径：${category.componentHierarchy.join(' → ') || '未提供'}；${category.interactionPath.join(' → ') || '未提供'}；真实性边界：${category.fidelityLabel}`,
        ],
      };
    case 'collage_mixed':
      return {
        label: '混合拼贴',
        lines: [
          `内容分区：${category.regions.map((region) => `${region.role}：${region.content}（${region.priority}）`).join('；')}`,
          `阅读与主次：${category.readingOrder}；${category.primarySecondaryRatio}；连续元素：${category.continuityElements.join('、') || '无'}`,
        ],
      };
  }
}

function VisualReferenceAuditPanel({ audit }: { audit: PanelVisualReferenceAudit | null | undefined }) {
  if (!audit) return null;
  const passed = audit.slots.filter((slot) => slot.finalStatus === 'passed').length;
  const unverified = audit.slots.filter((slot) => slot.finalStatus === 'unverified').length;
  const failed = audit.slots.filter((slot) => slot.finalStatus === 'failed' || slot.finalStatus === 'discarded').length;
  const type = failed > 0 ? 'error' : unverified > 0 ? 'warning' : passed > 0 ? 'success' : 'info';
  const bindingText = audit.bindingMode === 'slot' ? '逐槽主参考' : audit.bindingMode === 'legacy_all' ? '旧版整组共用' : '无参考绑定';
  const hasContentAlignment = audit.slots.some((slot) => slot.auditMode === 'content_alignment');
  const panelTitle = hasContentAlignment ? '原创配图审计' : '参考配图审计';
  return (
    <div style={{ marginTop: 8 }}>
      <Alert
        type={type}
        showIcon
        message={`${panelTitle}：${bindingText}；${passed} 槽通过，${unverified} 槽未核验，${failed} 槽失败/丢弃`}
        description={hasContentAlignment
          ? '没有来源图片时，只核验槽位职责、目标类型与正文表达；不做来源相似度或复制判断。'
          : audit.bindingMode === 'legacy_all' ? '图片模型使用过参考图，不代表生成结果已经通过保真核验。' : undefined}
      />
      <Collapse
        ghost
        size="small"
        items={[{
          key: 'visual-audit',
          label: '查看逐槽视觉审计',
          children: (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {audit.visualSetBrief ? (
                <Card size="small" title="整组视觉计划">
                  <Typography.Paragraph style={{ marginBottom: 4 }}>
                    <Typography.Text strong>叙事推进：</Typography.Text>{audit.visualSetBrief.narrativeArc}
                  </Typography.Paragraph>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
                    连续性：{audit.visualSetBrief.continuityRules.join('；')}
                  </Typography.Paragraph>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    类型组合：{audit.visualSetBrief.typeMixRationale}
                    {audit.visualSetBrief.source === 'fallback' ? '（系统保守兜底）' : ''}
                  </Typography.Paragraph>
                </Card>
              ) : null}
              {audit.slots.map((slot) => {
                const last = slot.attempts[slot.attempts.length - 1];
                const scores = last?.scores;
                const risks = last?.risks;
                const auditMode = slot.auditMode ?? (slot.binding.primarySourceIndex == null ? 'skipped' : 'reference_fidelity');
                const categoryView = slot.contentVisualBrief?.categoryBrief
                  ? visualCategoryPresentation(slot.contentVisualBrief.categoryBrief)
                  : null;
                return (
                  <Card key={slot.slot} size="small">
                    <Space wrap>
                      <Tag>槽 {slot.slot + 1}</Tag>
                      <Tag color={slot.finalStatus === 'passed' ? 'green' : slot.finalStatus === 'unverified' ? 'orange' : slot.finalStatus === 'discarded' || slot.finalStatus === 'failed' ? 'red' : 'default'}>
                        {slot.finalStatus === 'passed' && auditMode === 'content_alignment'
                          ? '正文与类型核验通过'
                          : VISUAL_STATUS_TEXT[slot.finalStatus] ?? slot.finalStatus}
                      </Tag>
                      <Tag color={auditMode === 'content_alignment' ? 'purple' : auditMode === 'reference_fidelity' ? 'blue' : 'default'}>
                        {VISUAL_AUDIT_MODE_TEXT[auditMode] ?? auditMode}
                      </Tag>
                      {slot.slotRole ? <Tag color="geekblue">{VISUAL_SLOT_ROLE_TEXT[slot.slotRole] ?? slot.slotRole}</Tag> : null}
                      <Tag>{VISUAL_ROUTE_TEXT[slot.route] ?? slot.route}</Tag>
                      <Tag color={slot.styleSource === 'reference_analysis' ? 'blue' : 'default'}>
                        {slot.styleSource === 'reference_analysis' ? '源图反推风格' : '品类风格兜底'}
                      </Tag>
                      {auditMode === 'reference_fidelity' ? (
                        <Tag color={slot.providerReferenceStatus === 'used' ? 'cyan' : 'default'}>
                          provider {slot.providerReferenceStatus}
                        </Tag>
                      ) : null}
                    </Space>
                    <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
                      {auditMode === 'content_alignment'
                        ? '审核模式：正文与类型核验；无来源比较'
                        : auditMode === 'reference_fidelity'
                          ? `主参考：${slot.binding.primarySourceIndex == null ? '无' : `源图 #${slot.binding.primarySourceIndex}`}`
                          : '审核模式：未执行视觉核验'}
                      {`；尝试 ${slot.attempts.length} 次`}
                      {last?.reason ? `；${last.reason}` : ''}
                    </Typography.Paragraph>
                    {slot.contentVisualBrief ? (
                      <div style={{ marginBottom: 6 }}>
                        <Typography.Text strong>正文视觉：</Typography.Text>
                        <Typography.Text type="secondary">
                          {slot.contentVisualBrief.emotion}（强度 {slot.contentVisualBrief.emotionIntensity.toFixed(2)}）
                          {`；${slot.contentVisualBrief.narrativeMoment}；动作：${slot.contentVisualBrief.action}；环境：${slot.contentVisualBrief.environment}`}
                        </Typography.Text>
                        {categoryView ? (
                          <div style={{ marginTop: 2 }}>
                            <Tag color="purple">{categoryView.label}</Tag>
                            {categoryView.lines.map((line) => (
                              <Typography.Paragraph key={line} type="secondary" style={{ margin: '2px 0 0' }}>
                                {line}
                              </Typography.Paragraph>
                            ))}
                          </div>
                        ) : slot.contentVisualBrief.facialExpression || slot.contentVisualBrief.gazeDirection || slot.contentVisualBrief.headAngle || slot.contentVisualBrief.bodyLanguage ? (
                          <Typography.Paragraph type="secondary" style={{ margin: '2px 0 0' }}>
                            人物表演：{[
                              slot.contentVisualBrief.facialExpression,
                              slot.contentVisualBrief.gazeDirection,
                              slot.contentVisualBrief.headAngle,
                              slot.contentVisualBrief.bodyLanguage,
                            ].filter(Boolean).join('；')}
                          </Typography.Paragraph>
                        ) : null}
                        {slot.contentVisualBrief.avoid.length ? (
                          <Typography.Paragraph type="secondary" style={{ margin: '2px 0 0' }}>
                            避免：{slot.contentVisualBrief.avoid.join('、')}
                          </Typography.Paragraph>
                        ) : null}
                      </div>
                    ) : null}
                    {scores ? (
                      <Typography.Text type="secondary">
                        形态 {scores.form.toFixed(2)} · 主体 {scores.subject.toFixed(2)} · 构图 {scores.composition.toFixed(2)} · 色彩 {scores.color.toFixed(2)} · 风格 {scores.style.toFixed(2)}
                        {scores.contentAlignment == null ? '' : ` · 正文一致 ${scores.contentAlignment.toFixed(2)}`}
                      </Typography.Text>
                    ) : null}
                    {risks ? (
                      <div style={{ marginTop: 6 }}>
                        {risks.recognizableRealPerson ? <Tag color="red">可识别真人</Tag> : null}
                        {risks.garbledText ? <Tag color="red">乱码</Tag> : null}
                        {risks.watermark ? <Tag color="red">画内水印</Tag> : null}
                        {risks.copyCheck === 'not_applicable' ? <Tag>来源复制检查不适用</Tag> : null}
                        {risks.copyCheck !== 'not_applicable' && risks.copiedText ? <Tag color="red">疑似逐字复制</Tag> : null}
                        <Tag color={risks.originalityRisk === 'high' ? 'red' : risks.originalityRisk === 'medium' ? 'orange' : 'green'}>
                          原创风险 {risks.originalityRisk}
                        </Tag>
                      </div>
                    ) : null}
                  </Card>
                );
              })}
            </Space>
          ),
        }]}
      />
    </div>
  );
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
      <VisualReferenceAuditPanel audit={row.visualReferenceAudit} />
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
  // 发布生命周期切换：新 cloud 用 journeyId；旧 cloud 回落 runId。null=自动跟随最新活跃项。
  const [selectedQueueItemId, setSelectedQueueItemId] = useState<string | null>(null);
  // 浮层当前打开的记录（含快照 contentVersion）；编辑态本地字段。
  const [viewing, setViewing] = useState<PanelPublish | null>(null);
  const [sourceViewing, setSourceViewing] = useState<PanelPublishSourceReference | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editPublishMode, setEditPublishMode] = useState<'immediate' | 'scheduled'>('immediate');
  const [editPublishTime, setEditPublishTime] = useState<number | null>(null);

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
    setEditPublishMode(row.publishMode === 'scheduled' ? 'scheduled' : 'immediate');
    setEditPublishTime(row.publishMode === 'scheduled' ? row.publishTime : null);
  };

  const refreshContent = () => {
    void qc.invalidateQueries({ queryKey: ['content', 'published'] });
    void qc.invalidateQueries({ queryKey: ['content', 'queue'] });
  };

  const candidateTask = useMutation({
    mutationFn: (input: { action: 'modify_candidate' | 'approve_candidate' | 'reject_candidate'; targetConstraints: Record<string, unknown> }) => {
      if (!viewing) throw new Error('candidate_not_selected');
      return apiPost<DelegatedTaskDraftReceipt>('/api/delegated-tasks/draft', {
        accountId: viewing.accountId,
        action: input.action,
        targetSuccessCount: 1,
        maxAttempts: 1,
        deadlineAt: Date.now() + 24 * 60 * 60 * 1000,
        executionWindow: { mode: 'immediate' },
        sourceConstraints: {},
        targetConstraints: {
          candidateId: String(viewing.id),
          candidateVersion: viewing.contentVersion,
          ...input.targetConstraints,
        },
        approvalMode: 'review',
        priority: 'normal',
        source: 'console',
        sourceRef: `candidate:${viewing.id}:v${viewing.contentVersion}:${input.action}`,
      });
    },
    // console 精确入口：候选稿动作即明确指令，云端直接确认入队（不再出「确认用户委托任务」卡）。
    // 入队 ≠ 平台成功；成功状态以平台 / 持久化验证结果为准。
    onSuccess: (res) => {
      message.success(`已排队（任务 ${res.task.id.slice(0, 8)}…）；成功状态以平台验证结果为准`);
      setViewing(null);
      refreshContent();
    },
    onError: (err) => message.error(reasonMessage(err, '创建委托失败')),
  });

  const busy = candidateTask.isPending;
  const hasTextEdits = !!viewing && (editTitle !== (viewing.title ?? '') || editContent !== (viewing.content ?? ''));
  const originalPublishMode = viewing?.publishMode === 'scheduled' ? 'scheduled' : 'immediate';
  const hasScheduleEdits = !!viewing && (
    editPublishMode !== originalPublishMode ||
    (editPublishMode === 'scheduled' && editPublishTime !== viewing.publishTime)
  );
  const hasEdits = hasTextEdits || hasScheduleEdits;
  const scheduleValid = editPublishMode === 'immediate' || (
    editPublishTime !== null &&
    editPublishTime >= Date.now() + 60 * 60 * 1000 &&
    editPublishTime <= Date.now() + 14 * 24 * 60 * 60 * 1000
  );
  const editPatch = () => ({
    title: editTitle,
    content: editContent,
    publishMode: editPublishMode,
    publishTime: editPublishMode === 'scheduled' ? editPublishTime : null,
  });

  const onSaveDraft = () => {
    if (!viewing || !hasEdits || !scheduleValid) return;
    candidateTask.mutate({ action: 'modify_candidate', targetConstraints: editPatch() });
  };

  const onSaveAndApprove = () => {
    if (!viewing) return;
    if (!scheduleValid) return;
    if (hasEdits) {
      candidateTask.mutate({ action: 'modify_candidate', targetConstraints: editPatch() });
      return;
    }
    candidateTask.mutate({ action: 'approve_candidate', targetConstraints: {} });
  };

  // 删配图：从当前列表移除该 URL（保留子集），走乐观 CAS；成功用后端回读真态刷新（非乐观），删空提示纯文字帖。
  const onDeleteImage = async (url: string) => {
    if (!viewing) return;
    const kept = (viewing.images ?? []).filter((u) => u !== url);
    candidateTask.mutate({ action: 'modify_candidate', targetConstraints: { images: kept } });
  };

  // 驳回：终态否决（携带版本快照）。
  const onReject = async () => {
    if (!viewing) return;
    candidateTask.mutate({ action: 'reject_candidate', targetConstraints: {} });
  };

  const accountOptions = [
    { label: '全部账号', value: '' },
    ...(accounts.data?.accounts ?? []).map((a) => ({
      label: accountDisplayName(a.nickname, a.label, a.accountId),
      value: a.accountId,
    })),
  ];
  const queueStatus = queue.data?.status ?? '—';
  const lifecycle = queue.data?.lifecycle;
  const lifecycleActive = lifecycle?.active ?? [];
  const lifecycleRecent = lifecycle?.recent ?? [];
  const selectedJourney = lifecycleActive.find((item) => item.journeyId === selectedQueueItemId)
    ?? lifecycleActive[0]
    ?? lifecycleRecent[0]
    ?? null;
  // 并行多轮（change parallel-rewrite-drafts）：runs 可空缺（旧 cloud）——回落旧聚合单快照渲染，绝不白屏。
  const queueRuns = queue.data?.runs ?? [];
  // 队列卡任何账号一律显示昵称/标签、绝不裸 id（用户反馈 2026-07-09）；解析不到才回落 id。
  const resolveAccountName = (id: string) => {
    const a = (accounts.data?.accounts ?? []).find((x) => x.accountId === id);
    return a ? accountDisplayName(a.nickname, a.label, a.accountId) : id;
  };
  // 选中轮可切换：显式选择优先；选中轮已收敛消失则回落最新启动的一轮。
  const latestRun = queueRuns.length > 0 ? queueRuns.reduce((a, b) => (b.startedAt >= a.startedAt ? b : a)) : null;
  const selectedRun = queueRuns.find((r) => r.runId === selectedQueueItemId) ?? latestRun;
  // 详情区数据源：有 runs 用选中轮的快照；无 runs（旧 cloud）回落聚合单快照。
  const queueSnapshot = lifecycle
    ? isRecord(selectedJourney?.snapshot) ? selectedJourney.snapshot : null
    : selectedRun
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
  const queueActive = lifecycle ? lifecycleActive.length > 0 : queueRuns.length > 0 || !!queueSnapshot || queueStatus === 'running';
  const queueHasDetails = lifecycle ? selectedJourney !== null : queueActive;
  const visibleQueueStatus = lifecycle?.status ?? queueStatus;

  return (
    <div className="page-stack">
      <Card
        size="small"
        title="发布队列"
        className={queueHasDetails ? undefined : 'publish-queue-card--collapsed'}
        extra={
          <Tag color={(lifecycle ? LIFECYCLE_STATUS_COLOR : QUEUE_STATUS_COLOR)[visibleQueueStatus] ?? 'default'}>
            {(lifecycle ? LIFECYCLE_STATUS_LABEL : QUEUE_STATUS_LABEL)[visibleQueueStatus] ?? visibleQueueStatus}
          </Tag>
        }
      >
        {lifecycle ? (
          selectedJourney ? (
            <>
              {lifecycleActive.length > 0 ? (
                <div className="publish-queue-runs">
                  <Space wrap size={[8, 8]}>
                    <Typography.Text type="secondary">活跃稿件 {lifecycleActive.length}</Typography.Text>
                    {lifecycleActive.length > 1 ? (
                      <Select
                        size="small"
                        className="publish-queue-journey-select"
                        value={selectedJourney.active ? selectedJourney.journeyId : lifecycleActive[0].journeyId}
                        onChange={setSelectedQueueItemId}
                        options={lifecycleActive.map((item) => ({
                          value: item.journeyId,
                          label: `${resolveAccountName(item.accountId)} · ${item.title} · ${labelOf(JOURNEY_STATUS_LABEL, item.status)}`,
                        }))}
                      />
                    ) : null}
                  </Space>
                </div>
              ) : null}
              <LifecycleJourneyOverview journey={selectedJourney} resolveAccountName={resolveAccountName} />
              {queueSnapshot ? (
                <Collapse
                  size="small"
                  ghost
                  className="publish-queue-raw"
                  items={[{
                    key: 'snapshot',
                    label: `原始字段（${rawSnapshotEntries.length}）`,
                    children: (
                      <Descriptions size="small" column={1} bordered>
                        {rawSnapshotEntries.map(([k, v]) => (
                          <Descriptions.Item key={k} label={k}>
                            <Typography.Text style={{ fontSize: 12, wordBreak: 'break-all' }}>{compactJson(v)}</Typography.Text>
                          </Descriptions.Item>
                        ))}
                      </Descriptions>
                    ),
                  }]}
                />
              ) : null}
            </>
          ) : null
        ) : queueActive ? (
          <>
        {/* 并行多轮切换（change parallel-rewrite-drafts；2026-07-09 用户反馈：每轮详情可切换，不只最新一轮）。 */}
        {queueRuns.length > 0 ? (
          <div className="publish-queue-runs" style={{ marginBottom: 8 }}>
            {queueRuns.length > 1 ? (
              <Segmented
                size="small"
                value={selectedRun?.runId}
                onChange={(v) => setSelectedQueueItemId(String(v))}
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
                        {labelOf(STAGE_STATE_LABEL, stage.state)}
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
              <Button onClick={onSaveDraft} loading={busy} disabled={!hasEdits || !scheduleValid}>
                创建修改任务
              </Button>
              <Button type="primary" loading={busy} onClick={onSaveAndApprove} disabled={!scheduleValid}>
                {hasEdits ? '先提交修改任务' : '创建批准任务'}
              </Button>
              <Button danger loading={busy} onClick={onReject}>
                创建驳回任务
              </Button>
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
                <ImagesStrip row={viewing} editable onDelete={onDeleteImage} deleting={candidateTask.isPending} />
                <div>
                  <Typography.Text type="secondary">正文</Typography.Text>
                  <Input.TextArea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    autoSize={{ minRows: 8, maxRows: 24 }}
                    placeholder="正文"
                  />
                </div>
                {viewing.platform === 'xiaohongshu' ? (
                  <div>
                    <Typography.Text type="secondary">发布时机</Typography.Text>
                    <div style={{ marginTop: 6 }}>
                      <Space wrap>
                        <Segmented<'immediate' | 'scheduled'>
                          value={editPublishMode}
                          options={[
                            { label: '审核后立即发布', value: 'immediate' },
                            { label: '定时发布', value: 'scheduled' },
                          ]}
                          onChange={setEditPublishMode}
                        />
                        {editPublishMode === 'scheduled' ? (
                          <DatePicker
                            showTime={{ format: 'HH:mm' }}
                            format="YYYY-MM-DD HH:mm"
                            minuteStep={1}
                            value={editPublishTime === null ? null : dayjs(editPublishTime)}
                            minDate={dayjs().add(1, 'hour')}
                            maxDate={dayjs().add(14, 'day')}
                            status={scheduleValid ? undefined : 'error'}
                            onChange={(value) => setEditPublishTime(value ? value.valueOf() : null)}
                            placeholder="选择 1 小时至 14 天内时间"
                          />
                        ) : null}
                      </Space>
                    </div>
                    <Typography.Text type={scheduleValid ? 'secondary' : 'danger'}>
                      定时设置在标题、正文、配图、话题与发布选项完成后应用；小红书仅接受当前时间后 1 小时至 14 天。
                    </Typography.Text>
                  </div>
                ) : null}
                <Typography.Text type="secondary">
                  配图可删（不可增/换，删空将作为纯文字帖）；可见范围 / 话题本期在此不可改。修改、批准、驳回都会先生成结构化确认卡；有未提交改动时必须先完成修改任务，再另行批准。
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
                  {viewing.publishMode === 'scheduled' && viewing.publishTime !== null ? (
                    <Typography.Text type="secondary">
                      计划公开：{new Date(viewing.publishTime).toLocaleString()}
                      {viewing.status === 'scheduled' ? '（待平台公开与对账）' : ''}
                    </Typography.Text>
                  ) : null}
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
