import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Radio,
  Result,
  Select,
  Skeleton,
  Space,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ApiOutlined,
  AuditOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  LockOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { ApiError } from '../api/client';
import {
  archiveReplyTemplate,
  deleteReplyRule,
  initializeReplyConfig,
  loadReplyAudit,
  loadReplyConfig,
  previewReply,
  publishReplyConfig,
  saveReplyPolicy,
  saveReplyProfiles,
  saveReplyRule,
  saveReplyTemplate,
  saveRuntimeControls,
} from '../api/interactionReplyConfig';
import { errorText } from '../api/errorText';
import { accountName } from '../types/accountDisplay';
import type { PanelAccount } from '../types/api';
import { labelOf } from '../types/aidcp-enums';
import type {
  AuditAction,
  AuditItem,
  InteractionChannel,
  InteractionErrorDetails,
  InteractionMessageType,
  PreviewAction,
  PreviewConfigUse,
  PreviewResult,
  ReplyConfigSnapshot,
  ReplyIntent,
  ReplyProfile,
  ReplyRule,
  ReplyTemplate,
  ReplyTone,
  RiskLevel,
  RiskTag,
  ValidationIssue,
} from '../types/interactionReplyConfig';
import {
  collectLocalValidationIssues,
  findObviousRuleConflicts,
  inspectTemplateVariables,
  TEMPLATE_VARIABLE_LABEL,
  TEMPLATE_VARIABLES,
} from './wechatChannelsReplyValidation';
import {
  applyReplyProcessingMode,
  isCanonicalReplyProcessingPolicy,
  REPLY_PROCESSING_MODES,
  replyProcessingModeMetaOf,
  replyProcessingModeOf,
  type ReplyProcessingMode,
} from './wechatChannelsReplyMode';

type DirtySection = 'runtime' | 'policy' | 'profiles';
type DirtyState = Record<DirtySection, boolean>;
type PermissionKind = 'edit' | 'publish' | 'preview';

const CLEAN_DIRTY: DirtyState = { runtime: false, policy: false, profiles: false };
const CHANNEL_LABEL: Record<InteractionChannel, string> = { comment: '评论', dm: '私信' };
const COMMENT_PREVIEW_PERMISSION_ERROR = '当前后台账号没有模拟预览权限（interaction.config.preview），Cloud 预览链路未运行。';
const DM_PREVIEW_PERMISSION_ERROR = '当前后台账号缺少私信预览权限（interaction.config.preview 与 interaction.dm.view_full），Cloud 预览链路未运行。';
const PREVIEW_ACTION_META: Record<PreviewAction, { label: string; color: string }> = {
  draft: { label: '生成草稿', color: 'blue' },
  review_required: { label: '需要人工审核', color: 'gold' },
  would_auto_send: { label: '符合自动发送条件', color: 'green' },
  no_match: { label: '没有命中规则', color: 'default' },
  blocked: { label: '被风险门禁阻断', color: 'red' },
};
const RISK_LEVEL_META: Record<RiskLevel, { label: string; color: string }> = {
  low: { label: '低风险', color: 'green' },
  medium: { label: '中风险', color: 'gold' },
  high: { label: '高风险', color: 'red' },
  unknown: { label: '风险未知', color: 'default' },
};
const INTENTS: ReplyIntent[] = [
  'gratitude',
  'general_question',
  'product_question',
  'support_request',
  'complaint',
  'order',
  'refund',
  'pricing',
  'promotion',
  'inventory',
  'shipping',
  'personal_data',
  'medical',
  'legal',
  'abuse',
  'minor_safety',
  'other',
  'unknown',
];
const RISK_TAGS: RiskTag[] = [
  'order',
  'refund',
  'after_sales',
  'pricing',
  'promotion',
  'inventory',
  'shipping',
  'personal_data',
  'complaint',
  'dispute',
  'legal',
  'medical',
  'safety',
  'abuse',
  'minor_safety',
  'meaning_changed',
  'introduced_claim',
  'unknown',
];
const RISK_TAG_LABEL: Record<RiskTag, string> = {
  order: '订单',
  refund: '退款',
  after_sales: '售后',
  pricing: '价格',
  promotion: '促销',
  inventory: '库存',
  shipping: '发货',
  personal_data: '个人信息',
  complaint: '投诉',
  dispute: '争议',
  legal: '法律',
  medical: '医疗',
  safety: '安全',
  abuse: '辱骂骚扰',
  minor_safety: '未成年人',
  meaning_changed: '改义',
  introduced_claim: '新增承诺',
  unknown: '未知',
};
const TONE_LABEL: Record<ReplyTone, string> = {
  professional: '专业',
  friendly: '亲切',
  concise: '简洁',
};
const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  draft_saved: '保存草稿',
  template_archived: '归档模板',
  config_initialized: '创建安全草稿',
  config_published: '发布配置',
  previewed: '运行预览',
};

/** 已知审计动作显示中文；未知未来 wire 值原样展示，避免空标签或枚举漂移白屏。 */
export function auditActionLabel(action: string): string {
  return labelOf(AUDIT_ACTION_LABEL, action);
}
const HARD_GATES = [
  '没有有效 published 配置，或模板变量缺失安全兜底',
  '登录非 active、账号身份不一致或写 capability 不可用',
  '订单、退款、售后、价格、促销、库存、发货及个人信息',
  '投诉争议、法律医疗、安全、辱骂骚扰与未成年人内容',
  'AI 改变原意、引入新承诺、置信度不足或风险未知',
  '重复/状态冲突、存在 active 或待核验发送、限速或连续失败熔断',
];

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isPermissionDenied(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.message === 'INTERACTION_PERMISSION_DENIED');
}

function isVersionConflict(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.message === 'INTERACTION_VERSION_CONFLICT') return true;
  // 兼容旧端点的无细分 409；新版 INTERACTION_STATE_CONFLICT 仍按真实错误文案展示。
  return error.status === 409 && !error.message.startsWith('INTERACTION_');
}

function isConfigMissing(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.message === 'INTERACTION_CONFIG_MISSING';
}

function errorDetails(error: unknown): InteractionErrorDetails {
  return error instanceof ApiError && error.details && typeof error.details === 'object'
    ? (error.details as InteractionErrorDetails)
    : {};
}

function formatTime(value: number | null | undefined): string {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '—';
}

function opaqueId(prefix: 'template' | 'rule'): string {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replaceAll('-', '')
    : `${Date.now()}${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${suffix}`;
}

function copySnapshot(snapshot: ReplyConfigSnapshot): ReplyConfigSnapshot {
  return structuredClone(snapshot);
}

function updateAt<T>(items: T[], index: number, value: T): T[] {
  return items.map((item, itemIndex) => (itemIndex === index ? value : item));
}

function statusText(enabled: boolean): ReactNode {
  return enabled ? <Tag color="green">已开启</Tag> : <Tag>已关闭</Tag>;
}

function channelProcessingSummary(
  enabled: boolean,
  allowAutoSend: boolean,
  processingMode: ReplyProcessingMode,
): string {
  if (!enabled) return '不处理（读取开关独立）';
  if (processingMode === 'off') return '已选参与，当前账号不自动处理';
  if (processingMode === 'draft') return '处理，只生成草稿';
  if (processingMode === 'review') return '处理，全部人工审核';
  return allowAutoSend ? '处理，低风险模板可自动发送' : '处理，全部人工审核';
}

interface TemplateEditorState {
  mode: 'create' | 'edit' | 'version';
  template: ReplyTemplate;
}

interface RuleEditorState {
  mode: 'create' | 'edit';
  rule: ReplyRule;
}

interface PreviewInput {
  use: PreviewConfigUse;
  channel: InteractionChannel;
  messageType: InteractionMessageType;
  userMessage: string;
  videoTitle: string;
  userName: string;
}

const DEFAULT_PREVIEW: PreviewInput = {
  use: 'draft',
  channel: 'comment',
  messageType: 'text',
  userMessage: '',
  videoTitle: '',
  userName: '',
};

