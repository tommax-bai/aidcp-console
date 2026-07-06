import type { RolePromptView } from '../types/api';

export interface PromptPersonaSourceSummary {
  label: string;
  description: string;
  alertType: 'info' | 'warning';
}

export function promptPersonaSourceSummary(
  view: Pick<RolePromptView, 'accountId' | 'personaFallback' | 'personaSource' | 'personaSourceLabel'>,
  accountLabel: (accountId: string) => string = (accountId) => accountId,
): PromptPersonaSourceSummary {
  const account = view.accountId ? accountLabel(view.accountId) : '';

  if (view.personaSource === 'fallback_sample' || view.personaFallback) {
    return {
      label: view.personaSourceLabel ?? '示例人设',
      description: account
        ? `所选账号「${account}」未绑定人设，运行会被拒绝；当前按示例人设渲染。`
        : '当前按示例人设渲染。',
      alertType: 'warning',
    };
  }

  if (view.personaSource === 'account' || view.accountId) {
    return {
      label: view.personaSourceLabel ?? '所选账号人设',
      description: account ? `来自所选账号「${account}」的真实人设。` : '来自所选账号的真实人设。',
      alertType: 'info',
    };
  }

  return {
    label: view.personaSourceLabel ?? '示例人设',
    description: '未选择账号，当前按示例人设渲染；卡片、正文等运行时输入仍为示例占位。',
    alertType: 'info',
  };
}
