import { useEffect, useState } from 'react';
import { App, Button, Card, Form, Input, InputNumber, Modal, Select, Skeleton, Table, Tag, Typography, Alert } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '../api/client';
import { useRoleConfig, useCategoryConfig, useModelConfig, useAccounts } from '../api/queries';
import { ProfileLink } from '../components';
import { makeAccountNamer, accountName } from '../types/accountDisplay';
import type {
  RoleConfigRow,
  RoleConfigCatalog,
  CategoryConfigRow,
  CategoryConfigCatalog,
  ModelEffectiveSource,
  ThinkingModeApi,
  RolePromptView,
} from '../types/api';

const GROUP_LABEL: Record<RoleConfigRow['group'], string> = { browse: '浏览', publish: '发布' };
const KIND_LABEL: Record<RoleConfigRow['llmKind'], { text: string; color: string }> = {
  text: { text: '文本模型', color: 'blue' },
  image: { text: '图像模型', color: 'purple' },
  none: { text: '不调模型', color: 'default' },
};
// 分类 key → 展示名/排序（UI 标签，与 cloud role-catalog CATEGORY_CATALOG 一致；可编辑分类默认仍以 API 为准）。
const CATEGORY_META: Record<string, { label: string; order: number }> = {
  browse_judge: { label: '浏览 · 判定类', order: 1 },
  browse_compose: { label: '浏览 · 撰写改写类', order: 2 },
  publish_create: { label: '发布 · 创作类', order: 3 },
  publish_gate: { label: '发布 · 裁决类', order: 4 },
  image: { label: '图像类', order: 5 },
};
const categoryLabel = (key: string) => CATEGORY_META[key]?.label ?? key;
// 生效来源标注（覆盖 / 继承分类 / 继承默认 / 图像全局）。
const SOURCE_TAG: Record<ModelEffectiveSource, { text: string; color: string }> = {
  override: { text: '已覆盖', color: 'green' },
  category: { text: '继承分类', color: 'cyan' },
  default: { text: '继承默认', color: 'default' },
  image: { text: '图像全局', color: 'purple' },
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
  const { data, isLoading } = useRoleConfig();
  const { data: catData, isLoading: catLoading } = useCategoryConfig();
  const { data: modelCfg } = useModelConfig();
  const { data: accountsData } = useAccounts();
  const { message } = App.useApp();
  const qc = useQueryClient();

  // 预览人设选择（change prompt-preview-persona-selector）：选一个账号，按其人设带入查看角色 prompt；
  // 空=系统默认人设。未配人设的账号灰标，预览时由服务端诚实回落默认并标 personaFallback。
  const accounts = accountsData?.accounts ?? [];
  const [previewAccountId, setPreviewAccountId] = useState<string | undefined>(undefined);
  const accountOptions = accounts.map((a) => {
    const noPersona = !a.personaBound && a.accountId !== 'default';
    const name = accountName(a);
    return { value: a.accountId, label: noPersona ? `${name}（未配人设）` : name };
  });
  // 统一走诚实回落（真名→运营名→ID），不再内联手写（防漂移）。
  const accountLabel = makeAccountNamer(accounts);

  // 文本厂商下拉项（取自模型配置真态；未载入时回退仅 dashscope）。
  const providerOptions = (modelCfg?.providers ?? [{ id: 'dashscope', displayName: '阿里百炼 DashScope', baseUrl: '' }]).map(
    (p) => ({ value: p.id, label: p.displayName }),
  );

  const [editing, setEditing] = useState<RoleConfigRow | null>(null);
  const [modelInput, setModelInput] = useState('');
  const [providerInput, setProviderInput] = useState('dashscope');
  const [tempInput, setTempInput] = useState<number | null>(null);
  const [thinkingInput, setThinkingInput] = useState<ThinkingModeApi>('default');

  const [editingCat, setEditingCat] = useState<CategoryConfigRow | null>(null);
  const [catModelInput, setCatModelInput] = useState('');
  const [catProviderInput, setCatProviderInput] = useState('dashscope');
  const [catThinkingInput, setCatThinkingInput] = useState<ThinkingModeApi>('default');

  // 只读 prompt 预览（change role-prompt-visibility）：点开时按需拉取，不常驻查询。
  const [promptRole, setPromptRole] = useState<RoleConfigRow | null>(null);
  const [promptView, setPromptView] = useState<RolePromptView | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);

  // 按选定账号人设拉取预览（change prompt-preview-persona-selector）：accountId 空=系统默认人设。
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
    setModelInput(row.modelOverridden ? row.effectiveModel : '');
    setProviderInput(row.effectiveProvider || 'dashscope');
    setTempInput(row.temperatureOverride);
    // 思考模式：有覆盖用覆盖、否则 'default'（不覆盖、继承分类/default）。
    setThinkingInput(row.thinkingModeOverride ?? 'default');
  };
  const openCatEdit = (row: CategoryConfigRow) => {
    setEditingCat(row);
    setCatModelInput(row.modelOverridden ? row.effectiveModel : '');
    setCatProviderInput(row.effectiveProvider || 'dashscope');
    setCatThinkingInput(row.thinkingModeOverridden ? row.effectiveThinkingMode : 'default');
  };

  // 角色按「用户访问小红书的顺序」展示：顺序源头是云端 role-catalog 的 ROLE_CATALOG 数组
  // （浏览闭环=访问先后、发布=管线依赖链），API 原样透出；此处直接沿用后端顺序、不再按分类/字母重排。
  // 分类改为行内标签（上方「分类默认模型」表仍按分类）。
  const sortedRoles = data?.roles ?? [];

  const catColumns: ColumnsType<CategoryConfigRow> = [
    { title: '分类', dataIndex: 'displayName', render: (n: string) => <strong>{n}</strong> },
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
      render: (m: ThinkingModeApi) => <Tag color={THINKING_TAG[m].color}>{THINKING_TAG[m].text}</Tag>,
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
      title: '分类',
      dataIndex: 'category',
      width: 150,
      render: (cat: string) => <Tag>{categoryLabel(cat)}</Tag>,
    },
    {
      title: '角色',
      dataIndex: 'displayName',
      render: (name: string, row) => (
        <span>
          {name} <Tag>{GROUP_LABEL[row.group]}</Tag>
        </span>
      ),
    },
    {
      title: '类型',
      dataIndex: 'llmKind',
      width: 110,
      render: (kind: RoleConfigRow['llmKind']) => <Tag color={KIND_LABEL[kind].color}>{KIND_LABEL[kind].text}</Tag>,
    },
    {
      title: '当前生效模型',
      dataIndex: 'effectiveModel',
      render: (model: string, row) => (
        <span className="tabular-nums">
          <Tag color={providerTag(row.effectiveProvider).color}>{providerTag(row.effectiveProvider).text}</Tag>
          {model} <Tag color={SOURCE_TAG[row.effectiveSource].color}>{SOURCE_TAG[row.effectiveSource].text}</Tag>
        </span>
      ),
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
      render: (m: ThinkingModeApi, row) =>
        row.llmKind === 'text' ? (
          <Tag color={THINKING_TAG[m].color}>
            {THINKING_TAG[m].text}
            {row.thinkingModeSource === 'category' ? '·类' : ''}
          </Tag>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
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

      <Card
        size="small"
        title="角色模型配置"
        extra={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--aidcp-text-secondary, #888)' }}>预览人设</span>
            <Select
              size="small"
              allowClear
              placeholder="系统默认人设"
              style={{ width: 220 }}
              value={previewAccountId}
              onChange={(v) => setPreviewAccountId(v ?? undefined)}
              options={accountOptions}
            />
          </span>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="模型按四层回落生效：按角色覆盖 → 分类默认 → 默认模型 → 代码默认。模型名留空=取消该角色覆盖；温度仅生成/改写类可调；图像角色用全局图片模型，请到「设置」页改。「预览人设」选一个账号，可按其人设带入查看 Prompt（空=系统默认人设；未配人设账号回落默认并标注）。"
        />
        <Table<RoleConfigRow>
          size="small"
          rowKey="roleId"
          columns={columns}
          dataSource={sortedRoles}
          pagination={false}
        />
      </Card>

      <Modal
        title={editing ? `编辑：${editing.displayName}` : ''}
        open={!!editing}
        onCancel={() => setEditing(null)}
        confirmLoading={save.isPending}
        onOk={() =>
          editing &&
          save.mutate({
            roleId: editing.roleId,
            model: modelInput.trim(),
            provider: providerInput,
            ...(editing.tunableTemperature ? { temperature: tempInput } : {}),
            thinkingMode: thinkingInput,
          })
        }
        okText="保存"
        cancelText="取消"
      >
        {editing && (
          <Form layout="vertical" requiredMark={false}>
            <Form.Item label="厂商" extra="火山方舟需先在「设置」页配置其 API 密钥；改厂商需同时填该厂商的模型名。">
              <Select
                value={providerInput}
                onChange={setProviderInput}
                options={providerOptions}
                style={{ maxWidth: 280 }}
              />
            </Form.Item>
            <Form.Item label="文本模型名" extra="自由输入；留空=取消该角色覆盖（回落分类默认/默认模型）。保存前服务端按所选厂商探活。">
              <Input
                value={modelInput}
                onChange={(e) => setModelInput(e.target.value)}
                placeholder="如 qwen-turbo / 火山 doubao-… / ep-…（留空=回落）"
              />
            </Form.Item>
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
                  const onOk = modelInput.trim()
                    ? thinkingOnSupported(providerInput, modelInput)
                    : editing.thinkingOnAvailable;
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
        title={editingCat ? `分类默认：${editingCat.displayName}` : ''}
        open={!!editingCat}
        onCancel={() => setEditingCat(null)}
        confirmLoading={saveCat.isPending}
        onOk={() =>
          editingCat &&
          saveCat.mutate({
            categoryId: editingCat.categoryId,
            model: catModelInput,
            provider: catProviderInput,
            thinkingMode: catThinkingInput,
          })
        }
        okText="保存"
        cancelText="取消"
      >
        {editingCat && (
          <Form layout="vertical" requiredMark={false}>
            <Form.Item label="厂商" extra="火山方舟需先在「设置」页配置其 API 密钥；改厂商需同时填该厂商的模型名。">
              <Select
                value={catProviderInput}
                onChange={setCatProviderInput}
                options={providerOptions}
                style={{ maxWidth: 280 }}
              />
            </Form.Item>
            <Form.Item
              label="分类默认模型名"
              extra="该分类下未单独覆盖的角色都用它；留空=回落到「默认模型」。保存前服务端按所选厂商探活。"
            >
              <Input
                value={catModelInput}
                onChange={(e) => setCatModelInput(e.target.value)}
                placeholder="如 qwen-turbo / 火山 doubao-… / ep-…（留空=回落默认模型）"
              />
            </Form.Item>
            <Form.Item
              label="分类默认思考模式"
              extra="该分类下未单独覆盖的角色都用它；默认=跟模型走。开启需该分类默认模型支持（非流式可思考）。"
            >
              <Select
                value={catThinkingInput}
                onChange={(v) => setCatThinkingInput(v)}
                style={{ maxWidth: 320 }}
                options={(() => {
                  const onOk = catModelInput.trim()
                    ? thinkingOnSupported(catProviderInput, catModelInput)
                    : editingCat.thinkingOnAvailable;
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
        title={promptRole ? `Prompt：${promptRole.displayName}` : ''}
        open={!!promptRole}
        onCancel={() => setPromptRole(null)}
        footer={<Button onClick={() => setPromptRole(null)}>关闭</Button>}
        width={760}
      >
        {promptLoading ? (
          <Skeleton active />
        ) : promptView ? (
          <div>
            {promptView.accountId && (
              <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--aidcp-text-secondary, #888)' }}>
                {/* 账号名可点：跳转其小红书主页（accountId = xhs userid）。非真实 id 回落纯文本。 */}
                预览人设来自账号：
                <strong>
                  <ProfileLink userId={promptView.accountId}>{accountLabel(promptView.accountId)}</ProfileLink>
                </strong>
              </div>
            )}
            {promptView.personaFallback && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 'var(--aidcp-space-3)' }}
                message="该账号未配置人设，下面展示的是系统默认人设（非该账号人设）。"
              />
            )}
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
