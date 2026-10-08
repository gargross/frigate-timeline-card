// Minimal Home Assistant frontend types used by the card.

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

export interface HassConnection {
  subscribeMessage<T>(
    callback: (message: T) => void,
    subscribeMessage: Record<string, unknown>,
  ): Promise<() => Promise<void>>;
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  connection: HassConnection;
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
  hassUrl(path?: string): string;
  fetchWithAuth?: (path: string, init?: RequestInit) => Promise<Response>;
  auth: { data: { access_token: string } };
  locale?: { language?: string; time_zone?: string };
  language?: string;
  config: { time_zone: string };
}

// ---------- Card configuration ----------

export interface LensConfig {
  camera: string;
  label?: string;
  entity?: string;
}

export interface LocationConfig {
  name: string;
  lenses: LensConfig[];
}

export interface SecurityLaneConfig {
  name: string;
  entities: string[];
  /** binary_sensors whose 'on' state is drawn as a tamper marker on this lane */
  tamper?: string[];
  /** Frigate camera most likely to see activity at this entry point */
  camera?: string;
}

export interface FaceConfig {
  name: string;
  color?: string;
  image?: string;
}

export type RangeKey = '1h' | '6h' | '24h' | '7d';

export interface CardConfig {
  type: string;
  frigate_instance_id?: string;
  frigate_url?: string;
  default_range?: RangeKey;
  cameras: LocationConfig[];
  security?: SecurityLaneConfig[];
  faces?: FaceConfig[];
  motion?: boolean;
  mobile_breakpoint?: number;
  colors?: { alert?: string; detection?: string; security?: string; tamper?: string };
}

// ---------- Normalised data ----------

export type Severity = 'alert' | 'detection';

export interface Review {
  id: string;
  camera: string;
  start: number; // epoch seconds
  end: number | null; // null = in progress
  severity: Severity;
  thumbPath: string;
  objects: string[];
  subLabels: string[];
  zones: string[];
  detections: string[];
  reviewed: boolean;
}

/** A single change on a security entity, or an interval while it was open/unlocked. */
export interface SecurityMark {
  lane: number;
  entityId: string;
  kind: 'interval' | 'point';
  start: number;
  end: number | null; // interval end; null = still open
  label: string;
  tone: 'normal' | 'tamper' | 'jammed';
}

export interface LensRef {
  locIndex: number;
  lensIndex: number;
  location: LocationConfig;
  lens: LensConfig;
}
