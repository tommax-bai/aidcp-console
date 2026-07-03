import { useState } from 'react';
import { App, Button, Card, Form, Input, Typography } from 'antd';
import { DeploymentUnitOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError, UnauthorizedError } from '../api/client';

/** 登录页（design PAGE 1）：非乐观——仅 JWT round-trip 成功后才进入外壳；视觉对齐 isales。 */
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    setError(null);
    try {
      await login(values.username, values.password);
      navigate(from, { replace: true }); // #24：登录后回来源页
    } catch (e) {
      if (e instanceof UnauthorizedError || (e instanceof ApiError && e.status === 401)) {
        setError('用户名或密码错误');
      } else {
        setError('无法连接服务端');
        message.error('无法连接服务端');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--aidcp-muted)',
        padding: 'var(--aidcp-space-6)',
      }}
    >
      <Card style={{ width: 360, boxShadow: 'var(--aidcp-shadow-md)' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--aidcp-space-6)' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              borderRadius: 'var(--aidcp-radius-md)',
              background: 'var(--aidcp-primary)',
              color: '#fff',
              fontSize: 32,
              marginBottom: 'var(--aidcp-space-3)',
            }}
          >
            <DeploymentUnitOutlined className="brand-glyph" />
          </span>
          <Typography.Title level={4} style={{ margin: 0 }}>
            AIDCP 运营管理后台
          </Typography.Title>
          <Typography.Text type="secondary">内部运营控制台</Typography.Text>
        </div>
        <Form layout="vertical" onFinish={onFinish} disabled={loading} requiredMark={false}>
          <Form.Item label="用户名" name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input autoFocus placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
          {error && (
            <Typography.Paragraph type="danger" style={{ marginBottom: 'var(--aidcp-space-2)' }}>
              {error}
            </Typography.Paragraph>
          )}
          <Button type="primary" htmlType="submit" block loading={loading}>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}
