import type {
  ReplyProfile,
  ReplyRule,
  ReplyTemplate,
  TemplateVariable,
  ValidationIssue,
} from '../types/interactionReplyConfig';
import { labelOf } from '../types/aidcp-enums';

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  'user_name',
  'video_title',
  'account_name',
  'support_channel',
];

export const TEMPLATE_VARIABLE_LABEL: Record<TemplateVariable, string> = {
  user_name: '用户昵称',
  video_title: '视频标题',
  account_name: '账号称呼',
  support_channel: '人工渠道',
};

const VARIABLE_TOKEN = /{{[^{}]+}}/g;

export function inspectTemplateVariables(content: string): {
  variables: TemplateVariable[];
  unknownTokens: string[];
} {
  const tokens = Array.from(new Set(content.match(VARIABLE_TOKEN) ?? []));
  const variables = TEMPLATE_VARIABLES.filter((variable) => tokens.includes(`{{${variable}}}`));
  const known = new Set(TEMPLATE_VARIABLES.map((variable) => `{{${variable}}}`));
  return { variables, unknownTokens: tokens.filter((token) => !known.has(token)) };
}

function normalizedConditions(rule: ReplyRule): string {
  const workHours = rule.conditions.workHours
    ? {
        timezone: rule.conditions.workHours.timezone,
        start: rule.conditions.workHours.start,
        end: rule.conditions.workHours.end,
      }
    : null;
  return JSON.stringify({
    keywordsAny: [...rule.conditions.keywordsAny].sort(),
    intentsAny: [...rule.conditions.intentsAny].sort(),
    sourceExternalIds: [...rule.conditions.sourceExternalIds].sort(),
    messageTypes: [...rule.conditions.messageTypes].sort(),
    workHours,
  });
}

/** UI 即时发现确定可见的冲突；发布仍以 Cloud 的完整规范化与 validation issues 为事实源。 */
export function findObviousRuleConflicts(rules: ReplyRule[]): Array<[ReplyRule, ReplyRule]> {
  const enabled = rules.filter((rule) => rule.enabled);
  const conflicts: Array<[ReplyRule, ReplyRule]> = [];
  for (let left = 0; left < enabled.length; left += 1) {
    for (let right = left + 1; right < enabled.length; right += 1) {
      const a = enabled[left];
      const b = enabled[right];
      if (
        a.channel === b.channel &&
        a.priority === b.priority &&
        normalizedConditions(a) === normalizedConditions(b) &&
        a.actions.templateId !== b.actions.templateId
      ) {
        conflicts.push([a, b]);
      }
    }
  }
  return conflicts;
}

export function collectLocalValidationIssues(
  templates: ReplyTemplate[],
  rules: ReplyRule[],
  profiles: ReplyProfile[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const activeTemplates = new Map(
    templates.filter((template) => template.enabled && !template.archived).map((template) => [template.templateId, template]),
  );

  for (const template of templates.filter((item) => !item.archived)) {
    const { unknownTokens } = inspectTemplateVariables(template.content);
    if (unknownTokens.length) {
      issues.push({
        path: `templates.${template.templateId}.content`,
        code: 'unknown_template_variable',
        message: `模板「${template.name}」包含未知变量：${unknownTokens.join('、')}`,
      });
    }
  }

  for (const rule of rules.filter((item) => item.enabled)) {
    const template = activeTemplates.get(rule.actions.templateId);
    if (!template) {
      issues.push({
        path: `rules.${rule.ruleId}.actions.templateId`,
        code: 'template_unavailable',
        message: `规则「${rule.name}」引用的模板不存在、已归档或未启用。`,
      });
    } else if (template.channel !== rule.channel) {
      issues.push({
        path: `rules.${rule.ruleId}.actions.templateId`,
        code: 'template_channel_mismatch',
        message: `规则「${rule.name}」与模板「${template.name}」渠道不一致。`,
      });
    }
  }

  for (const [left, right] of findObviousRuleConflicts(rules)) {
    issues.push({
      path: `rules.${left.ruleId}`,
      code: 'obvious_rule_conflict',
      message: `规则「${left.name}」与「${right.name}」优先级和条件相同，却指向不同模板。`,
    });
  }

  for (const channel of ['comment', 'dm'] as const) {
    const profile = profiles.find((item) => item.channel === channel);
    if (!profile) {
      issues.push({
        path: `profiles.${channel}`,
        code: 'profile_missing',
        message: `${channel === 'comment' ? '评论' : '私信'}品牌语气缺失。`,
      });
      continue;
    }
    if ((profile.knowledgeDocument?.trim().length ?? 0) > 20_000) {
      issues.push({
        path: `profiles.${channel}.knowledgeDocument`,
        code: 'knowledge_document_too_long',
        message: `${channel === 'comment' ? '评论' : '私信'}的 AI 回答说明文档不能超过 20000 个字符。`,
      });
    }
    const usedVariables = new Set(
      templates
        .filter((template) => template.channel === channel && template.enabled && !template.archived)
        .flatMap((template) => inspectTemplateVariables(template.content).variables),
    );
    for (const variable of usedVariables) {
      if (!profile.variableFallbacks[variable]?.trim()) {
        issues.push({
          path: `profiles.${channel}.variableFallbacks.${variable}`,
          code: 'variable_fallback_missing',
          message: `${channel === 'comment' ? '评论' : '私信'}渠道缺少「${labelOf(TEMPLATE_VARIABLE_LABEL, variable)}」安全兜底。`,
        });
      }
    }
  }

  return issues;
}
