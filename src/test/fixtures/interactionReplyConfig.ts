import type { PanelAccount } from '../../types/api';
import type {
  AuditResponse,
  PolicyResponse,
  PreviewResponse,
  ProfileResponse,
  RuleListResponse,
  RuntimeControlsResponse,
  TemplateListResponse,
} from '../../types/interactionReplyConfig';

/**
 * Session 00 frozen internal-api fixtures 的 TypeScript 镜像，仅供 Console 测试/mock 使用。
 * 源：aidcp/docs/contracts/wechat-channels-interaction/v1/fixtures/internal-api/*.json（schema v1）。
 */
export function panelAccount(accountId = 'acct_wc_demo', platform = 'wechat_channels'): PanelAccount {
  return {
    accountId,
    label: platform === 'wechat_channels' ? '视频号演示账号' : '其他平台账号',
    nickname: platform === 'wechat_channels' ? '示例品牌视频号' : '其他账号',
    platform,
    groupLabel: null,
    machineLabel: '演示设备',
    contactInfo: null,
    operatorStatus: 'active',
    pausedAt: null,
    riskStatus: 'normal',
    riskQuotaLevel: 'normal',
    signalCount: 0,
    personaBound: true,
    needsPersonaSetup: false,
  };
}

export function frozenInteractionFixtures(accountId = 'acct_wc_demo') {
  const meta = (requestId: string, asOf: number) => ({ requestId, asOf });
  const policy: PolicyResponse = {
    data: {
      head: {
        accountId,
        platform: 'wechat_channels',
        currentVersion: 1,
        draftVersion: 1,
        publishedVersion: null,
        updatedAt: 1784044710000,
        updatedBy: 'admin_demo',
      },
      policy: {
        mode: 'review_before_send',
        generateDrafts: true,
        sendReplies: false,
        channels: {
          comment: { enabled: true, aiPolishEnabled: true, allowAutoSend: false },
          dm: { enabled: true, aiPolishEnabled: false, allowAutoSend: false },
        },
        rateLimits: {
          accountPerMinute: 2,
          accountPerHour: 20,
          accountPerDay: 100,
          threadCooldownSeconds: 60,
          newLoginCooldownSeconds: 600,
          consecutiveFailureLimit: 3,
        },
      },
    },
    meta: meta('internal-policy-001', 1784044840000),
  };
  const runtime: RuntimeControlsResponse = {
    data: {
      accountId,
      platform: 'wechat_channels',
      version: 1,
      commentsReadEnabled: true,
      commentsReplyEnabled: false,
      dmReadEnabled: true,
      dmSendTextEnabled: false,
      dmSendImageEnabled: false,
      writePaused: true,
      updatedAt: 1784044700000,
      updatedBy: 'admin_demo',
    },
    meta: meta('internal-runtime-controls-001', 1784044839000),
  };
  const templates: TemplateListResponse = {
    data: {
      accountId,
      currentVersion: 1,
      items: [
        {
          templateId: 'template_comment_thanks',
          channel: 'comment',
          name: '评论感谢',
          content: '谢谢 {{user_name}} 的喜欢，欢迎继续交流。',
          enabled: true,
          archived: false,
          templateVersion: 1,
          variables: ['user_name'],
          updatedAt: 1784044720000,
          updatedBy: 'admin_demo',
        },
        {
          templateId: 'template_dm_greeting',
          channel: 'dm',
          name: '私信问候',
          content: '你好 {{user_name}}，感谢联系 {{account_name}}，我们会尽快回复。',
          enabled: true,
          archived: false,
          templateVersion: 1,
          variables: ['user_name', 'account_name'],
          updatedAt: 1784044721000,
          updatedBy: 'admin_demo',
        },
      ],
      nextCursor: null,
    },
    meta: meta('internal-templates-001', 1784044841000),
  };
  const rules: RuleListResponse = {
    data: {
      accountId,
      currentVersion: 1,
      items: [
        {
          ruleId: 'rule_comment_thanks',
          channel: 'comment',
          name: '感谢类评论',
          priority: 100,
          enabled: true,
          conditions: {
            keywordsAny: ['谢谢', '有帮助'],
            intentsAny: ['gratitude'],
            sourceExternalIds: [],
            messageTypes: ['text'],
            workHours: null,
          },
          actions: {
            templateId: 'template_comment_thanks',
            polish: true,
            allowAutoSend: false,
            forceHumanTags: [],
          },
          updatedAt: 1784044730000,
          updatedBy: 'admin_demo',
        },
        {
          ruleId: 'rule_dm_greeting',
          channel: 'dm',
          name: '普通私信问候',
          priority: 100,
          enabled: true,
          conditions: {
            keywordsAny: ['你好', '了解'],
            intentsAny: ['general_question'],
            sourceExternalIds: [],
            messageTypes: ['text'],
            workHours: { timezone: 'Asia/Shanghai', start: '09:00', end: '18:00' },
          },
          actions: {
            templateId: 'template_dm_greeting',
            polish: false,
            allowAutoSend: false,
            forceHumanTags: ['unknown'],
          },
          updatedAt: 1784044731000,
          updatedBy: 'admin_demo',
        },
      ],
      nextCursor: null,
    },
    meta: meta('internal-rules-001', 1784044842000),
  };
  const profiles: ProfileResponse = {
    data: {
      accountId,
      currentVersion: 1,
      profiles: [
        {
          channel: 'comment',
          selfName: '示例品牌',
          userAddress: '你',
          tone: ['friendly', 'concise'],
          maxLength: 200,
          allowEmoji: true,
          allowLinks: false,
          blockedPhrases: ['绝对有效'],
          disallowedClaims: ['未验证的效果承诺'],
          requiredDisclaimer: null,
          variableFallbacks: {
            user_name: '朋友',
            video_title: '这条视频',
            account_name: '我们',
            support_channel: '人工客服',
          },
        },
        {
          channel: 'dm',
          selfName: '示例品牌客服',
          userAddress: '你',
          tone: ['professional', 'friendly'],
          maxLength: 500,
          allowEmoji: false,
          allowLinks: false,
          blockedPhrases: ['保证退款'],
          disallowedClaims: ['代替人工完成订单决策'],
          requiredDisclaimer: '如需处理账户或订单，请转人工核验。',
          variableFallbacks: {
            user_name: '朋友',
            video_title: '相关视频',
            account_name: '我们',
            support_channel: '人工客服',
          },
        },
      ],
    },
    meta: meta('internal-profiles-001', 1784044843000),
  };
  const preview: PreviewResponse = {
    data: {
      accountId,
      configVersion: 1,
      matchedRule: { ruleId: 'rule_comment_thanks', reason: '命中 gratitude 意图和 text 消息类型。' },
      template: {
        templateId: 'template_comment_thanks',
        templateVersion: 1,
        renderedText: '谢谢示例观众的喜欢，欢迎继续交流。',
      },
      polish: {
        before: '谢谢示例观众的喜欢，欢迎继续交流。',
        after: '谢谢你的喜欢，欢迎继续交流。',
        fallbackUsed: false,
        meaningChanged: false,
        introducedClaims: [],
      },
      risk: { level: 'low', tags: [], reasons: [] },
      action: 'review_required',
    },
    meta: meta('internal-preview-001', 1784044844000),
  };
  const audit: AuditResponse = {
    data: {
      accountId,
      items: [
        {
          eventId: 'audit_draft_001',
          actor: 'admin_demo',
          action: 'draft_saved',
          configVersion: 1,
          entityType: 'policy',
          entityId: null,
          summary: '保存账号级回复策略草稿。',
          createdAt: 1784044710000,
        },
      ],
      nextCursor: null,
    },
    meta: meta('internal-audit-001', 1784044845000),
  };
  return { runtime, policy, templates, rules, profiles, preview, audit };
}
