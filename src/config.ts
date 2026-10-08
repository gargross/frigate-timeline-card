import type { CardConfig, LensConfig, LocationConfig, RangeKey } from './types';

const RANGES: RangeKey[] = ['1h', '6h', '24h', '7d'];

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

  return {
    type: String(c.type),
    frigate_instance_id: typeof c.frigate_instance_id === 'string' ? c.frigate_instance_id : 'frigate',
    frigate_url: typeof c.frigate_url === 'string' ? c.frigate_url.replace(/\/$/, '') : undefined,
    default_range: range ?? '6h',
    cameras,
    security,
    faces: Array.isArray(c.faces)
      ? (c.faces as unknown[]).map((f) =>
          typeof f === 'string' ? { name: f } : (f as { name: string; color?: string; image?: string }),
        )
      : undefined,
    motion: c.motion !== false,
    mobile_breakpoint: typeof c.mobile_breakpoint === 'number' ? c.mobile_breakpoint : 720,
    colors: (c.colors as CardConfig['colors']) ?? {},
  };
}
