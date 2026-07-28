import { describe, expect, it } from 'vitest';

import {
  COMMENT_TEMPLATE_SEPARATOR,
  formatCommentTemplates,
  parseCommentTemplates,
} from './commentTemplates';

const AD = [
  'TUYỂN DỤNG NHÂN VIÊN SẢN XUẤT LUXSHARE',
  '📍 Làm việc tại: Nhà máy sản xuất linh kiện điện tử LUXSHARE',
  '👉 Lương cơ bản: 5.700.000 VNĐ',
  '📞 Liên hệ: 0335 610 868',
].join('\n');

describe('评论模板分块（facebook-comment-template-blocks）', () => {
  it('多行块 = 一条模板，块内换行保留', () => {
    const parsed = parseCommentTemplates(AD);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toBe(AD);
  });

  it('单独一行 ------ 分隔出两条模板，分隔行不进正文', () => {
    const parsed = parseCommentTemplates(`${AD}\n------\n第二条模板\n第二行`);
    expect(parsed).toEqual([AD, '第二条模板\n第二行']);
    expect(parsed.some((t) => t.includes('------'))).toBe(false);
  });

  it('6 个以上连字符、带首尾空白的分隔行同样生效；行内出现的连字符不是分隔符', () => {
    expect(parseCommentTemplates('A\n  --------  \nB')).toEqual(['A', 'B']);
    expect(parseCommentTemplates('A ------ 还在同一行\nB')).toEqual(['A ------ 还在同一行\nB']);
    expect(parseCommentTemplates('A\n-----\nB')).toEqual(['A\n-----\nB']);
  });

  it('空块与重复块被丢弃', () => {
    expect(parseCommentTemplates(`A\n------\n\n------\n  \n------\nA\n------\nB`)).toEqual(['A', 'B']);
    expect(parseCommentTemplates('')).toEqual([]);
  });

  it('回填与解析可往返', () => {
    const templates = [AD, '第二条\n带换行'];
    expect(parseCommentTemplates(formatCommentTemplates(templates))).toEqual(templates);
    expect(formatCommentTemplates(templates)).toContain(`\n${COMMENT_TEMPLATE_SEPARATOR}\n`);
  });
});
