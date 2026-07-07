import { useState } from 'react';
import { App, Button, Form, Modal, Select, Skeleton, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '../api/client';
import type { FacebookCommentConfig, PanelAccount } from '../types/api';

/**
 * Facebook 账号「配置搜索词」入口（change facebook-scheduled-comment 2.1）。
 * 仅对 Facebook 账号展示（调用方按 platform 门控）。打开时拉当前配置回填、保存经面板 PUT。
 * 语义提示：关键词或容器任一为空 → 云端不生效（fail-closed）；系统随机选关键词、仅在配置的容器内搜索。
 */
export function FacebookSearchConfig({ account }: { account: PanelAccount }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [containers, setContainers] = useState<string[]>([]);

  const path = `/api/accounts/${encodeURIComponent(account.accountId)}/facebook-comment-config`;

  const openModal = async () => {
    setOpen(true);
    setLoading(true);
    try {
      const cfg = await apiGet<FacebookCommentConfig>(path);
      setKeywords(cfg.keywords ?? []);
      setContainers(cfg.containers ?? []);
    } catch {
      message.error('读取搜索词配置失败');
      setKeywords([]);
      setContainers([]);
    } finally {
      setLoading(false);
    }
  };

  const save = useMutation({
    mutationFn: (v: { keywords: string[]; containers: string[] }) =>
      apiPut<FacebookCommentConfig>(path, v),
    onSuccess: () => {
      message.success('搜索词配置已保存');
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: () => message.error('搜索词配置保存失败'),
  });

  const effectiveOff = keywords.length === 0 || containers.length === 0;

  return (
    <>
      <Button size="small" onClick={openModal}>
        配置搜索词
      </Button>
      <Modal
        title={`配置搜索词 · ${account.label ?? account.accountId}`}
        open={open}
        confirmLoading={save.isPending}
        onOk={() => save.mutate({ keywords, containers })}
        onCancel={() => setOpen(false)}
        okText="保存"
        cancelText="取消"
        width={560}
      >
        {loading ? (
          <Skeleton active />
        ) : (
          <Form layout="vertical" requiredMark={false}>
            <Form.Item label="搜索关键词" extra="系统每次随机选一个关键词。输入后回车 / 逗号 / 空格添加。">
              <Select
                mode="tags"
                style={{ width: '100%' }}
                value={keywords}
                onChange={setKeywords}
                tokenSeparators={[',', ' ']}
                placeholder="如：手冲咖啡、烘焙"
              />
            </Form.Item>
            <Form.Item
              label="目标容器（主页 / 群）"
              extra="仅在这些你运营 / 已加入的 Facebook 主页或群内部搜索，绝不全站搜索。填容器主页 / 群标识。"
            >
              <Select
                mode="tags"
                style={{ width: '100%' }}
                value={containers}
                onChange={setContainers}
                tokenSeparators={[',', ' ']}
                placeholder="如：某主页 slug、某群组 id"
              />
            </Form.Item>
            {effectiveOff ? (
              <Typography.Text type="warning">
                关键词与容器都非空时才会生效；当前配置不生效（不会评论）。
              </Typography.Text>
            ) : null}
          </Form>
        )}
      </Modal>
    </>
  );
}
