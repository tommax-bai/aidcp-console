import { useEffect, useState } from 'react';
import { App, Button, Card, Form, Input, InputNumber, Modal, Segmented, Select, Skeleton, Table, Tabs, Tag, Typography, Alert } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '../api/client';
import { useRoleConfig, useCategoryConfig, useModelConfig, useAccounts } from '../api/queries';
import { QueryError } from '../components/QueryGate';
import { ProfileLink } from '../components';
import { promptPersonaSourceSummary } from './rolePromptPersonaSource';
import { makeAccountNamer, accountName } from '../types/accountDisplay';
import { tagOf } from '../types/aidcp-enums';
import type {
  RoleConfigRow,
  RoleConfigCatalog,
  CategoryConfigRow,
  CategoryConfigCatalog,
  ModelEffectiveSource,
  ThinkingModeApi,
  RolePromptView,
} from '../types/api';

const KIND_LABEL: Record<RoleConfigRow['llmKind'], { text: string; color: string }> = {
  text: { text: '文本模型', color: 'blue' },
  image: { text: '图像模型', color: 'purple' },
  vision: { text: '视觉模型', color: 'geekblue' },
  none: { text: '不调模型', color: 'default' },
};
// 分类 key → 展示名/排序（console 侧短名）。
// 刻意与 cloud CATEGORY_CATALOG 的长名（「浏览 · 判定类」…）分道：本页把「生命周期阶段」交给上方 tab
// （初始化/浏览/互动/撰写），分类只表达「模型任务类型」这条正交轴，故剥掉会与 tab 撞词的「浏览/发布」域前缀，
// 只留纯任务类型词。全站分类叫法以此为准（顶部「分类默认模型」表 + 行内分类均走这里），云端返回的
// displayName 仅作未知分类的兜底。
const CATEGORY_META: Record<string, { label: string; order: number }> = {
  browse_judge: { label: '判定类', order: 1 },
  browse_compose: { label: '文案类', order: 2 },
  publish_create: { label: '创作类', order: 3 },
  publish_gate: { label: '评审类', order: 4 },
  image: { label: '图像类', order: 5 },
};
const categoryLabel = (key: string) => CATEGORY_META[key]?.label ?? key;

// 角色显示名 console 侧归一（唯一权威 = 本页；云端 role-config-facade 仅透传 displayName、别处不消费）：
// 只登记「名字需改」的 roleId，未列出的优雅回落 API displayName（新角色不漏不崩）。
// 归一规则：① 分隔符统一为无空格中点「·」，只给「有名的多步管线 / 平台域」前缀（建号·/精选准入·/保真洗稿·/
// 配图·/封面·/评论·/Facebook·），单一用途角色不加；② 显示名禁塞实现细节（删「（模型经 env 配置）」「（张数+主题）」
// 「（主题→万相prompt）」「（依定稿）」）；③ 二元 go/no-go 结论统一「…判定」、删口语「是否/值得」前缀。
const ROLE_NAME_OVERRIDE: Record<string, string> = {
  'browse:concept_extractor': '笔记概念抽取',
  'browse:comment_reviewer': '评论区展开判定',
  'browse:author_evaluator': '作者主页访问判定',
  'browse:comment_target_picker': '评论·目标笔记甄选',
  'browse:comment_appraiser': '评论价值判定',
  'browse:facebook_group_join_judge': 'Facebook·加群判定',
  'browse:comment_de_ai_flavor': '评论去AI味改写',
  'publish:ContentScout': '选题侦察',
  'publish:CategoryClassifier': '配图·品类判定',
  'publish:CoverFormSensor': '封面·形态感知',
  'publish:CoverCardWriter': '封面·文字卡文案',
  'publish:ImageSetPlanner': '配图·选题规划',
  'publish:ImagePromptComposer': '配图·指令生成',
  'publish:ContentCleaner': '正文去AI味改写',
  'publish:ImageGenerator': '配图·生成执行',
  'publish:TopicGenerator': '话题生成',
  'publish:TopicEvaluator': '话题相关性评估',
};
const roleDisplayName = (row: Pick<RoleConfigRow, 'roleId' | 'displayName'>) =>
  ROLE_NAME_OVERRIDE[row.roleId] ?? row.displayName;

