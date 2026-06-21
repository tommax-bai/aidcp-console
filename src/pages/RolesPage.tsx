import { useState } from 'react';
import { App, Button, Card, Form, Input, InputNumber, Modal, Skeleton, Table, Tag, Typography, Alert } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPut } from '../api/client';
import { useRoleConfig } from '../api/queries';
import type { RoleConfigRow, RoleConfigCatalog } from '../types/api';

const GROUP_LABEL: Record<RoleConfigRow['group'], string> = { browse: '浏览', publish: '发布' };
const KIND_LABEL: Record<RoleConfigRow['llmKind'], { text: string; color: string }> = {
  text: { text: '文本模型', color: 'blue' },
  image: { text: '图像模型', color: 'purple' },
  none: { text: '不调模型', color: 'default' },
};

/**
 * 角色配置页（change console-role-model-config）：按角色覆盖文本模型名与温度。
 * 白名单制——只列现役且真调大模型的角色；模型名自由输入（留空=回落全局）；
 * 温度仅生成/改写类可调；图像角色用全局图片模型、不在此覆盖。
 * 写非乐观——round-trip 后 invalidate 重取真态；模型名保存前由服务端探活，无效则诚实拒绝。
 */
export function RolesPage() {
  const { data, isLoading } = useRoleConfig();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [editing, setEditing] = useState<RoleConfigRow | null>(null);
  const [modelInput, setModelInput] = useState('');
  const [tempInput, setTempInput] = useState<number | null>(null);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['config', 'roles'] });

  const save = useMutation({
    mutationFn: (v: { roleId: string; model: string; temperature?: number | null }) =>
      apiPut<RoleConfigCatalog>(`/api/roles/${encodeURIComponent(v.roleId)}/config`, {
        model: v.model,
        ...(v.temperature !== undefined ? { temperature: v.temperature } : {}),
      }),
    onSuccess: () => {
      message.success('已保存，按角色即时生效');
      setEditing(null);
      invalidate();
    },
    onError: (e) => {
      const msg = (e as Error).message;
      message.error(msg === 'model_invalid' ? '模型名无效（保存前探活未通过），未保存' : '保存失败');
    },
  });

  const openEdit = (row: RoleConfigRow) => {
    setEditing(row);
    setModelInput(row.modelOverridden ? row.effectiveModel : '');
    setTempInput(row.temperatureOverride);
  };

  const columns: ColumnsType<RoleConfigRow> = [
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
          {model} {row.modelOverridden ? <Tag color="green">已覆盖</Tag> : <Tag>全局</Tag>}
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
      width: 90,
      render: (_: unknown, row) =>
        row.llmKind === 'text' ? (
          <Button size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
        ) : (
          <Typography.Text type="secondary">全局配置</Typography.Text>
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
      <Card size="small" title="角色模型配置">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="按角色覆盖文本模型与温度，改完即时生效（无需重启）。模型名留空=回落全局模型；温度仅生成/改写类可调；图像角色用全局图片模型，请到「设置」页改。"
        />
        <Table<RoleConfigRow>
          size="small"
          rowKey="roleId"
          columns={columns}
          dataSource={data.roles}
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
            ...(editing.tunableTemperature ? { temperature: tempInput } : {}),
          })
        }
        okText="保存"
        cancelText="取消"
      >
        {editing && (
          <Form layout="vertical" requiredMark={false}>
            <Form.Item label="文本模型名" extra="自由输入；留空=回落全局模型。保存前服务端会探活校验。">
              <Input
                value={modelInput}
                onChange={(e) => setModelInput(e.target.value)}
                placeholder="如 qwen-turbo / qwen-plus / qwen-max（留空=全局）"
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
    </div>
  );
}
