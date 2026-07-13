import { useState } from 'react';
import {
  App,
  Button,
  Empty,
  Form,
  Image,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Skeleton,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { UploadProps } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  InboxOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '../api/client';
import { errorText } from '../api/errorText';
import type {
  FacebookCommentConfig,
  FacebookCommentMode,
  FacebookPublishMediaList,
  FacebookPublishMediaSet,
  FacebookPublishMediaStatus,
  FacebookPublishUploadResult,
  PanelAccount,
} from '../types/api';
import { accountName } from '../types/accountDisplay';

const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const STATUS_META: Record<FacebookPublishMediaStatus, { text: string; color?: string }> = {
  available: { text: '可用', color: 'green' },
  reserved: { text: '占用中', color: 'processing' },
  used: { text: '已发布', color: 'default' },
  disabled: { text: '已停用', color: 'warning' },
  deleted: { text: '已删除', color: 'default' },
  quarantine: { text: '待人工确认', color: 'red' },
};

interface PendingUpload {
  uid: string;
  name: string;
  size: number;
  type: string;
  file: File;
}

interface UploadProgress {
  current: number;
  total: number;
}

function pendingKey(file: File & { uid?: string }): string {
  return file.uid ?? `${file.name}-${file.size}-${file.lastModified}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    const chunk = bytes.subarray(i, i + 8192);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function activeSets(view: FacebookPublishMediaList | null): FacebookPublishMediaSet[] {
  return (view?.sets ?? []).filter((set) => set.status !== 'deleted');
}

function statusTag(status: FacebookPublishMediaStatus) {
  const meta = STATUS_META[status] ?? { text: status };
  return <Tag color={meta.color}>{meta.text}</Tag>;
}

/**
 * Facebook 账号「FB配置」入口（关键词 + 评论方式 / 模板）。
 * 仅对 Facebook 账号展示（调用方按 platform 门控）。打开时拉当前配置回填、保存经面板 PUT。
 * 目标群由账号已加入群组账本选择；本弹窗不再编辑 legacy containers。
 */
export function FacebookSearchConfig({ account }: { account: PanelAccount }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [commentMode, setCommentMode] = useState<FacebookCommentMode>('generated');
  const [templateText, setTemplateText] = useState('');
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaView, setMediaView] = useState<FacebookPublishMediaList | null>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [uploadResults, setUploadResults] = useState<FacebookPublishUploadResult[]>([]);
  const [captionDrafts, setCaptionDrafts] = useState<Record<number, string>>({});
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  const path = `/api/accounts/${encodeURIComponent(account.accountId)}/facebook-comment-config`;
  const mediaPath = `/api/accounts/${encodeURIComponent(account.accountId)}/facebook-publish-media`;

  const loadMedia = async () => {
    setMediaLoading(true);
    try {
      setMediaView(await apiGet<FacebookPublishMediaList>(mediaPath));
    } catch (error) {
      message.error(errorText(error, '读取发帖图片失败'));
      setMediaView(null);
    } finally {
      setMediaLoading(false);
    }
  };

  const openModal = async () => {
    setOpen(true);
    setLoading(true);
    setUploadResults([]);
    setPendingUploads([]);
    setCaptionDrafts({});
    setUploadProgress(null);
    void loadMedia();
    try {
      const cfg = await apiGet<FacebookCommentConfig>(path);
      setKeywords(cfg.keywords ?? []);
      setCommentMode(cfg.commentMode ?? 'generated');
      setTemplateText((cfg.commentTemplates ?? []).join('\n'));
    } catch {
      message.error('读取搜索词配置失败');
      setKeywords([]);
      setCommentMode('generated');
      setTemplateText('');
    } finally {
      setLoading(false);
    }
  };

  const save = useMutation({
    mutationFn: (v: { keywords: string[]; commentMode: FacebookCommentMode; commentTemplates: string[] }) =>
      apiPut<FacebookCommentConfig>(path, v),
    onSuccess: () => {
      message.success('搜索词配置已保存');
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (error) => message.error(errorText(error, '搜索词配置保存失败')),
  });

  const upload = useMutation({
    mutationFn: async (): Promise<{ results: FacebookPublishUploadResult[]; failedItems: PendingUpload[] }> => {
      const batch = [...pendingUploads];
      const results: FacebookPublishUploadResult[] = [];
      const failedItems: PendingUpload[] = [];

      // 保留批量选择，但逐张请求：避免多个 Base64 图片合并成一个超大 JSON 请求体。
      for (let index = 0; index < batch.length; index += 1) {
        const item = batch[index];
        setUploadProgress({ current: index + 1, total: batch.length });
        try {
          const response = await apiPost<{ results: FacebookPublishUploadResult[]; view: FacebookPublishMediaList }>(
            `${mediaPath}/upload`,
            {
              files: [
                {
                  filename: item.name,
                  contentType: item.type,
                  dataBase64: arrayBufferToBase64(await item.file.arrayBuffer()),
                },
              ],
            },
          );
          const result = response.results.find((entry) => entry.filename === item.name) ?? response.results[0];
          const normalized: FacebookPublishUploadResult =
            result ?? { ok: false, filename: item.name, reason: 'missing_result', message: '服务器未返回上传结果' };
          results.push(normalized);
          setMediaView(response.view);
          if (!normalized.ok) failedItems.push(item);
        } catch (error) {
          results.push({
            ok: false,
            filename: item.name,
            reason: 'request_failed',
            message: errorText(error, '图片上传失败'),
          });
          failedItems.push(item);
        }
      }

      return { results, failedItems };
    },
    onSuccess: ({ results, failedItems }) => {
      const failed = results.filter((result) => !result.ok).length;
      const succeeded = results.length - failed;
      setUploadResults(results);
      setPendingUploads(failedItems);
      setUploadProgress(null);
      if (failed > 0) message.warning(`已上传 ${succeeded} 张，${failed} 张失败；失败文件仍保留，可重试`);
      else message.success(`已上传 ${succeeded} 张图片`);
    },
    onError: (error) => {
      setUploadProgress(null);
      message.error(errorText(error, '图片上传失败'));
    },
  });

  const patchSet = useMutation({
    mutationFn: (v: { setId: number; status?: 'available' | 'disabled' | 'deleted'; captionHint?: string | null }) =>
      apiPatch<FacebookPublishMediaSet>(`${mediaPath}/sets/${v.setId}`, {
        ...(v.status ? { status: v.status } : {}),
        ...('captionHint' in v ? { captionHint: v.captionHint ?? null } : {}),
      }),
    onSuccess: () => {
      message.success('图片状态已更新');
      void loadMedia();
    },
    onError: (error) => message.error(errorText(error, '图片状态更新失败')),
  });

  const deleteSet = useMutation({
    mutationFn: (setId: number) => apiDelete<FacebookPublishMediaSet>(`${mediaPath}/sets/${setId}`),
    onSuccess: () => {
      message.success('图片已删除');
      void loadMedia();
    },
    onError: (error) => message.error(errorText(error, '图片删除失败')),
  });

  const reorder = useMutation({
    mutationFn: (orderedSetIds: number[]) =>
      apiPut<FacebookPublishMediaList>(`${mediaPath}/reorder`, { orderedSetIds }),
    onSuccess: (view) => {
      setMediaView(view);
    },
    onError: (error) => message.error(errorText(error, '排序保存失败')),
  });

  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      message.error('仅支持 PNG / JPG / WEBP / GIF 图片');
      return Upload.LIST_IGNORE;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      message.error('单张图片不能超过 10 MB');
      return Upload.LIST_IGNORE;
    }
    const key = pendingKey(file);
    setPendingUploads((prev) =>
      prev.some((item) => item.uid === key)
        ? prev
        : [...prev, { uid: key, name: file.name, size: file.size, type: file.type, file }],
    );
    return Upload.LIST_IGNORE;
  };

  const commentTemplates = (): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of templateText.split(/\r?\n/)) {
      const v = raw.trim();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  };

  const effectiveOff = keywords.length === 0 || (commentMode === 'template' && commentTemplates().length === 0);
  const mediaRows = activeSets(mediaView);

  const moveSet = (index: number, delta: -1 | 1) => {
    const next = [...mediaRows];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorder.mutate(next.map((set) => set.id));
  };

  const columns: ColumnsType<FacebookPublishMediaSet> = [
    {
      title: '图片',
      key: 'image',
      width: 76,
      render: (_, row) => {
        const img = row.images[0];
        return img ? <Image width={52} height={52} src={img.url} alt={img.filename} style={{ objectFit: 'cover' }} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={false} />;
      },
    },
    {
      title: '文件',
      key: 'file',
      width: 220,
      render: (_, row) => {
        const img = row.images[0];
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text ellipsis={{ tooltip: img?.filename }}>{img?.filename ?? `素材 ${row.id}`}</Typography.Text>
            <Typography.Text type="secondary">{row.images.length} 张 · {formatBytes(img?.byteSize ?? 0)}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 104,
      filters: [
        { text: '可用', value: 'available' },
        { text: '停用', value: 'disabled' },
        { text: '占用中', value: 'reserved' },
        { text: '已发布', value: 'used' },
        { text: '待确认', value: 'quarantine' },
      ],
      onFilter: (value, row) => row.status === value,
      render: (status: FacebookPublishMediaStatus) => statusTag(status),
    },
    {
      title: '备注',
      key: 'captionHint',
      width: 180,
      render: (_, row) => {
        const value = captionDrafts[row.id] ?? row.captionHint ?? '';
        const locked = row.status === 'reserved' || row.status === 'used';
        return (
          <Input
            size="small"
            value={value}
            disabled={locked || patchSet.isPending}
            placeholder="可选备注"
            onChange={(event) => setCaptionDrafts((prev) => ({ ...prev, [row.id]: event.target.value.slice(0, 300) }))}
            onBlur={() => {
              const next = (captionDrafts[row.id] ?? row.captionHint ?? '').trim();
              const prev = row.captionHint ?? '';
              if (next !== prev) patchSet.mutate({ setId: row.id, captionHint: next || null });
            }}
          />
        );
      },
    },
    {
      title: '顺序',
      key: 'order',
      width: 96,
      render: (_, row, index) => {
        const locked = row.status === 'reserved' || row.status === 'used' || row.status === 'quarantine';
        return (
          <Space size={4}>
            <Button
              size="small"
              icon={<ArrowUpOutlined />}
              aria-label="上移图片"
              disabled={index === 0 || locked || reorder.isPending}
              onClick={() => moveSet(index, -1)}
            />
            <Button
              size="small"
              icon={<ArrowDownOutlined />}
              aria-label="下移图片"
              disabled={index === mediaRows.length - 1 || locked || reorder.isPending}
              onClick={() => moveSet(index, 1)}
            />
          </Space>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 172,
      render: (_, row) => {
        const locked = row.status === 'reserved' || row.status === 'used';
        return (
          <Space size={4} wrap={false}>
            {row.status === 'quarantine' ? (
              <Button
                size="small"
                icon={<CheckCircleOutlined />}
                disabled={locked}
                loading={patchSet.isPending}
                onClick={() => patchSet.mutate({ setId: row.id, status: 'available' })}
              >
                确认
              </Button>
            ) : row.status === 'disabled' ? (
              <Button
                size="small"
                icon={<PlayCircleOutlined />}
                disabled={locked}
                loading={patchSet.isPending}
                onClick={() => patchSet.mutate({ setId: row.id, status: 'available' })}
              >
                启用
              </Button>
            ) : (
              <Button
                size="small"
                icon={<PauseCircleOutlined />}
                disabled={locked}
                loading={patchSet.isPending}
                onClick={() => patchSet.mutate({ setId: row.id, status: 'disabled' })}
              >
                停用
              </Button>
            )}
            <Popconfirm title="删除这张发帖图片？" okText="删除" cancelText="取消" onConfirm={() => deleteSet.mutate(row.id)}>
              <Button size="small" icon={<DeleteOutlined />} aria-label="删除图片" danger disabled={locked} loading={deleteSet.isPending} />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <>
      <Button size="small" onClick={openModal}>
        FB配置
      </Button>
      <Modal
        title={`FB配置 · ${accountName(account)}`}
        open={open}
        confirmLoading={save.isPending}
        onOk={() => save.mutate({ keywords, commentMode, commentTemplates: commentTemplates() })}
        onCancel={() => setOpen(false)}
        okText="保存"
        cancelText="取消"
        width={860}
      >
        {loading ? (
          <Skeleton active />
        ) : (
          <Tabs
            items={[
              {
                key: 'comment',
                label: '评论搜索',
                children: (
                  <Form layout="vertical" requiredMark={false}>
                    <Form.Item label="搜索关键词" extra="系统每次随机选一个关键词。输入后回车 / 逗号添加；关键词内可含空格（如「手冲 咖啡」为一个词，不会被拆开）。">
                      <Select
                        mode="tags"
                        style={{ width: '100%' }}
                        value={keywords}
                        onChange={setKeywords}
                        // 只用逗号分隔关键词——空格保留在词内（多词短语算一个搜索词，绝不按空格拆词）。
                        tokenSeparators={[',']}
                        placeholder="如：手冲 咖啡、烘焙"
                      />
                    </Form.Item>
                    <Form.Item label="评论方式">
                      <Radio.Group
                        optionType="button"
                        buttonStyle="solid"
                        value={commentMode}
                        onChange={(e) => setCommentMode(e.target.value as FacebookCommentMode)}
                        options={[
                          { label: '生成评论', value: 'generated' },
                          { label: '模板评论', value: 'template' },
                        ]}
                      />
                    </Form.Item>
                    {commentMode === 'template' ? (
                      <Form.Item label="评论模板" extra="每行一个模板。模板正文不应包含联系方式；带联系方式评论会自动拼接账号联系方式。">
                        <Input.TextArea
                          rows={5}
                          value={templateText}
                          onChange={(e) => setTemplateText(e.target.value)}
                          placeholder="这家手冲咖啡很不错"
                        />
                      </Form.Item>
                    ) : null}
                    {effectiveOff ? (
                      <Typography.Text type="warning">
                        {keywords.length === 0 ? '至少需要 1 个搜索关键词。' : '模板评论至少需要 1 条模板。'}
                      </Typography.Text>
                    ) : null}
                  </Form>
                ),
              },
              {
                key: 'publish-media',
                label: '发帖图片',
                children: (
                  <div className="facebook-publish-media">
                    <div className="facebook-publish-media__summary">
                      <Space wrap>
                        <Tag color="green">可用 {mediaView?.statusCounts.available ?? 0}</Tag>
                        <Tag>已发布 {mediaView?.statusCounts.used ?? 0}</Tag>
                        <Tag color="warning">停用 {mediaView?.statusCounts.disabled ?? 0}</Tag>
                        <Tag color="red">待确认 {mediaView?.statusCounts.quarantine ?? 0}</Tag>
                      </Space>
                      <Button size="small" onClick={() => void loadMedia()} loading={mediaLoading}>
                        刷新
                      </Button>
                    </div>
                    {(mediaView?.statusCounts.available ?? 0) === 0 ? (
                      <Typography.Text type="warning">素材不足：至少需要 1 张可用图片才能生成 Facebook 发帖草稿。</Typography.Text>
                    ) : null}

                    <Upload.Dragger
                      aria-label="选择发帖图片"
                      multiple
                      accept={ACCEPTED_IMAGE_TYPES.join(',')}
                      disabled={upload.isPending}
                      beforeUpload={beforeUpload}
                      showUploadList={false}
                    >
                      <InboxOutlined className="facebook-publish-media__upload-icon" />
                      <Typography.Text>选择或拖入发帖图片</Typography.Text>
                      <Typography.Text type="secondary">支持 PNG / JPG / WEBP / GIF，单张最大 10 MB</Typography.Text>
                    </Upload.Dragger>

                    {pendingUploads.length > 0 ? (
                      <div className="facebook-publish-media__pending">
                        <Space wrap>
                          {pendingUploads.map((item) => (
                            <Tag
                              key={item.uid}
                              closable={!upload.isPending}
                              onClose={() => setPendingUploads((prev) => prev.filter((file) => file.uid !== item.uid))}
                            >
                              {item.name} · {formatBytes(item.size)}
                            </Tag>
                          ))}
                        </Space>
                        <Button
                          type="primary"
                          icon={<UploadOutlined />}
                          loading={upload.isPending}
                          disabled={pendingUploads.length === 0}
                          onClick={() => upload.mutate()}
                        >
                          {uploadProgress ? `上传中 ${uploadProgress.current}/${uploadProgress.total}` : '上传图片'}
                        </Button>
                      </div>
                    ) : null}

                    {uploadResults.length > 0 ? (
                      <Space wrap>
                        {uploadResults.map((result) =>
                          result.ok ? (
                            <Tag key={result.filename} color="green">
                              {result.filename} 已入池
                            </Tag>
                          ) : (
                            <Tag key={result.filename} color="red">
                              {result.filename} 失败{result.message ? `：${result.message}` : ''}
                            </Tag>
                          ),
                        )}
                      </Space>
                    ) : null}

                    <Table<FacebookPublishMediaSet>
                      size="small"
                      rowKey="id"
                      loading={mediaLoading}
                      dataSource={mediaRows}
                      columns={columns}
                      pagination={false}
                      locale={{ emptyText: <Empty description="暂无发帖图片" /> }}
                      scroll={{ x: 720 }}
                    />
                  </div>
                ),
              },
            ]}
          />
        )}
      </Modal>
    </>
  );
}
