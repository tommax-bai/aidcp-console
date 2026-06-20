import { Empty } from 'antd';

/** 发布队列 + 已发布历史 + 待审核（task 6.6 写：审批 first-writer-wins / task 5 读接口）。 */
export function ContentPage() {
  return <Empty description="Content — 待 task 5 /api/content/* 与 task 4 审批写接入" />;
}
