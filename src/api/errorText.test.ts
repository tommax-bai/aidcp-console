import { describe, it, expect } from 'vitest';
import { errorText } from './errorText';
import { ApiError } from './client';

describe('errorText（#31 服务端错误码 → 中文）', () => {
  it('reason 细分原因优先于 error 粗码', () => {
    expect(errorText(new ApiError(400, 'bad_request', 'value_type'))).toBe('字段类型不合法');
  });

  it('无 reason 时用 error 码映射', () => {
    expect(errorText(new ApiError(409, 'version_stale'))).toBe('内容已更新，请刷新后重新审批');
  });

  it('自动群评「必须先配群码」拒因按 reason 映射（error 恒为 bad_request，不得吞成「请求格式有误」）', () => {
    expect(errorText(new ApiError(400, 'bad_request', 'no_group_code'))).toBe(
      '该账号未配群码，请先到「账号」页录入关联群聊引流码',
    );
  });

  it('未知码回落 fallback（绝不把英文机器码当中文上屏）', () => {
    expect(errorText(new ApiError(500, 'wat_is_this'), '保存失败')).toBe('保存失败');
    expect(errorText(new ApiError(500, 'unmapped'))).toBe('操作失败');
  });

  it('普通 Error 的已知 message 也映射', () => {
    expect(errorText(new Error('account_not_found'))).toBe('账号不存在');
  });

  it('非 Error 值回落 fallback', () => {
    expect(errorText('boom', '失败')).toBe('失败');
    expect(errorText(null)).toBe('操作失败');
  });
});