// 角色「使用阶段」tab（纯前端展示分组，与云端 category 分类正交、只在此维护）：
// 初始化=建号/任务起点，浏览=读与判，互动=点赞/评论/关注决策，撰写=评论撰写 + 整条发布管线。
// 显式 roleId→tab 优先；未列出的按 group 兜底（browse→浏览、publish→撰写），保证任何新角色都不会漏出 tab。
type RoleTabKey = 'init' | 'browse' | 'interact' | 'compose';
const ROLE_TAB_META: { key: RoleTabKey; label: string }[] = [
  { key: 'init', label: '初始化' },
  { key: 'browse', label: '浏览' },
  { key: 'interact', label: '互动' },
  { key: 'compose', label: '撰写' },
];
const ROLE_TAB_BY_ID: Record<string, RoleTabKey> = {
  // 初始化：建号人设 + 起一次浏览/评论任务的入口决策。
  'browse:persona_generator': 'init',
  'browse:search_evaluator': 'init',
  'browse:comment_search_term_generator': 'init',
  // 浏览：读正文 / 判定 / 甄选（含精选准入评估、概念抽取、进主页评估、搜索目标甄选）。
  'browse:content_evaluator': 'browse',
  'browse:content_curator': 'browse',
  'browse:concept_extractor': 'browse',
  'browse:curated_note_evaluator': 'browse',
  'browse:comment_reviewer': 'browse',
  'browse:curated_comment_evaluator': 'browse',
  'browse:author_evaluator': 'browse',
  'browse:comment_target_picker': 'browse',
  // 互动：点赞 / 收藏 / 评论与否 / 关注 / 加群 的决策。
  'browse:interaction_appraiser': 'interact',
  'browse:comment_appraiser': 'interact',
  'browse:comment_like_appraiser': 'interact',
  'browse:follow_agent': 'interact',
  'browse:facebook_group_join_judge': 'interact',
  // 撰写：浏览侧评论撰写/去 AI 味 + 所有 publish:* 发布管线（由 group 兜底，无需逐一列）。
  'browse:comment_composer': 'compose',
  'browse:comment_de_ai_flavor': 'compose',
};
const tabOfRole = (row: RoleConfigRow): RoleTabKey =>
  ROLE_TAB_BY_ID[row.roleId] ?? (row.group === 'publish' ? 'compose' : 'browse');
// 生效来源标注（覆盖 / 继承分类 / 继承默认 / 图像全局）。
const SOURCE_TAG: Record<ModelEffectiveSource, { text: string; color: string }> = {
  override: { text: '已覆盖', color: 'green' },
  category: { text: '继承分类', color: 'cyan' },
  default: { text: '继承默认', color: 'default' },
  image: { text: '图像全局', color: 'purple' },
  vision: { text: '视觉全局', color: 'geekblue' },
};
// 厂商短标签（change model-config-volcengine-provider）。
const PROVIDER_TAG: Record<string, { text: string; color: string }> = {
  dashscope: { text: '百炼', color: 'blue' },
  volcengine: { text: '火山', color: 'volcano' },
};
const providerTag = (id: string) => PROVIDER_TAG[id] ?? { text: id, color: 'default' };

// 思考模式（change role-thinking-mode-config）：三态标签 + 与 cloud buildThinkingParams 同源的"可开启"判定。
const THINKING_TAG: Record<'default' | 'off' | 'on', { text: string; color: string }> = {
  default: { text: '跟模型', color: 'default' },
  off: { text: '关思考', color: 'blue' },
  on: { text: '开思考', color: 'green' },
};
/** DashScope Qwen 开思考需流式（本期不支持）→ 不可开启；火山豆包 / DashScope DeepSeek 非流式可开；未知失败安全。 */
function thinkingOnSupported(provider: string, model: string): boolean {
  const p = (provider || '').trim().toLowerCase();
  const m = (model || '').trim().toLowerCase();
  if (p === 'volcengine') return true;
  if (p === 'dashscope') return m.startsWith('deepseek');
  return false;
}

/**
 * 角色配置页（change console-role-model-config + role-model-category-config）。
 * - 按分类分组查看角色；模型解析四层回落：按角色覆盖 → 分类默认 → 全局「默认模型」→ 代码默认。
 * - 可按分类设默认模型（同类未单独覆盖的角色随之生效）；也可按角色单独覆盖模型/温度。
 * - 写非乐观——round-trip 后 invalidate 重取真态；模型名保存前由服务端探活，无效则诚实拒绝。
 */
