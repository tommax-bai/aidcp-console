import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { App as AntApp, Alert, Button, Empty, Result, Space, Spin, Tag, Typography } from 'antd';
import { ClearOutlined, ExportOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { useParams, useSearchParams } from 'react-router-dom';
import type { CaptchaAssistIncident } from '../types/api';
import { labelOf } from '../types/aidcp-enums';

const { Text, Title } = Typography;

type AssistPoint = { x: number; y: number };

const STATUS_LABEL: Record<CaptchaAssistIncident['status'], string> = {
  detected: '待截图',
  capture_pending: '截图中',
  ready: '待处理',
  click_pending: '复检中',
  cleared: '已清除',
  still_blocked: '仍阻断',
  failed: '失败',
  expired: '已过期',
};

const STATUS_COLOR: Record<CaptchaAssistIncident['status'], string> = {
  detected: 'default',
  capture_pending: 'processing',
  ready: 'warning',
  click_pending: 'processing',
  cleared: 'success',
  still_blocked: 'error',
  failed: 'error',
  expired: 'default',
};

function withToken(path: string, token: string): string {
  const joiner = path.includes('?') ? '&' : '?';
  return `${path}${joiner}token=${encodeURIComponent(token)}`;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; reason?: string };
    return body.reason ?? body.error ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

export function CaptchaAssistPage() {
  const { message } = AntApp.useApp();
  const { incidentId = '' } = useParams();
  const [search] = useSearchParams();
  const token = search.get('token') ?? '';
  const [incident, setIncident] = useState<CaptchaAssistIncident | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<AssistPoint[]>([]);
  // 选点期冻结（change captcha-assist-live-snapshot）：运营放下第 1 个点即 pin 当前帧，其后实时新帧不换
  // 显示画面、不冲掉已选点；提交/清空/看最新才解冻。落点坐标始终映射到这张被 pin 的帧。
  const [pinned, setPinned] = useState<CaptchaAssistIncident['snapshot'] | null>(null);

  // 运营真实鼠标轨迹采集（change captcha-assist-trajectory-replay）：与落点同一 stage rect 基准，
  // 归一化 {x,y}+相对首样本毫秒 t；pointerdown 时把点击位置也入样本并记 clicks 下标（保证每点有对应样本、
  // 下标合法）。节流 + 上限有界，随 /click 一并上送；边缘无/无效轨迹时回落合成路径。
  const samplesRef = useRef<{ x: number; y: number; t: number }[]>([]);
  const clicksRef = useRef<number[]>([]);
  const startRef = useRef<number | null>(null);
  const lastSampleAtRef = useRef(0);
  const MOVE_SAMPLE_CAP = 200; // + 至多 2 个点击样本 < 边缘 250 上限
  const MOVE_SAMPLE_THROTTLE_MS = 40;
  // 太短的轨迹（秒点无移动）不上送——回放会近瞬移、反而不如合成路径拟人。边缘无轨迹即走合成。
  const MIN_TRAJECTORY_SAMPLES = 5;

  const resetTrajectory = () => {
    samplesRef.current = [];
    clicksRef.current = [];
    startRef.current = null;
    lastSampleAtRef.current = 0;
  };
  const relTime = (): number => {
    const now = performance.now();
    if (startRef.current == null) startRef.current = now;
    return Math.max(0, Math.round(now - startRef.current));
  };

  const endpoint = useMemo(
    () => `/api/captcha-assist/${encodeURIComponent(incidentId)}`,
    [incidentId],
  );

  const load = useCallback(async () => {
    if (!incidentId || !token) return;
    setError(null);
    try {
      const res = await fetch(withToken(endpoint, token));
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as { incident: CaptchaAssistIncident };
      setIncident(body.incident);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [endpoint, incidentId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  // 轮询直到终态：实时抓帧下 ready 是稳态（要持续拉新帧 + 每次 GET 即向云端发"在场"信号 re-arm 实时循环），
  // 故不再在 ready 停轮询，只在 cleared/failed/expired 停。
  useEffect(() => {
    if (!incident || incident.status === 'cleared' || incident.status === 'failed' || incident.status === 'expired') {
      return;
    }
    const timer = window.setInterval(() => void load(), 1400);
    return () => window.clearInterval(timer);
  }, [incident, load]);

  const liveSnapshot = incident?.snapshot;
  // 冻结中显示被 pin 的帧，否则跟随最新帧。
  const frozen = points.length > 0 && pinned != null;
  const displaySnapshot = frozen ? pinned : liveSnapshot;
  const imageSrc = displaySnapshot ? `data:${displaySnapshot.image.mime};base64,${displaySnapshot.image.data}` : '';
  const canClick = Boolean(displaySnapshot && incident?.status !== 'click_pending' && incident?.status !== 'cleared' && incident?.status !== 'expired');
  // 冻结期间实时帧已推进到不同 snapshotId → 挑战画面可能已变，给显式提示（绝不静默沿用旧帧让运营点错）。
  const newerFrameAvailable = Boolean(frozen && liveSnapshot && pinned && liveSnapshot.snapshotId !== pinned.snapshotId);
  const liveActive = Boolean(incident?.liveUntil && Date.now() < incident.liveUntil);

  // 未冻结时换帧 → 重置轨迹采集（对新帧重新开始）。冻结期 displaySnapshot 恒定、不触发。
  useEffect(() => {
    if (points.length === 0) resetTrajectory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displaySnapshot?.snapshotId]);

  // 解冻并采纳最新帧：清点 + 取消 pin + 重置轨迹（不发服务端请求，直接用已轮询到的最新帧）。
  const adoptLatest = () => {
    setPoints([]);
    setPinned(null);
    resetTrajectory();
  };

  const onImageClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!canClick) return;
    if (points.length >= 2) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return;
    // 放下第 1 个点即冻结当前显示帧（此后落点都映射到这张帧）。
    if (points.length === 0 && liveSnapshot) setPinned(liveSnapshot);
    // 点击位置入样本，并记该点的 clicks 下标（每点必有对应样本、下标恒合法）。
    samplesRef.current.push({ x, y, t: relTime() });
    clicksRef.current.push(samplesRef.current.length - 1);
    setPoints((prev) => (prev.length >= 2 ? prev : [...prev, { x, y }]));
  };

  // 采集鼠标移动轨迹（节流 + 上限）：仅在可点态、同一 stage rect 基准。
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!canClick) return;
    if (samplesRef.current.length >= MOVE_SAMPLE_CAP) return;
    const now = performance.now();
    if (now - lastSampleAtRef.current < MOVE_SAMPLE_THROTTLE_MS) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return;
    lastSampleAtRef.current = now;
    samplesRef.current.push({ x, y, t: relTime() });
  };

  const refresh = async () => {
    if (!incidentId || !token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(withToken(`${endpoint}/capture`, token), { method: 'POST' });
      if (!res.ok) throw new Error(await readError(res));
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    // 提交被冻结的那张帧的 snapshotId（与运营所见一致）；云端按近期帧集放行、边缘按该帧 crop 落点。
    if (!displaySnapshot || points.length === 0) return;
    setBusy(true);
    setError(null);
    // 轨迹随 click 上送：仅当每个点都有对应样本（clicks 长度===点数）且有样本时才带；否则不带、边缘走合成。
    const samples = samplesRef.current;
    const clicks = clicksRef.current;
    const trajectory =
      samples.length >= MIN_TRAJECTORY_SAMPLES && clicks.length === points.length
        ? { v: 1 as const, samples, clicks }
        : undefined;
    try {
      const res = await fetch(withToken(`${endpoint}/click`, token), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ snapshotId: displaySnapshot.snapshotId, points, ...(trajectory ? { trajectory } : {}) }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as { incident: CaptchaAssistIncident };
      setIncident(body.incident);
      setPoints([]);
      setPinned(null);
      resetTrajectory();
      message.success('已提交');
      window.setTimeout(() => void load(), 1200);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!incidentId || !token) {
    return <Result status="403" title="缺少访问令牌" />;
  }

  if (loading && !incident) {
    return (
      <div className="captcha-assist-page captcha-assist-page--center">
        <Spin />
      </div>
    );
  }

  return (
    <div className="captcha-assist-page">
      <header className="captcha-assist-header">
        <div>
          <Title level={3}>验证码协助处理</Title>
          <Space size={8} wrap>
            {incident ? <Tag color={STATUS_COLOR[incident.status]}>{labelOf(STATUS_LABEL, incident.status)}</Tag> : null}
            {liveActive ? <Tag color="processing">实时</Tag> : null}
            {incident?.riskStatus ? <Tag>{incident.riskStatus}</Tag> : null}
            {incident?.accountName || incident?.accountId ? <Text type="secondary">{incident.accountName ?? incident.accountId}</Text> : null}
            {incident?.edgeId ? <Text type="secondary">{incident.edgeId}</Text> : null}
            {incident?.machineLabel ? <Text type="secondary">{incident.machineLabel}</Text> : null}
          </Space>
        </div>
        <Space wrap>
          <Button icon={<ClearOutlined />} onClick={adoptLatest} disabled={points.length === 0 || busy}>
            清空
          </Button>
          {incident?.remoteAddr ? (
            <Button icon={<ExportOutlined />} href={incident.remoteAddr} target="_blank" rel="noreferrer">
              远程桌面
            </Button>
          ) : null}
          <Button icon={<ReloadOutlined />} onClick={() => void refresh()} loading={busy}>
            刷新
          </Button>
          <Button type="primary" icon={<SendOutlined />} onClick={() => void submit()} disabled={!displaySnapshot || points.length === 0 || busy} loading={busy}>
            提交
          </Button>
        </Space>
      </header>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {newerFrameAvailable ? (
        <Alert
          type="warning"
          showIcon
          message="画面已更新，挑战可能已变"
          description="你正在一张较早的截图上选点。若挑战已换新题，请先看最新画面再重选。"
          action={
            <Button size="small" onClick={adoptLatest}>
              看最新画面
            </Button>
          }
        />
      ) : null}

      <section className="captcha-assist-meta">
        <Text type="secondary">点位 {points.length}/2</Text>
        {incident?.lastResult ? <Text type="secondary">上次复检：{incident.lastResult.status}</Text> : null}
        {incident?.machineLabel ? <Text type="secondary">机器：{incident.machineLabel}</Text> : null}
        {incident?.url ? <Text className="captcha-assist-url" type="secondary">{incident.url}</Text> : null}
      </section>

      <section className="captcha-assist-workbench">
        {displaySnapshot ? (
          <div className="captcha-assist-stage" onClick={onImageClick} onPointerMove={onPointerMove}>
            <img src={imageSrc} alt="captcha challenge" draggable={false} />
            {points.map((point, index) => (
              <span
                key={`${point.x}-${point.y}-${index}`}
                className="captcha-assist-point"
                style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
              >
                {index + 1}
              </span>
            ))}
          </div>
        ) : (
          <div className="captcha-assist-empty">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无截图" />
          </div>
        )}
      </section>
    </div>
  );
}
