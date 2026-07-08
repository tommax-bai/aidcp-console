import type { ReactNode } from 'react';
import { xhsProfileUrl } from '../types/xhsProfile';

/**
 * 账号 / 联系人昵称 → 可点跳转其小红书个人主页（新标签页打开）。
 *
 * - `userId` 为真实小红书用户 id 时渲染外链；否则（缺 id / 退役 'default' / 形状不符）回落纯文本，绝不渲染死链。
 * - 我们的账号传 `accountId`（= 登录派生的 xhs userid）；通知联系人传其 `userId`（主页 id）。
 * - 与互动流「目标→详情页/作者主页」可点链接同口径：诚实，缺则降级为纯文本。
 */
export function ProfileLink({
  userId,
  children,
}: {
  userId: string | null | undefined;
  children: ReactNode;
}) {
  const url = xhsProfileUrl(userId);
  // 缺 id / 退役 default / 形状不符 → 纯文本回落，绝不渲染死链、也不加可点样式（否则误导）。
  if (!url) return <>{children}</>;
  // 外链可点性（.ext-link）：下划线 + 悬停高亮 + 尾随 ↗ 图标，一眼可点（近黑品牌不变）。
  return (
    <a className="ext-link" href={url} target="_blank" rel="noreferrer noopener" title="打开小红书主页">
      {children}
    </a>
  );
}
