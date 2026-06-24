/**
 * token 用量页的角色/账号标签映射（change llm-token-usage-stats）。
 *
 * PG 存的是稳定内部 tag（`browse:<role>` / `publish:<Name>` / `system:model_probe` / `untagged`），
 * 这里把它映射成运营可读的中文；未知 tag 回落「去前缀人性化」，绝不直露内部串。
 * 改云端角色 tag 时同步此表（漏映射只会回落人性化，不崩）。
 */

const ROLE_LABELS: Record<string, string> = {
  // 浏览闭环（browse:<role>）
  'browse:content_evaluator': '内容评估',
  'browse:content_curator': '内容甄选',
  'browse:search_evaluator': '搜索评估',
  'browse:interaction_appraiser': '互动评估',
  'browse:follow_agent': '关注决策',
  'browse:author_evaluator': '作者评估',
  'browse:comment_appraiser': '评论评估',
  'browse:comment_composer': '评论撰写',
  'browse:comment_reviewer': '评论审阅',
  'browse:comment_de_ai_flavor': '评论去AI味',
  'browse:comment_like_appraiser': '评论点赞评估',
  'browse:concept_extractor': '概念提取',
  // 发布流水线（publish:<Name>）
  'publish:ContentScout': '选题侦察',
  'publish:ContentCreator': '正文创作',
  'publish:TitleCreator': '标题创作',
  'publish:ImagePlanner': '配图规划',
  'publish:QualityScorer': '质量评分',
  'publish:ApprovalGatekeeper': '发布审批',
  'publish:ImageGenerator': '配图生成',
  // 系统/保留
  'system:model_probe': '模型探活',
  untagged: '未标注/遗留',
};

/** 去前缀 + 下划线转空格的人性化回落（未知 tag 用）。 */
function humanize(tag: string): string {
  const noPrefix = tag.includes(':') ? tag.slice(tag.indexOf(':') + 1) : tag;
  return noPrefix.replace(/_/g, ' ');
}

/** 角色 tag → 中文标签；未知回落人性化，绝不直露内部串。 */
export function roleLabel(tag: string): string {
  return ROLE_LABELS[tag] ?? humanize(tag);
}

/** 账号 id → 展示名。单租户占位 `default` 显式标注。 */
export function accountLabel(accountId: string): string {
  return accountId === 'default' ? '默认账号（单租户）' : accountId;
}
