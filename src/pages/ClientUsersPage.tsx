import { useEffect, useMemo, useState } from 'react';
import {
  App,
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KeyOutlined } from '@ant-design/icons';
import {
  useClientUsers,
  useClientUserScope,
  useCreateClientUser,
  useUpdateClientUser,
  useRotateClientUserKey,
  useSetClientUserScope,
} from '../api/queries';
import { errorText } from '../api/errorText';
import { QueryError } from '../components/QueryGate';
import type { ClientEnvScopeRow, ClientUserView } from '../types/api';

/**
 * 客户端用户管理页（change edge-client-customer-auth）。
 *
 * 内部运营管理「对外客户」：客户用 name+key 登录 edge 客户端、只看归属自己的那批环境。本页对接 cloud
 * 内部面板端点（受内部 JWT 保护）做 CRUD + 生成/轮换 key + 维护「客户 ↔ 环境」归属。
 *
 * 安全不变量：
 * - **明文 key 只此一次**——创建 / 轮换的响应带明文 key，仅捧在一次性展示 Modal 的组件 state 里，
 *   关闭即丢并 reset 掉 mutation 状态；绝不写 localStorage / query 缓存 / 任何持久处。
 * - **枚举兜底防白屏**——status / source / platform 均按已知联合穷举映射、未知值回落灰底裸值，绝不 crash 整页。
 */

// ── 显示元数据：已知联合穷举 + 未知值灰底兜底（防 cloud 侧枚举漂移把整页 crash 成白屏）──────────

const STATUS_META: Record<string, { text: string; color: string }> = {
  enabled: { text: '启用', color: 'green' },
  disabled: { text: '停用', color: 'default' },
};
/** 客户启停态标签（未知值灰底裸值）。 */
export function statusTag(status: string) {
  const m = STATUS_META[status];
  return <Tag color={m?.color ?? 'default'}>{m?.text ?? status}</Tag>;
}

const SOURCE_META: Record<string, { text: string; color: string }> = {
  admin: { text: '后台分配', color: 'blue' },
  client: { text: '客户端自建', color: 'geekblue' },
};
/** 环境归属来源标签（未知值灰底裸值）。 */
export function sourceTag(source: string) {
  const m = SOURCE_META[source];
  return <Tag color={m?.color ?? 'default'}>{m?.text ?? source}</Tag>;
}

const PLATFORM_META: Record<string, { text: string; color: string }> = {
  xiaohongshu: { text: '小红书', color: 'magenta' },
  facebook: { text: 'Facebook', color: 'blue' },
};
/** 平台标签（未知值灰底裸值；platform 可为 null → 不显示）。 */
export function platformTag(platform: string | null) {
  if (!platform) return <Typography.Text type="secondary">—</Typography.Text>;
  const m = PLATFORM_META[platform];
  return <Tag color={m?.color ?? 'default'}>{m?.text ?? platform}</Tag>;
}

/** 平台下拉候选（与 cloud 支持平台对齐；仅作录入辅助，未知历史值仍能透传/展示）。 */
const PLATFORM_OPTIONS = [
  { label: '小红书', value: 'xiaohongshu' },
  { label: 'Facebook', value: 'facebook' },
];

function fmtTime(ms: number | null): string {
  if (!ms) return '从未';
  return new Date(ms).toLocaleString('zh-CN');
}

/**
 * 复制文本到剪贴板，带非安全上下文兜底。
 *
 * `navigator.clipboard` 只在安全上下文（HTTPS 或 localhost）存在。dev/内网 console 常经明文 HTTP
 * 访问（如 http://<ip>:8088），此时 `navigator.clipboard` 为 undefined，异步 API 直接失败——这正是
 * 一次性密钥「复制失败，请手动选中复制」的根因。故先试异步 API，不可用 / 失败再退回传统 execCommand
 * 选区复制（同步、http 下可用）。两条都不成才算真失败。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到 execCommand 兜底
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    // 移出视口但保留可选中，避免触发页面滚动 / 布局跳动
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** 一次性密钥展示态：key 明文只活在这里，关闭即丢。 */
interface RevealState {
  key: string;
  name: string;
  kind: 'create' | 'rotate';
}

