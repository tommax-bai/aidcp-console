import { describe, expect, it } from 'vitest';
import { roleLabel } from './usageLabels';

describe('roleLabel', () => {
  it('labels current publish image roles with operator-readable text', () => {
    expect(roleLabel('publish:ImageGenerator')).toBe('配图生成（图片模型）');
    expect(roleLabel('publish:ImageSetPlanner')).toBe('配图选题');
    expect(roleLabel('publish:ImagePromptComposer')).toBe('配图指令');
  });

  it('keeps unknown role fallback readable', () => {
    expect(roleLabel('publish:NewRole')).toBe('NewRole');
    expect(roleLabel('browse:unknown_role')).toBe('unknown role');
  });
});
