import { useState } from 'react';
import { App, Button, Form, Modal, Select, Skeleton, Tag, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '../api/client';
import type { FacebookCommentConfig, FacebookContainer, PanelAccount } from '../types/api';
import { accountName } from '../types/accountDisplay';

/**
 * Facebook 账号「配置搜索词」入口（change facebook-scheduled-comment 2.1 + facebook-container-display-name）。
 * 仅对 Facebook 账号展示（调用方按 platform 门控）。打开时拉当前配置回填、保存经面板 PUT。
 * 语义提示：关键词或容器任一为空 → 云端不生效（fail-closed）；系统随机选关键词、仅在配置的容器内搜索。
 * 容器：运营方粘贴群/主页**链接**（url），系统评论时自动从群页读出真实群名回填——**标签一律展示群名（缺则「待识别」），
 * 绝不展示群 id**（id 对人无辨识度）。保存时保留已识别的群名（按 url 匹配），不因改关键词而丢名。
 */
export function FacebookSearchConfig({ account }: { account: PanelAccount }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [containers, setContainers] = useState<FacebookContainer[]>([]);

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
    mutationFn: (v: { keywords: string[]; containers: FacebookContainer[] }) =>
      apiPut<FacebookCommentConfig>(path, v),
    onSuccess: () => {
      message.success('搜索词配置已保存');
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: () => message.error('搜索词配置保存失败'),
  });

  // Select 值 = 容器 url 列表（运营方粘 url）；增删时保留已识别群名（按 url 匹配），新 url 名待识别。
  const containerUrls = containers.map((c) => c.url);
  const onContainersChange = (urls: string[]) => {
    setContainers(urls.map((u) => containers.find((c) => c.url === u) ?? { url: u }));
  };
  const displayName = (url: string): string => {
    const name = containers.find((c) => c.url === url)?.name;
    return name && name.trim() ? name : '待识别';
  };

  const effectiveOff = keywords.length === 0 || containers.length === 0;

  return (
    <>
      <Button size="small" onClick={openModal}>
        配置搜索词
      </Button>
      <Modal
        title={`配置搜索词 · ${accountName(account)}`}
        open={open}
        confirmLoading={save.isPending}
        onOk={() => save.mutate({ keywords, containers })}
        // containers 已是 {url,name}[]，保存时保留已识别群名。
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
              extra="粘贴你运营 / 已加入的 Facebook 主页或群链接（url），仅在其内部搜索、绝不全站。系统评论时自动识别并显示真实群名（标签显示群名，「待识别」表示尚未识别）。"
            >
              <Select
                mode="tags"
                style={{ width: '100%' }}
                value={containerUrls}
                onChange={onContainersChange}
                tokenSeparators={[',', ' ']}
                placeholder="粘贴群 / 主页链接，如 https://www.facebook.com/groups/…"
                // 标签显示真实群名（缺则「待识别」），绝不展示 url 里的 id。
                tagRender={({ value, closable, onClose }) => (
                  <Tag closable={closable} onClose={onClose} style={{ marginInlineEnd: 4 }}>
                    {displayName(String(value))}
                  </Tag>
                )}
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
