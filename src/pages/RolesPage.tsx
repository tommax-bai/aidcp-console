import { useMemo, useState } from 'react';
import { App, Button, Card, Form, Input, InputNumber, Modal, Select, Skeleton, Table, Tag, Typography, Alert } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '../api/client';
import { useRoleConfig, useCategoryConfig, useModelConfig } from '../api/queries';
import type {
  RoleConfigRow,
  RoleConfigCatalog,
  CategoryConfigRow,
  CategoryConfigCatalog,
  ModelEffectiveSource,
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
const categoryOrder = (key: string) => CATEGORY_META[key]?.order ?? 99;
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
  const { message } = App.useApp();
  const qc = useQueryClient();

  // 文本厂商下拉项（取自模型配置真态；未载入时回退仅 dashscope）。
  const providerOptions = (modelCfg?.providers ?? [{ id: 'dashscope', displayName: '阿里百炼 DashScope', baseUrl: '' }]).map(
    (p) => ({ value: p.id, label: p.displayName }),
  );

  const [editing, setEditing] = useState<RoleConfigRow | null>(null);
  const [modelInput, setModelInput] = useState('');
  const [providerInput, setProviderInput] = useState('dashscope');
  const [tempInput, setTempInput] = useState<number | null>(null);

  const [editingCat, setEditingCat] = useState<CategoryConfigRow | null>(null);
  const [catModelInput, setCatModelInput] = useState('');
  const [catProviderInput, setCatProviderInput] = useState('dashscope');

  // 只读 prompt 预览（change role-prompt-visibility）：点开时按需拉取，不常驻查询。
  const [promptRole, setPromptRole] = useState<RoleConfigRow | null>(null);
  const [promptView, setPromptView] = useState<RolePromptView | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);

  const openPrompt = async (row: RoleConfigRow) => {
    setPromptRole(row);
    setPromptView(null);
    setPromptLoading(true);
    try {
      setPromptView(await apiGet<RolePromptView>(`/api/roles/${encodeURIComponent(row.roleId)}/prompt`));
    } catch (e) {
      setPromptView({ roleId: row.roleId, prompt: null, available: false, note: `加载失败：${(e as Error).message}` });
    } finally {
      setPromptLoading(false);
    }
  };

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
    mutationFn: (v: { roleId: string; model: string; provider: string; temperature?: number | null }) =>
      apiPut<RoleConfigCatalog>(`/api/roles/${encodeURIComponent(v.roleId)}/config`, {
        model: v.model,
        provider: v.provider,
        ...(v.temperature !== undefined ? { temperature: v.temperature } : {}),
      }),
    onSuccess: () => {
      message.success('已保存，按角色即时生效');
      setEditing(null);
      invalidate();
    },
    onError: saveErr,
  });

  const saveCat = useMutation({
    mutationFn: (v: { categoryId: string; model: string; provider: string }) =>
      apiPut<CategoryConfigCatalog>(`/api/categories/${encodeURIComponent(v.categoryId)}/config`, {
        // 留空 → null：清除分类覆盖，回落全局默认（provider 随之清空）。
        model: v.model.trim() === '' ? null : v.model.trim(),
        provider: v.provider,
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
  };
  const openCatEdit = (row: CategoryConfigRow) => {
    setEditingCat(row);
    setCatModelInput(row.modelOverridden ? row.effectiveModel : '');
    setCatProviderInput(row.effectiveProvider || 'dashscope');
  };

  // 角色按分类排序（同类相邻，达到「按分类分组查看」）。
  const sortedRoles = useMemo(
    () =>
      (data?.roles ?? [])
        .slice()
        .sort((a, b) => categoryOrder(a.category) - categoryOrder(b.category) || a.roleId.localeCompare(b.roleId)),
    [data],
  );

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

      <Card size="small" title="角色模型配置">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="模型按四层回落生效：按角色覆盖 → 分类默认 → 默认模型 → 代码默认。模型名留空=取消该角色覆盖；温度仅生成/改写类可调；图像角色用全局图片模型，请到「设置」页改。"
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
          saveCat.mutate({ categoryId: editingCat.categoryId, model: catModelInput, provider: catProviderInput })
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
