/**
 * 评论模板编辑框的分块语义（change facebook-comment-template-blocks）。
 *
 * 一条模板是一个**块**、不是一行：运营的投放素材天然多行（标题 / 待遇 / 要求 / 联系方式）。
 * 块与块之间用单独一行 `------`（6 个及以上连字符）分隔；块内换行属于该模板正文的一部分。
 *
 * 历史语义是"每行一条"，运营把整段广告粘进去会被切成十几条、每次只随机发其中一行
 * （2026-07-28 真机：发出去的是残句「👉 Chuyên cần: 400.000 VNĐ」）。
 */

/** 回填编辑框时使用的分隔行。 */
export const COMMENT_TEMPLATE_SEPARATOR = '------';

/** 只含 6 个及以上连字符的整行（允许首尾空白）视为分隔行。 */
const SEPARATOR_LINE_RE = /^\s*-{6,}\s*$/;

/** 编辑框文本 → 模板数组。去空块、去重，块内换行原样保留。 */
export function parseCommentTemplates(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of (text ?? '').split(/\r?\n/)) {
    if (SEPARATOR_LINE_RE.test(line)) {
      blocks.push(current.join('\n'));
      current = [];
      continue;
    }
    current.push(line);
  }
  blocks.push(current.join('\n'));

  const out: string[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const value = block.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** 模板数组 → 编辑框文本（round-trip：parse(format(x)) === x）。 */
export function formatCommentTemplates(templates: readonly string[]): string {
  return (templates ?? []).join(`\n${COMMENT_TEMPLATE_SEPARATOR}\n`);
}
