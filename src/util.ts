import type { CardConfig, HomeAssistant, LensRef, RangeKey, Review } from './types';

export const RANGE_SECONDS: Record<RangeKey, number> = {
  '1h': 3600,
  '6h': 6 * 3600,
  '24h': 24 * 3600,
  '7d': 7 * 24 * 3600,
};

export function nowSec(): number {
  return Date.now() / 1000;
}

export class TimeFormat {
  private time: Intl.DateTimeFormat;
  private timeSec: Intl.DateTimeFormat;
  private day: Intl.DateTimeFormat;
  private hourOnly: Intl.DateTimeFormat;
  private tz?: string;

  constructor(hass: HomeAssistant) {
    const lang = hass.locale?.language ?? hass.language ?? navigator.language;
    this.tz = hass.locale?.time_zone === 'server' ? hass.config.time_zone : undefined;
    const base = { timeZone: this.tz } as const;
    this.time = new Intl.DateTimeFormat(lang, { ...base, hour: 'numeric', minute: '2-digit' });
    this.timeSec = new Intl.DateTimeFormat(lang, { ...base, hour: 'numeric', minute: '2-digit', second: '2-digit' });
    this.day = new Intl.DateTimeFormat(lang, { ...base, weekday: 'short', month: 'short', day: 'numeric' });
    this.hourOnly = new Intl.DateTimeFormat(lang, { ...base, hour: 'numeric' });
  }

  t(sec: number): string {
    return this.time.format(sec * 1000);
  }
  ts(sec: number): string {
    return this.timeSec.format(sec * 1000);
  }
  d(sec: number): string {
    return this.day.format(sec * 1000);
  }
  h(sec: number): string {
    return this.hourOnly.format(sec * 1000);
  }
  /** Key that groups timestamps by local calendar hour. */
  hourKey(sec: number): string {
    return `${this.day.format(sec * 1000)} ${this.hourOnly.format(sec * 1000)}`;
  }
}

export function fmtDuration(review: Review): string {
  if (review.end === null) return 'In progress';
  const total = Math.max(0, Math.round(review.end - review.start));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function fmtOffset(seconds: number): string {
  const sign = seconds < 0 ? '−' : '+';
  const a = Math.abs(Math.round(seconds));
  return a >= 60 ? `${sign}${Math.floor(a / 60)}m ${a % 60}s` : `${sign}${a}s`;
}

/** Pick a tick step that gives roughly 6–10 ticks across the span. */
export function tickStep(span: number): number {
  const steps = [600, 1800, 3600, 2 * 3600, 3 * 3600, 6 * 3600, 12 * 3600, 24 * 3600];
  return steps.find((s) => span / s <= 10) ?? 24 * 3600;
}

export function ticks(start: number, end: number): number[] {
  const step = tickStep(end - start);
  // Align to local midnight-relative boundaries using the browser offset.
  const offset = new Date(start * 1000).getTimezoneOffset() * 60;
  const first = Math.ceil((start - offset) / step) * step + offset;
  const out: number[] = [];
  for (let t = first; t <= end; t += step) out.push(t);
  return out;
}

export function buildLensIndex(config: CardConfig): Map<string, LensRef> {
  const idx = new Map<string, LensRef>();
  config.cameras.forEach((location, locIndex) =>
    location.lenses.forEach((lens, lensIndex) =>
      idx.set(lens.camera, { location, lens, locIndex, lensIndex }),
    ),
  );
  return idx;
}

/** Display name of the person in a review: a configured/recognised face, 'Unknown', or null for non-person. */
export function faceOf(review: Review, knownFaces: Set<string> | null): string | null {
  const faces = review.subLabels.filter((s) => (knownFaces ? knownFaces.has(s) : true));
  if (faces.length) return faces[0];
  return review.objects.includes('person') ? 'Unknown' : null;
}

export function reviewTitle(review: Review, knownFaces: Set<string> | null): string {
  const face = faceOf(review, knownFaces);
  if (face && face !== 'Unknown') return face;
  if (face === 'Unknown') return 'Unknown person';
  const obj = review.objects[0] ?? (review.severity === 'alert' ? 'Alert' : 'Detection');
  return obj.charAt(0).toUpperCase() + obj.slice(1).replace(/_/g, ' ');
}

const FACE_PALETTE = ['#4db6ac', '#f48fb1', '#9fa8da', '#ffcc80', '#a5d6a7', '#ce93d8', '#80deea', '#ef9a9a'];

export function faceColor(name: string, config: CardConfig): string {
  const configured = config.faces?.find((f) => f.name === name)?.color;
  if (configured) return configured;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return FACE_PALETTE[h % FACE_PALETTE.length];
}
