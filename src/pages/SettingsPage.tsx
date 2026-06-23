import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Divider, Form, Input, Skeleton, Space, Tag, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPut } from '../api/client';
import { useModelConfig } from '../api/queries';
import type { ModelConfig } from '../types/api';

const SOURCE_LABEL: Record<ModelConfig['credential']['source'], string> = {
  db: '已加密保存于服务端',
  env: '来自环境变量',
  none: '未配置',
};

/**
 * 设置页（change console-model-provider-config）：模型配置 + 凭据。
 * 模型名改完热加载即时生效；密钥加密落库、掩码显示、永不回显、改 key 整段重输、改密钥需重启 cloud 生效。
 * 写非乐观——round-trip 后 invalidate 重取真态；文案诚实。
 */
export function SettingsPage() {
  const { data, isLoading } = useModelConfig();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [textModel, setTextModel] = useState('');
  const [imageModel, setImageModel] = useState('');
  const [apiKey, setApiKey] = useState('');

  // 数据到达时回灌模型名输入（密钥永不回灌——永不回显明文）
  useEffect(() => {
    if (data) {
      setTextModel(data.textModel);
      setImageModel(data.imageModel);
    }
  }, [data]);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['config', 'model'] });

  const saveModel = useMutation({
    mutationFn: (v: { textModel: string; imageModel: string }) => apiPut<ModelConfig>('/api/config/model', v),
    onSuccess: () => {
      message.success('模型已保存，已即时生效');
      invalidate();
    },
    onError: () => message.error('模型保存失败'),
  });

  const saveKey = useMutation({
    mutationFn: (value: string) =>
      apiPut<{ field: string; configured: boolean; maskedHint: string }>('/api/config/credential', {
        field: 'dashscope_api_key',
        value,
      }),
    onSuccess: () => {
      message.success('密钥已加密保存，重启 cloud 后生效');
      setApiKey('');
      invalidate();
    },
    onError: (e) => {
      // 主密钥缺失（503 cred_key_missing）等诚实可辨
      const msg = (e as Error).message;
      message.error(msg === 'cred_key_missing' ? '服务端未配置主加密密钥，无法保存密钥' : '密钥保存失败');
    },
  });

  if (isLoading || !data) {
    return (
      <div className="page-stack">
        <Card size="small" title="设置">
          <Skeleton active />
        </Card>
      </div>
    );
  }

  const cred = data.credential;

  return (
    <div className="page-stack">
      <Card size="small" title="模型配置">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="模型名改完即时生效；API 密钥加密落库、掩码显示、永不回显，改密钥后需重启 cloud 才生效。"
        />

        <Descriptions size="small" column={1} style={{ marginBottom: 'var(--aidcp-space-4)' }}>
          <Descriptions.Item label="厂商">
            百炼 DashScope（<span className="tabular-nums">{data.provider}</span>）
          </Descriptions.Item>
          <Descriptions.Item label="接口地址">
            <Typography.Text type="secondary" copyable>
              {data.baseUrl}
            </Typography.Text>
          </Descriptions.Item>
        </Descriptions>

        <Form layout="vertical" requiredMark={false} style={{ maxWidth: 480 }}>
          <Form.Item label="默认模型（文本，Qwen）" extra="全局默认文本模型：角色 / 分类未单独设置时一律回落到它（见「角色」页）。">
            <Input value={textModel} onChange={(e) => setTextModel(e.target.value)} placeholder="如 qwen-turbo / qwen-plus / qwen-max" />
          </Form.Item>
          <Form.Item label="图片模型（通义万相）">
            <Input value={imageModel} onChange={(e) => setImageModel(e.target.value)} placeholder="如 wan2.7-image-pro" />
          </Form.Item>
          <Button
            type="primary"
            loading={saveModel.isPending}
            disabled={!textModel.trim() || !imageModel.trim()}
            onClick={() => saveModel.mutate({ textModel: textModel.trim(), imageModel: imageModel.trim() })}
          >
            保存模型
          </Button>
        </Form>

        <Divider />

        <Typography.Title level={5} style={{ marginTop: 0 }}>
          API 密钥
        </Typography.Title>
        <Space style={{ marginBottom: 'var(--aidcp-space-3)' }}>
          <Typography.Text type="secondary">当前状态：</Typography.Text>
          {cred.configured ? (
            <Tag color="green">
              已配置 {cred.maskedHint ? `（${cred.maskedHint}）` : ''} · {SOURCE_LABEL[cred.source]}
            </Tag>
          ) : (
            <Tag>未配置</Tag>
          )}
        </Space>

        {data.canEditCredential ? (
          <Form layout="vertical" requiredMark={false} style={{ maxWidth: 480 }}>
            <Form.Item
              label="DashScope API 密钥"
              extra="加密保存于服务端，永不回显；更换请整段重新输入。保存后需重启 cloud 生效。"
            >
              <Input.Password
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={cred.configured ? '已配置 — 改 key 请整段重输' : '请输入 API 密钥'}
                autoComplete="new-password"
              />
            </Form.Item>
            <Button danger loading={saveKey.isPending} disabled={!apiKey.trim()} onClick={() => saveKey.mutate(apiKey.trim())}>
              保存密钥（重启生效）
            </Button>
          </Form>
        ) : (
          <Alert
            type="warning"
            showIcon
            message="服务端未配置主加密密钥（AIDCP_CRED_KEY），暂不能在后台修改密钥。"
            description="请在 cloud 的 .env 配置 AIDCP_CRED_KEY（32 字节随机、base64）后重启；模型名仍可在上方修改。"
          />
        )}
      </Card>
    </div>
  );
}