export function ClientUsersPage() {
  const { message } = App.useApp();
  const users = useClientUsers();

  const createUser = useCreateClientUser();
  const updateUser = useUpdateClientUser();
  const rotateKey = useRotateClientUserKey();
  const setScope = useSetClientUserScope();

  // 新建客户 Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');

  // 改名 Modal
  const [renameTarget, setRenameTarget] = useState<ClientUserView | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // 一次性密钥展示 Modal（明文 key 仅在此 state，关闭即丢）
  const [reveal, setReveal] = useState<RevealState | null>(null);

  // 环境归属 Drawer
  const [scopeUserId, setScopeUserId] = useState<string | null>(null);
  const scopeUser = useMemo(
    () => (users.data?.users ?? []).find((u) => u.userId === scopeUserId) ?? null,
    [users.data, scopeUserId],
  );

  const openCreate = () => {
    setCreateName('');
    setCreateOpen(true);
  };
  const submitCreate = () => {
    const name = createName.trim();
    if (!name) {
      message.warning('请填写账户名');
      return;
    }
    createUser.mutate(
      { name },
      {
        onSuccess: (res) => {
          setCreateOpen(false);
          setReveal({ key: res.key, name: res.user.name, kind: 'create' });
        },
        onError: (e) => message.error(errorText(e, '创建失败')),
      },
    );
  };

  const openRename = (u: ClientUserView) => {
    setRenameTarget(u);
    setRenameValue(u.name);
  };
  const submitRename = () => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) {
      message.warning('请填写账户名');
      return;
    }
    if (name === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    updateUser.mutate(
      { userId: renameTarget.userId, name },
      {
        onSuccess: () => {
          message.success('已改名');
          setRenameTarget(null);
        },
        onError: (e) => message.error(errorText(e, '改名失败')),
      },
    );
  };

  const toggleStatus = (u: ClientUserView) => {
    const next = u.status === 'enabled' ? 'disabled' : 'enabled';
    updateUser.mutate(
      { userId: u.userId, status: next },
      {
        onSuccess: () => message.success(next === 'disabled' ? '已停用' : '已启用'),
        onError: (e) => message.error(errorText(e, '操作失败')),
      },
    );
  };

  const doRotate = (u: ClientUserView) => {
    rotateKey.mutate(
      { userId: u.userId },
      {
        onSuccess: (res) => setReveal({ key: res.key, name: u.name, kind: 'rotate' }),
        onError: (e) => message.error(errorText(e, '轮换失败')),
      },
    );
  };

  // 关闭一次性密钥 Modal：丢明文 + reset 掉 mutation 状态（避免明文残留在 mutation 结果里）。
  const closeReveal = () => {
    setReveal(null);
    createUser.reset();
    rotateKey.reset();
  };

  const copyKey = async (key: string) => {
    if (await copyToClipboard(key)) {
      message.success('已复制到剪贴板');
    } else {
      message.warning('复制失败，请手动选中复制');
    }
  };

  const columns: ColumnsType<ClientUserView> = [
    { title: '账户名', dataIndex: 'name', render: (n: string) => <strong>{n}</strong> },
    { title: '状态', dataIndex: 'status', width: 100, render: (s: string) => statusTag(s) },
    {
      title: '环境数',
      dataIndex: 'envCount',
      width: 90,
      render: (n: number, row) => (
        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setScopeUserId(row.userId)}>
          <span className="tabular-nums">{n}</span>
        </Button>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (t: number) => (
        <Typography.Text type="secondary" className="tabular-nums">
          {fmtTime(t)}
        </Typography.Text>
      ),
    },
    {
      title: '上次轮换',
      dataIndex: 'rotatedAt',
      width: 180,
      render: (t: number | null) => (
        <Typography.Text type="secondary" className="tabular-nums">
          {fmtTime(t)}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 320,
      render: (_: unknown, u) => (
        <Space size={4} wrap>
          {u.status === 'enabled' ? (
            <Popconfirm
              title="停用该客户？"
              description="停用后该客户将无法登录，且其在途会话立即失效。"
              okText="停用"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => toggleStatus(u)}
            >
              <Button size="small" danger loading={updateUser.isPending}>
                停用
              </Button>
            </Popconfirm>
          ) : (
            <Popconfirm title="启用该客户？" okText="启用" cancelText="取消" onConfirm={() => toggleStatus(u)}>
              <Button size="small" loading={updateUser.isPending}>
                启用
              </Button>
            </Popconfirm>
          )}
          <Button size="small" onClick={() => openRename(u)}>
            改名
          </Button>
          <Popconfirm
            title="轮换密钥？"
            description="旧密钥将立即失效；新密钥只显示一次，请立即复制交给客户。"
            okText="轮换"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => doRotate(u)}
          >
            <Button size="small" loading={rotateKey.isPending}>
              轮换密钥
            </Button>
          </Popconfirm>
          <Button size="small" onClick={() => setScopeUserId(u.userId)}>
            环境归属
          </Button>
        </Space>
      ),
    },
  ];

  if (users.isError) return <QueryError title="加载客户端用户失败" onRetry={() => users.refetch()} />;

  return (
    <div className="page-stack">
      <Card
        size="small"
        title="客户端用户"
        extra={
          <Button type="primary" size="small" icon={<KeyOutlined />} onClick={openCreate}>
            新建客户
          </Button>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="这里管理「对外客户」：客户用账户名 + 密钥登录桌面客户端，只能看到归属自己的环境。密钥由后台生成，明文只在创建 / 轮换时显示一次。"
          description="停用后该客户立即无法登录、在途会话失效。「环境归属」维护每个客户可见的环境范围（envKey = AdsPower 环境 ID）。"
        />
        <Table<ClientUserView>
          size="small"
          rowKey="userId"
          columns={columns}
          dataSource={users.data?.users ?? []}
          loading={users.isLoading}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          locale={{ emptyText: <Empty description="暂无客户端用户，点击右上「新建客户」创建" /> }}
        />
      </Card>

      {/* 新建客户 Modal */}
      <Modal
        open={createOpen}
        title="新建客户"
        okText="创建"
        cancelText="取消"
        confirmLoading={createUser.isPending}
        onOk={submitCreate}
        onCancel={() => setCreateOpen(false)}
        destroyOnClose
      >
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text type="secondary">账户名用于客户登录（唯一，不可与已有客户重名）。</Typography.Text>
          <Input
            autoFocus
            placeholder="客户账户名"
            value={createName}
            maxLength={64}
            onChange={(e) => setCreateName(e.target.value)}
            onPressEnter={submitCreate}
          />
        </Space>
      </Modal>

      {/* 改名 Modal */}
      <Modal
        open={!!renameTarget}
        title="修改账户名"
        okText="保存"
        cancelText="取消"
        confirmLoading={updateUser.isPending}
        onOk={submitRename}
        onCancel={() => setRenameTarget(null)}
        destroyOnClose
      >
        <Input
          autoFocus
          placeholder="新账户名"
          value={renameValue}
          maxLength={64}
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={submitRename}
        />
      </Modal>

      {/* 一次性密钥展示 Modal（明文 key 仅在组件 state，关闭即丢） */}
      <Modal
        open={!!reveal}
        title={reveal?.kind === 'rotate' ? '新密钥已生成' : '客户创建成功'}
        footer={
          <Button type="primary" onClick={closeReveal}>
            我已复制，关闭
          </Button>
        }
        closable={false}
        maskClosable={false}
        onCancel={closeReveal}
        width={520}
      >
        {reveal && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Typography.Text>
              客户「<strong>{reveal.name}</strong>」的登录密钥：
            </Typography.Text>
            <div
              style={{
                fontFamily: 'var(--aidcp-font-mono, monospace)',
                fontSize: 18,
                fontWeight: 600,
                wordBreak: 'break-all',
                padding: '12px 14px',
                borderRadius: 8,
                background: 'var(--aidcp-fill-2, rgba(0,0,0,0.04))',
                border: '1px solid var(--aidcp-border, rgba(0,0,0,0.1))',
              }}
            >
              {reveal.key}
            </div>
            <Button block onClick={() => copyKey(reveal.key)}>
              复制密钥
            </Button>
            <Alert
              type="warning"
              showIcon
              message="此密钥只显示一次，请立即复制交给客户；关闭后无法再查看。"
              description="如遗失只能轮换重发（轮换会使旧密钥立即失效）。"
            />
          </Space>
        )}
      </Modal>

      {/* 环境归属 Drawer */}
      <ScopeDrawer
        user={scopeUser}
        open={!!scopeUserId}
        onClose={() => setScopeUserId(null)}
        onSave={(environments) => {
          if (!scopeUserId) return;
          setScope.mutate(
            { userId: scopeUserId, environments },
            {
              onSuccess: () => {
                message.success('已保存环境归属');
                setScopeUserId(null);
              },
              onError: (e) => message.error(errorText(e, '保存失败')),
            },
          );
        }}
        saving={setScope.isPending}
      />
    </div>
  );
}

