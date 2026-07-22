/**
 * 风控/告警枚举的 console 端镜像（cloud src/risk/types.ts 的副本）。
 *
 * 唯一源是 cloud `GET /api/version`；本文件 + aidcp-enums.test.ts 对其断言以防三处漂移
 * （design-ui §0/§2、design.md D11）。改这里务必同步 cloud，否则漂移测试失败。
 */

export const RISK_STATUSES = ['normal', 'warned', 'restricted', 'frozen'] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];

export const RISK_QUOTA_LEVELS = ['conservative', 'normal', 'aggressive'] as const;
export type RiskQuotaLevel = (typeof RISK_QUOTA_LEVELS)[number];

export const RISK_ACTIONS = ['like', 'collect', 'comment', 'follow', 'publish', 'view', 'search', 'comment_like', 'join_group', 'dm_reply'] as const;
export type RiskAction = (typeof RISK_ACTIONS)[number];

export const ALERT_SEVERITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export type EdgeOnlineState = 'online' | 'stale' | 'offline';

// ── 面板角色/模型配置枚举镜像（cloud src/panel/version.ts 权威全集的 console 副本，
//    change console-panel-config-enum-fingerprint）：对 GET /api/version 对拍防漂移。
//    这些是 console `{text,color}` 徽标映射的键——漂移→键缺失→曾致 /roles 整页崩（vision）。
//    类型由数组派生（控制台侧单源）；api.ts 复出这些类型供既有消费方按原路径导入。──

/** 角色模型类型（含 vision 视觉角色）。 */
export const LLM_KINDS = ['text', 'image', 'vision', 'none'] as const;
export type LlmKind = (typeof LLM_KINDS)[number];

/** 生效模型来源（含 vision 视觉全局）。 */
export const MODEL_EFFECTIVE_SOURCES = ['override', 'category', 'default', 'image', 'vision'] as const;
export type ModelEffectiveSource = (typeof MODEL_EFFECTIVE_SOURCES)[number];

/** 人设来源（override=已绑定 / none=未绑定）。 */
export const PERSONA_SOURCES = ['override', 'none'] as const;
export type PersonaSource = (typeof PERSONA_SOURCES)[number];

/** 思考模式三态（default=跟模型走 / off / on）。 */
export const THINKING_MODES_API = ['default', 'off', 'on'] as const;
export type ThinkingModeApi = (typeof THINKING_MODES_API)[number];

// ── 视觉映射（design-ui §2）：status = filled warm / tier = outlined cool，构造级分离 ──

/** STATUS 徽标色（AntD Tag preset，warm 族）。 */
export const RISK_STATUS_COLOR: Record<RiskStatus, string> = {
  normal: 'green',
  warned: 'gold',
  restricted: 'volcano',
  frozen: 'red',
};

/** QUOTA-TIER 徽标色（AntD Tag preset，cool 族；与 status 永不混淆）。 */
export const RISK_QUOTA_COLOR: Record<RiskQuotaLevel, string> = {
  conservative: 'blue',
  normal: 'geekblue',
  aggressive: 'purple',
};

/** 互动动作色（change interaction-feed-enrichment）：四类互动各异色便于区分；未知回落默认灰。 */
export const RISK_ACTION_COLOR: Record<RiskAction, string> = {
  like: 'magenta',
  collect: 'gold',
  comment: 'blue',
  follow: 'green',
  publish: 'purple',
  view: 'default',
  search: 'geekblue',
  comment_like: 'cyan', // 评论赞
  join_group: 'lime',
  dm_reply: 'orange',
};

/** 告警分级色（V1 用；P3 中性灰不抢视觉）。 */
export const ALERT_SEVERITY_COLOR: Record<AlertSeverity, string> = {
  P0: 'red',
  P1: 'orange',
  P2: 'gold',
  P3: 'default',
};

/** edge online 三态 → AntD Badge status（绝不二元）。 */
export const EDGE_ONLINE_BADGE: Record<EdgeOnlineState, 'success' | 'warning' | 'default'> = {
  online: 'success',
  stale: 'warning',
  offline: 'default',
};

// ── 枚举 → 中文 label（全站唯一源；UI 渲染中文、内部值不变，防术语漂移）──

/** 风控状态中文 label。 */
export const RISK_STATUS_LABEL: Record<RiskStatus, string> = {
  normal: '正常',
  warned: '预警',
  restricted: '受限',
  frozen: '冻结',
};

/** 配额档位中文 label。 */
export const RISK_QUOTA_LABEL: Record<RiskQuotaLevel, string> = {
  conservative: '保守',
  normal: '正常',
  aggressive: '激进',
};

/** 互动动作中文 label（复用于按账号计数列头与互动表）。 */
export const RISK_ACTION_LABEL: Record<RiskAction, string> = {
  like: '点赞',
  collect: '收藏',
  comment: '评论',
  follow: '关注',
  publish: '发布',
  view: '浏览',
  search: '搜索',
  comment_like: '评论赞', // change console-cloud-panel-hardening #4
  join_group: '加群',
  dm_reply: '私信回复',
};

/** 运营态中文 label（durable 暂停，区别于验证码暂停）。 */
export const OPERATOR_STATUS_LABEL: Record<'active' | 'paused', string> = {
  active: '运行中',
  paused: '运营已暂停',
};

/** 边缘端在线三态中文 label。 */
export const EDGE_ONLINE_LABEL: Record<EdgeOnlineState, string> = {
  online: '在线',
  stale: '失联',
  offline: '离线',
};

/** 告警级别中文释义（代号保留，作 tooltip / 副文）。 */
export const ALERT_SEVERITY_LABEL: Record<AlertSeverity, string> = {
  P0: '紧急',
  P1: '严重',
  P2: '警告',
  P3: '提示',
};

// ── 对象值徽标映射的容错取值（防云端↔控制台枚举漂移把整页 white-screen）─────────────
/**
 * `Record<Union, {text,color}>` 徽标映射按 wire 值取值的**唯一安全入口**。
 *
 * 背景：控制台的枚举类型是手动镜像 cloud 的（见本文件头与 [[protocol]] 四处同步同源思路），
 * 会漂移。若直接写 `MAP[wireValue].color`，遇到镜像里还没有的新枚举值（如曾经的
 * `llmKind:'vision'`）就会 `undefined.color` 抛错、整页崩成 "Unexpected Application Error!"。
 * 本函数令未知值诚实回落成灰底原值标签、绝不 throw（自愈不自残、坏一格 ≠ 垮整页）。
 *
 * 约束：全站所有对象值徽标映射按 wire 值取值**必须**走此函数——`enumTagSafety.test.ts`
 * 扫描源码、发现任何 `大写映射[...] .color/.text/.label` 裸取即失败（本仓无 ESLint，测试即闸）。
 */
export function tagOf(
  map: Record<string, { text: string; color: string }>,
  key: string,
): { text: string; color: string } {
  return map[key] ?? { text: key, color: 'default' };
}

/** 标量中文文案映射按 wire 值取值的安全入口；未知值诚实显示原值。 */
export function labelOf(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}
