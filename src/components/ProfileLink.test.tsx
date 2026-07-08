/**
 * ProfileLink 可点性诚实回归（设计标准：可点样式只在「真有链接」时出现）。
 *  - 真实 xhs userid → 渲染外链 <a class="ext-link">（下划线 + 尾随 ↗ 由 .ext-link 提供），新标签打开。
 *  - 缺 id / 退役 default / 形状不符 → 纯文本回落：无 <a>、无 .ext-link，绝不误导、绝不渲染死链。
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProfileLink } from './ProfileLink';

const VALID_ID = '63e2ff0500000000260049ce'; // ≥20 位字母数字（与 cloud 登录派生 userid 口径一致）

describe('ProfileLink 可点性诚实回归', () => {
  it('真实 userid → 外链 <a class="ext-link">，新标签打开、指向裸主页链接', () => {
    render(<ProfileLink userId={VALID_ID}>张三</ProfileLink>);
    const a = screen.getByRole('link', { name: '张三' });
    expect(a.classList.contains('ext-link')).toBe(true);
    expect(a.getAttribute('href')).toBe(`https://www.xiaohongshu.com/user/profile/${VALID_ID}`);
    expect(a.getAttribute('target')).toBe('_blank');
  });

  it('退役 default / 形状不符 / 空 / null → 纯文本，无链接、无可点样式', () => {
    for (const bad of ['default', 'abc123', '', null, undefined]) {
      const { container, unmount } = render(<ProfileLink userId={bad}>张三</ProfileLink>);
      expect(container.querySelector('a')).toBeNull();
      expect(container.querySelector('.ext-link')).toBeNull();
      expect(container.textContent).toBe('张三');
      unmount();
    }
  });
});