/** 环境归属编辑草稿行（source 仅供显示；保存时不回传，服务端派生）。 */
type DraftRow = ClientEnvScopeRow;

interface ScopeDrawerProps {
  user: ClientUserView | null;
  open: boolean;
  onClose: () => void;
  onSave: (environments: { envKey: string; label: string | null; platform: string | null }[]) => void;
  saving: boolean;
}

function ScopeDrawer({ user, open, onClose, onSave, saving }: ScopeDrawerProps) {
  const { message } = App.useApp();
  const scope = useClientUserScope(open ? (user?.userId ?? null) : null);

  const [rows, setRows] = useState<DraftRow[]>([]);
  // 添加环境表单
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newPlatform, setNewPlatform] = useState<string | undefined>(undefined);

  // 服务端 scope 到达即以其为准 seed 草稿（server 是权威；保存后 invalidate 回读也走这里对账）。
  useEffect(() => {
    if (scope.data) setRows(scope.data.scope.map((r) => ({ ...r })));
  }, [scope.data]);

  // 打开 / 切换客户时先清空草稿与表单，避免上一个客户的行闪现。
  useEffect(() => {
    setRows([]);
    setNewEnvKey('');
    setNewLabel('');
    setNewPlatform(undefined);
  }, [user?.userId]);

  const addRow = () => {
    const envKey = newEnvKey.trim();
    if (!envKey) {
      message.warning('请填写环境 ID（envKey）');
      return;
    }
    if (rows.some((r) => r.envKey === envKey)) {
      message.warning('该环境已在列表中');
      return;
    }
    setRows((prev) => [
      ...prev,
      {
        envKey,
        label: newLabel.trim() || null,
        platform: newPlatform ?? null,
        source: 'admin',
        assignedAt: Date.now(),
      },
    ]);
    setNewEnvKey('');
    setNewLabel('');
    setNewPlatform(undefined);
  };

  const removeRow = (envKey: string) => setRows((prev) => prev.filter((r) => r.envKey !== envKey));

  const columns: ColumnsType<DraftRow> = [
    {
      title: '环境 ID（envKey）',
      dataIndex: 'envKey',
      render: (k: string) => (
        <Typography.Text className="tabular-nums" copyable={{ text: k }}>
          {k}
        </Typography.Text>
      ),
    },
    {
      title: '备注名',
      dataIndex: 'label',
      width: 140,
      render: (l: string | null) => (l ? l : <Typography.Text type="secondary">—</Typography.Text>),
    },
    { title: '平台', dataIndex: 'platform', width: 100, render: (p: string | null) => platformTag(p) },
    { title: '来源', dataIndex: 'source', width: 110, render: (s: string) => sourceTag(s) },
    {
      title: '操作',
      key: 'op',
      width: 72,
      render: (_: unknown, row) => (
        <Button size="small" danger type="link" onClick={() => removeRow(row.envKey)}>
          移除
        </Button>
      ),
    },
  ];

  return (
    <Drawer
      title={user ? `环境归属 · ${user.name}` : '环境归属'}
      open={open}
      onClose={onClose}
      width={640}
      destroyOnClose
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose}>取消</Button>
          <Popconfirm
            title="整批替换该客户的可见环境？"
            description="保存将用当前列表整批替换该客户当前的可见环境（新增 / 移除均以此列表为准）。"
            okText="保存"
            cancelText="再看看"
            onConfirm={() =>
              onSave(rows.map((r) => ({ envKey: r.envKey, label: r.label, platform: r.platform })))
            }
          >
            <Button type="primary" loading={saving}>
              保存
            </Button>
          </Popconfirm>
        </div>
      }
    >
      {scope.isError ? (
        <QueryError title="加载环境归属失败" onRetry={() => scope.refetch()} />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="维护该客户可见的环境范围。保存时整批替换——列表里的即可见、移除的即不可见。"
            description="envKey = 环境的 AdsPower profileId（从 AdsPower 后台可查）。来源为「客户端自建」的行也可在此调整或移除。"
          />
          <Card size="small" title="添加环境">
            <Space wrap align="start">
              <Input
                placeholder="环境 ID（envKey / profileId）"
                value={newEnvKey}
                style={{ width: 240 }}
                onChange={(e) => setNewEnvKey(e.target.value)}
                onPressEnter={addRow}
              />
              <Input
                placeholder="备注名（可选）"
                value={newLabel}
                style={{ width: 160 }}
                onChange={(e) => setNewLabel(e.target.value)}
                onPressEnter={addRow}
              />
              <Select
                placeholder="平台（可选）"
                allowClear
                style={{ width: 140 }}
                value={newPlatform}
                onChange={(v) => setNewPlatform(v)}
                options={PLATFORM_OPTIONS}
              />
              <Button onClick={addRow}>添加</Button>
            </Space>
          </Card>
          <Table<DraftRow>
            size="small"
            rowKey="envKey"
            columns={columns}
            dataSource={rows}
            loading={scope.isLoading}
            pagination={false}
            locale={{ emptyText: <Empty description="尚未归属任何环境" /> }}
          />
        </Space>
      )}
    </Drawer>
  );
}
