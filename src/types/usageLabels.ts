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
  'browse:curated_note_evaluator': '精选准入·正文评估',
  'browse:curated_comment_evaluator': '精选准入·评论评估',
  'browse:comment_search_term_generator': '评论搜索词生成',
  'browse:comment_target_picker': '评论笔记甄选',
  // 发布流水线（publish:<Name>）
  'publish:ContentScout': '选题侦察',
  'publish:ContentCreator': '正文创作',
  'publish:ReferenceAnalyzer': '保真洗稿·原稿分析',
  'publish:FaithfulRewritePlanner': '保真洗稿·改写规划',
  'publish:FaithfulDraftWriter': '保真洗稿·正文改写',
  'publish:FidelityAuditor': '保真洗稿·忠实度审核',
  'publish:CategoryClassifier': '配图品类判定',
  'publish:ImageSetPlanner': '配图选题',
  'publish:ImagePromptComposer': '配图指令',
  'publish:ImagePlanner': '配图规划',
  'publish:ContentCleaner': '正文去AI味',
  'publish:QualityScorer': '质量评分',
  'publish:TitleCreator': '标题创作',
  'publish:TopicGenerator': '话题生成',
  'publish:TopicEvaluator': '话题评判',
  'publish:ApprovalGatekeeper': '发布审批',
  'publish:ImageGenerator': '配图生成（图片模型）',
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

// 账号 id → 展示名已统一走 types/accountDisplay.ts 的 makeAccountNamer（真名→运营名→ID），
// 不再在此另起一份回落（旧 accountLabel 只标 default、其余直露 ID，是裸 ID 漂移的根源，已移除）。
