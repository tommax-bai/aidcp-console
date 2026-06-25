import { useState } from 'react';
import { App, Button, Card, Form, Input, Modal, Skeleton, Table, Tag, Typography, Alert } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '../api/client';
import { usePersonaConfig } from '../api/queries';
import type { PersonaConfigRow, PersonaConfigCatalog, PersonaDetailView, PersonaSource } from '../types/api';

// 人设来源标注（自定义 / 系统默认回落）。
const SOURCE_TAG: Record<PersonaSource, { text: string; color: string }> = {
  override: { text: '自定义', color: 'green' },
  fallback: { text: '系统默认', color: 'default' },
};

/**
 * 账号人设配置页（change account-persona-config，stream F）。
 * - 按账号配置「人设」（identity / interests / behavior_guidelines 等，YAML 文本）。
 *   注：单场会话上限（时长 + 互动预算）已从人设迁出到「安全限额 · 单场会话上限」页（change session-limits-to-quota-layer）。
 * - 缺自定义人设的账号回落系统默认人设（打包 soul.yaml），列表如实标注来源。
 * - 写非乐观——round-trip 后 invalidate 重取真态；非法人设由服务端 soul 校验拦截，诚实拒绝绝不落库。
 * - 留空保存=清除该账号覆盖，回落系统默认。
 */
export function PersonaPage() {
  const { data, isLoading } = usePersonaConfig();
  const { message } = App.useApp();
  const qc = useQueryClient();

  // 编辑态：点开时按需拉取该账号人设详情（列表只带身份摘要，不带全文）。
  const [editing, setEditing] = useState<PersonaConfigRow | null>(null);
  const [personaText, setPersonaText] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);

  const openEdit = async (row: PersonaConfigRow) => {
    setEditing(row);
    setPersonaText('');
    setDetailLoading(true);
    try {
      const detail = await apiGet<PersonaDetailView>(`/api/persona/${encodeURIComponent(row.accountId)}`);
      setPersonaText(detail.persona);
    } catch (e) {
      const msg = (e as Error).message;
      message.error(
        msg === 'unknown_account'
          ? '账号不存在'
          : msg === 'persona_unavailable'
            ? '人设服务暂不可用'
            : '加载人设失败',
      );
      setEditing(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['config', 'personas'] });
  };

  const save = useMutation({
    mutationFn: (v: { accountId: string; persona: string }) =>
      apiPut<PersonaConfigCatalog>(`/api/persona/${encodeURIComponent(v.accountId)}`, { persona: v.persona }),
    onSuccess: () => {
      message.success('已保存，浏览 / 发布角色即时改用新人设');
      setEditing(null);
      invalidate();
    },
    onError: (e) => {
      const msg = (e as Error).message;
      message.error(
        msg === 'persona_invalid'
          ? '人设格式无效（YAML / 必填字段校验未通过），未保存'
          : msg === 'unknown_account'
            ? '账号不存在，未保存'
            : '保存失败',
      );
    },
  });

  const columns: ColumnsType<PersonaConfigRow> = [
    {
      title: '账号',
      dataIndex: 'accountId',
      render: (id: string, row) => (
        <span>
          <strong>{row.label || id}</strong>
          {row.label && row.label !== id ? <Typography.Text type="secondary"> （{id}）</Typography.Text> : null}
        </span>
      ),
    },
    {
      title: '当前人设',
      dataIndex: 'identityName',
      render: (name: string, row) =>
        name ? (
          <span>
            {name}
            {row.identityRole ? <Typography.Text type="secondary"> · {row.identityRole}</Typography.Text> : null}
          </span>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 120,
      render: (s: PersonaSource) => <Tag color={SOURCE_TAG[s].color}>{SOURCE_TAG[s].text}</Tag>,
    },
    {
      title: '最近修改',
      dataIndex: 'updatedAt',
      width: 200,
      render: (at: string | null, row) =>
        at ? (
          <Typography.Text type="secondary" className="tabular-nums">
            {new Date(at).toLocaleString('zh-CN')}
            {row.updatedBy ? ` · ${row.updatedBy}` : ''}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: '操作',
      width: 90,
      render: (_: unknown, row) => (
        <Button size="small" onClick={() => openEdit(row)}>
          编辑
        </Button>
      ),
    },
  ];

  if (isLoading || !data) {
    return (
      <div className="page-stack">
        <Card size="small" title="账号人设">
          <Skeleton active />
        </Card>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <Card size="small" title="账号人设">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="按账号配置人设：喂给该账号所有浏览 / 发布角色的身份、兴趣与行为偏好。保存后即时生效、无需重启。未配置的账号回落系统默认人设。"
        />
        <Table<PersonaConfigRow>
          size="small"
          rowKey="accountId"
          columns={columns}
          dataSource={data.accounts}
          pagination={false}
        />
      </Card>

      <Modal
        title={editing ? `编辑人设：${editing.label || editing.accountId}` : ''}
        open={!!editing}
        onCancel={() => setEditing(null)}
        confirmLoading={save.isPending}
        onOk={() => editing && save.mutate({ accountId: editing.accountId, persona: personaText })}
        okText="保存"
        cancelText="取消"
        width={760}
      >
        {detailLoading ? (
          <Skeleton active />
        ) : editing ? (
          <Form layout="vertical" requiredMark={false}>
            <Form.Item
              label="人设（YAML）"
              extra="包含 identity / interests 等字段；留空=清除该账号覆盖、回落系统默认人设。保存前服务端会做 soul 格式校验，无效则拒绝不落库。"
            >
              <Input.TextArea
                value={personaText}
                onChange={(e) => setPersonaText(e.target.value)}
                autoSize={{ minRows: 16, maxRows: 28 }}
                style={{ fontFamily: 'var(--aidcp-font-mono, monospace)', fontSize: 12, lineHeight: 1.6 }}
                placeholder="identity / interests 等 YAML 字段；留空=回落系统默认人设"
              />
            </Form.Item>
          </Form>
        ) : null}
      </Modal>
    </div>
  );
}
