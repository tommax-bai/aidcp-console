import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Form, Input, Select, Skeleton, Space, Tag, Typography } from 'antd';
import { ApiOutlined, CloudServerOutlined, KeyOutlined, SafetyCertificateOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPut } from '../api/client';
import { useModelConfig } from '../api/queries';
import { useConfigMutation } from '../hooks/useConfigMutation';
import { QueryError } from '../components/QueryGate';
import type { ModelConfig } from '../types/api';
import { labelOf } from '../types/aidcp-enums';

type Credential = ModelConfig['credentials'][number];

const SOURCE_LABEL: Record<Credential['source'], string> = {
  db: '服务端密文',
  env: '环境变量',
  none: '未配置',
};

const SOURCE_COLOR: Record<Credential['source'], string> = {
  db: 'blue',
  env: 'gold',
  none: 'default',
};

function credentialId(provider: string, field: string): string {
  return `${provider}::${field}`;
}

function credentialDomName(cred: Credential): string {
  return `aidcp-credential-${cred.provider}-${cred.field}`.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function credentialPlaceholder(cred: Credential): string {
  if (cred.configured) return `${cred.label} 已配置，修改需重新粘贴完整值`;
  if (cred.secretKind === 'access_key_id') return `输入完整 ${cred.providerLabel} AccessKey ID`;
  if (cred.secretKind === 'access_key_secret') return `输入完整 ${cred.providerLabel} AccessKey Secret`;
  return `输入完整 ${cred.providerLabel} API Key`;
}

function credentialHelp(cred: Credential): string {
  if (cred.secretKind === 'access_key_id') return '账单查询使用的 AccessKey ID，保存后只显示掩码。';
  if (cred.secretKind === 'access_key_secret') return '账单查询使用的 AccessKey Secret，不会回显明文。';
  return '模型调用使用的 API Key，不会回显明文。';
}

function maskedHint(cred: Credential): string | null {
  if (!cred.maskedHint) return null;
  if (cred.source === 'env' && cred.maskedHint.includes('环境变量')) return null;
  return cred.maskedHint;
}

export function SettingsPage() {
  const { data, isLoading, isError, refetch } = useModelConfig();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [textProvider, setTextProvider] = useState('');
  const [textModel, setTextModel] = useState('');
  const [imageModel, setImageModel] = useState('');
  const [imageProvider, setImageProvider] = useState('');
  const [credentialInputs, setCredentialInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!data) return;
    setTextProvider(data.textProvider);
    setTextModel(data.textModel);
    setImageModel(data.imageModel);
    setImageProvider(data.imageProvider);
  }, [data]);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['config', 'model'] });

  const saveModel = useMutation({
    mutationFn: (v: { textProvider: string; textModel: string; imageModel: string; imageProvider: string }) =>
      apiPut<ModelConfig>('/api/config/model', v),
    onSuccess: () => {
      message.success('模型与厂商已保存，立即生效');
      invalidate();
    },
    onError: (e) => {
      const msg = (e as Error).message;
      message.error(
        msg === 'model_invalid'
          ? '模型名无效：服务端探活未通过，未保存'
          : msg === 'provider_key_missing'
            ? '所选模型厂商的 API Key 未配置，请先保存对应凭据并重启 cloud'
            : msg === 'unknown_provider'
              ? '未知厂商，未保存'
              : '模型与厂商保存失败',
      );
    },
  });

  const saveKey = useConfigMutation({
    mutationFn: (v: { provider: string; field: string; value: string }) =>
      apiPut<{ provider: string; field: string; configured: boolean; maskedHint: string }>('/api/config/credential', v),
    successMessage: '凭据已加密保存，重启 cloud 后生效',
    invalidateKeys: [['config', 'model']],
    errorFallback: '凭据保存失败',
    onSuccess: (_d, v) => setCredentialInputs((s) => ({ ...s, [credentialId(v.provider, v.field)]: '' })),
  });

  const credentialGroups = useMemo(() => {
    if (!data) return [];
    return data.credentials.reduce<Array<{ key: string; label: string; items: Credential[] }>>((groups, cred) => {
      const found = groups.find((g) => g.key === cred.group);
      if (found) found.items.push(cred);
      else groups.push({ key: cred.group, label: cred.groupLabel, items: [cred] });
      return groups;
    }, []);
  }, [data]);

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

  const selectedBaseUrl = data.providers.find((p) => p.id === textProvider)?.baseUrl ?? '';
  const modelSaveDisabled = !textProvider || !imageProvider || !textModel.trim() || !imageModel.trim();

  return (
    <div className="page-stack">
      <div>
        <Space align="start" size="middle">
          <CloudServerOutlined style={{ marginTop: 6, fontSize: 20 }} />
          <div>
            <Typography.Title level={3} style={{ margin: 0 }}>
              平台配置
            </Typography.Title>
            <Typography.Text type="secondary">
              管理默认模型、模型厂商和平台级凭据。凭据只保存密文，不回显明文。
            </Typography.Text>
          </div>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        message="保存规则"
        description="模型与厂商保存后立即生效；API Key 和账单 AccessKey 保存为密文，运行时读取新凭据需要重启 cloud。"
      />

      <Card
        size="small"
        title={
          <Space>
            <ApiOutlined />
            <span>模型与厂商</span>
          </Space>
        }
        extra={<Tag color="green">即时生效</Tag>}
      >
        <Form layout="vertical" requiredMark={false}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 'var(--aidcp-space-4)',
              maxWidth: 920,
            }}
          >
            <div>
              <Form.Item label="全局文本厂商" extra="角色或分类未单独配置时，文本调用使用这个厂商。">
                <Select
                  aria-label="全局文本厂商"
                  value={textProvider}
                  onChange={setTextProvider}
                  options={data.providers.map((p) => ({ value: p.id, label: p.displayName }))}
                />
              </Form.Item>
              <Form.Item label="默认文本模型" extra="保存前服务端会按所选厂商探活；探活失败不会落库。">
                <Input
                  value={textModel}
                  onChange={(e) => setTextModel(e.target.value)}
                  placeholder="如 qwen-turbo、qwen-plus、doubao 或 ep-*"
                />
              </Form.Item>
            </div>

            <div>
              <Form.Item label="全局图片厂商" extra="图片生成厂商独立于文本厂商；如切到火山需配置对应模型 API Key。">
                <Select
                  aria-label="全局图片厂商"
                  value={imageProvider}
                  onChange={setImageProvider}
                  options={data.imageProviders.map((p) => ({ value: p.id, label: p.displayName }))}
                />
              </Form.Item>
              <Form.Item label="默认图片模型" extra="切换图片厂商后，请填写该厂商可用的图片模型名。">
                <Input value={imageModel} onChange={(e) => setImageModel(e.target.value)} placeholder="如 wan2.7-image-pro 或 doubao-seedream" />
              </Form.Item>
            </div>
          </div>

          <div style={{ marginBottom: 'var(--aidcp-space-4)' }}>
            <Typography.Text type="secondary">当前文本接口地址：</Typography.Text>
            <Typography.Text copyable code>
              {selectedBaseUrl || '未选择'}
            </Typography.Text>
          </div>

          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saveModel.isPending}
            disabled={modelSaveDisabled}
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
      </Card>

      <Card
        size="small"
        title={
          <Space>
            <SafetyCertificateOutlined />
            <span>平台凭据</span>
          </Space>
        }
        extra={<Tag color="gold">重启 cloud 后生效</Tag>}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            模型 API Key 用于调用模型厂商；账单 AccessKey 用于价格刷新。两类凭据都走同一个加密保存入口，但用途不同。
          </Typography.Text>

          {!data.canEditCredential && (
            <Alert
              type="warning"
              showIcon
              message="服务端未配置主加密密钥，暂不能在后台修改凭据"
              description="请在 cloud 的 .env 配置 AIDCP_CRED_KEY（32 字节随机、base64）后重启；模型名和厂商仍可在上方修改。"
            />
          )}

          {credentialGroups.map((group) => (
            <section key={group.key}>
              <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 'var(--aidcp-space-3)' }}>
                {group.label}
              </Typography.Title>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                {group.items.map((cred) => {
                  const inputId = credentialId(cred.provider, cred.field);
                  const domName = credentialDomName(cred);
                  const inputValue = credentialInputs[inputId] ?? '';
                  const isSaving = saveKey.isPending && saveKey.variables?.provider === cred.provider && saveKey.variables?.field === cred.field;
                  const hint = maskedHint(cred);

                  return (
                    <div
                      key={inputId}
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 'var(--aidcp-space-3)',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: 'var(--aidcp-space-3)',
                        border: '1px solid var(--aidcp-border)',
                        borderRadius: 'var(--aidcp-radius-md)',
                        background: 'var(--aidcp-background)',
                      }}
                    >
                      <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                        <Space wrap size="small" style={{ marginBottom: 'var(--aidcp-space-1)' }}>
                          <KeyOutlined />
                          <Typography.Text strong>{cred.label}</Typography.Text>
                          <Tag color={cred.configured ? 'green' : 'default'}>{cred.configured ? '已配置' : '未配置'}</Tag>
                          <Tag color={SOURCE_COLOR[cred.source]}>{labelOf(SOURCE_LABEL, cred.source)}</Tag>
                          {hint && <Tag>{hint}</Tag>}
                        </Space>
                        <div>
                          <Typography.Text type="secondary">{credentialHelp(cred)}</Typography.Text>
                        </div>
                      </div>

                      {data.canEditCredential && (
                        <Space.Compact style={{ flex: '1 1 340px', maxWidth: 560, minWidth: 280 }}>
                          <Input.Password
                            id={domName}
                            name={domName}
                            aria-label={`输入${cred.label}`}
                            value={inputValue}
                            onChange={(e) => setCredentialInputs((s) => ({ ...s, [inputId]: e.target.value }))}
                            placeholder={credentialPlaceholder(cred)}
                            autoComplete="off"
                            spellCheck={false}
                            data-lpignore="true"
                            data-1p-ignore="true"
                          />
                          <Button
                            icon={<SaveOutlined />}
                            loading={isSaving}
                            disabled={!inputValue.trim()}
                            onClick={() => saveKey.mutate({ provider: cred.provider, field: cred.field, value: inputValue.trim() })}
                          >
                            保存凭据
                          </Button>
                        </Space.Compact>
                      )}
                    </div>
                  );
                })}
              </Space>
            </section>
          ))}
        </Space>
      </Card>
    </div>
  );
}
