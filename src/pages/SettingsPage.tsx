import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Divider, Form, Input, Select, Skeleton, Space, Tag, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPut } from '../api/client';
import { useModelConfig } from '../api/queries';
import { useConfigMutation } from '../hooks/useConfigMutation';
import { QueryError } from '../components/QueryGate';
import type { ModelConfig } from '../types/api';

const SOURCE_LABEL: Record<ModelConfig['credentials'][number]['source'], string> = {
  db: '已加密保存于服务端',
  env: '来自环境变量',
  none: '未配置',
};

/**
 * 设置页（change platform-provider-credentials-config）：平台配置 = 模型/厂商 + 平台凭据。
 * 模型名和厂商改完热加载即时生效；平台凭据加密落库、掩码显示、永不回显、改 key 整段重输、
 * 改密钥需重启 cloud 生效。
 * 写非乐观——round-trip 后 invalidate 重取真态；文案诚实。
 */
export function SettingsPage() {
  const { data, isLoading, isError, refetch } = useModelConfig();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [textProvider, setTextProvider] = useState('');
  const [textModel, setTextModel] = useState('');
  const [imageModel, setImageModel] = useState('');
  const [imageProvider, setImageProvider] = useState('');
  // 各平台凭据输入（密钥永不回灌——永不回显明文）。
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});

  // 数据到达时回灌厂商/模型名输入（密钥不回灌）
  useEffect(() => {
    if (data) {
      setTextProvider(data.textProvider);
      setTextModel(data.textModel);
      setImageModel(data.imageModel);
      setImageProvider(data.imageProvider);
    }
  }, [data]);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['config', 'model'] });

  const saveModel = useMutation({
    mutationFn: (v: { textProvider: string; textModel: string; imageModel: string; imageProvider: string }) =>
      apiPut<ModelConfig>('/api/config/model', v),
    onSuccess: () => {
      message.success('模型已保存，已即时生效');
      invalidate();
    },
    onError: (e) => {
      const msg = (e as Error).message;
      message.error(
        msg === 'model_invalid'
          ? '模型名无效（保存前探活未通过），未保存'
          : msg === 'provider_key_missing'
            ? '所选厂商的密钥未配置，请先在下方配置密钥并重启 cloud'
            : msg === 'unknown_provider'
              ? '未知厂商'
              : '模型保存失败',
      );
    },
  });

  const credentialInputKey = (provider: string, field: string) => `${provider}/${field}`;

  // 密钥写：成功提示 + 清该凭据输入框 + invalidate 收口到 useConfigMutation（#34）。
  // 失败文案与原逐字等价——唯一特判分支 cred_key_missing 已收录于 errorText 集中映射（同文案）、
  // 其余回落 '密钥保存失败'，与原 onError 一致。
  const saveKey = useConfigMutation({
    mutationFn: (v: { provider: string; field: string; value: string }) =>
      apiPut<{ provider: string; field: string; configured: boolean; maskedHint: string }>('/api/config/credential', v),
    successMessage: '密钥已加密保存，重启 cloud 后生效',
    invalidateKeys: [['config', 'model']],
    errorFallback: '密钥保存失败',
    onSuccess: (_d, v) => setKeyInputs((s) => ({ ...s, [credentialInputKey(v.provider, v.field)]: '' })),
  });

  if (isError) return <QueryError title="加载平台配置失败" onRetry={() => refetch()} />;

  if (isLoading || !data) {
    return (
      <div className="page-stack">
        <Card size="small" title="平台配置">
          <Skeleton active />
        </Card>
      </div>
    );
  }

  const providerName = (id: string) => data.providers.find((p) => p.id === id)?.displayName ?? id;
  const selectedBaseUrl = data.providers.find((p) => p.id === textProvider)?.baseUrl ?? '';
  const credentialGroups = data.credentials.reduce<Array<{ key: string; label: string; items: typeof data.credentials }>>((groups, cred) => {
    const found = groups.find((g) => g.key === cred.group);
    if (found) found.items.push(cred);
    else groups.push({ key: cred.group, label: cred.groupLabel, items: [cred] });
    return groups;
  }, []);

  return (
    <div className="page-stack">
      <Card size="small" title="平台配置">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="模型与厂商改完即时生效；平台凭据加密落库、掩码显示、永不回显，改密钥后需重启 cloud 才生效。"
        />

        <Typography.Title level={5} style={{ marginTop: 0 }}>
          模型与厂商
        </Typography.Title>
        <Form layout="vertical" requiredMark={false} style={{ maxWidth: 480 }}>
          <Form.Item label="全局文本厂商" extra="角色 / 分类未单独设置时，文本调用走此厂商。火山方舟需先在下方配置其 API 密钥。">
            <Select
              value={textProvider}
              onChange={setTextProvider}
              options={data.providers.map((p) => ({ value: p.id, label: p.displayName }))}
              style={{ maxWidth: 320 }}
            />
          </Form.Item>
          <Descriptions size="small" column={1} style={{ marginBottom: 'var(--aidcp-space-3)' }}>
            <Descriptions.Item label="接口地址">
              <Typography.Text type="secondary" copyable>
                {selectedBaseUrl}
              </Typography.Text>
            </Descriptions.Item>
          </Descriptions>
          <Form.Item label="默认模型（文本）" extra="全局默认文本模型：角色 / 分类未单独设置时一律回落到它（见「角色」页）。保存前服务端按所选厂商探活。">
            <Input
              value={textModel}
              onChange={(e) => setTextModel(e.target.value)}
              placeholder="如 qwen-turbo / qwen-plus 或火山 doubao-… / ep-…"
            />
          </Form.Item>
          <Form.Item label="全局图片厂商" extra="图片生成走此厂商（通义万相 / 火山即梦 Seedream），独立于文本厂商。火山需先在下方配置其 API 密钥。">
            <Select
              value={imageProvider}
              onChange={setImageProvider}
              options={data.imageProviders.map((p) => ({ value: p.id, label: p.displayName }))}
              style={{ maxWidth: 320 }}
            />
          </Form.Item>
          <Form.Item label="默认模型（图片）" extra="全局图片模型名。切换厂商后按需改成该厂商的模型名。">
            <Input value={imageModel} onChange={(e) => setImageModel(e.target.value)} placeholder="如 wan2.7-image-pro / doubao-seedream-…" />
          </Form.Item>
          <Button
            type="primary"
            loading={saveModel.isPending}
            disabled={!textProvider || !imageProvider || !textModel.trim() || !imageModel.trim()}
            onClick={() =>
              saveModel.mutate({
                textProvider,
                textModel: textModel.trim(),
                imageModel: imageModel.trim(),
                imageProvider,
              })
            }
          >
            保存模型与厂商
          </Button>
        </Form>

        <Divider />

        <Typography.Title level={5} style={{ marginTop: 0 }}>
          平台凭据
        </Typography.Title>
        {!data.canEditCredential && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 'var(--aidcp-space-3)' }}
            message="服务端未配置主加密密钥（AIDCP_CRED_KEY），暂不能在后台修改密钥。"
            description="请在 cloud 的 .env 配置 AIDCP_CRED_KEY（32 字节随机、base64）后重启；模型名仍可在上方修改。"
          />
        )}
        {credentialGroups.map((group) => (
          <div key={group.key} style={{ marginBottom: 'var(--aidcp-space-4)' }}>
            <Typography.Text strong>{group.label}</Typography.Text>
            <div style={{ marginTop: 'var(--aidcp-space-2)' }}>
              {group.items.map((cred) => {
                const inputKey = credentialInputKey(cred.provider, cred.field);
                const label = cred.label || providerName(cred.provider);
                const placeholder =
                  cred.secretKind === 'access_key_id'
                    ? '请输入 AccessKey ID'
                    : cred.secretKind === 'access_key_secret'
                      ? '请输入 AccessKey Secret'
                      : '请输入 API 密钥';
                return (
                  <div key={inputKey} style={{ marginBottom: 'var(--aidcp-space-3)' }}>
                    <Space style={{ marginBottom: 'var(--aidcp-space-2)' }} wrap>
                      <Typography.Text>{label}</Typography.Text>
                      {cred.configured ? (
                        <Tag color="green">
                          已配置 {cred.maskedHint ? `（${cred.maskedHint}）` : ''} · {SOURCE_LABEL[cred.source]}
                        </Tag>
                      ) : (
                        <Tag>未配置</Tag>
                      )}
                    </Space>
                    {data.canEditCredential && (
                      <Space.Compact style={{ display: 'flex', maxWidth: 520 }}>
                        <Input.Password
                          value={keyInputs[inputKey] ?? ''}
                          onChange={(e) => setKeyInputs((s) => ({ ...s, [inputKey]: e.target.value }))}
                          placeholder={cred.configured ? '已配置 — 改 key 请整段重输' : placeholder}
                          autoComplete="new-password"
                        />
                        <Button
                          danger
                          loading={saveKey.isPending && saveKey.variables?.provider === cred.provider && saveKey.variables?.field === cred.field}
                          disabled={!(keyInputs[inputKey] ?? '').trim()}
                          onClick={() => saveKey.mutate({ provider: cred.provider, field: cred.field, value: (keyInputs[inputKey] ?? '').trim() })}
                        >
                          保存（重启生效）
                        </Button>
                      </Space.Compact>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
