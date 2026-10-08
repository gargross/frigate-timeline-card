import type { CardConfig, LensConfig, LocationConfig, RangeKey } from './types';

const RANGES: RangeKey[] = ['1h', '6h', '24h', '7d'];

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([\d\s.,%/+-]+\)|var\(--[\w-]+\)|[a-z]+)$/i;

function color(v: unknown, where: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !SAFE_COLOR.test(v.trim())) fail(`${where} is not a valid color`);
  return (v as string).trim();
}

/** http(s) URL or same-origin absolute path; anything else (javascript:, data:, quotes) is rejected. */
function safeUrl(v: unknown, where: string, allowPath: boolean): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || /["'()\s\\]/.test(v)) fail(`${where} is not a valid URL`);
  const s = v as string;
  if (allowPath && s.startsWith('/') && !s.startsWith('//')) return s;
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return s;
  } catch {
    /* fall through */
  }
  fail(`${where} must be an http(s) URL${allowPath ? ' or a /local/... path' : ''}`);
}

function fail(msg: string): never {
  throw new Error(`frigate-timeline-card: ${msg}`);
}

/** Validate and normalise user YAML. Throws with a readable message on bad config. */
export function normalizeConfig(raw: unknown): CardConfig {
  if (!raw || typeof raw !== 'object') fail('invalid configuration');
  const c = raw as Record<string, unknown>;

  if (!Array.isArray(c.cameras) || !c.cameras.length) fail('`cameras` must be a non-empty list');

  const cameras: LocationConfig[] = (c.cameras as unknown[]).map((loc, i) => {
    if (!loc || typeof loc !== 'object') fail(`cameras[${i}] must be an object`);
    const l = loc as Record<string, unknown>;
    let lenses: LensConfig[];
    if (Array.isArray(l.lenses)) {
      lenses = (l.lenses as unknown[]).map((lens, j) => {
        const o = lens as Record<string, unknown>;
        if (!o || typeof o.camera !== 'string') fail(`cameras[${i}].lenses[${j}].camera is required`);
        return {
          camera: o.camera,
          label: typeof o.label === 'string' ? o.label : undefined,
          entity: typeof o.entity === 'string' ? o.entity : undefined,
        };
      });
    } else if (typeof l.camera === 'string') {
      lenses = [{ camera: l.camera, entity: typeof l.entity === 'string' ? l.entity : undefined }];
    } else {
      fail(`cameras[${i}] needs either \`camera\` or \`lenses\``);
    }
    if (!lenses.length) fail(`cameras[${i}].lenses is empty`);
    return { name: typeof l.name === 'string' ? l.name : lenses[0].camera, lenses };
  });

  const seen = new Set<string>();
  for (const lens of cameras.flatMap((x) => x.lenses)) {
    if (seen.has(lens.camera)) fail(`Frigate camera \`${lens.camera}\` is listed twice`);
    seen.add(lens.camera);
  }

  const security = Array.isArray(c.security)
    ? (c.security as unknown[]).map((lane, i) => {
        const o = lane as Record<string, unknown>;
        if (!o || typeof o.name !== 'string') fail(`security[${i}].name is required`);
        const entities = Array.isArray(o.entities) ? (o.entities as unknown[]).map(String) : [];
        const tamper = Array.isArray(o.tamper) ? (o.tamper as unknown[]).map(String) : undefined;
        if (!entities.length && !tamper?.length) fail(`security[${i}] needs \`entities\` or \`tamper\``);
        return { name: o.name, entities, tamper, camera: typeof o.camera === 'string' ? o.camera : undefined };
      })
    : [];

  const range = c.default_range as RangeKey | undefined;
  if (range !== undefined && !RANGES.includes(range)) fail(`default_range must be one of ${RANGES.join(', ')}`);

  const instance = c.frigate_instance_id ?? 'frigate';
  if (typeof instance !== 'string' || !/^[\w.-]+$/.test(instance)) fail('frigate_instance_id may contain only letters, digits, _ . -');
  const colorsIn = (c.colors ?? {}) as Record<string, unknown>;
  const faces = Array.isArray(c.faces)
    ? (c.faces as unknown[]).map((f, i) => {
        if (typeof f === 'string') return { name: f };
        const o = f as Record<string, unknown>;
        if (!o || typeof o.name !== 'string') fail(`faces[${i}].name is required`);
        return {
          name: o.name as string,
          color: color(o.color, `faces[${i}].color`),
          image: safeUrl(o.image, `faces[${i}].image`, true),
        };
      })
    : undefined;

  return {
    type: String(c.type),
    frigate_instance_id: instance,
    frigate_url: safeUrl(c.frigate_url, 'frigate_url', false)?.replace(/\/$/, ''),
    default_range: range ?? '6h',
    cameras,
    security,
    faces,
    motion: c.motion !== false,
    mobile_breakpoint: typeof c.mobile_breakpoint === 'number' ? c.mobile_breakpoint : 720,
    colors: {
      alert: color(colorsIn.alert, 'colors.alert'),
      detection: color(colorsIn.detection, 'colors.detection'),
      security: color(colorsIn.security, 'colors.security'),
      tamper: color(colorsIn.tamper, 'colors.tamper'),
    },
  };
}
