import { useState } from 'react';
import { App, Button, Card, Form, Input, Layout, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';

/** 登录页（design PAGE 1）：非乐观——仅 JWT round-trip 成功后才进入外壳。 */
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    setError(null);
    try {
      await login(values.username, values.password);
      navigate('/', { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError('invalid credentials');
      } else {
        setError('cannot reach /api');
        message.error('cannot reach /api');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout
      style={{ minHeight: '100vh', alignItems: 'center', justifyContent: 'center', flexDirection: 'row' }}
    >
      <Card style={{ width: 320 }}>
        <Typography.Title level={4} style={{ textAlign: 'center', marginBottom: 0 }}>
          AIDCP Console
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          internal ops console
        </Typography.Paragraph>
        <Form layout="vertical" size="small" onFinish={onFinish} disabled={loading}>
          <Form.Item label="Username" name="username" rules={[{ required: true }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item label="Password" name="password" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          {error && (
            <Typography.Paragraph type="danger" style={{ marginBottom: 8 }}>
              {error}
            </Typography.Paragraph>
          )}
          <Button type="primary" htmlType="submit" block loading={loading}>
            Sign in
          </Button>
        </Form>
      </Card>
    </Layout>
  );
}
