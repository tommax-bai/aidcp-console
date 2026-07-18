import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { App as AntApp, Alert, Button, Checkbox, Empty, Input, Result, Space, Spin, Tag, Typography } from 'antd';
import { ClearOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { useParams, useSearchParams } from 'react-router-dom';
import type { CaptchaAssistIncident, CaptchaAssistTypeReport } from '../types/api';
import { labelOf } from '../types/aidcp-enums';

const { Text, Title } = Typography;

type AssistPoint = { x: number; y: number };

/** 答案长度上界（与 edge/cloud 的 24 一致；仅作输入框 maxLength 前端提示，真校验在两端）。 */
const CAPTCHA_TEXT_MAX_LEN = 24;

// 「上次复检」状态的人话表（change captcha-assist-text-answer，8.8）：原为裸打英文枚举、无表 ⇒ 新增的
// no_target 本会从这个洞溜走。建 Record 才有守卫——union 一加成员 typecheck 立刻红。
const LAST_RESULT_LABEL: Record<NonNullable<CaptchaAssistIncident['lastResult']>['status'], string> = {
  cleared: '已清除',
  still_blocked: '仍阻断',
  stale_snapshot: '画面已过期',
  not_blocked: '未见阻断',
  invalid_target: '落点无效',
  no_target: '没点到输入框',
  failed: '失败',
};

// 提交失败原因的人话表：能力/畸形类拒绝码绝不裸打英文给运营（8.9）。表外原因回落原文。
const REASON_MESSAGE: Record<string, string> = {
  edge_lacks_text_capability: '该机器客户端版本过旧，不支持远程输入。请更新运营机上的客户端后再试。',
  edge_capability_unknown: '该机器当前不在线或连接状态未知，暂时无法远程输入。',
  invalid_text: '答案不合法：仅支持 1–24 个可见 ASCII 字符（数字/字母/常见标点）。',
  text_requires_single_focus_point: '键入答案时只能在截图上点中 1 个输入框。',
};

function humanizeReason(reason: string): string {
  return REASON_MESSAGE[reason] ?? reason;
}

/**
 * 键入取证渲染成一句人话 + 展示语义（change captcha-assist-text-answer，8.9，整个 change 的用户价值兑现点）。
 * 运营 MUST 能区分「答案打错了」与「字根本没打进去」。
 */
function describeTypeReport(
  report: CaptchaAssistTypeReport,
  textNotExecuted: boolean | undefined,
): { text: string; type: 'success' | 'info' | 'warning' | 'error' } {
  if (textNotExecuted) {
    return { text: '该机器客户端版本过旧，键入未执行（只发生了点击）。请更新客户端。', type: 'error' };
  }
  if (report.focus === 'none') {
    return { text: '那一点没点到输入框，未键入任何字符。请在截图上点中输入框再键入。', type: 'error' };
  }
  if (report.verified === 'unverifiable' || report.focus === 'opaque') {
    return { text: '焦点在跨源/不可读元素内，无法证明字符已落入；请对照新画面确认。', type: 'warning' };
  }
  if (report.verified === 'mismatch') {
    return { text: '字打进去了，但读回的内容与答案不一致（可能答案不对，或输入框吃字异常）。', type: 'warning' };
  }
  if (report.verified === 'match') {
    return { text: `答案已键入并回读匹配${report.submitted ? '、已回车提交' : ''}。`, type: 'success' };
  }
  return { text: `已键入 ${report.typed} 个字符${report.submitted ? '、已回车提交' : ''}。`, type: 'info' };
}

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
  // 验证码答案（change captcha-assist-text-answer）：只进已聚焦元素、仅 ASCII 可见字符、≤24。绝不进 URL/localStorage。
  const [text, setText] = useState('');
  // 「回车提交」默认开（8.5）；仅在有答案时生效。不提供「点第 2 个点提交」——聚焦滚动会让旧坐标失效。
  const [submitOnEnter, setSubmitOnEnter] = useState(true);
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
  // 冻结中显示被 pin 的帧，否则跟随最新帧。pin 触发扩到首次键入（8.6）：使「画面已更新」Alert 在打字期照常生效。
  const frozen = (points.length > 0 || text.length > 0) && pinned != null;
  // 键入模式：恰好 1 个落点时答案框可用（8.4）。text 非空即锁死单点（不许再放第 2 个点）。
  const answerEnabled = points.length === 1;
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

  // 解冻并采纳最新帧：清点 + 清答案 + 取消 pin + 重置轨迹（不发服务端请求，直接用已轮询到的最新帧）。
  const adoptLatest = () => {
    setPoints([]);
    setText('');
    setPinned(null);
    resetTrajectory();
  };

  const onImageClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!canClick) return;
    // 键入模式（text 非空）锁死单点：聚焦滚动会让第 2 个点失效（design D4/8.4）。否则点选类最多 2 点。
    const maxPoints = text.length > 0 ? 1 : 2;
    if (points.length >= maxPoints) return;
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
    // 键入模式（有答案）纵深校验：必须恰好 1 个落点（真校验在两端，这里只挡住明显误用）。
    const hasAnswer = text.length > 0;
    if (hasAnswer && points.length !== 1) {
      setError(humanizeReason('text_requires_single_focus_point'));
      return;
    }
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
        // 答案只进 body（JSON），绝不进 URL / localStorage（design D10）。空则整字段省略（与 trajectory 同「全有或全无」）。
        body: JSON.stringify({
          snapshotId: displaySnapshot.snapshotId,
          points,
          ...(trajectory ? { trajectory } : {}),
          ...(hasAnswer ? { text, ...(submitOnEnter ? { submit: 'enter' as const } : {}) } : {}),
        }),
      });
      if (!res.ok) throw new Error(humanizeReason(await readError(res)));
      const body = (await res.json()) as { incident: CaptchaAssistIncident };
      setIncident(body.incident);
      setPoints([]);
      // 提交成功即清空答案 state（明文答案不驻留）。
      setText('');
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
          <Button icon={<ClearOutlined />} onClick={adoptLatest} disabled={(points.length === 0 && text.length === 0) || busy}>
            清空
          </Button>
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

      {/* 键入取证渲染成人话（8.9，用户价值兑现点）：运营 MUST 能区分「答案打错了」与「字根本没打进去」。 */}
      {incident?.lastResult && (incident.lastResult.typeReport || incident.lastResult.textNotExecuted) ? (() => {
        const desc = describeTypeReport(
          incident.lastResult.typeReport ?? { focus: 'none', typed: 0, submitted: false },
          incident.lastResult.textNotExecuted,
        );
        return <Alert type={desc.type} showIcon message="键入结果" description={desc.text} />;
      })() : null}

      {/* 键入答案（change captcha-assist-text-answer）：模糊数字图片类字符识别码在协助页上键入答案 + 回车提交。
          不变量长在控件上（8.4）：答案框 disabled 直到恰好 1 个落点。授权面不变（design D9）——不挂 Bearer、不感知登录态。 */}
      <section className="captcha-assist-answer">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!answerEnabled || busy}
          maxLength={CAPTCHA_TEXT_MAX_LEN}
          placeholder={answerEnabled ? '在此键入验证码答案（1–24 个可见字符），回车或点「提交」下发' : '先在截图上点中输入框，再在此键入答案'}
          onPressEnter={() => { if (answerEnabled && text.length > 0 && !busy) void submit(); }}
          aria-label="验证码答案"
        />
        <Checkbox checked={submitOnEnter} onChange={(e) => setSubmitOnEnter(e.target.checked)}>
          键入后回车提交
        </Checkbox>
      </section>

      <section className="captcha-assist-meta">
        <Text type="secondary">点位 {points.length}/{text.length > 0 ? 1 : 2}</Text>
        {incident?.lastResult ? (
          <Text type="secondary">上次复检：{labelOf(LAST_RESULT_LABEL, incident.lastResult.status)}</Text>
        ) : null}
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
