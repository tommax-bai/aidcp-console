import { App } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryKey, UseMutationResult } from '@tanstack/react-query';
import { errorText } from '../api/errorText';

/**
 * 配置写样板收口（change console-cloud-panel-hardening #34）。
 *
 * 各配置页的「保存」写法高度同构：提交 → 成功 message + 可选副作用（关编辑态 / 清输入）+
 * invalidate 指定 queryKey 整体重取真态 → 失败经集中映射 errorText 出说人话中文。本 hook 封装这一套，
 * 消除重复。
 *
 * 适用边界：仅收口「失败文案可完全交给 errorText」的配置写。带页面专属拒因文案且 errorText 未覆盖 /
 * 会被弱化的页面（如 QuotasPage 的「数字非法…」invalid_value、SettingsPage saveModel /
 * RolesPage 的 provider_key_missing 带「重启 cloud / 到设置页」指引、PersonaPage 的 persona_required 等）
 * 应保留原样、不迁移——避免把更具体的提示弱化成集中映射的通用中文。
 *
 * hook 内用 App.useApp() 取 message、useQueryClient 取 qc，均在组件渲染期调用（与页面里的 useMutation 同层）。
 */
export interface UseConfigMutationOptions<TData, TVars> {
  /** 提交函数（PUT/POST 到配置端点），返回服务端最新态。 */
  mutationFn: (vars: TVars) => Promise<TData>;
  /** 成功后的 message.success 文案。 */
  successMessage: string | ((data: TData, vars: TVars) => string);
  /** 成功后要 invalidate 的 queryKey（可多把，整体重取相关配置真态）。 */
  invalidateKeys: QueryKey[];
  /** 失败提示兜底文案：errorText 命中集中映射时用中文、未命中回落此串（绝不上屏英文码）。 */
  errorFallback: string;
  /** 成功后的可选副作用（关编辑态 / 清输入等），带服务端返回与提交变量。 */
  onSuccess?: (data: TData, vars: TVars) => void;
}

/** 泛型配置写 hook：成功提示 + 可选副作用 + invalidate；失败统一走 errorText 出中文。 */
export function useConfigMutation<TData, TVars>(
  opts: UseConfigMutationOptions<TData, TVars>,
): UseMutationResult<TData, Error, TVars> {
  const { message } = App.useApp();
  const qc = useQueryClient();
  return useMutation<TData, Error, TVars>({
    mutationFn: opts.mutationFn,
    onSuccess: (data, vars) => {
      message.success(typeof opts.successMessage === 'function' ? opts.successMessage(data, vars) : opts.successMessage);
      opts.onSuccess?.(data, vars);
      for (const key of opts.invalidateKeys) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
    onError: (err) => {
      message.error(errorText(err, opts.errorFallback));
    },
  });
}
