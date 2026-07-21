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
  // 客户端用户后台（change edge-client-customer-auth）
  name_taken: '账户名已被占用，请换一个',
  invalid_name: '账户名格式不合法（不能为空）',
  unknown_environment: '该环境尚未登记，无法分配',
  env_already_assigned: '该环境已有归属，请先完成原归属撤权与清理',
  cleanup_in_progress: '该环境归属已撤销，但清理仍待定位，暂不能重新分配',
  offboard_in_progress: '该环境正在执行撤权清理，完成并清除保留记录前不能重新分配',
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
  adspower_key_missing: '请先到「设置」配置 AdsPower API Key',
  adspower_unreachable: 'Cloud 无法连接 AdsPower API，AIDCP 环境已保留',
  adspower_timeout: 'AdsPower 删除请求超时，AIDCP 环境已保留，请稍后重试',
  adspower_http_error: 'AdsPower API 响应异常，AIDCP 环境已保留',
  adspower_invalid_response: 'AdsPower 返回无法确认的结果，AIDCP 环境已保留',
  adspower_api_error: 'AdsPower 拒绝删除，AIDCP 环境已保留',
  adspower_delete_failed: 'AdsPower 删除失败，AIDCP 环境已保留',
  deletion_in_progress: '该环境正在从 AdsPower 删除，请勿重复提交',
  persistence_failed: 'AdsPower 结果未能写入 AIDCP，请立即重试以核对真实状态',
  already_deleted: '该环境已经删除，请刷新列表',
  unavailable: '该功能暂不可用（依赖未就绪）',
  facebook_publish_media_unavailable: 'Facebook 发帖图片池暂不可用',
  non_facebook_account: '该账号不是 Facebook 账号',
  object_store_unavailable: '图片存储暂不可用，请稍后重试',
  invalid_file: '图片格式不合法',
  body_too_large: '文件过大，请压缩后重试',
  status_locked: '该图片正在使用或等待确认，暂不能修改',
  invalid_value: '提交的图片配置不合法',
  no_files: '请选择至少一张图片',
  bad_order: '图片排序数据不合法',
  bad_caption_hint: '图片备注格式不合法',
  // 视频号互动回复配置 v1 统一错误 envelope。
  INTERACTION_PERMISSION_DENIED: '权限不足，操作未执行',
  INTERACTION_NOT_FOUND: '账号或配置不存在',
  INTERACTION_SCOPE_MISMATCH: '账号范围不匹配，操作已拒绝',
  INTERACTION_VERSION_CONFLICT: '配置已被他处修改，请刷新后重试',
  INTERACTION_STATE_CONFLICT: '当前状态不允许该操作，请刷新后重试',
  INTERACTION_VALIDATION_FAILED: '配置校验未通过，请检查错误摘要',
  INTERACTION_CONFIG_MISSING: '缺少可用配置，请先完成草稿设置',
  INTERACTION_FEATURE_DISABLED: '该账号的互动能力尚未启用',
  INTERACTION_RATE_LIMITED: '操作过于频繁，请稍后重试',
  INTERACTION_UPSTREAM_UNAVAILABLE: '上游服务暂不可用，请稍后重试',
  INTERACTION_INTERNAL_ERROR: '互动配置服务暂时异常，请稍后重试',
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