export function WechatChannelsReplySettings({
  account,
  open,
  onClose,
}: {
  account: PanelAccount | null;
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const requestController = useRef<AbortController | null>(null);
  const auditPageController = useRef<AbortController | null>(null);
  const activeAccountId = useRef<string | null>(null);
  const dirtyRef = useRef<DirtyState>(CLEAN_DIRTY);
  const [snapshot, setSnapshot] = useState<ReplyConfigSnapshot | null>(null);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [auditNextCursor, setAuditNextCursor] = useState<string | null>(null);
  const [auditPageState, setAuditPageState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<'permission' | 'missing' | 'error' | null>(null);
  const [auditState, setAuditState] = useState<'loading' | 'ready' | 'permission' | 'error'>('loading');
  const [dirty, setDirty] = useState<DirtyState>(CLEAN_DIRTY);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [editDenied, setEditDenied] = useState(false);
  const [publishDenied, setPublishDenied] = useState(false);
  const [previewDenied, setPreviewDenied] = useState(false);
  const [dmPreviewDenied, setDmPreviewDenied] = useState(false);
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState('strategy');
  const [templateChannel, setTemplateChannel] = useState<InteractionChannel>('comment');
  const [profileChannel, setProfileChannel] = useState<InteractionChannel>('comment');
  const [templateEditor, setTemplateEditor] = useState<TemplateEditorState | null>(null);
  const [templateEditorError, setTemplateEditorError] = useState<string | null>(null);
  const [ruleEditor, setRuleEditor] = useState<RuleEditorState | null>(null);
  const [ruleEditorError, setRuleEditorError] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishIssues, setPublishIssues] = useState<ValidationIssue[]>([]);
  const [previewInput, setPreviewInput] = useState<PreviewInput>(DEFAULT_PREVIEW);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  dirtyRef.current = dirty;
  activeAccountId.current = open ? (account?.accountId ?? null) : null;

  const resetScopedState = useCallback(() => {
    auditPageController.current?.abort();
    auditPageController.current = null;
    setSnapshot(null);
    setAuditItems([]);
    setAuditNextCursor(null);
    setAuditPageState('idle');
    setLoadError(null);
    setAuditState('loading');
    setDirty(CLEAN_DIRTY);
    dirtyRef.current = CLEAN_DIRTY;
    setPendingAction(null);
    setEditDenied(false);
    setPublishDenied(false);
    setPreviewDenied(false);
    setDmPreviewDenied(false);
    setConflictVersion(null);
    setActiveTab('strategy');
    setTemplateChannel('comment');
    setProfileChannel('comment');
    setTemplateEditor(null);
    setRuleEditor(null);
    setPublishOpen(false);
    setPublishIssues([]);
    setPreviewInput(DEFAULT_PREVIEW);
    setPreviewResult(null);
    setPreviewError(null);
  }, []);

  const loadAccount = useCallback(async (accountId: string) => {
    requestController.current?.abort();
    auditPageController.current?.abort();
    auditPageController.current = null;
    const controller = new AbortController();
    requestController.current = controller;
    setLoading(true);
    setLoadError(null);
    setSnapshot(null);
    setAuditItems([]);
    setAuditNextCursor(null);
    setAuditPageState('idle');
    setAuditState('loading');

    const auditPromise = loadReplyAudit(accountId, controller.signal)
      .then((value) => ({ value, error: null as unknown }))
      .catch((error: unknown) => ({ value: null, error }));
    try {
      const next = await loadReplyConfig(accountId, controller.signal);
      if (activeAccountId.current !== accountId || controller.signal.aborted) return;
      setSnapshot(copySnapshot(next));
      setDirty(CLEAN_DIRTY);
      dirtyRef.current = CLEAN_DIRTY;
      setLoading(false);
    } catch (error) {
      if (isAbort(error)) return;
      if (activeAccountId.current !== accountId) return;
      controller.abort();
      setLoading(false);
      setLoadError(isPermissionDenied(error) ? 'permission' : isConfigMissing(error) ? 'missing' : 'error');
      return;
    }

    try {
      const auditResult = await auditPromise;
      if (auditResult.error) throw auditResult.error;
      const audit = auditResult.value;
      if (!audit) throw new Error('reply_audit_missing');
      if (activeAccountId.current !== accountId || controller.signal.aborted) return;
      setAuditItems(audit.data.items);
      setAuditNextCursor(audit.data.nextCursor);
      setAuditState('ready');
    } catch (error) {
      if (isAbort(error) || activeAccountId.current !== accountId) return;
      setAuditState(isPermissionDenied(error) ? 'permission' : 'error');
    }
  }, []);

  useEffect(() => {
    requestController.current?.abort();
    auditPageController.current?.abort();
    resetScopedState();
    if (open && account?.accountId) void loadAccount(account.accountId);
    return () => {
      requestController.current?.abort();
      auditPageController.current?.abort();
    };
  }, [account?.accountId, loadAccount, open, resetScopedState]);

  const refreshAfterWrite = useCallback(async (accountId: string, saved: DirtySection | 'templates' | 'rules') => {
    const controller = new AbortController();
    requestController.current?.abort();
    auditPageController.current?.abort();
    auditPageController.current = null;
    setAuditPageState('idle');
    requestController.current = controller;
    const next = await loadReplyConfig(accountId, controller.signal);
    if (activeAccountId.current !== accountId || controller.signal.aborted) return;
    setSnapshot((previous) => {
      if (!previous) return copySnapshot(next);
      const currentDirty = dirtyRef.current;
      return {
        ...copySnapshot(next),
        runtime: currentDirty.runtime && saved !== 'runtime' ? previous.runtime : next.runtime,
        policy: currentDirty.policy && saved !== 'policy' ? previous.policy : next.policy,
        profiles: currentDirty.profiles && saved !== 'profiles' ? previous.profiles : next.profiles,
      };
    });
    if (saved === 'runtime' || saved === 'policy' || saved === 'profiles') {
      setDirty((current) => ({ ...current, [saved]: false }));
    }
    setConflictVersion(null);

    try {
      const audit = await loadReplyAudit(accountId, controller.signal);
      if (activeAccountId.current === accountId && !controller.signal.aborted) {
        setAuditItems(audit.data.items);
        setAuditNextCursor(audit.data.nextCursor);
        setAuditState('ready');
      }
    } catch (error) {
      if (!isAbort(error) && activeAccountId.current === accountId) {
        setAuditState(isPermissionDenied(error) ? 'permission' : 'error');
      }
    }
  }, []);

  const loadMoreAudit = useCallback(async () => {
    const accountId = account?.accountId;
    const cursor = auditNextCursor;
    if (!accountId || !cursor || auditPageState === 'loading') return;

    auditPageController.current?.abort();
    const controller = new AbortController();
    auditPageController.current = controller;
    setAuditPageState('loading');
    try {
      const audit = await loadReplyAudit(accountId, controller.signal, cursor);
      if (activeAccountId.current !== accountId || controller.signal.aborted) return;
      setAuditItems((current) => {
        const seen = new Set(current.map((item) => item.eventId));
        return [...current, ...audit.data.items.filter((item) => !seen.has(item.eventId))];
      });
      setAuditNextCursor(audit.data.nextCursor);
      setAuditPageState('idle');
    } catch (error) {
      if (isAbort(error) || activeAccountId.current !== accountId) return;
      setAuditPageState('error');
    } finally {
      if (auditPageController.current === controller) auditPageController.current = null;
    }
  }, [account?.accountId, auditNextCursor, auditPageState]);

  const handleMutationError = useCallback((error: unknown, permission: PermissionKind, fallback: string) => {
    if (isPermissionDenied(error)) {
      if (permission === 'edit') setEditDenied(true);
      if (permission === 'publish') setPublishDenied(true);
      if (permission === 'preview') setPreviewDenied(true);
      message.error('权限不足，操作未执行');
      return;
    }
    if (isVersionConflict(error)) {
      setConflictVersion(errorDetails(error).currentVersion ?? null);
      message.error('配置已被其他管理员更新，本次操作未保存');
      return;
    }
    message.error(errorText(error, fallback));
  }, [message]);

  const initializeMissingConfig = useCallback(async () => {
    if (!account || pendingAction !== null) return;
    const accountId = account.accountId;
    setPendingAction('initialize');
    setEditDenied(false);
    try {
      const response = await initializeReplyConfig(accountId, { expectedVersion: 0 });
      if (activeAccountId.current !== accountId) return;
      message.success(`已创建安全草稿 v${response.data.initializedVersion}，尚未发布`);
      await loadAccount(accountId);
    } catch (error) {
      if (activeAccountId.current !== accountId || isAbort(error)) return;
      if (isPermissionDenied(error)) {
        setEditDenied(true);
        message.error('缺少 interaction.config.edit 权限，未创建配置');
      } else if (isVersionConflict(error)) {
        message.info('配置已由其他管理员创建，正在读取最新状态');
        await loadAccount(accountId);
      } else {
        message.error(errorText(error, '创建安全草稿失败'));
      }
    } finally {
      if (activeAccountId.current === accountId) setPendingAction(null);
    }
  }, [account, loadAccount, message, pendingAction]);

  const runWrite = useCallback(async (
    action: string,
    successText: string,
    saved: DirtySection | 'templates' | 'rules',
    write: () => Promise<unknown>,
  ) => {
    const accountId = account?.accountId;
    if (!accountId) return false;
    setPendingAction(action);
    let wrote = false;
    try {
      await write();
      wrote = true;
      await refreshAfterWrite(accountId, saved);
      if (activeAccountId.current === accountId) message.success(successText);
      return true;
    } catch (error) {
      if (isAbort(error)) return false;
      if (activeAccountId.current !== accountId) return false;
      if (wrote) message.warning('Cloud 已接受保存，但重新读取真态失败，请点击刷新确认');
      else handleMutationError(error, 'edit', `${successText}失败`);
      return false;
    } finally {
      if (activeAccountId.current === accountId) setPendingAction(null);
    }
  }, [account?.accountId, handleMutationError, message, refreshAfterWrite]);

  const markDirty = (section: DirtySection) => {
    setDirty((current) => ({ ...current, [section]: true }));
    setConflictVersion(null);
  };

  const mutateSnapshot = (section: DirtySection, updater: (current: ReplyConfigSnapshot) => ReplyConfigSnapshot) => {
    setSnapshot((current) => (current ? updater(current) : current));
    markDirty(section);
  };

  const changePreviewInput = (patch: Partial<PreviewInput>) => {
    setPreviewInput((current) => ({ ...current, ...patch }));
    setPreviewResult(null);
    setPreviewError(null);
  };

  const saveRuntime = () => {
    if (!snapshot || !account) return;
    const runtime = snapshot.runtime;
    void runWrite('runtime', '运行时开关已保存', 'runtime', () =>
      saveRuntimeControls(account.accountId, {
        expectedVersion: runtime.version,
        commentsReadEnabled: runtime.commentsReadEnabled,
        commentsReplyEnabled: runtime.commentsReplyEnabled,
        dmReadEnabled: runtime.dmReadEnabled,
        dmSendTextEnabled: runtime.dmSendTextEnabled,
        dmSendImageEnabled: false,
        writePaused: runtime.writePaused,
      }),
    );
  };

  const savePolicy = () => {
    if (!snapshot || !account) return;
    void runWrite('policy', '回复策略草稿已保存', 'policy', () =>
      saveReplyPolicy(account.accountId, {
        expectedVersion: snapshot.head.currentVersion,
        policy: snapshot.policy,
      }),
    );
  };

  const saveProfiles = () => {
    if (!snapshot || !account) return;
    void runWrite('profiles', '品牌语气草稿已保存', 'profiles', () =>
      saveReplyProfiles(account.accountId, {
        expectedVersion: snapshot.head.currentVersion,
        profiles: snapshot.profiles,
      }),
    );
  };

  const localIssues = useMemo(
    () => (snapshot ? collectLocalValidationIssues(snapshot.templates, snapshot.rules, snapshot.profiles) : []),
    [snapshot],
  );
  const hasDirty = dirty.runtime || dirty.policy || dirty.profiles;

  const openCreateTemplate = () => {
    if (!snapshot) return;
    setTemplateEditorError(null);
    setTemplateEditor({
      mode: 'create',
      template: {
        templateId: opaqueId('template'),
        channel: templateChannel,
        name: '',
        content: '',
        enabled: true,
        archived: false,
        templateVersion: 1,
        variables: [],
        updatedAt: Date.now(),
        updatedBy: snapshot.head.updatedBy,
      },
    });
  };

  const submitTemplate = async () => {
    if (!snapshot || !account || !templateEditor) return;
    const template = templateEditor.template;
    const variableInspection = inspectTemplateVariables(template.content);
    if (!template.name.trim() || !template.content.trim()) {
      setTemplateEditorError('模板名称和正文不能为空。');
      return;
    }
    if (variableInspection.unknownTokens.length) {
      setTemplateEditorError(`请先移除未知变量：${variableInspection.unknownTokens.join('、')}`);
      return;
    }
    const next = { ...template, name: template.name.trim(), variables: variableInspection.variables };
    const success = await runWrite('template', '模板草稿已保存', 'templates', () =>
      saveReplyTemplate(
        account.accountId,
        { expectedVersion: snapshot.head.currentVersion, template: next },
        templateEditor.mode !== 'create',
      ),
    );
    if (success) setTemplateEditor(null);
  };

  const handleArchiveTemplate = async (template: ReplyTemplate) => {
    if (!snapshot || !account) return;
    const references = snapshot.rules.filter(
      (rule) => rule.enabled && rule.actions.templateId === template.templateId,
    );
    if (references.length) {
      message.warning(`仍被 ${references.length} 条启用规则引用，请先调整规则`);
      return;
    }
    await runWrite('template-archive', '模板已归档', 'templates', () =>
      archiveReplyTemplate(account.accountId, template.templateId, snapshot.head.currentVersion),
    );
  };

  const openCreateRule = () => {
    if (!snapshot) return;
    const template = snapshot.templates.find(
      (item) => item.channel === templateChannel && item.enabled && !item.archived,
    );
    setRuleEditorError(null);
    setRuleEditor({
      mode: 'create',
      rule: {
        ruleId: opaqueId('rule'),
        channel: templateChannel,
        name: '',
        priority: 100,
        enabled: true,
        conditions: {
          keywordsAny: [],
          intentsAny: [],
          sourceExternalIds: [],
          messageTypes: ['text'],
          workHours: null,
        },
        actions: {
          templateId: template?.templateId ?? '',
          polish: templateChannel === 'comment',
          allowAutoSend: false,
          forceHumanTags: [],
        },
        updatedAt: Date.now(),
        updatedBy: snapshot.head.updatedBy,
      },
    });
  };

  const submitRule = async () => {
    if (!snapshot || !account || !ruleEditor) return;
    const rule = ruleEditor.rule;
    const template = snapshot.templates.find(
      (item) => item.templateId === rule.actions.templateId && item.enabled && !item.archived,
    );
    if (!rule.name.trim() || !template || !rule.conditions.messageTypes.length) {
      setRuleEditorError('规则名称、可用模板和至少一种消息类型为必填项。');
      return;
    }
    if (template.channel !== rule.channel) {
      setRuleEditorError('规则与模板渠道必须一致。');
      return;
    }
    const candidate = {
      ...rule,
      name: rule.name.trim(),
      actions: {
        ...rule.actions,
        allowAutoSend: rule.actions.polish ? false : rule.actions.allowAutoSend,
      },
    };
    const peers = snapshot.rules.filter((item) => item.ruleId !== candidate.ruleId);
    if (findObviousRuleConflicts([...peers, candidate]).length) {
      setRuleEditorError('已有同渠道、同优先级、同条件但使用不同模板的规则，请调整优先级或条件。');
      return;
    }
    const success = await runWrite('rule', '匹配规则草稿已保存', 'rules', () =>
      saveReplyRule(
        account.accountId,
        { expectedVersion: snapshot.head.currentVersion, rule: candidate },
        ruleEditor.mode === 'edit',
      ),
    );
    if (success) setRuleEditor(null);
  };

  const handleDeleteRule = async (rule: ReplyRule) => {
    if (!snapshot || !account) return;
    await runWrite('rule-delete', '规则已删除', 'rules', () =>
      deleteReplyRule(account.accountId, rule.ruleId, snapshot.head.currentVersion),
    );
  };

  const runPreview = async () => {
    if (!snapshot || !account) return;
    setPendingAction('preview');
    setPreviewError(null);
    setPreviewResult(null);
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    try {
      const response = await previewReply(account.accountId, {
        expectedVersion: snapshot.head.currentVersion,
        use: previewInput.use,
        channel: previewInput.channel,
        messageType: previewInput.messageType,
        userMessage: previewInput.userMessage.trim() || null,
        videoTitle: previewInput.channel === 'comment' ? (previewInput.videoTitle.trim() || null) : null,
        userName: previewInput.userName.trim() || null,
      }, controller.signal);
      if (activeAccountId.current !== account.accountId) return;
      if (response.data.accountId !== account.accountId) throw new Error('reply_preview_scope_mismatch');
      setPreviewResult(response.data);
    } catch (error) {
      if (activeAccountId.current !== account.accountId) return;
      if (isPermissionDenied(error)) {
        if (previewInput.channel === 'dm') setDmPreviewDenied(true);
        else setPreviewDenied(true);
        setPreviewError(previewInput.channel === 'dm'
          ? DM_PREVIEW_PERMISSION_ERROR
          : COMMENT_PREVIEW_PERMISSION_ERROR);
      } else if (isVersionConflict(error)) {
        setConflictVersion(errorDetails(error).currentVersion ?? null);
        setPreviewError('草稿版本已变化，请刷新后重新预览。');
      } else {
        setPreviewError(errorText(error, '模拟预览失败，请稍后重试。'));
      }
    } finally {
      if (activeAccountId.current === account.accountId) setPendingAction(null);
    }
  };

  const submitPublish = async () => {
    if (!snapshot || !account) return;
    setPendingAction('publish');
    setPublishIssues([]);
    let published = false;
    try {
      const response = await publishReplyConfig(account.accountId, { expectedVersion: snapshot.head.currentVersion });
      if (activeAccountId.current !== account.accountId) return;
      if (response.data.head.accountId !== account.accountId) throw new Error('reply_publish_scope_mismatch');
      published = true;
      await refreshAfterWrite(account.accountId, 'policy');
      setPublishOpen(false);
      message.success(`配置 v${response.data.head.publishedVersion ?? response.data.head.currentVersion} 已发布`);
    } catch (error) {
      if (activeAccountId.current !== account.accountId || isAbort(error)) return;
      if (published) {
        message.warning('Cloud 已返回发布成功，但重新读取真态失败，请点击刷新确认');
      } else if (isPermissionDenied(error)) {
        setPublishDenied(true);
        message.error('缺少 interaction.config.publish 权限，未发布');
      } else if (isVersionConflict(error)) {
        setConflictVersion(errorDetails(error).currentVersion ?? null);
        message.error('配置版本已变化，本次未发布');
      } else {
        const issues = errorDetails(error).issues ?? [];
        setPublishIssues(issues);
        message.error(issues.length ? 'Cloud 校验未通过，本次未发布' : errorText(error, '配置发布失败'));
      }
    } finally {
      if (activeAccountId.current === account.accountId) setPendingAction(null);
    }
  };

  const publishedAudit = auditItems.find((item) => item.action === 'config_published');

  const templateColumns: ColumnsType<ReplyTemplate> = [
    {
      title: '模板',
      key: 'name',
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{row.name}</Typography.Text>
          <Typography.Text type="secondary" className="reply-config__mono">{row.templateId}</Typography.Text>
        </Space>
      ),
    },
    { title: '版本', dataIndex: 'templateVersion', width: 76, render: (value: number) => <Tag>v{value}</Tag> },
    { title: '变量', dataIndex: 'variables', render: (values: string[]) => values.length ? values.map((v) => <Tag key={v}>{`{{${v}}}`}</Tag>) : '无' },
    { title: '状态', key: 'status', width: 90, render: (_, row) => row.archived ? <Tag>已归档</Tag> : statusText(row.enabled) },
    {
      title: '修改',
      key: 'audit',
      width: 150,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{row.updatedBy}</Typography.Text>
          <Typography.Text type="secondary">{formatTime(row.updatedAt)}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 250,
      render: (_, row) => row.archived ? null : (
        <Space size={4} wrap>
          <Button
            size="small"
            icon={<EditOutlined />}
            disabled={editDenied}
            onClick={() => {
              setTemplateEditorError(null);
              setTemplateEditor({ mode: 'edit', template: structuredClone(row) });
            }}
          >
            编辑草稿
          </Button>
          <Button
            size="small"
            disabled={editDenied}
            onClick={() => {
              setTemplateEditorError(null);
              setTemplateEditor({
                mode: 'version',
                template: { ...structuredClone(row), templateVersion: row.templateVersion + 1 },
              });
            }}
          >
            新版本
          </Button>
          <Popconfirm
            title="归档后历史版本仍保留；启用规则不能继续引用它。"
            okText="归档"
            cancelText="取消"
            onConfirm={() => void handleArchiveTemplate(row)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} disabled={editDenied}>归档</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const ruleColumns: ColumnsType<ReplyRule> = [
    {
      title: '优先级 / 规则',
      key: 'rule',
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong><span className="tabular-nums">{row.priority}</span> · {row.name}</Typography.Text>
          <Typography.Text type="secondary">{row.conditions.keywordsAny.length ? `关键词：${row.conditions.keywordsAny.join('、')}` : '不限制关键词'}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '动作',
      key: 'action',
      render: (_, row) => (
        <Space wrap>
          <Tag>{snapshot?.templates.find((item) => item.templateId === row.actions.templateId)?.name ?? row.actions.templateId}</Tag>
          {row.actions.polish ? <Tag color="blue">AI 润色 · 必须人工</Tag> : <Tag>模板原文</Tag>}
          {row.actions.allowAutoSend ? <Tag color="green">继承上层自动范围</Tag> : <Tag color="gold">必须人工审核</Tag>}
            {row.actions.forceHumanTags.map((tag) => <Tag key={tag} color="gold">{labelOf(RISK_TAG_LABEL, tag)}</Tag>)}
        </Space>
      ),
    },
    { title: '状态', dataIndex: 'enabled', width: 82, render: statusText },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_, row) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} disabled={editDenied} onClick={() => {
            setRuleEditorError(null);
            setRuleEditor({ mode: 'edit', rule: structuredClone(row) });
          }}>编辑</Button>
          <Popconfirm title="确认删除这条草稿规则？" okText="删除" cancelText="取消" onConfirm={() => void handleDeleteRule(row)}>
            <Button size="small" danger icon={<DeleteOutlined />} disabled={editDenied} aria-label={`删除规则 ${row.name}`} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const renderStrategy = () => {
    if (!snapshot) return null;
    const runtime = snapshot.runtime;
    const circuitOpen = runtime.circuitOpen || runtime.circuitOpenedAt !== null;
    const policy = snapshot.policy;
    const processingMode = replyProcessingModeOf(policy);
    const canonicalProcessingMode = isCanonicalReplyProcessingPolicy(policy);
    return (
      <div className="reply-config__stack">
        <Card
          size="small"
          title={<Space><ApiOutlined />即时运行控制（紧急停写）</Space>}
          extra={<Typography.Text type="secondary">独立版本 v{runtime.version} · {runtime.updatedBy} · {formatTime(runtime.updatedAt)}</Typography.Text>}
        >
          <Alert
            type="info"
            showIcon
            message="这里控制当前是否收取、是否真实发送，保存后立即生效。"
            description="它不改变下方长期回复策略；关闭账号或渠道发送后，仍可按读取开关继续收取互动和保留草稿。"
            className="reply-config__section-alert"
          />
          {circuitOpen ? (
            <Alert
              type="error"
              showIcon
              message="账号写熔断中，当前不会发送"
              description={`已连续失败 ${runtime.consecutiveFailures} 次，熔断开始于 ${
                runtime.circuitOpenedAt === null ? '未知时间' : formatTime(runtime.circuitOpenedAt)
              }。排除故障后，将“账号写总闸”从暂停切换为开启并保存；该动作会清除熔断并恢复发送。`}
              className="reply-config__section-alert"
            />
          ) : null}
          <div className="reply-config__switch-grid">
            <SettingSwitch
              label="收取互动"
              description="同时收取评论与私信；关闭后不再同步新互动。"
              checked={runtime.commentsReadEnabled && runtime.dmReadEnabled}
              disabled={editDenied}
              onChange={(checked) => mutateSnapshot('runtime', (current) => ({
                ...current,
                runtime: { ...current.runtime, commentsReadEnabled: checked, dmReadEnabled: checked },
              }))}
            />
            <SettingSwitch
              label="账号发送"
              description="关闭后立即暂停评论和私信发送，保留收取、草稿和待处理队列。"
              checked={!runtime.writePaused}
              disabled={editDenied}
              onChange={(checked) => mutateSnapshot('runtime', (current) => ({
                ...current,
                runtime: { ...current.runtime, writePaused: !checked },
              }))}
            />
            <SettingSwitch
              label="评论收取 / 回复"
              description="左侧控制读取；右侧是评论发送的即时开关。"
              checked={runtime.commentsReadEnabled}
              secondaryChecked={runtime.commentsReplyEnabled}
              secondaryLabel="允许回复"
              disabled={editDenied}
              onChange={(checked) => mutateSnapshot('runtime', (current) => ({ ...current, runtime: { ...current.runtime, commentsReadEnabled: checked } }))}
              onSecondaryChange={(checked) => mutateSnapshot('runtime', (current) => ({ ...current, runtime: { ...current.runtime, commentsReplyEnabled: checked } }))}
            />
            <SettingSwitch
              label="私信收取 / 文本发送"
              description="左侧控制读取；右侧是文本发送的即时开关。图片发送固定关闭。"
              checked={runtime.dmReadEnabled}
              secondaryChecked={runtime.dmSendTextEnabled}
              secondaryLabel="允许发送"
              disabled={editDenied}
              onChange={(checked) => mutateSnapshot('runtime', (current) => ({ ...current, runtime: { ...current.runtime, dmReadEnabled: checked } }))}
              onSecondaryChange={(checked) => mutateSnapshot('runtime', (current) => ({ ...current, runtime: { ...current.runtime, dmSendTextEnabled: checked } }))}
            />
            <div className="reply-config__setting reply-config__setting--locked">
              <Space><LockOutlined /><Typography.Text strong>私信图片发送</Typography.Text></Space>
              <Switch checked={false} disabled aria-label="私信图片发送固定关闭" />
              <Typography.Text type="secondary">平台 v1 硬门禁，不可编辑</Typography.Text>
            </div>
          </div>
          <Space className="reply-config__save-row">
            <Button type="primary" onClick={saveRuntime} disabled={!dirty.runtime || editDenied} loading={pendingAction === 'runtime'}>
              保存即时开关
            </Button>
            {dirty.runtime ? <Tag color="gold">有未保存修改</Tag> : <Tag color="green">已读取服务端真态</Tag>}
          </Space>
        </Card>

        <Card size="small" title="回复处理策略草稿">
          <Alert
            type="info"
            showIcon
            message="这里只选择一次账号的回复处理方式"
            description="保存后仍需发布才影响新互动；即时发送开关和 Cloud 硬门禁会在发送时继续独立检查。"
          />
          <Form layout="vertical" requiredMark={false}>
            <Form.Item label="回复处理方式" className="reply-config__section-alert">
              <Radio.Group
                aria-label="回复处理方式"
                value={processingMode}
                disabled={editDenied}
                onChange={(event) => mutateSnapshot('policy', (current) => ({
                  ...current,
                  policy: applyReplyProcessingMode(current.policy, event.target.value as ReplyProcessingMode),
                }))}
              >
                <div className="reply-config__processing-modes">
                  {REPLY_PROCESSING_MODES.map((value) => (
                    <Radio key={value} value={value} className="reply-config__processing-mode">
                      <span>
                        <Typography.Text strong>{replyProcessingModeMetaOf(value).label}</Typography.Text>
                        <Typography.Text type="secondary">{replyProcessingModeMetaOf(value).description}</Typography.Text>
                      </span>
                    </Radio>
                  ))}
                </div>
              </Radio.Group>
            </Form.Item>
            {!canonicalProcessingMode ? (
              <Alert
                type="warning"
                showIcon
                message={`检测到历史组合，已按不扩权原则显示为“${replyProcessingModeMetaOf(processingMode).label}”`}
                description="只有主动选择更高处理方式才会增加生成或发送权限；保存后会写回规范组合。"
                className="reply-config__section-alert"
              />
            ) : null}
            <Divider orientation="left">参与回复处理的渠道</Divider>
            <div className="reply-config__channel-grid">
              {(['comment', 'dm'] as const).map((channel) => (
              <Card key={channel} size="small" title={labelOf(CHANNEL_LABEL, channel)}>
                  <Space direction="vertical">
                    <Checkbox
                      checked={policy.channels[channel].enabled}
                      disabled={editDenied}
                      onChange={(event) => mutateSnapshot('policy', (current) => ({
                        ...current,
                        policy: {
                          ...current.policy,
                          channels: { ...current.policy.channels, [channel]: { ...current.policy.channels[channel], enabled: event.target.checked } },
                        },
                      }))}
                    >处理{labelOf(CHANNEL_LABEL, channel)}互动</Checkbox>
                    <Typography.Text type="secondary">关闭后仍可按即时读取开关收取，但不生成或发送该渠道的回复。</Typography.Text>
                    <Checkbox
                      checked={policy.channels[channel].aiPolishEnabled}
                      disabled={editDenied || channel === 'dm'}
                      onChange={(event) => mutateSnapshot('policy', (current) => ({
                        ...current,
                        policy: {
                          ...current.policy,
                          channels: { ...current.policy.channels, [channel]: { ...current.policy.channels[channel], aiPolishEnabled: event.target.checked } },
                        },
                      }))}
                    >允许规则使用 AI 润色{channel === 'dm' ? '（v1 私信关闭）' : '（使用后必须人工审核）'}</Checkbox>
                    {processingMode === 'auto' ? (
                      <Checkbox
                        checked={policy.channels[channel].allowAutoSend}
                        disabled={editDenied}
                        onChange={(event) => mutateSnapshot('policy', (current) => ({
                          ...current,
                          policy: {
                            ...current.policy,
                            channels: { ...current.policy.channels, [channel]: { ...current.policy.channels[channel], allowAutoSend: event.target.checked } },
                          },
                        }))}
                      >此渠道的低风险模板可自动发送</Checkbox>
                    ) : null}
                  </Space>
                </Card>
              ))}
            </div>
          </Form>
          <Space className="reply-config__save-row">
            <Button type="primary" onClick={savePolicy} disabled={!dirty.policy || editDenied} loading={pendingAction === 'policy'}>
              保存策略草稿
            </Button>
            {dirty.policy ? <Tag color="gold">有未保存修改</Tag> : <Tag color="green">已保存 draft</Tag>}
          </Space>
        </Card>
      </div>
    );
  };

  const renderTemplates = () => {
    if (!snapshot) return null;
    const rows = snapshot.templates.filter((item) => item.channel === templateChannel);
    return (
      <div className="reply-config__stack">
        <Alert
          type="info"
          showIcon
          message="模板按账号、渠道和版本管理；历史任务引用的版本不会被覆盖，删除操作会归档。"
        />
        <div className="reply-config__toolbar">
          <Radio.Group aria-label="模板渠道" value={templateChannel} onChange={(event) => setTemplateChannel(event.target.value as InteractionChannel)}>
            <Radio.Button value="comment">评论模板</Radio.Button>
            <Radio.Button value="dm">私信模板</Radio.Button>
          </Radio.Group>
          <Button type="primary" icon={<PlusOutlined />} aria-label="新建模板" disabled={editDenied} onClick={openCreateTemplate}>新建模板</Button>
        </div>
        <Table
          size="small"
          rowKey={(row) => `${row.templateId}-${row.templateVersion}`}
          dataSource={rows}
          columns={templateColumns}
          pagination={false}
          scroll={{ x: 900 }}
          locale={{ emptyText: <Empty description={`暂无${labelOf(CHANNEL_LABEL, templateChannel)}模板`} /> }}
        />
      </div>
    );
  };

  const renderRules = () => {
    if (!snapshot) return null;
    const conflicts = findObviousRuleConflicts(snapshot.rules);
    return (
      <div className="reply-config__stack">
        {conflicts.length ? (
          <Alert type="error" showIcon message="存在明显规则冲突" description={conflicts.map(([a, b]) => `${a.name} ↔ ${b.name}`).join('；')} />
        ) : (
          <Alert type="info" showIcon message="规则按 priority 升序、ruleId 升序命中；这里做即时冲突预检，发布仍以 Cloud 校验为准。" />
        )}
        <div className="reply-config__toolbar">
          <Radio.Group aria-label="规则渠道" value={templateChannel} onChange={(event) => setTemplateChannel(event.target.value as InteractionChannel)}>
            <Radio.Button value="comment">评论规则</Radio.Button>
            <Radio.Button value="dm">私信规则</Radio.Button>
          </Radio.Group>
          <Button type="primary" icon={<PlusOutlined />} aria-label="新建规则" disabled={editDenied} onClick={openCreateRule}>新建规则</Button>
        </div>
        <Table
          size="small"
          rowKey="ruleId"
          dataSource={snapshot.rules.filter((item) => item.channel === templateChannel).sort((a, b) => a.priority - b.priority || a.ruleId.localeCompare(b.ruleId))}
          columns={ruleColumns}
          pagination={false}
          scroll={{ x: 840 }}
          locale={{ emptyText: <Empty description={`暂无${labelOf(CHANNEL_LABEL, templateChannel)}规则`} /> }}
        />
      </div>
    );
  };

  const renderProfile = () => {
    if (!snapshot) return null;
    const index = snapshot.profiles.findIndex((item) => item.channel === profileChannel);
    const profile = snapshot.profiles[index];
    if (!profile) return <Alert type="error" message="Cloud 返回缺少渠道品牌语气，不能伪造默认值。" />;
    const change = (patch: Partial<ReplyProfile>) => mutateSnapshot('profiles', (current) => ({
      ...current,
      profiles: updateAt(current.profiles, index, { ...current.profiles[index], ...patch }),
    }));
    return (
      <div className="reply-config__stack">
        <div className="reply-config__toolbar">
          <Radio.Group aria-label="品牌语气渠道" value={profileChannel} onChange={(event) => setProfileChannel(event.target.value as InteractionChannel)}>
            <Radio.Button value="comment">评论语气</Radio.Button>
            <Radio.Button value="dm">私信语气</Radio.Button>
          </Radio.Group>
          <Space>
            {dirty.profiles ? <Tag color="gold">有未保存修改</Tag> : <Tag color="green">已保存 draft</Tag>}
            <Button type="primary" onClick={saveProfiles} disabled={!dirty.profiles || editDenied} loading={pendingAction === 'profiles'}>保存品牌语气</Button>
          </Space>
        </div>
        <Card size="small">
          <Form layout="vertical" requiredMark={false}>
            <div className="reply-config__form-grid">
              <Form.Item label="账号自称">
                <Input aria-label="账号自称" value={profile.selfName} maxLength={128} disabled={editDenied} onChange={(event) => change({ selfName: event.target.value })} />
              </Form.Item>
              <Form.Item label="用户称呼">
                <Input aria-label="用户称呼" value={profile.userAddress} maxLength={128} disabled={editDenied} onChange={(event) => change({ userAddress: event.target.value })} />
              </Form.Item>
              <Form.Item label="语气组合">
                <Select
                  aria-label="语气组合"
                  mode="multiple"
                  value={profile.tone}
                  disabled={editDenied}
                  options={(Object.keys(TONE_LABEL) as ReplyTone[]).map((value) => ({ value, label: labelOf(TONE_LABEL, value) }))}
                  onChange={(tone) => change({ tone })}
                />
              </Form.Item>
              <Form.Item label="最大字数">
                <InputNumber aria-label="最大字数" min={1} max={4000} value={profile.maxLength} disabled={editDenied} onChange={(value) => value && change({ maxLength: value })} />
              </Form.Item>
              <Form.Item label="表达偏好">
                <Space>
                  <Checkbox checked={profile.allowEmoji} disabled={editDenied} onChange={(event) => change({ allowEmoji: event.target.checked })}>允许 emoji</Checkbox>
                  <Checkbox checked={profile.allowLinks} disabled={editDenied} onChange={(event) => change({ allowLinks: event.target.checked })}>允许链接</Checkbox>
                </Space>
              </Form.Item>
            </div>
            <Form.Item label="禁用短语">
              <Select aria-label="禁用短语" mode="tags" tokenSeparators={[',']} value={profile.blockedPhrases} disabled={editDenied} onChange={(blockedPhrases) => change({ blockedPhrases })} placeholder="输入后回车，例如：绝对有效" />
            </Form.Item>
            <Form.Item label="禁止作出的承诺">
              <Select aria-label="禁止作出的承诺" mode="tags" tokenSeparators={[',']} value={profile.disallowedClaims} disabled={editDenied} onChange={(disallowedClaims) => change({ disallowedClaims })} placeholder="输入后回车，例如：未验证的效果承诺" />
            </Form.Item>
            <Form.Item label="必要说明 / 转人工话术">
              <Input.TextArea aria-label="必要说明 / 转人工话术" rows={3} value={profile.requiredDisclaimer ?? ''} disabled={editDenied} onChange={(event) => change({ requiredDisclaimer: event.target.value || null })} />
            </Form.Item>
            <Divider orientation="left">变量缺失时的安全兜底</Divider>
            <div className="reply-config__form-grid">
              {TEMPLATE_VARIABLES.map((variable) => (
                <Form.Item key={variable} label={labelOf(TEMPLATE_VARIABLE_LABEL, variable)}>
                  <Input
                    aria-label={`${labelOf(TEMPLATE_VARIABLE_LABEL, variable)}兜底值`}
                    value={profile.variableFallbacks[variable]}
                    disabled={editDenied}
                    onChange={(event) => change({ variableFallbacks: { ...profile.variableFallbacks, [variable]: event.target.value } })}
                  />
                </Form.Item>
              ))}
            </div>
          </Form>
        </Card>
      </div>
    );
  };

  const renderRisk = () => {
    if (!snapshot) return null;
    const limits = snapshot.policy.rateLimits;
    const setLimit = (key: keyof typeof limits, value: number | null) => {
      if (value === null) return;
      mutateSnapshot('policy', (current) => ({
        ...current,
        policy: { ...current.policy, rateLimits: { ...current.policy.rateLimits, [key]: value } },
      }));
    };
    return (
      <div className="reply-config__stack">
        <Alert
          type="warning"
          showIcon
          message="系统保护始终生效，不是可配置开关"
          description="下列 Cloud RiskController、身份、capability、幂等和待核验门禁不可关闭；账号管理员只能通过限速和人工审核增加更严格的限制。"
        />
        <List
          bordered
          dataSource={HARD_GATES}
          renderItem={(item) => (
            <List.Item extra={<Tag icon={<LockOutlined />}>平台强制</Tag>}>
              <Space><SafetyCertificateOutlined /><Typography.Text>{item}</Typography.Text></Space>
            </List.Item>
          )}
        />
        <Card
          size="small"
          title="账号安全限速（只能收紧）"
          extra={<Button type="primary" onClick={savePolicy} disabled={!dirty.policy || editDenied} loading={pendingAction === 'policy'}>保存到策略草稿</Button>}
        >
          <div className="reply-config__limit-grid">
            <LimitInput label="每分钟上限" value={limits.accountPerMinute} max={60} onChange={(value) => setLimit('accountPerMinute', value)} disabled={editDenied} />
            <LimitInput label="每小时上限" value={limits.accountPerHour} max={1000} onChange={(value) => setLimit('accountPerHour', value)} disabled={editDenied} />
            <LimitInput label="每日上限" value={limits.accountPerDay} max={10000} onChange={(value) => setLimit('accountPerDay', value)} disabled={editDenied} />
            <LimitInput label="同会话冷却（秒）" value={limits.threadCooldownSeconds} max={604800} onChange={(value) => setLimit('threadCooldownSeconds', value)} disabled={editDenied} />
            <LimitInput label="新登录冷却（秒）" value={limits.newLoginCooldownSeconds} max={604800} onChange={(value) => setLimit('newLoginCooldownSeconds', value)} disabled={editDenied} />
            <LimitInput label="连续失败熔断" value={limits.consecutiveFailureLimit} min={1} max={100} onChange={(value) => setLimit('consecutiveFailureLimit', value)} disabled={editDenied} />
          </div>
        </Card>
      </div>
    );
  };

  const renderPreview = () => (
    <div className="reply-config__stack">
      <Alert
        type="success"
        showIcon
        icon={<EyeOutlined />}
        message="模拟预览不会真实发送"
        description="只调用 Cloud reply-preview 生成/评审链路，不创建真实消息、回复任务或发送尝试，也不会下发 Edge。"
      />
      <Card size="small" title="模拟一条互动">
        <Form layout="vertical" requiredMark={false}>
          <div className="reply-config__form-grid">
            <Form.Item label="使用配置">
              <Radio.Group aria-label="使用配置" value={previewInput.use} onChange={(event) => changePreviewInput({ use: event.target.value as PreviewConfigUse })}>
                <Radio value="draft">当前草稿</Radio>
                <Radio value="published">已发布版本</Radio>
              </Radio.Group>
            </Form.Item>
            <Form.Item label="渠道">
              <Radio.Group aria-label="预览渠道" value={previewInput.channel} onChange={(event) => changePreviewInput({ channel: event.target.value as InteractionChannel })}>
                <Radio value="comment">评论</Radio>
                <Radio value="dm">私信</Radio>
              </Radio.Group>
            </Form.Item>
            <Form.Item label="消息类型">
              <Select
                aria-label="消息类型"
                value={previewInput.messageType}
                options={[
                  { value: 'text', label: '文本' },
                  { value: 'image', label: '图片' },
                  { value: 'unknown', label: '未知类型' },
                ]}
                onChange={(messageType) => changePreviewInput({ messageType })}
              />
            </Form.Item>
            <Form.Item label="模拟用户昵称">
              <Input aria-label="模拟用户昵称" value={previewInput.userName} onChange={(event) => changePreviewInput({ userName: event.target.value })} />
            </Form.Item>
          </div>
          {previewInput.channel === 'comment' ? (
            <Form.Item label="模拟视频标题">
              <Input aria-label="模拟视频标题" value={previewInput.videoTitle} onChange={(event) => changePreviewInput({ videoTitle: event.target.value })} />
            </Form.Item>
          ) : null}
          <Form.Item label="模拟互动内容">
            <Input.TextArea aria-label="模拟互动内容" rows={4} value={previewInput.userMessage} maxLength={4000} showCount onChange={(event) => changePreviewInput({ userMessage: event.target.value })} />
          </Form.Item>
          <Button type="primary" icon={<EyeOutlined />} aria-label="运行无副作用预览" onClick={() => void runPreview()} loading={pendingAction === 'preview'} disabled={previewDenied || (previewInput.channel === 'dm' && dmPreviewDenied)}>
            运行无副作用预览
          </Button>
        </Form>
      </Card>
      {previewError ? <Alert type="error" showIcon message={previewError} /> : null}
      {!previewError && previewDenied ? <Alert type="error" showIcon message={COMMENT_PREVIEW_PERMISSION_ERROR} /> : null}
      {!previewError && !previewDenied && previewInput.channel === 'dm' && dmPreviewDenied ? (
        <Alert type="error" showIcon message={DM_PREVIEW_PERMISSION_ERROR} />
      ) : null}
      {pendingAction === 'preview' ? <Skeleton active /> : null}
      {!previewResult && pendingAction !== 'preview' && !previewError ? <Empty description="输入模拟内容后查看完整决策链路" /> : null}
      {previewResult ? <PreviewFlow result={previewResult} templates={snapshot?.templates ?? []} rules={snapshot?.rules ?? []} /> : null}
    </div>
  );

  const renderAudit = () => {
    if (auditState === 'loading') return <Skeleton active />;
    if (auditState === 'permission') return <Result status="403" title="无审计查看权限" subTitle="需要 interaction.audit.view；配置正文未泄露。" />;
    if (auditState === 'error') return <Alert type="error" showIcon message="审计信息加载失败" action={<Button size="small" onClick={() => account && void loadAccount(account.accountId)}>重试</Button>} />;
    return (
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <List
          bordered
          dataSource={auditItems}
          locale={{ emptyText: <Empty description="暂无审计记录" /> }}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta
                avatar={<AuditOutlined />}
                title={<Space><Tag>v{item.configVersion}</Tag><Typography.Text strong>{auditActionLabel(item.action)}</Typography.Text><Typography.Text>{item.actor}</Typography.Text></Space>}
                description={<Space direction="vertical" size={0}><span>{item.summary}</span><Typography.Text type="secondary">{formatTime(item.createdAt)} · {item.entityType}{item.entityId ? ` · ${item.entityId}` : ''}</Typography.Text></Space>}
              />
            </List.Item>
          )}
        />
        {auditNextCursor ? (
          auditPageState === 'error' ? (
            <Alert
              type="error"
              showIcon
              message="后续审计加载失败"
              description="已加载的记录已保留，可以重试下一页。"
              action={<Button size="small" onClick={() => void loadMoreAudit()}>重试加载更多</Button>}
            />
          ) : (
            <Button loading={auditPageState === 'loading'} onClick={() => void loadMoreAudit()}>
              加载更多审计记录
            </Button>
          )
        ) : (
          <Typography.Text type="secondary">已加载全部审计记录</Typography.Text>
        )}
      </Space>
    );
  };

  const tabItems = snapshot ? [
    { key: 'strategy', label: '基本策略', children: renderStrategy() },
    { key: 'templates', label: `回复模板 (${snapshot.templates.filter((item) => !item.archived).length})`, children: renderTemplates() },
    { key: 'rules', label: `匹配规则 (${snapshot.rules.length})`, children: renderRules() },
    { key: 'profile', label: '品牌语气', children: renderProfile() },
    { key: 'risk', label: '风险门禁', children: renderRisk() },
    { key: 'preview', label: '模拟预览', children: renderPreview() },
    { key: 'audit', label: '审计', children: renderAudit() },
  ] : [];

  const runtimeCircuitOpen = snapshot
    ? snapshot.runtime.circuitOpen || snapshot.runtime.circuitOpenedAt !== null
    : false;
  const publishProcessingMode = snapshot ? replyProcessingModeOf(snapshot.policy) : null;
  const publishSummary = snapshot && publishProcessingMode ? [
    `回复处理方式：${replyProcessingModeMetaOf(publishProcessingMode).label}`,
    `即时账号写总闸：${runtimeCircuitOpen ? '熔断中（发送已阻断）' :
      snapshot.runtime.writePaused ? '暂停写入' : '允许写入'}`,
    `评论：${channelProcessingSummary(snapshot.policy.channels.comment.enabled, snapshot.policy.channels.comment.allowAutoSend, publishProcessingMode)}`,
    `私信：${channelProcessingSummary(snapshot.policy.channels.dm.enabled, snapshot.policy.channels.dm.allowAutoSend, publishProcessingMode)}`,
    `启用规则：${snapshot.rules.filter((rule) => rule.enabled && rule.actions.allowAutoSend && !rule.actions.polish).length} 条继承自动范围，${snapshot.rules.filter((rule) => rule.enabled && (!rule.actions.allowAutoSend || rule.actions.polish)).length} 条必须人工`,
  ] : [];

  return (
    <>
      <Drawer
        className="reply-config-drawer"
        rootClassName="reply-config-drawer-root"
        title={account ? `互动回复设置 · ${accountName(account)}` : '互动回复设置'}
        width={1080}
        open={open}
        destroyOnClose
        onClose={onClose}
        extra={snapshot ? (
          <Space wrap>
            <Tag color="blue">schema v1</Tag>
            <Tag>draft v{snapshot.head.draftVersion ?? '—'}</Tag>
            <Tag color={snapshot.head.publishedVersion ? 'green' : 'gold'}>published v{snapshot.head.publishedVersion ?? '未发布'}</Tag>
            {hasDirty ? <Tag color="gold">页面有未保存修改</Tag> : null}
            <Tooltip title="重新读取会清除当前账号所有未保存页面状态">
              <Button icon={<ReloadOutlined />} aria-label="刷新" disabled={loading || pendingAction !== null} onClick={() => account && void loadAccount(account.accountId)}>刷新</Button>
            </Tooltip>
            <Button type="primary" icon={<CloudUploadOutlined />} aria-label="发布" disabled={publishDenied} onClick={() => { setPublishIssues([]); setPublishOpen(true); }}>发布</Button>
          </Space>
        ) : null}
      >
        {loading ? <Skeleton active paragraph={{ rows: 12 }} /> : null}
        {!loading && loadError === 'permission' ? (
          <Result status="403" title="无配置查看权限" subTitle="需要 interaction.config.view；没有读取或展示该账号配置。" />
        ) : null}
        {!loading && loadError === 'missing' ? (
          <Result
            status="info"
            title="尚未创建互动回复配置"
            subTitle="可以显式创建安全草稿 v1；不会发布配置，不会创建模板或规则，也不会开启回复、自动发送或即时账号写入。"
            extra={(
              <Space wrap>
                <Button
                  type="primary"
                  loading={pendingAction === 'initialize'}
                  disabled={editDenied || pendingAction !== null && pendingAction !== 'initialize'}
                  onClick={() => void initializeMissingConfig()}
                >创建安全草稿</Button>
                <Button disabled={pendingAction !== null} onClick={() => account && void loadAccount(account.accountId)}>重新检查</Button>
              </Space>
            )}
          >
            {editDenied ? <Alert type="warning" showIcon message="缺少 interaction.config.edit 权限，未创建任何配置。" /> : null}
          </Result>
        ) : null}
        {!loading && loadError === 'error' ? (
          <Result status="error" title="互动回复设置加载失败" subTitle="未使用默认值冒充服务端配置。" extra={<Button type="primary" onClick={() => account && void loadAccount(account.accountId)}>重试</Button>} />
        ) : null}
        {!loading && snapshot ? (
          <div className="reply-config__stack">
            {editDenied ? <Alert type="warning" showIcon message="当前账号缺少 interaction.config.edit 权限，草稿未保存。" /> : null}
            {publishDenied ? <Alert type="warning" showIcon message="当前账号缺少 interaction.config.publish 权限，发布未执行。" /> : null}
            {conflictVersion !== null ? (
              <Alert
                type="error"
                showIcon
                message={`版本冲突：远端当前为 v${conflictVersion}`}
                description="本次保存/发布没有显示成功。刷新会清除未保存页面状态，再基于最新版本编辑。"
                action={<Button size="small" danger onClick={() => account && void loadAccount(account.accountId)}>读取最新版本</Button>}
              />
            ) : null}
            <Card size="small" className="reply-config__head-card">
              <Descriptions size="small" column={{ xs: 1, sm: 2, md: 4 }}>
                <Descriptions.Item label="账号平台"><Tag color="green">视频号</Tag></Descriptions.Item>
                <Descriptions.Item label="草稿版本">v{snapshot.head.draftVersion ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="生效版本">v{snapshot.head.publishedVersion ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="当前聚合版本">v{snapshot.head.currentVersion}</Descriptions.Item>
                <Descriptions.Item label="最后修改">{snapshot.head.updatedBy} · {formatTime(snapshot.head.updatedAt)}</Descriptions.Item>
                <Descriptions.Item label="最近发布">{publishedAudit ? `${publishedAudit.actor} · ${formatTime(publishedAudit.createdAt)} · v${publishedAudit.configVersion}` : '尚无发布审计'}</Descriptions.Item>
              </Descriptions>
            </Card>
            <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
          </div>
        ) : null}
      </Drawer>

      <TemplateEditorModal
        state={templateEditor}
        error={templateEditorError}
        pending={pendingAction === 'template'}
        onChange={(template) => setTemplateEditor((current) => current ? { ...current, template } : current)}
        onCancel={() => setTemplateEditor(null)}
        onSubmit={() => void submitTemplate()}
      />

      <RuleEditorModal
        state={ruleEditor}
        templates={snapshot?.templates ?? []}
        error={ruleEditorError}
        pending={pendingAction === 'rule'}
        onChange={(rule) => setRuleEditor((current) => current ? { ...current, rule } : current)}
        onCancel={() => setRuleEditor(null)}
        onSubmit={() => void submitRule()}
      />

      <Modal
        title="发布回复配置"
        open={publishOpen}
        okText="确认发布"
        cancelText="取消"
        confirmLoading={pendingAction === 'publish'}
        okButtonProps={{ disabled: hasDirty || localIssues.length > 0 || publishDenied }}
        onOk={() => void submitPublish()}
        onCancel={() => setPublishOpen(false)}
      >
        <div className="reply-config__stack">
          <Alert
            type="warning"
            showIcon
            message="发布后 Cloud 工作流只读取新的 immutable published 版本"
            description="以下是本次发布的有效用户意图；即时运行控制和不可关闭的 Cloud 硬门禁不会被本次发布绕过。"
          />
          <List size="small" bordered dataSource={publishSummary} renderItem={(item) => <List.Item><CheckCircleOutlined /> {item}</List.Item>} />
          {hasDirty ? <Alert type="error" showIcon message="仍有未保存页面修改，请先保存再发布。" /> : null}
          {localIssues.length ? (
            <ValidationIssues title="即时预检未通过" issues={localIssues} />
          ) : (
            <Alert type="success" showIcon message="前端即时预检通过；仍会执行 Cloud schema、规则、模板、role 和硬门禁校验。" />
          )}
          {publishIssues.length ? <ValidationIssues title="Cloud 发布校验未通过，published 未变化" issues={publishIssues} /> : null}
        </div>
      </Modal>
    </>
  );
}

function SettingSwitch({
  label,
  description,
  checked,
  secondaryChecked,
  secondaryLabel,
  disabled,
  onChange,
  onSecondaryChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  secondaryChecked?: boolean;
  secondaryLabel?: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  onSecondaryChange?: (checked: boolean) => void;
}) {
  return (
    <div className="reply-config__setting">
      <div>
        <Typography.Text strong>{label}</Typography.Text>
        <div><Typography.Text type="secondary">{description}</Typography.Text></div>
      </div>
      <Space>
        <Switch checked={checked} disabled={disabled} onChange={onChange} aria-label={label} />
        {secondaryChecked !== undefined && onSecondaryChange ? (
          <Tooltip title={secondaryLabel}>
            <Switch checked={secondaryChecked} disabled={disabled} onChange={onSecondaryChange} aria-label={`${label}：${secondaryLabel ?? '第二开关'}`} />
          </Tooltip>
        ) : null}
      </Space>
    </div>
  );
}

function LimitInput({
  label,
  value,
  min = 0,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <Form.Item label={label}>
      <InputNumber aria-label={label} min={min} max={max} value={value} disabled={disabled} onChange={onChange} style={{ width: '100%' }} />
    </Form.Item>
  );
}

function TemplateEditorModal({
  state,
  error,
  pending,
  onChange,
  onCancel,
  onSubmit,
}: {
  state: TemplateEditorState | null;
  error: string | null;
  pending: boolean;
  onChange: (template: ReplyTemplate) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const inspection = inspectTemplateVariables(state?.template.content ?? '');
  const insertVariable = (variable: string) => {
    if (!state) return;
    const separator = state.template.content && !state.template.content.endsWith(' ') ? ' ' : '';
    onChange({ ...state.template, content: `${state.template.content}${separator}{{${variable}}}` });
  };
  return (
    <Modal
      title={state?.mode === 'create' ? '新建回复模板' : state?.mode === 'version' ? '创建模板新版本' : '编辑模板草稿'}
      open={!!state}
      okText="保存草稿"
      cancelText="取消"
      confirmLoading={pending}
      onOk={onSubmit}
      onCancel={onCancel}
      width={720}
    >
      {state ? (
        <Form layout="vertical" requiredMark={false}>
          <div className="reply-config__form-grid">
            <Form.Item label="渠道">
              <Select aria-label="模板渠道" value={state.template.channel} options={[{ value: 'comment', label: '评论' }, { value: 'dm', label: '私信' }]} onChange={(channel) => onChange({ ...state.template, channel })} />
            </Form.Item>
            <Form.Item label="模板名称">
              <Input aria-label="模板名称" value={state.template.name} maxLength={128} onChange={(event) => onChange({ ...state.template, name: event.target.value })} />
            </Form.Item>
            <Form.Item label="模板版本">
              <Input aria-label="模板版本" value={`v${state.template.templateVersion}`} disabled />
            </Form.Item>
            <Form.Item label="启用状态">
              <Switch checked={state.template.enabled} onChange={(enabled) => onChange({ ...state.template, enabled })} aria-label="模板启用状态" />
            </Form.Item>
          </div>
          <Form.Item
            label="模板正文"
            extra="只做字面变量替换，不支持条件、脚本或 HTML。"
          >
            <Input.TextArea rows={7} value={state.template.content} maxLength={4000} showCount aria-label="模板正文" onChange={(event) => onChange({ ...state.template, content: event.target.value })} />
          </Form.Item>
          <Space wrap>
            <Typography.Text type="secondary">插入变量：</Typography.Text>
            {TEMPLATE_VARIABLES.map((variable) => (
              <Button key={variable} size="small" onClick={() => insertVariable(variable)}>{labelOf(TEMPLATE_VARIABLE_LABEL, variable)}</Button>
            ))}
          </Space>
          {inspection.unknownTokens.length ? (
            <Alert className="reply-config__section-alert" type="error" showIcon message={`未知变量：${inspection.unknownTokens.join('、')}`} description="未知变量不能保存或发布。" />
          ) : null}
          {error ? <Alert className="reply-config__section-alert" type="error" showIcon message={error} /> : null}
        </Form>
      ) : null}
    </Modal>
  );
}

function RuleEditorModal({
  state,
  templates,
  error,
  pending,
  onChange,
  onCancel,
  onSubmit,
}: {
  state: RuleEditorState | null;
  templates: ReplyTemplate[];
  error: string | null;
  pending: boolean;
  onChange: (rule: ReplyRule) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  if (!state) return null;
  const rule = state.rule;
  const setConditions = (patch: Partial<ReplyRule['conditions']>) => onChange({ ...rule, conditions: { ...rule.conditions, ...patch } });
  const setActions = (patch: Partial<ReplyRule['actions']>) => onChange({ ...rule, actions: { ...rule.actions, ...patch } });
  const channelTemplates = templates.filter((item) => item.channel === rule.channel && item.enabled && !item.archived);
  return (
    <Modal title={state.mode === 'create' ? '新建匹配规则' : '编辑匹配规则'} open okText="保存草稿" cancelText="取消" confirmLoading={pending} onOk={onSubmit} onCancel={onCancel} width={820}>
      <Form layout="vertical" requiredMark={false}>
        <div className="reply-config__form-grid">
          <Form.Item label="规则名称"><Input aria-label="规则名称" value={rule.name} maxLength={128} onChange={(event) => onChange({ ...rule, name: event.target.value })} /></Form.Item>
          <Form.Item label="优先级（数字越小越先）"><InputNumber aria-label="规则优先级" min={0} max={1_000_000} value={rule.priority} onChange={(priority) => priority !== null && onChange({ ...rule, priority })} style={{ width: '100%' }} /></Form.Item>
          <Form.Item label="渠道">
            <Select aria-label="规则渠道" value={rule.channel} options={[{ value: 'comment', label: '评论' }, { value: 'dm', label: '私信' }]} onChange={(channel) => {
              const first = templates.find((item) => item.channel === channel && item.enabled && !item.archived);
              onChange({ ...rule, channel, actions: { ...rule.actions, templateId: first?.templateId ?? '' } });
            }} />
          </Form.Item>
          <Form.Item label="启用状态"><Switch checked={rule.enabled} onChange={(enabled) => onChange({ ...rule, enabled })} aria-label="规则启用状态" /></Form.Item>
        </div>
        <Divider orientation="left">匹配条件</Divider>
        <Form.Item label="任一关键词"><Select aria-label="任一关键词" mode="tags" tokenSeparators={[',']} value={rule.conditions.keywordsAny} onChange={(keywordsAny) => setConditions({ keywordsAny })} /></Form.Item>
        <Form.Item label="任一意图"><Select aria-label="任一意图" mode="multiple" value={rule.conditions.intentsAny} options={INTENTS.map((value) => ({ value, label: value }))} onChange={(intentsAny) => setConditions({ intentsAny })} /></Form.Item>
        <Form.Item label="视频 / 会话外部 ID 范围"><Select aria-label="视频 / 会话外部 ID 范围" mode="tags" tokenSeparators={[',']} value={rule.conditions.sourceExternalIds} onChange={(sourceExternalIds) => setConditions({ sourceExternalIds })} /></Form.Item>
        <Form.Item label="消息类型">
          <Checkbox.Group
            aria-label="消息类型"
            value={rule.conditions.messageTypes}
            options={[{ value: 'text', label: '文本' }, { value: 'image', label: '图片' }, { value: 'unknown', label: '未知' }]}
            onChange={(messageTypes) => setConditions({ messageTypes: messageTypes as InteractionMessageType[] })}
          />
        </Form.Item>
        <Checkbox checked={rule.conditions.workHours !== null} onChange={(event) => setConditions({ workHours: event.target.checked ? { timezone: 'Asia/Shanghai', start: '09:00', end: '18:00' } : null })}>限定工作时间</Checkbox>
        {rule.conditions.workHours ? (
          <div className="reply-config__form-grid reply-config__section-alert">
            <Form.Item label="时区"><Input aria-label="工作时区" value={rule.conditions.workHours.timezone} onChange={(event) => setConditions({ workHours: { ...rule.conditions.workHours!, timezone: event.target.value } })} /></Form.Item>
            <Form.Item label="开始"><Input aria-label="工作时间开始" type="time" value={rule.conditions.workHours.start} onChange={(event) => setConditions({ workHours: { ...rule.conditions.workHours!, start: event.target.value } })} /></Form.Item>
            <Form.Item label="结束"><Input aria-label="工作时间结束" type="time" value={rule.conditions.workHours.end} onChange={(event) => setConditions({ workHours: { ...rule.conditions.workHours!, end: event.target.value } })} /></Form.Item>
          </div>
        ) : null}
        <Divider orientation="left">命中动作</Divider>
        <Form.Item label="回复模板"><Select aria-label="回复模板" value={rule.actions.templateId || undefined} options={channelTemplates.map((item) => ({ value: item.templateId, label: `${item.name} · v${item.templateVersion}` }))} onChange={(templateId) => setActions({ templateId })} /></Form.Item>
        <Space direction="vertical">
          <Checkbox
            checked={rule.actions.polish}
            onChange={(event) => setActions(event.target.checked
              ? { polish: true, allowAutoSend: false }
              : { polish: false })}
          >使用 AI 润色（必须人工审核）</Checkbox>
          <Checkbox
            checked={rule.actions.polish || !rule.actions.allowAutoSend}
            disabled={rule.actions.polish}
            onChange={(event) => setActions({ allowAutoSend: !event.target.checked })}
          >此规则必须人工审核</Checkbox>
          <Typography.Text type="secondary">取消后仅继承账号和渠道的自动化上限，不代表一定自动发送。</Typography.Text>
        </Space>
        <Form.Item label="命中这些风险标签时强制人工" className="reply-config__section-alert">
              <Select aria-label="强制人工风险标签" mode="multiple" value={rule.actions.forceHumanTags} options={RISK_TAGS.map((value) => ({ value, label: labelOf(RISK_TAG_LABEL, value) }))} onChange={(forceHumanTags) => setActions({ forceHumanTags })} />
        </Form.Item>
        {error ? <Alert type="error" showIcon message={error} /> : null}
      </Form>
    </Modal>
  );
}

function PreviewFlow({ result, templates, rules }: { result: PreviewResult; templates: ReplyTemplate[]; rules: ReplyRule[] }) {
  const actionMeta = PREVIEW_ACTION_META[result.action];
  const riskMeta = RISK_LEVEL_META[result.risk.level];
  const rule = rules.find((item) => item.ruleId === result.matchedRule?.ruleId);
  const template = templates.find((item) => item.templateId === result.template?.templateId);
  return (
    <Card size="small" title={<Space><CheckCircleOutlined />Cloud 预览结果 · 配置 v{result.configVersion}</Space>}>
      <Steps
        direction="vertical"
        size="small"
        current={5}
        items={[
          {
            title: '1. 命中规则',
            status: result.matchedRule ? 'finish' : 'wait',
            description: result.matchedRule ? `${rule?.name ?? result.matchedRule.ruleId}：${result.matchedRule.reason}` : '未命中规则',
          },
          {
            title: '2. 模板渲染',
            status: result.template ? 'finish' : 'wait',
            description: result.template ? <div><Tag>{template?.name ?? result.template.templateId} · v{result.template.templateVersion}</Tag><Typography.Paragraph copyable>{result.template.renderedText}</Typography.Paragraph></div> : '未使用模板',
          },
          {
            title: '3. AI 润色差异',
            status: result.polish ? 'finish' : 'wait',
            description: result.polish ? (
              <div className="reply-config__diff-grid">
                <div><Typography.Text type="secondary">润色前</Typography.Text><Typography.Paragraph>{result.polish.before}</Typography.Paragraph></div>
                <div><Typography.Text type="secondary">润色后</Typography.Text><Typography.Paragraph>{result.polish.after}</Typography.Paragraph></div>
                {result.polish.fallbackUsed ? <Tag color="gold">已回退原模板</Tag> : null}
                {result.polish.meaningChanged ? <Tag color="red">检测到改义</Tag> : null}
                {result.polish.introducedClaims.map((claim) => <Tag key={claim} color="red">新增承诺：{claim}</Tag>)}
              </div>
            ) : '该路径未运行 AI 润色',
          },
          {
            title: '4. 风险判断',
            status: result.risk.level === 'low' ? 'finish' : 'error',
            description: <Space wrap><Tag color={riskMeta.color}>{riskMeta.label}</Tag>{result.risk.tags.map((tag) => <Tag key={tag}>{labelOf(RISK_TAG_LABEL, tag)}</Tag>)}{result.risk.reasons.map((reason) => <Typography.Text key={reason}>{reason}</Typography.Text>)}</Space>,
          },
          {
            title: '5. 最终动作',
            status: result.action === 'blocked' ? 'error' : 'finish',
            description: <Space><Tag color={actionMeta.color}>{actionMeta.label}</Tag><Typography.Text type="secondary">仅模拟，不会真实发送</Typography.Text></Space>,
          },
        ]}
      />
    </Card>
  );
}

function ValidationIssues({ title, issues }: { title: string; issues: ValidationIssue[] }) {
  return (
    <Alert
      type="error"
      showIcon
      message={title}
      description={(
        <ul className="reply-config__issues">
          {issues.map((issue, index) => <li key={`${issue.path}-${issue.code}-${index}`}>{issue.message} <Typography.Text type="secondary">({issue.path})</Typography.Text></li>)}
        </ul>
      )}
    />
  );
}
