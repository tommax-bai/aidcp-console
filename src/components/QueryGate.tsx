import type { ReactNode } from 'react';
import { Alert, Button, Skeleton } from 'antd';

/**
 * 统一读查询错误呈现（change console-cloud-panel-hardening #30）。
 *
 * 病灶：多数页面读失败时呈现为「仍在加载」（永久骨架屏）或「暂无数据」（误导空态），甚至回落到内置
 * 默认值冒充真实配置——等同 UI 层的静默假成功（与后端「绝不静默假成功」红线同源）。
 * 收口：读查询三态统一由本组件呈现——加载中→骨架屏；失败→可读错误 + 重试；成功→children。
 */

/** react-query 结果的最小结构（避免耦合具体泛型）。 */
export interface GateQuery {
  isLoading: boolean;
  isError: boolean;
  refetch: () => unknown;
}

/** 纯错误面板（可单独用于「页首 isError 分支」的最小接入）。 */
export function QueryError({ title = '加载失败', onRetry }: { title?: string; onRetry?: () => void }) {
  return (
    <div className="page-stack">
      <Alert
        type="error"
        showIcon
        message={title}
        description="请检查网络或稍后重试；若持续失败请联系维护。"
        action={
          onRetry && (
            <Button size="small" onClick={onRetry}>
              重试
            </Button>
          )
        }
      />
    </div>
  );
}

/**
 * 包裹式三态门：任一 query 失败→错误+重试；任一加载中→骨架屏；全部就绪→children。
 * children 里保证已过加载/错误态（但 TS 不缩窄 data，调用方仍需 `data && ...` 或子组件传参）。
 */
export function QueryGate({
  query,
  queries,
  errorTitle = '加载失败',
  loading,
  children,
}: {
  query?: GateQuery;
  queries?: GateQuery[];
  errorTitle?: string;
  loading?: ReactNode;
  children: ReactNode;
}) {
  const list = queries ?? (query ? [query] : []);
  if (list.some((q) => q.isError)) {
    return <QueryError title={errorTitle} onRetry={() => list.forEach((q) => void q.refetch())} />;
  }
  if (list.some((q) => q.isLoading)) {
    return <>{loading ?? <Skeleton active />}</>;
  }
  return <>{children}</>;
}
