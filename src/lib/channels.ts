import type { NotifyStyle } from './types';

/**
 * Android 알림 채널은 만든 뒤 소리/진동을 바꿀 수 없어서 방식마다 채널을 따로 둔다.
 * (사용자가 시스템 설정에서 채널을 바꿨다면 그 설정이 우선이다)
 */
export interface ChannelDef {
  id: string;
  name: string;
  description: string;
  importance: 'HIGH' | 'LOW';
  /** null = 소리 없음, 'default' = 기본 알림음 */
  sound: 'default' | null;
  vibration: number[] | null;
  /** 잠금화면 표시: 'public' 전체 내용 */
  visibility: 'public' | 'private';
}

export const CHANNELS: Record<NotifyStyle, ChannelDef> = {
  sound: { id: 'routine-sound', name: '루틴 알림 · 소리', description: '소리와 진동으로 알려요', importance: 'HIGH', sound: 'default', vibration: [0, 250, 250, 250], visibility: 'public' },
  vibrate: { id: 'routine-vibrate', name: '루틴 알림 · 진동', description: '소리 없이 진동으로만 알려요', importance: 'HIGH', sound: null, vibration: [0, 400, 200, 400], visibility: 'public' },
  silent: { id: 'routine-silent', name: '루틴 알림 · 조용히', description: '소리·진동 없이 알림창에만 표시해요', importance: 'LOW', sound: null, vibration: null, visibility: 'public' },
};

export const channelFor = (style: NotifyStyle) => CHANNELS[style].id;
export const DEFAULT_STYLE: NotifyStyle = 'vibrate';
export const isStyle = (s: unknown): s is NotifyStyle => s === 'sound' || s === 'vibrate' || s === 'silent';
/** 루틴의 방식(없으면 앱 기본값) */
export const effectiveStyle = (routineStyle: NotifyStyle | null | undefined, appDefault: NotifyStyle = DEFAULT_STYLE): NotifyStyle => routineStyle ?? appDefault;
