import type { HomeAssistant, Review, Severity } from '../types';

/** The Frigate integration returns most REST passthroughs as a raw JSON string. */
function parseJson<T>(value: unknown): T {
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
}

function toSeconds(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const n = Number(value);
  if (!Number.isNaN(n)) return n;
  const d = Date.parse(String(value));
  return Number.isNaN(d) ? null : d / 1000;
}

interface RawReview {
  id: string;
  camera: string;
  start_time: number | string;
  end_time: number | string | null;
  severity: Severity;
  thumb_path: string;
  data?: {
    objects?: string[];
    sub_labels?: string[];
    zones?: string[];
    detections?: string[];
  };
  has_been_reviewed?: boolean | number;
}

export function normalizeReview(raw: RawReview, reviewedFallback = false): Review {
  const objects = Array.from(
    new Set((raw.data?.objects ?? []).map((o) => o.replace(/-verified$/, ''))),
  );
  return {
    id: raw.id,
    camera: raw.camera,
    start: toSeconds(raw.start_time) ?? 0,
    end: toSeconds(raw.end_time),
    severity: raw.severity,
    thumbPath: raw.thumb_path ?? '',
    objects,
    subLabels: Array.from(new Set(raw.data?.sub_labels ?? [])),
    zones: raw.data?.zones ?? [],
    detections: raw.data?.detections ?? [],
    reviewed:
      raw.has_been_reviewed === undefined ? reviewedFallback : Boolean(raw.has_been_reviewed),
  };
}

const seg = (v: string): string => encodeURIComponent(v);
const ts = (v: number): string => String(Math.max(0, Math.floor(v)));

/** Paths the card may attach credentials to: this instance's Frigate proxy only. */
export function isFrigateProxyPath(instanceId: string, path: string): boolean {
  return path.startsWith(`/api/frigate/${seg(instanceId)}/`) && !/(^|\/)\.\.?(\/|$)/.test(path);
}

/** One path point: normalized [x, y] of the object's bottom-centre, and its frame time. */
export type PathPoint = [[number, number], number];

export interface FrigateEvent {
  id: string;
  camera: string;
  label: string;
  sub_label: string | null;
  start_time: number;
  end_time: number | null;
  has_snapshot?: boolean;
  plus_id?: string | null;
  false_positive?: boolean | null;
  top_score?: number | null;
  data?: {
    sub_label_score?: number | null;
    score?: number;
    top_score?: number;
    /** normalized [x, y, w, h] of the best box */
    box?: [number, number, number, number];
    path_data?: PathPoint[];
  };
}

export interface RecordingSegment {
  start: number;
  end: number;
  motion: number;
  objects: number;
}

interface ReviewMessage {
  type: 'new' | 'update' | 'end';
  after: RawReview;
}

export class FrigateApi {
  constructor(
    private readonly getHass: () => HomeAssistant,
    readonly instanceId: string,
  ) {}

  private get hass(): HomeAssistant {
    return this.getHass();
  }

  async getReviews(cameras: string[], after: number, before: number): Promise<Review[]> {
    const result = await this.hass.callWS<unknown>({
      type: 'frigate/reviews/get',
      instance_id: this.instanceId,
      cameras,
      after,
      before,
    });
    return parseJson<RawReview[]>(result).map((r) => normalizeReview(r));
  }

  async setViewed(ids: string[], viewed: boolean): Promise<void> {
    if (!ids.length) return;
    await this.hass.callWS({
      type: 'frigate/reviews/viewed',
      instance_id: this.instanceId,
      ids,
      viewed,
    });
  }

  /** Live review updates (new / update / end), forwarded from Frigate's MQTT reviews topic. */
  subscribeReviews(callback: (review: Review) => void): Promise<() => Promise<void>> {
    return this.hass.connection.subscribeMessage<unknown>(
      (message) => {
        try {
          const parsed = parseJson<ReviewMessage>(message);
          if (parsed?.after?.id) callback(normalizeReview(parsed.after, false));
        } catch (err) {
          console.warn('frigate-timeline-card: unreadable review message', err);
        }
      },
      { type: 'frigate/reviews/subscribe', instance_id: this.instanceId },
    );
  }

  async getEvents(camera: string, after: number, before: number): Promise<FrigateEvent[]> {
    const result = await this.hass.callWS<unknown>({
      type: 'frigate/events/get',
      instance_id: this.instanceId,
      cameras: [camera],
      after: Math.floor(after),
      before: Math.ceil(before),
      limit: 100,
    });
    return parseJson<FrigateEvent[]>(result);
  }

  async getRecordings(camera: string, after: number, before: number): Promise<RecordingSegment[]> {
    const result = await this.hass.callWS<unknown>({
      type: 'frigate/recordings/get',
      instance_id: this.instanceId,
      camera,
      after: Math.floor(after),
      before: Math.ceil(before),
    });
    const rows = parseJson<
      { start_time: number; end_time: number; motion?: number; objects?: number }[]
    >(result);
    return rows.map((r) => ({
      start: r.start_time,
      end: r.end_time,
      motion: r.motion ?? 0,
      objects: r.objects ?? 0,
    }));
  }

  // ---------- Media paths (all served by the integration's authenticated proxies) ----------

  /** Base directory of a VOD window; segments live under it. */
  vodBase(camera: string, start: number, end: number): string {
    return `/api/frigate/${seg(this.instanceId)}/vod/${seg(camera)}/start/${ts(start)}/end/${ts(Math.ceil(end))}`;
  }

  vodPath(camera: string, start: number, end: number): string {
    return `${this.vodBase(camera, start, end)}/index.m3u8`;
  }

  clipPath(camera: string, start: number, end: number): string {
    return `/api/frigate/${seg(this.instanceId)}/recording/${seg(camera)}/start/${ts(start)}/end/${ts(Math.ceil(end))}`;
  }

  /**
   * Review thumbnail via the integration's clips proxy. thumb_path comes from Frigate
   * (and from MQTT for live items), so it is treated as untrusted: only a plain
   * relative file path under clips/ is accepted, each segment URL-encoded.
   */
  /** Event snapshot with Frigate's bounding box drawn on it. */
  snapshotPath(eventId: string): string | null {
    if (!/^[\w.-]+$/.test(eventId)) return null;
    return `/api/frigate/${seg(this.instanceId)}/snapshot/${seg(eventId)}?bbox=1&height=360`;
  }

  reviewThumbPath(review: Review): string | null {
    const marker = '/clips/';
    const idx = review.thumbPath.indexOf(marker);
    if (idx < 0) return null;
    const parts = review.thumbPath.slice(idx + marker.length).split('/');
    if (!parts.length || parts.some((p) => !p || p === '.' || p === '..' || !/^[\w.@-]+$/.test(p))) return null;
    return `/api/frigate/${seg(this.instanceId)}/clips/${parts.map(seg).join('/')}`;
  }

  async signPath(path: string, expires = 3600): Promise<string> {
    if (!isFrigateProxyPath(this.instanceId, path)) throw new Error('refusing to sign a non-Frigate path');
    const res = await this.hass.callWS<{ path: string }>({
      type: 'auth/sign_path',
      path,
      expires,
    });
    return this.hass.hassUrl(res.path);
  }
}
