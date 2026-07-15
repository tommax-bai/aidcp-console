import { describe, expect, it } from 'vitest';
import { frozenInteractionFixtures } from '../test/fixtures/interactionReplyConfig';
import { collectLocalValidationIssues, findObviousRuleConflicts, inspectTemplateVariables } from './wechatChannelsReplyValidation';

describe('wechatChannelsReplyValidation', () => {
  it('accepts only the four exact frozen variable tokens', () => {
    expect(inspectTemplateVariables('你好 {{user_name}}，来自 {{account_name}}')).toEqual({
      variables: ['user_name', 'account_name'],
      unknownTokens: [],
    });
    expect(inspectTemplateVariables('{{ user_name }} {{order_total}}').unknownTokens).toEqual([
      '{{ user_name }}',
      '{{order_total}}',
    ]);
  });

  it('finds same-priority same-condition rules that point to different templates', () => {
    const fixtures = frozenInteractionFixtures();
    const first = fixtures.rules.data.items[0];
    const conflict = structuredClone(first);
    conflict.ruleId = 'rule_conflict';
    conflict.name = '冲突规则';
    conflict.actions.templateId = 'template_other';
    expect(findObviousRuleConflicts([first, conflict])).toHaveLength(1);
  });

  it('keeps frozen fixtures locally valid', () => {
    const fixtures = frozenInteractionFixtures();
    expect(collectLocalValidationIssues(
      fixtures.templates.data.items,
      fixtures.rules.data.items,
      fixtures.profiles.data.profiles,
    )).toEqual([]);
  });
});
