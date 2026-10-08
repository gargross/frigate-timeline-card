import type { HomeAssistant, SecurityLaneConfig, SecurityMark } from '../types';

interface StatePoint {
  t: number; // epoch seconds
  s: string;
}

type CompressedHistory = Record<string, { s: string; lu: number; lc?: number }[]>;

const OPEN_STATES: Record<string, Set<string>> = {
  binary_sensor: new Set(['on']),
  cover: new Set(['open', 'opening', 'closing']),
};

function domainOf(entityId: string): string {
  return entityId.split('.', 1)[0];
}

function friendly(hass: HomeAssistant, entityId: string): string {
  const name = hass.states[entityId]?.attributes?.friendly_name;
  return typeof name === 'string' ? name : entityId;
}

/**
 * Keeps a state timeline per security entity: seeded from the recorder
 * (history/history_during_period) and extended live from hass.states.
 */
export class SecurityHistory {
  private timelines = new Map<string, StatePoint[]>();
  private loaded: { start: number; end: number } | null = null;
  version = 0;

  constructor(private lanes: SecurityLaneConfig[]) {}

  setConfig(lanes: SecurityLaneConfig[]): void {
    this.lanes = lanes;
    this.timelines.clear();
    this.loaded = null;
    this.version++;
  }

  private get entityIds(): string[] {
    return Array.from(new Set(this.lanes.flatMap((l) => [...l.entities, ...(l.tamper ?? [])])));
  }

  covers(start: number, end: number): boolean {
    return !!this.loaded && this.loaded.start <= start && this.loaded.end >= end - 120;
  }

  async load(hass: HomeAssistant, start: number, end: number): Promise<void> {
    const ids = this.entityIds;
    if (!ids.length) return;
    const result = await hass.callWS<CompressedHistory>({
      type: 'history/history_during_period',
      start_time: new Date(start * 1000).toISOString(),
      end_time: new Date(end * 1000).toISOString(),
      entity_ids: ids,
      include_start_time_state: true,
      significant_changes_only: false,
      minimal_response: true,
      no_attributes: true,
    });
    for (const id of ids) {
      const rows = result[id] ?? [];
      this.timelines.set(
        id,
        rows.map((r) => ({ t: r.lu ?? r.lc ?? start, s: r.s })).sort((a, b) => a.t - b.t),
      );
    }
    this.loaded = { start, end };
    this.version++;
  }

  /** Append live changes from hass.states. Returns true if anything changed. */
  ingest(hass: HomeAssistant): boolean {
    if (!this.loaded) return false;
    let changed = false;
    for (const id of this.entityIds) {
      const st = hass.states[id];
      if (!st) continue;
      const t = Date.parse(st.last_changed) / 1000;
      const line = this.timelines.get(id) ?? [];
      const last = line[line.length - 1];
      if (!last || (t > last.t && st.state !== last.s)) {
        line.push({ t, s: st.state });
        this.timelines.set(id, line);
        changed = true;
      }
    }
    if (changed) this.version++;
    return changed;
  }

  marks(hass: HomeAssistant): SecurityMark[] {
    const out: SecurityMark[] = [];

    this.lanes.forEach((lane, laneIdx) => {
      for (const id of lane.entities) {
        const line = this.timelines.get(id) ?? [];
        const domain = domainOf(id);
        const name = friendly(hass, id);

        if (domain === 'lock') {
          for (let i = 0; i < line.length; i++) {
            const p = line[i];
            const prev = line[i - 1];
            if (!prev || prev.s === p.s) continue;
            if (p.s === 'unlocked' || p.s === 'open') {
              out.push({ lane: laneIdx, entityId: id, kind: 'point', start: p.t, end: null, label: `${name} unlocked`, tone: 'normal' });
            } else if (p.s === 'jammed') {
              out.push({ lane: laneIdx, entityId: id, kind: 'point', start: p.t, end: null, label: `${name} jammed`, tone: 'jammed' });
            } else if (p.s === 'locked' && prev.s !== 'locking') {
              out.push({ lane: laneIdx, entityId: id, kind: 'point', start: p.t, end: null, label: `${name} locked`, tone: 'normal' });
            }
          }
          continue;
        }

        const openSet = OPEN_STATES[domain];
        if (!openSet) continue;
        let openedAt: number | null = null;
        for (const p of line) {
          const isOpen = openSet.has(p.s);
          if (isOpen && openedAt === null) openedAt = p.t;
          if (!isOpen && openedAt !== null && p.s !== 'unavailable' && p.s !== 'unknown') {
            out.push({ lane: laneIdx, entityId: id, kind: 'interval', start: openedAt, end: p.t, label: `${name} open`, tone: 'normal' });
            openedAt = null;
          }
        }
        if (openedAt !== null) {
          out.push({ lane: laneIdx, entityId: id, kind: 'interval', start: openedAt, end: null, label: `${name} open`, tone: 'normal' });
        }
      }
    });

    this.lanes.forEach((lane, laneIdx) => {
      for (const id of lane.tamper ?? []) {
        const line = this.timelines.get(id) ?? [];
        const name = friendly(hass, id);
        for (let i = 0; i < line.length; i++) {
          const p = line[i];
          const prev = line[i - 1];
          if (p.s === 'on' && (!prev || prev.s !== 'on')) {
            out.push({ lane: laneIdx, entityId: id, kind: 'point', start: p.t, end: null, label: `${name}: tamper`, tone: 'tamper' });
          }
        }
      }
    });

    return out.sort((a, b) => a.start - b.start);
  }
}
