/**
 * 服务端错误码 / 细分原因 → 说人话中文（change console-cloud-panel-hardening #31）。
 *
 * client 把 body.error 放进 ApiError.message、body.reason 放进 ApiError.reason；本模块集中映射，
 * 替代各页把英文机器码（如 bad_request / version_stale）直接上屏。收口原 ContentPage 的孤例映射。
 * reason（细分）优先于 error（粗）；未知码回落调用方给的 fallback（绝不把英文码当中文展示）。
 */

import { ApiError } from './client';

const CODE_TEXT: Record<string, string> = {
  // 审批 / 编辑 CAS 拒因（原 ContentPage 孤例，收口于此）
  version_conflict: '内容已被他处修改，请刷新后重试',
  version_stale: '内容已更新，请刷新后重新审批',
  already_decided: '该草稿正在审批处理中，请刷新',
  account_offline: '账号不在线，无法发布',
  publish_target_unavailable: '无法确认发布账号，无法发布',
  not_pending: '该草稿已不可编辑（非待审态）',
  not_found: '目标不存在',
  missing_visibility: '可见范围不能为空',
  invalid_title: '标题不能为空',
  invalid_field: '提交内容不合法或已过期，请刷新后重试',
  // 通用写入 / 校验拒因
  bad_request: '请求格式有误',
  value_type: '字段类型不合法',
  invalid_record_id: '记录 ID 不合法',
  invalid_request_id: '请求标识不合法',
  invalid_group_label: '分组标签格式不合法',
  invalid_contact_info: '联系方式格式不合法',
  // 自动联系评论「必须先配联系方式」拒因（content-schedule-group-comments）：云端随 bad_request 的 body.reason 下发，
  // error 恒为 'bad_request'，故必须按 reason 映射（否则只会显「请求格式有误」看不出真因）。
  // 注：联系方式「共用」自 loosen-group-comment-shared-code 起不再是 error（已放行 + 前端警告），故此处无共用拒因映射。
  no_contact_info: '该账号未配联系方式，请先到「账号」页录入联系方式',
  account_not_found: '账号不存在',
  account_lookup_failed: '账号列表查询失败，请稍后重试',
  unknown_command: '未知操作',
  unknown_kind: '未知信号类型',
  unknown_level: '未知档位',
  unknown_provider: '未知厂商',
  override_requires_audit_reason: '强制恢复需填写审计理由',
  provider_key_missing: '所选厂商的密钥未配置，请先配置密钥',
  model_invalid: '模型名无效（保存前探活未通过）',
  cred_key_missing: '服务端未配置主加密密钥，无法保存密钥',
  unavailable: '该功能暂不可用（依赖未就绪）',
};

/** 把 API 错误映射为说人话中文；未知码回落 fallback。reason（细分）优先于 error（粗）。 */
export function errorText(err: unknown, fallback = '操作失败'): string {
  if (err instanceof ApiError) {
    if (err.reason && CODE_TEXT[err.reason]) return CODE_TEXT[err.reason];
    if (CODE_TEXT[err.message]) return CODE_TEXT[err.message];
    return fallback;
  }
  if (err instanceof Error && CODE_TEXT[err.message]) return CODE_TEXT[err.message];
  return fallback;
}
