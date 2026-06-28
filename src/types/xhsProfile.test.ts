import { describe, it, expect } from 'vitest';
import { xhsProfileUrl } from './xhsProfile';

describe('xhsProfileUrl（账号 / 联系人昵称 → 小红书主页链接，守「绝不渲染死链」红线）', () => {
  it('真实小红书 userid（≥20 位字母数字）→ 裸主页链接', () => {
    expect(xhsProfileUrl('63e2ff0500000000260049ce')).toBe(
      'https://www.xiaohongshu.com/user/profile/63e2ff0500000000260049ce',
    );
  });

  it('退役标识 default / 空 / 空白 / null / undefined → null（不给链接）', () => {
    expect(xhsProfileUrl('default')).toBeNull();
    expect(xhsProfileUrl('')).toBeNull();
    expect(xhsProfileUrl('   ')).toBeNull();
    expect(xhsProfileUrl(null)).toBeNull();
    expect(xhsProfileUrl(undefined)).toBeNull();
  });

  it('形状不符（过短 / 含非字母数字 / 含路径分隔）→ null', () => {
    expect(xhsProfileUrl('abc123')).toBeNull(); // 太短（<20）
    expect(xhsProfileUrl('63e2ff05 00000000260049ce')).toBeNull(); // 含空格
    expect(xhsProfileUrl('/user/profile/63e2ff0500000000260049')).toBeNull(); // 含路径分隔
  });

  it('两端空白先裁剪再判定', () => {
    expect(xhsProfileUrl('  63e2ff0500000000260049ce  ')).toBe(
      'https://www.xiaohongshu.com/user/profile/63e2ff0500000000260049ce',
    );
  });
});
