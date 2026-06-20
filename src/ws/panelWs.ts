import { useEffect, useRef, useState } from 'react';
import { getToken } from '../api/client';

/** 面板 WS 帧（与 cloud src/panel/panel-ws.ts 的 PanelFrame 对齐）。 */
export interface PanelFrame {
  ts: number;
  kind: string;
  data: unknown;
}

export type WsStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

/**
 * 订阅面板 WS（单一全局流 + 客户端过滤）。bounded ring buffer（最近 max 条，drop-oldest）；
 * 断连诚实显示 reconnecting + 自动重连；missed-while-down 不回填（单一全局流无 replay）。
 */
export function usePanelWs(max = 500) {
  const [frames, setFrames] = useState<PanelFrame[]>([]);
  const [status, setStatus] = useState<WsStatus>('connecting');
  const pausedRef = useRef(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: number | undefined;
    let closed = false;

    const connect = () => {
      const token = getToken();
      if (!token) {
        setStatus('offline');
        return;
      }
      const wsUrl = `${location.origin.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
      ws = new WebSocket(wsUrl);
      ws.onopen = () => setStatus('live');
      ws.onmessage = (e) => {
        if (pausedRef.current) return;
        try {
          const frame = JSON.parse(e.data as string) as PanelFrame;
          setFrames((prev) => [frame, ...prev].slice(0, max));
        } catch {
          /* 忽略坏帧 */
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setStatus('reconnecting');
        retry = window.setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [max]);

  return {
    frames,
    status,
    setPaused: (p: boolean) => {
      pausedRef.current = p;
    },
  };
}