export function RolesPage() {
  const { data, isLoading, isError, refetch } = useRoleConfig();
  const { data: catData, isLoading: catLoading } = useCategoryConfig();
  const { data: modelCfg } = useModelConfig();
  const { data: accountsData } = useAccounts();
  const { message } = App.useApp();
  const qc = useQueryClient();

  // 预览人设选择（change prompt-preview-persona-selector）：选一个账号，按其人设带入查看角色 prompt；
  // 空=示例人设。未绑人设的账号标注（persona-driven-content-pipeline：default 已删、无豁免；
  // 未绑账号运行会被拒，预览由服务端按示例人设渲染并标 personaFallback，绝不冒充）。
  const accounts = accountsData?.accounts ?? [];
  const [previewAccountId, setPreviewAccountId] = useState<string | undefined>(undefined);
  const accountOptions = accounts.map((a) => {
    const noPersona = !a.personaBound;
    const name = accountName(a);
    return { value: a.accountId, label: noPersona ? `${name}（未绑定人设）` : name };
  });
  // 统一走诚实回落（真名→运营名→ID），不再内联手写（防漂移）。
  const accountLabel = makeAccountNamer(accounts);
  const previewAccount = previewAccountId ? accounts.find((a) => a.accountId === previewAccountId) : undefined;
  const previewPersonaHint = previewAccountId
    ? previewAccount?.personaBound
      ? `查看 Prompt 时使用账号「${accountLabel(previewAccountId)}」的真实人设；实时卡片/正文仍为示例占位。`
      : `账号「${accountLabel(previewAccountId)}」未绑定人设，运行会被拒绝；查看 Prompt 时仅按示例人设渲染。`
    : '未选择账号，查看 Prompt 时使用示例人设；实时卡片/正文仍为示例占位。';

  // 文本厂商下拉项（取自模型配置真态；未载入时回退仅 dashscope）。
  const providerOptions = (modelCfg?.providers ?? [{ id: 'dashscope', displayName: '阿里百炼 DashScope', baseUrl: '' }]).map(
    (p) => ({ value: p.id, label: p.displayName }),
  );

  const [editing, setEditing] = useState<RoleConfigRow | null>(null);
  // 模型来源显式二态：inherit=跟随上层默认（清除本行覆盖）；custom=为本行单独锁定模型。
  // 取代原先「靠字符串是否变动来推断覆盖/继承」的隐式逻辑，避免误钉、并支持把继承值主动固定为覆盖。
  const [modelMode, setModelMode] = useState<'inherit' | 'custom'>('inherit');
  const [modelInput, setModelInput] = useState('');
  const [providerInput, setProviderInput] = useState('dashscope');
  const [tempInput, setTempInput] = useState<number | null>(null);
  const [thinkingInput, setThinkingInput] = useState<ThinkingModeApi>('default');

  const [editingCat, setEditingCat] = useState<CategoryConfigRow | null>(null);
  const [catModelMode, setCatModelMode] = useState<'inherit' | 'custom'>('inherit');
  const [catModelInput, setCatModelInput] = useState('');
  const [catProviderInput, setCatProviderInput] = useState('dashscope');
  const [catThinkingInput, setCatThinkingInput] = useState<ThinkingModeApi>('default');

  // 只读 prompt 预览（change role-prompt-visibility）：点开时按需拉取，不常驻查询。
  const [promptRole, setPromptRole] = useState<RoleConfigRow | null>(null);
  const [promptView, setPromptView] = useState<RolePromptView | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);

  // 按选定账号人设拉取预览（change prompt-preview-persona-selector）：accountId 空=示例人设。
  const loadPrompt = async (row: RoleConfigRow, accountId: string | undefined) => {
    setPromptView(null);
    setPromptLoading(true);
    try {
      const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
      setPromptView(await apiGet<RolePromptView>(`/api/roles/${encodeURIComponent(row.roleId)}/prompt${qs}`));
    } catch (e) {
      setPromptView({ roleId: row.roleId, prompt: null, available: false, note: `加载失败：${(e as Error).message}` });
    } finally {
      setPromptLoading(false);
    }
  };

  const openPrompt = (row: RoleConfigRow) => {
    setPromptRole(row);
    void loadPrompt(row, previewAccountId);
  };

  // 选定账号变化且弹窗已开 → 按新账号人设重拉刷新（仅响应账号切换，不在打开时重复拉取）。
  useEffect(() => {
    if (promptRole) void loadPrompt(promptRole, previewAccountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewAccountId]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['config', 'roles'] });
    void qc.invalidateQueries({ queryKey: ['config', 'categories'] });
  };

  const saveErr = (e: unknown) => {
    const msg = (e as Error).message;
    message.error(
      msg === 'model_invalid'
        ? '模型名无效（保存前探活未通过），未保存'
        : msg === 'provider_key_missing'
          ? '所选厂商的密钥未配置，请到「设置」页配置该厂商密钥并重启 cloud'
          : '保存失败',
    );
  };

  const save = useMutation({
    mutationFn: (v: {
      roleId: string;
      model: string;
      provider: string;
      temperature?: number | null;
      thinkingMode: ThinkingModeApi;
    }) =>
      apiPut<RoleConfigCatalog>(`/api/roles/${encodeURIComponent(v.roleId)}/config`, {
        model: v.model,
        provider: v.provider,
        ...(v.temperature !== undefined ? { temperature: v.temperature } : {}),
        // 思考模式（change role-thinking-mode-config）：与模型独立发；'default' = 清除覆盖（回落）。
        thinkingMode: v.thinkingMode,
      }),
    onSuccess: () => {
      message.success('已保存，按角色即时生效');
      setEditing(null);
      invalidate();
    },
    onError: saveErr,
  });

  const saveCat = useMutation({
    mutationFn: (v: { categoryId: string; model: string; provider: string; thinkingMode: ThinkingModeApi }) =>
      apiPut<CategoryConfigCatalog>(`/api/categories/${encodeURIComponent(v.categoryId)}/config`, {
        // 留空 → null：清除分类覆盖，回落全局默认（provider 随之清空）。
        model: v.model.trim() === '' ? null : v.model.trim(),
        provider: v.provider,
        // 分类思考模式（change role-thinking-mode-config）：'default' = 清除覆盖（回落）。
        thinkingMode: v.thinkingMode,
      }),
    onSuccess: () => {
      message.success('已保存，分类默认即时生效');
      setEditingCat(null);
      invalidate();
    },
    onError: saveErr,
  });

  const openEdit = (row: RoleConfigRow) => {
    setEditing(row);
    // 来源二态按当前是否有覆盖初始化；无论哪态都带入当前生效模型，作为切到「自定义」时的起始值
    //（继承值也能被一键固定为覆盖）。
    setModelMode(row.modelOverridden ? 'custom' : 'inherit');
    setModelInput(row.effectiveModel);
    setProviderInput(row.effectiveProvider || 'dashscope');
    setTempInput(row.temperatureOverride);
    // 思考模式：有覆盖用覆盖、否则 'default'（不覆盖、继承分类/default）；与模型来源相互独立。
    setThinkingInput(row.thinkingModeOverride ?? 'default');
  };
  const openCatEdit = (row: CategoryConfigRow) => {
    setEditingCat(row);
    setCatModelMode(row.modelOverridden ? 'custom' : 'inherit');
    setCatModelInput(row.effectiveModel);
    setCatProviderInput(row.effectiveProvider || 'dashscope');
    setCatThinkingInput(row.thinkingModeOverridden ? row.effectiveThinkingMode : 'default');
  };

  // 思考「开启」可用性：自定义且已填模型 → 按当前「厂商+模型」的前端镜像（与云端 buildThinkingParams 同源）；
  // 继承/未填 → 用后端对当前生效模型算好的真态。thinkingOnAvailable 独立于模型来源（后端分开存）。
  const roleThinkingOnOk =
    editing == null
      ? false
      : modelMode === 'custom' && modelInput.trim()
        ? thinkingOnSupported(providerInput, modelInput)
        : editing.thinkingOnAvailable;
  const catThinkingOnOk =
    editingCat == null
      ? false
      : catModelMode === 'custom' && catModelInput.trim()
        ? thinkingOnSupported(catProviderInput, catModelInput)
        : editingCat.thinkingOnAvailable;
  // 一旦「开启」变不可用（切来源 / 换模型 / 换厂商后目标模型不支持非流式思考），把已选的 on 收回 default，
  // 避免「禁用却仍选中 on」的误导状态、也防止把不支持思考的组合静默存成 on（红线：别误导、绝不静默假成功）。
  useEffect(() => {
    if (editing && thinkingInput === 'on' && !roleThinkingOnOk) setThinkingInput('default');
  }, [editing, thinkingInput, roleThinkingOnOk]);
  useEffect(() => {
    if (editingCat && catThinkingInput === 'on' && !catThinkingOnOk) setCatThinkingInput('default');
  }, [editingCat, catThinkingInput, catThinkingOnOk]);

  // 角色按「用户访问小红书的顺序」展示：顺序源头是云端 role-catalog 的 ROLE_CATALOG 数组
  // （浏览闭环=访问先后、发布=管线依赖链），API 原样透出；此处直接沿用后端顺序、不再按分类/字母重排。
  // 分类改为行内标签（上方「分类默认模型」表仍按分类）。
  const sortedRoles = data?.roles ?? [];

  const catColumns: ColumnsType<CategoryConfigRow> = [
    {
      title: '分类',
      dataIndex: 'categoryId',
      render: (_id: string, row) => <strong>{CATEGORY_META[row.categoryId]?.label ?? row.displayName}</strong>,
    },
    {
      title: '分类默认模型',
      dataIndex: 'effectiveModel',
      render: (model: string, row) => (
        <span className="tabular-nums">
          <Tag color={providerTag(row.effectiveProvider).color}>{providerTag(row.effectiveProvider).text}</Tag>
          {model} {row.modelOverridden ? <Tag color="green">已设</Tag> : <Tag>继承默认</Tag>}
        </span>
      ),
    },
    {
      title: '思考',
      dataIndex: 'effectiveThinkingMode',
      width: 100,
      render: (m: ThinkingModeApi) => {
        const t = tagOf(THINKING_TAG, m);
        return <Tag color={t.color}>{t.text}</Tag>;
      },
    },
    {
      title: '操作',
      width: 90,
      render: (_: unknown, row) => (
        <Button size="small" onClick={() => openCatEdit(row)}>
          编辑
        </Button>
      ),
    },
  ];

  const columns: ColumnsType<RoleConfigRow> = [
    {
      title: '角色',
      dataIndex: 'displayName',
      render: (_name: string, row) => (
        <div className="roles-role-cell">
          <div className="roles-role-cell__name">{roleDisplayName(row)}</div>
          <div className="roles-role-cell__cat">{categoryLabel(row.category)}</div>
        </div>
      ),
    },
    {
      title: '类型',
      dataIndex: 'llmKind',
      width: 110,
      // 文本模型是绝大多数，逐行一枚蓝 Tag 是纯噪声 → 文本降为 muted 文字，仅图像/视觉/不调/未知才出彩色 Tag。
      render: (kind: RoleConfigRow['llmKind']) => {
        const t = tagOf(KIND_LABEL, kind);
        return kind === 'text' ? (
          <Typography.Text type="secondary">{t.text}</Typography.Text>
        ) : (
          <Tag color={t.color}>{t.text}</Tag>
        );
      },
    },
    {
      title: '当前生效模型',
      dataIndex: 'effectiveModel',
      render: (model: string, row) => {
        const src = tagOf(SOURCE_TAG, row.effectiveSource);
        return (
          <span className="tabular-nums">
            <Tag color={providerTag(row.effectiveProvider).color}>{providerTag(row.effectiveProvider).text}</Tag>
            {model} <Tag color={src.color}>{src.text}</Tag>
          </span>
        );
      },
    },
    {
      title: '温度',
      dataIndex: 'temperatureOverride',
      width: 120,
      render: (t: number | null, row) =>
        row.tunableTemperature ? (
          t === null ? <Typography.Text type="secondary">默认</Typography.Text> : <span className="tabular-nums">{t}</span>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: '思考',
      dataIndex: 'effectiveThinkingMode',
      width: 110,
      render: (m: ThinkingModeApi, row) => {
        if (row.llmKind !== 'text') return <Typography.Text type="secondary">—</Typography.Text>;
        const t = tagOf(THINKING_TAG, m);
        return (
          <Tag color={t.color}>
            {t.text}
            {row.thinkingModeSource === 'category' ? '·类' : ''}
          </Tag>
        );
      },
    },
    {
      title: '操作',
      width: 180,
      render: (_: unknown, row) => (
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          {row.llmKind === 'text' ? (
            <Button size="small" onClick={() => openEdit(row)}>
              编辑
            </Button>
          ) : (
            <Typography.Text type="secondary">全局</Typography.Text>
          )}
          <Button size="small" type="link" style={{ padding: 0 }} onClick={() => openPrompt(row)}>
            查看 Prompt
          </Button>
        </span>
      ),
    },
  ];

  if (isError) return <QueryError title="加载角色配置失败" onRetry={() => refetch()} />;

  if (isLoading || !data) {
    return (
      <div className="page-stack">
        <Card size="small" title="角色配置">
          <Skeleton active />
        </Card>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <Card size="small" title="分类默认模型">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="按分类设默认模型：同类下未单独覆盖的角色都用它；留空=该分类回落到「默认模型」（设置页）。改完即时生效。"
        />
        {catLoading || !catData ? (
          <Skeleton active />
        ) : (
          <Table<CategoryConfigRow>
            size="small"
            rowKey="categoryId"
            columns={catColumns}
            dataSource={catData.categories}
            pagination={false}
          />
        )}
      </Card>

      <Card size="small" title="角色模型配置">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="Prompt 预览人设"
          description={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <span>{previewPersonaHint}</span>
              <Select
                size="small"
                allowClear
                placeholder="示例人设"
                style={{ width: 260 }}
                value={previewAccountId}
                onChange={(v) => setPreviewAccountId(v ?? undefined)}
                options={accountOptions}
              />
            </div>
          }
        />
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="模型按四层回落生效：按角色覆盖 → 分类默认 → 默认模型 → 代码默认。模型名留空=取消该角色覆盖；温度仅生成/改写类可调；图像角色用全局图片模型，请到「设置」页改。"
        />
        <Tabs
          className="roles-stage-tabs"
          defaultActiveKey="browse"
          items={ROLE_TAB_META.map((t) => {
            const rows = sortedRoles.filter((r) => tabOfRole(r) === t.key);
            return {
              key: t.key,
              // 视觉：阶段名 + 计数徽标（不再把「（N）」塞进标题文案）；title 保留全角括号计数供 hover/无障碍/测试定位。
              label: (
                <span className="roles-tab-label" title={`${t.label}（${rows.length}）`}>
                  {t.label}
                  <span className="roles-tab-label__count">{rows.length}</span>
                </span>
              ),
              // 全 tab 强制挂载：4 张表总计仅数十行，避免切换闪烁，也让「当前生效模型」一览无需逐 tab 点。
              forceRender: true,
              children: (
                <Table<RoleConfigRow>
                  size="small"
                  rowKey="roleId"
                  columns={columns}
                  dataSource={rows}
                  pagination={false}
                  locale={{ emptyText: '该阶段下暂无角色' }}
                />
              ),
            };
          })}
        />
      </Card>

      <Modal
        title={editing ? `编辑：${roleDisplayName(editing)}` : ''}
        open={!!editing}
        onCancel={() => setEditing(null)}
        confirmLoading={save.isPending}
        onOk={() => {
          if (!editing) return;
          const custom = modelMode === 'custom';
          const m = modelInput.trim();
          // 自定义但没填模型名 = 无意义空覆盖 → 诚实拦下，别让它退化成静默回落。
          if (custom && !m) {
            message.warning('「自定义」需填写模型名，或切回「继承」');
            return;
          }
          // 继承 → 送空清除本角色模型覆盖；自定义 → 送当前值建/改覆盖（后端按厂商探活）。
          save.mutate({
            roleId: editing.roleId,
            model: custom ? m : '',
            provider: providerInput,
            ...(editing.tunableTemperature ? { temperature: tempInput } : {}),
            thinkingMode: thinkingInput,
          });
        }}
        okText="保存"
        cancelText="取消"
      >
        {editing && (
          <Form layout="vertical" requiredMark={false}>
            <Form.Item
              label="模型来源"
              extra="继承=跟随分类默认 / 默认模型（随上层变动）；自定义=为本角色单独锁定一个模型。"
            >
              <Segmented
                value={modelMode}
                onChange={(v) => setModelMode(v as 'inherit' | 'custom')}
                options={[
                  { label: '继承', value: 'inherit' },
                  { label: '自定义', value: 'custom' },
                ]}
              />
            </Form.Item>
            {modelMode === 'inherit' ? (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 'var(--aidcp-space-4)' }}
                message={`跟随${editing.effectiveSource === 'category' ? '分类默认' : '默认模型'}（随上层变动）。当前生效：${providerTag(editing.effectiveProvider).text} ${editing.effectiveModel}。保存即取消本角色的模型覆盖。`}
              />
            ) : (
              <>
                <Form.Item label="厂商" extra="火山方舟需先在「设置」页配置其 API 密钥。">
                  <Select
                    value={providerInput}
                    onChange={setProviderInput}
                    options={providerOptions}
                    style={{ maxWidth: 280 }}
                  />
                </Form.Item>
                <Form.Item label="文本模型名" extra="为本角色单独锁定模型；保存前服务端按所选厂商探活。">
                  <Input
                    value={modelInput}
                    onChange={(e) => setModelInput(e.target.value)}
                    placeholder="如 qwen-turbo / 火山 doubao-… / ep-…"
                  />
                </Form.Item>
              </>
            )}
            {editing.tunableTemperature && (
              <Form.Item label="温度" extra="0–1；留空=用代码默认。判定类角色不开放此项。">
                <InputNumber
                  value={tempInput ?? undefined}
                  onChange={(v) => setTempInput(v ?? null)}
                  min={0}
                  max={1}
                  step={0.1}
                  style={{ width: 160 }}
                  placeholder="默认"
                />
              </Form.Item>
            )}
            <Form.Item
              label="思考模式"
              extra="默认=跟模型走（当前行为）；关闭=强制不思考（判定/口语撰写类推荐）；开启=强制深度思考（仅发布审批类值得）。"
            >
              <Select
                value={thinkingInput}
                onChange={(v) => setThinkingInput(v)}
                style={{ maxWidth: 320 }}
                options={(() => {
                  const onOk = roleThinkingOnOk;
                  return [
                    { value: 'default', label: '默认（跟模型走）' },
                    { value: 'off', label: '关闭（强制不思考）' },
                    {
                      value: 'on',
                      label: onOk ? '开启（强制深度思考）' : '开启（该模型开思考需流式，暂不可用）',
                      disabled: !onOk,
                    },
                  ];
                })()}
              />
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title={editingCat ? `分类默认：${CATEGORY_META[editingCat.categoryId]?.label ?? editingCat.displayName}` : ''}
        open={!!editingCat}
        onCancel={() => setEditingCat(null)}
        confirmLoading={saveCat.isPending}
        onOk={() => {
          if (!editingCat) return;
          const custom = catModelMode === 'custom';
          const m = catModelInput.trim();
          if (custom && !m) {
            message.warning('「自定义」需填写模型名，或切回「继承」');
            return;
          }
          // 继承 → 送空（后端归 null）清除分类默认覆盖；自定义 → 送当前值设为分类默认（后端按厂商探活）。
          saveCat.mutate({
            categoryId: editingCat.categoryId,
            model: custom ? m : '',
            provider: catProviderInput,
            thinkingMode: catThinkingInput,
          });
        }}
        okText="保存"
        cancelText="取消"
      >
        {editingCat && (
          <Form layout="vertical" requiredMark={false}>
            <Form.Item
              label="模型来源"
              extra="继承=跟随全局「默认模型」（随其变动）；自定义=为该分类单独设一个默认模型。"
            >
              <Segmented
                value={catModelMode}
                onChange={(v) => setCatModelMode(v as 'inherit' | 'custom')}
                options={[
                  { label: '继承', value: 'inherit' },
                  { label: '自定义', value: 'custom' },
                ]}
              />
            </Form.Item>
            {catModelMode === 'inherit' ? (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 'var(--aidcp-space-4)' }}
                message={`跟随全局「默认模型」（设置页，随其变动）。当前生效：${providerTag(editingCat.effectiveProvider).text} ${editingCat.effectiveModel}。保存即取消该分类的默认模型覆盖。`}
              />
            ) : (
              <>
                <Form.Item label="厂商" extra="火山方舟需先在「设置」页配置其 API 密钥。">
                  <Select
                    value={catProviderInput}
                    onChange={setCatProviderInput}
                    options={providerOptions}
                    style={{ maxWidth: 280 }}
                  />
                </Form.Item>
                <Form.Item
                  label="分类默认模型名"
                  extra="该分类下未单独覆盖的角色都用它；保存前服务端按所选厂商探活。"
                >
                  <Input
                    value={catModelInput}
                    onChange={(e) => setCatModelInput(e.target.value)}
                    placeholder="如 qwen-turbo / 火山 doubao-… / ep-…"
                  />
                </Form.Item>
              </>
            )}
            <Form.Item
              label="分类默认思考模式"
              extra="该分类下未单独覆盖的角色都用它；默认=跟模型走。开启需该分类默认模型支持（非流式可思考）。"
            >
              <Select
                value={catThinkingInput}
                onChange={(v) => setCatThinkingInput(v)}
                style={{ maxWidth: 320 }}
                options={(() => {
                  const onOk = catThinkingOnOk;
                  return [
                    { value: 'default', label: '默认（跟模型走）' },
                    { value: 'off', label: '关闭（强制不思考）' },
                    {
                      value: 'on',
                      label: onOk ? '开启（强制深度思考）' : '开启（该模型开思考需流式，暂不可用）',
                      disabled: !onOk,
                    },
                  ];
                })()}
              />
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title={promptRole ? `Prompt：${roleDisplayName(promptRole)}` : ''}
        open={!!promptRole}
        onCancel={() => setPromptRole(null)}
        footer={<Button onClick={() => setPromptRole(null)}>关闭</Button>}
        width={760}
      >
        {promptLoading ? (
          <Skeleton active />
        ) : promptView ? (
          <div>
            {(() => {
              const persona = promptPersonaSourceSummary(promptView, accountLabel);
              return (
                <Alert
                  type={persona.alertType}
                  showIcon
                  style={{ marginBottom: 'var(--aidcp-space-3)' }}
                  message={
                    <span>
                      预览人设：<Tag color={persona.alertType === 'warning' ? 'orange' : 'blue'}>{persona.label}</Tag>
                    </span>
                  }
                  description={
                    <span>
                      {persona.description}
                      {promptView.accountId && (
                        <>
                          {' '}
                          账号：
                          <ProfileLink userId={promptView.accountId}>{accountLabel(promptView.accountId)}</ProfileLink>
                        </>
                      )}
                    </span>
                  }
                />
              );
            })()}
            <Alert
              type={promptView.available ? 'info' : 'warning'}
              showIcon
              style={{ marginBottom: 'var(--aidcp-space-3)' }}
              message={promptView.note}
            />
            {promptView.segments && promptView.segments.length > 0 ? (
              <>
                {/* 图例：文字 + 色块（不只靠颜色），说明灰底=真实账号人设。 */}
                <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--aidcp-text-secondary, #888)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ display: 'inline-block', width: 12, height: 12, background: '#d9d9d9', border: '1px solid #bbb', borderRadius: 2 }} />
                  灰底 = 来自当前账号的真实人设；其余为该角色独有指令
                </div>
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    maxHeight: 440,
                    overflow: 'auto',
                    background: '#fafafa',
                    padding: 12,
                    borderRadius: 6,
                    fontSize: 12,
                    lineHeight: 1.7,
                    margin: 0,
                  }}
                >
                  {promptView.segments.map((seg, i) =>
                    seg.source === 'persona' ? (
                      <span
                        key={i}
                        style={{ background: '#d9d9d9', borderRadius: 3, padding: '1px 3px', boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }}
                      >
                        {seg.text}
                      </span>
                    ) : (
                      <span key={i}>{seg.text}</span>
                    ),
                  )}
                </pre>
              </>
            ) : (
              promptView.prompt != null && (
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    maxHeight: 440,
                    overflow: 'auto',
                    background: '#f6f6f6',
                    padding: 12,
                    borderRadius: 6,
                    fontSize: 12,
                    lineHeight: 1.6,
                    margin: 0,
                  }}
                >
                  {promptView.prompt}
                </pre>
              )
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
