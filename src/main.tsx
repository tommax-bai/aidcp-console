import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { UnauthorizedError } from './api/client';
import { aidcpTheme } from './theme';
import './styles/app.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 会话过期的 401 不重试——重试只会再次 401，白等约 1s 退避；其余错误仍重试一次。
      retry: (failureCount, error) => !(error instanceof UnauthorizedError) && failureCount < 1,
      refetchOnWindowFocus: false,
    },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

// 单一 <App>（antd）wrapper 供 App.useApp() 的 theme-aware message/notification（design §5）。
createRoot(rootEl).render(
  <StrictMode>
    <ConfigProvider theme={aidcpTheme} locale={zhCN}>
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>
  </StrictMode>,
);
