import { useState } from 'react';
import { App, Button, Card, Form, Input, Modal, Skeleton, Table, Tag, Typography, Alert } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '../api/client';
import { usePersonaConfig, useAccounts } from '../api/queries';
import { QueryError } from '../components/QueryGate';
import { ProfileLink } from '../components';
import { makeAccountNamer } from '../types/accountDisplay';
import { tagOf } from '../types/aidcp-enums';
import type { PersonaConfigRow, PersonaConfigCatalog, PersonaDetailView, PersonaSource } from '../types/api';

// 人设绑定状态标注（persona-driven-content-pipeline：系统不存在默认/兜底人设）。
const SOURCE_TAG: Record<PersonaSource, { text: string; color: string }> = {
  override: { text: '已绑定', color: 'green' },
  none: { text: '未绑定', color: 'red' },
};

/**
 * 账号人设配置页（change account-persona-config，stream F）。
 * - 按账号配置「人设」（identity / interests / behavior_guidelines 等，YAML 文本）。
 *   注：单场会话上限（时长 + 行为预算）已从人设迁出到「安全限额 · 单场会话上限」页（change session-limits-to-quota-layer）。
 * - 系统不存在默认/兜底人设——未绑定人设的账号
 *   浏览/发布/评论一律被诚实拒绝运行；列表如实标注绑定状态（未绑定=红）。
 * - 清空编辑器并保存 = 显式解绑，服务端删绑定行后返回 source=none 真态。
 * - 写非乐观——round-trip 后 invalidate 重取真态；非法人设由服务端 soul 校验拦截，诚实拒绝绝不落库。
 */
export function PersonaPage() {
  const { data, isLoading, isError, refetch } = usePersonaConfig();
  const { data: accountsData } = useAccounts();
  // 账号列展示名走统一诚实回落（真名→运营名→ID）：人设目录只带 label，真名从账号列表 join 取。
  const nameOf = makeAccountNamer(accountsData?.accounts ?? []);
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
    onSuccess: (catalog, variables) => {
      const row = catalog.accounts.find((a) => a.accountId === variables.accountId);
      message.success(row?.source === 'none' ? '已解绑，该账号已调整为未绑定人设' : '已保存，浏览 / 发布角色即时改用新人设');
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
      // 账号名可点：跳转其小红书主页（id = xhs userid）。非真实 id 回落纯文本。
      // 不再在名字旁明文展示账号 ID（nameOf 已做 真名→运营名→ID 的诚实回落）。
      render: (id: string) => (
        <ProfileLink userId={id}>
          <strong>{nameOf(id)}</strong>
        </ProfileLink>
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
      render: (s: PersonaSource) => {
        const t = tagOf(SOURCE_TAG, s);
        return <Tag color={t.color}>{t.text}</Tag>;
      },
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

  if (isError) return <QueryError title="加载账号人设失败" onRetry={() => refetch()} />;

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
          message="按账号配置人设：喂给该账号所有浏览 / 发布角色的身份、兴趣与行为偏好。保存后即时生效、无需重启。系统无默认人设，清空并保存会将账号调整为未绑定；未绑定账号会被诚实拒绝运行（不浏览、不发布、不评论）。"
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
        title={editing ? `编辑人设：${nameOf(editing.accountId)}` : ''}
        open={!!editing}
        onCancel={() => setEditing(null)}
        confirmLoading={save.isPending}
        onOk={() => {
          if (!editing) return;
          save.mutate({ accountId: editing.accountId, persona: personaText });
        }}
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
              extra="包含 identity / interests 等字段；清空并保存会解绑该账号。未绑定账号编辑器预填的是起点模板，请改成该账号的真实人设后保存。保存前服务端会做 soul 格式校验，无效则拒绝不落库。"
            >
              <Input.TextArea
                value={personaText}
                onChange={(e) => setPersonaText(e.target.value)}
                autoSize={{ minRows: 16, maxRows: 28 }}
                style={{ fontFamily: 'var(--aidcp-font-mono, monospace)', fontSize: 12, lineHeight: 1.6 }}
                placeholder="identity / interests 等 YAML 字段；清空并保存会解绑"
              />
            </Form.Item>
          </Form>
        ) : null}
      </Modal>
    </div>
  );
}
