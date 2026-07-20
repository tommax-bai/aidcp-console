import { describe, expect, it } from 'vitest';
import { accountDisplayName, makeAccountNamer } from './accountDisplay';

describe('accountDisplayName', () => {
  it('只消费 Cloud 解析结果，人工别名可覆盖旧 nickname/label 字段', () => {
    expect(accountDisplayName({ accountId: 'machine-id', displayName: 'Tianxing Bai1' })).toBe('Tianxing Bai1');
  });

  it('旧 DTO 缺 displayName 时仅回落 accountId，不在前端重建优先级', () => {
    expect(accountDisplayName({ accountId: 'machine-id' })).toBe('machine-id');
    expect(makeAccountNamer([{ accountId: 'machine-id' }])('machine-id')).toBe('machine-id');
  });
});
