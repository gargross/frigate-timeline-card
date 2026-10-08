import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { normalizeConfig } from './config';
import { FrigateApi, type RecordingSegment } from './data/frigate';
import { SecurityHistory } from './data/security';
import { cardStyles } from './styles';
import type { CardConfig, HomeAssistant, LensRef, RangeKey, Review, SecurityMark, Severity } from './types';
import {
  RANGE_SECONDS,
  TimeFormat,
  buildLensIndex,
  faceColor,
  faceOf,
  fmtDuration,
  fmtOffset,
  nowSec,
  reviewTitle,
  ticks,
} from './util';
import './components/auth-img';
import './components/player';
import type { FtcPlayer } from './components/player';

const VERSION = '0.2.2';
const RELATED_WINDOW = 300; // seconds either side of a review for "security events nearby"
const MOMENT_WINDOW = 90; // seconds either side for "same moment, other cameras"
const MOTION_MAX_SPAN = 6 * 3600;
const MOTION_BINS = 120;
const FEED_LIMIT = 150;
const SYNC_MAX_FOLLOWERS = 8;
const SYNC_DRIFT = 0.5; // seconds a follower may drift before it is re-seeked
const SYNC_KEY = 'frigate-timeline-card:sync';
const UNDO_MS = 10_000;

/** What the player is showing: a review, or an arbitrary moment on one camera. */
type Playback =
  | { kind: 'review'; review: Review; camera: string }
  | { kind: 'moment'; camera: string; start: number; end: number };

interface Lane {
  key: string;
  title: string;
  sub: boolean;
  locIndex: number;
  cameras: string[]; // cameras whose reviews draw on this lane
  playCamera: string; // camera a click on empty track plays
  expandable: boolean;
  expanded: boolean;
  lensCount: number;
}

export class FrigateTimelineCard extends LitElement {
  static styles = cardStyles;

  static properties = {
    _config: { state: true },
    _reviews: { state: true },
    _span: { state: true },
    _follow: { state: true },
    _winEnd: { state: true },
    _selId: { state: true },
    _playback: { state: true },
    _sev: { state: true },
    _unrevOnly: { state: true },
    _face: { state: true },
    _expanded: { state: true },
    _narrow: { state: true },
    _error: { state: true },
    _motion: { state: true },
    _scores: { state: true },
    _secVersion: { state: true },
    _tick: { state: true },
    _sync: { state: true },
    _undo: { state: true },
    _playT: { state: true },
    _resumeAt: { state: true },
    _recorded: { state: true },
  };

  declare _config: CardConfig;
  declare _reviews: Map<string, Review>;
  declare _span: number;
  declare _follow: boolean;
  declare _winEnd: number;
  declare _selId: string | null;
  declare _playback: Playback | null;
  declare _sev: 'all' | Severity;
  declare _unrevOnly: boolean;
  declare _face: string | null;
  declare _expanded: Set<number>;
  declare _narrow: boolean;
  declare _error: string | null;
  declare _motion: Map<string, RecordingSegment[]>;
  declare _scores: Map<string, number | null>;
  declare _secVersion: number;
  declare _tick: number;
  declare _sync: boolean;
  declare _undo: { ids: string[]; viewed: boolean; text: string } | null;
  declare _playT: number | null;
  declare _resumeAt: number | null;
  /** camera → has recent recording segments (false = detect-only / not recording). */
  declare _recorded: Map<string, boolean>;

  private _hass?: HomeAssistant;
  private api?: FrigateApi;
  private security = new SecurityHistory([]);
  private lensIndex = new Map<string, LensRef>();
  private fmt?: TimeFormat;
  private loadedFrom: number | null = null;
  private loadingReviews = false;
  private unsub: (() => Promise<void>) | null = null;
  private subscribing = false;
  private securityLoading = false;
  private resizeObs?: ResizeObserver;
  private timer?: number;
  private motionKey = '';
  private drag: { x: number; end: number; moved: boolean; width: number } | null = null;
  private suppressClick = false;
  private syncTimer?: number;
  private undoTimer?: number;

  constructor() {
    super();
    this._reviews = new Map();
    this._span = RANGE_SECONDS['6h'];
    this._follow = true;
    this._winEnd = nowSec();
    this._selId = null;
    this._playback = null;
    this._sev = 'all';
    this._unrevOnly = false;
    this._face = null;
    this._expanded = new Set();
    this._narrow = false;
    this._error = null;
    this._motion = new Map();
    this._scores = new Map();
    this._secVersion = 0;
    this._tick = 0;
    this._undo = null;
    this._playT = null;
    this._resumeAt = null;
    this._recorded = new Map();
    let sync = false;
    try {
      sync = localStorage.getItem(SYNC_KEY) === '1';
    } catch {
      /* storage unavailable */
    }
    this._sync = sync;
  }

  // ---------------------------------------------------------------- HA API

  static getStubConfig(): Record<string, unknown> {
    return {
      cameras: [{ name: 'Front', lenses: [{ camera: 'front' }] }],
    };
  }

  setConfig(raw: unknown): void {
    const config = normalizeConfig(raw);
    this._config = config;
    this._span = RANGE_SECONDS[config.default_range ?? '6h'];
    this.lensIndex = buildLensIndex(config);
    this.security.setConfig(config.security ?? []);
    this._reviews = new Map();
    this.loadedFrom = null;
    this._selId = null;
    this._playback = null;
    this.motionKey = '';
    const colors = config.colors ?? {};
    const set = (name: string, v?: string) =>
      v ? this.style.setProperty(name, v) : this.style.removeProperty(name);
    set('--ftc-alert-color', colors.alert);
    set('--ftc-detection-color', colors.detection);
    set('--ftc-security-color', colors.security);
    set('--ftc-tamper-color', colors.tamper);
    if (this._hass) this.initApi();
  }

  set hass(hass: HomeAssistant) {
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      this.fmt = new TimeFormat(hass);
      if (this._config) this.initApi();
      this.requestUpdate();
      return;
    }
    if (this.security.ingest(hass)) this._secVersion = this.security.version;
  }

  get hass(): HomeAssistant {
    return this._hass as HomeAssistant;
  }

  getCardSize(): number {
    return 12;
  }

  getGridOptions() {
    return { columns: 'full', min_columns: 12 };
  }

  // ---------------------------------------------------------------- lifecycle

  connectedCallback(): void {
    super.connectedCallback();
    this.resizeObs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      const narrow = w > 0 && w < (this._config?.mobile_breakpoint ?? 720);
      if (narrow !== this._narrow) this._narrow = narrow;
    });
    this.resizeObs.observe(this);
    this.timer = window.setInterval(() => {
      if (this._follow) this._tick++;
    }, 30_000);
    if (this.api) void this.subscribe();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObs?.disconnect();
    window.clearInterval(this.timer);
    this.stopSyncLoop();
    window.clearTimeout(this.undoTimer);
    void this.unsubscribe();
  }

  private initApi(): void {
    if (!this._hass || !this._config) return;
    const hass = () => this._hass as HomeAssistant;
    this.api = new FrigateApi(hass, this._config.frigate_instance_id ?? 'frigate');
    void this.unsubscribe().then(() => this.subscribe());
    void this.ensureLoaded();
    void this.probeRecording();
  }

  /** Find cameras with no recent recording segments (e.g. detect-only lenses). */
  private async probeRecording(): Promise<void> {
    if (!this.api) return;
    const now = nowSec();
    const cams = this.allCameras();
    const results = await Promise.allSettled(cams.map((c) => this.api!.getRecordings(c, now - 900, now)));
    const next = new Map<string, boolean>();
    results.forEach((r, i) => {
      // Only mark "not recorded" on a definite empty answer; errors leave it unknown.
      if (r.status === 'fulfilled') next.set(cams[i], r.value.length > 0);
    });
    this._recorded = next;
    // Re-point the current playback if it landed on an unrecorded lens.
    if (this._playback && !this.isRecorded(this._playback.camera)) {
      this._playback = { ...this._playback, camera: this.playableCamera(this._playback.camera) };
    }
  }

  private isRecorded(camera: string): boolean {
    return this._recorded.get(camera) !== false;
  }

  /** The camera to actually play: itself if recorded, else a recorded lens at the same location. */
  private playableCamera(camera: string): string {
    if (this.isRecorded(camera)) return camera;
    const ref = this.lensIndex.get(camera);
    return ref?.location.lenses.find((l) => this.isRecorded(l.camera))?.camera ?? camera;
  }

  private async subscribe(): Promise<void> {
    if (!this.api || this.unsub || this.subscribing || !this.isConnected) return;
    this.subscribing = true;
    try {
      this.unsub = await this.api.subscribeReviews((review) => {
        if (!this.lensIndex.has(review.camera)) return;
        const existing = this._reviews.get(review.id);
        const next = new Map(this._reviews);
        next.set(review.id, { ...review, reviewed: existing?.reviewed ?? false });
        this._reviews = next;
      });
    } catch (err) {
      console.warn('frigate-timeline-card: review subscription failed', err);
    } finally {
      this.subscribing = false;
    }
    // Disconnected while the subscription was being set up.
    if (!this.isConnected) void this.unsubscribe();
  }

  private async unsubscribe(): Promise<void> {
    const u = this.unsub;
    this.unsub = null;
    if (u) {
      try {
        await u();
      } catch {
        /* subscription already gone */
      }
    }
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has('_tick') && this._follow) this._winEnd = nowSec();
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has('_span') || changed.has('_winEnd') || changed.has('_follow') || changed.has('_expanded')) {
      void this.ensureLoaded();
    }
    if (changed.has('_selId') || changed.has('_reviews')) this.autoSelect();
    if (changed.has('_selId')) void this.loadScore();
    if (this._sync && !this._narrow && this._playback) this.startSyncLoop();
    else this.stopSyncLoop();
  }

  // ---------------------------------------------------------------- synced multi-view

  private startSyncLoop(): void {
    if (this.syncTimer === undefined) this.syncTimer = window.setInterval(() => this.syncTick(), 300);
  }

  private stopSyncLoop(): void {
    if (this.syncTimer !== undefined) window.clearInterval(this.syncTimer);
    this.syncTimer = undefined;
  }

  /** Keep follower videos on the master's clock: same play state, rate and position. */
  private syncTick(): void {
    const root = this.renderRoot;
    const master = root.querySelector<FtcPlayer>('ftc-player.master')?.video;
    if (!master || master.readyState < 1) return;
    root.querySelectorAll<FtcPlayer>('ftc-player.follower').forEach((p) => {
      const v = p.video;
      if (!v || v.readyState < 1) return;
      if (v.playbackRate !== master.playbackRate) v.playbackRate = master.playbackRate;
      if (!master.seeking) {
        const max = Number.isFinite(v.duration) ? v.duration - 0.1 : master.currentTime;
        const target = Math.min(master.currentTime, max);
        if (Math.abs(v.currentTime - target) > SYNC_DRIFT) v.currentTime = target;
      }
      if (master.paused && !v.paused) v.pause();
      else if (!master.paused && v.paused && !v.ended) void v.play().catch(() => undefined);
    });
  }

  private setSync(on: boolean): void {
    this._sync = on;
    try {
      localStorage.setItem(SYNC_KEY, on ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }

  /** Make another camera the main view without losing the playback position. */
  private promote(camera: string): void {
    const pb = this._playback;
    if (!pb) return;
    const master = this.renderRoot.querySelector<FtcPlayer>('ftc-player.master')?.video;
    this._resumeAt = master ? master.currentTime : null;
    this._playback = { ...pb, camera };
  }

  private onPlayerTime(e: CustomEvent<{ wall: number }>): void {
    const t = e.detail.wall;
    if (this._playT === null || Math.abs(t - this._playT) >= 1) this._playT = t;
  }

  // ---------------------------------------------------------------- data loading

  private get window(): { start: number; end: number } {
    const end = this._follow ? nowSec() : this._winEnd;
    return { start: end - this._span, end };
  }

  private allCameras(): string[] {
    return this._config.cameras.flatMap((l) => l.lenses.map((x) => x.camera));
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.api || !this._hass) return;
    const { start, end } = this.window;
    this._error = null;

    if (!this.loadingReviews && (this.loadedFrom === null || start < this.loadedFrom)) {
      this.loadingReviews = true;
      const from = start - this._span * 0.25;
      const to = this.loadedFrom ?? nowSec() + 60;
      try {
        const rows = await this.api.getReviews(this.allCameras(), from, to);
        const next = new Map(this._reviews);
        for (const r of rows) next.set(r.id, r);
        this._reviews = next;
        this.loadedFrom = from;
      } catch (err) {
        this._error = `Could not load Frigate reviews (instance "${this.api.instanceId}"): ${(err as Error)?.message ?? err}`;
      } finally {
        this.loadingReviews = false;
      }
    }

    if ((this._config.security ?? []).length && !this.securityLoading && !this.security.covers(start, nowSec())) {
      this.securityLoading = true;
      try {
        await this.security.load(this._hass, Math.min(start, nowSec() - 86400), nowSec());
        this.security.ingest(this._hass);
        this._secVersion = this.security.version;
      } catch (err) {
        console.warn('frigate-timeline-card: security history failed', err);
      } finally {
        this.securityLoading = false;
      }
    }

    void this.loadMotion(start, end);
  }

  private async loadMotion(start: number, end: number): Promise<void> {
    if (!this.api || this._config.motion === false || this._narrow) return;
    if (end - start > MOTION_MAX_SPAN) {
      if (this._motion.size) this._motion = new Map();
      return;
    }
    const cams = this.lanes().map((l) => l.playCamera);
    const bucket = Math.max(60, Math.round(this._span / 20));
    const key = `${cams.join(',')}|${Math.floor(start / bucket)}|${Math.floor(end / bucket)}`;
    if (key === this.motionKey) return;
    this.motionKey = key;
    const results = await Promise.allSettled(
      cams.map(async (c) => [c, await this.api!.getRecordings(c, start, end)] as const),
    );
    if (key !== this.motionKey) return;
    const next = new Map<string, RecordingSegment[]>();
    for (const r of results) if (r.status === 'fulfilled') next.set(r.value[0], r.value[1]);
    this._motion = next;
  }

  private async loadScore(): Promise<void> {
    const review = this.selected;
    if (!review || !this.api || this._scores.has(review.id)) return;
    if (!review.subLabels.length) return;
    try {
      const events = await this.api.getEvents(review.camera, review.start - 30, (review.end ?? nowSec()) + 30);
      const ids = new Set(review.detections);
      const match = events.find((e) => ids.has(e.id) && e.sub_label);
      const score = match?.data?.sub_label_score ?? null;
      this._scores = new Map(this._scores).set(review.id, score);
    } catch {
      this._scores = new Map(this._scores).set(review.id, null);
    }
  }

  // ---------------------------------------------------------------- derived state

  private get knownFaces(): Set<string> | null {
    return this._config.faces?.length ? new Set(this._config.faces.map((f) => f.name)) : null;
  }

  private get selected(): Review | null {
    return this._selId ? this._reviews.get(this._selId) ?? null : null;
  }

  private inWindow(r: Review, start: number, end: number): boolean {
    return r.start < end && (r.end ?? nowSec()) > start;
  }

  /** Reviews passing the current filters (the selected one always passes). */
  private filtered(): Review[] {
    const { start, end } = this.window;
    const known = this.knownFaces;
    return Array.from(this._reviews.values()).filter((r) => {
      if (r.id === this._selId) return true;
      if (!this.lensIndex.has(r.camera)) return false;
      if (!this.inWindow(r, start, end)) return false;
      if (this._sev !== 'all' && r.severity !== this._sev) return false;
      if (this._unrevOnly && r.reviewed) return false;
      if (this._face && faceOf(r, known) !== this._face) return false;
      return true;
    });
  }

  private unreviewedSorted(): Review[] {
    return this.filtered()
      .filter((r) => !r.reviewed || r.id === this._selId)
      .sort((a, b) => a.start - b.start);
  }

  private autoSelect(): void {
    if (this._selId && this._reviews.has(this._selId)) return;
    if (this._playback?.kind === 'moment') return;
    const list = this.filtered().sort((a, b) => b.start - a.start);
    const pick =
      list.find((r) => !r.reviewed && r.severity === 'alert') ?? list.find((r) => !r.reviewed) ?? list[0];
    if (pick) this.select(pick);
  }

  private lanes(): Lane[] {
    const out: Lane[] = [];
    this._config.cameras.forEach((loc, locIndex) => {
      const expandable = loc.lenses.length > 1;
      const expanded = expandable && this._expanded.has(locIndex);
      out.push({
        key: `loc-${locIndex}`,
        title: loc.name,
        sub: false,
        locIndex,
        cameras: expanded ? [loc.lenses[0].camera] : loc.lenses.map((l) => l.camera),
        playCamera: loc.lenses[0].camera,
        expandable,
        expanded,
        lensCount: loc.lenses.length,
      });
      if (expanded) {
        loc.lenses.slice(1).forEach((lens, i) =>
          out.push({
            key: `loc-${locIndex}-${i + 1}`,
            title: `${lens.label ?? lens.camera} lens`,
            sub: true,
            locIndex,
            cameras: [lens.camera],
            playCamera: lens.camera,
            expandable: false,
            expanded: false,
            lensCount: 1,
          }),
        );
      }
    });
    return out;
  }

  private securityMarks(): SecurityMark[] {
    void this._secVersion;
    return this._hass ? this.security.marks(this._hass) : [];
  }

  private lensLabel(camera: string): string {
    const ref = this.lensIndex.get(camera);
    if (!ref) return camera;
    return ref.location.lenses.length > 1
      ? `${ref.location.name} · ${ref.lens.label ?? ref.lens.camera}`
      : ref.location.name;
  }

  // ---------------------------------------------------------------- actions

  private select(review: Review): void {
    this._selId = review.id;
    this._resumeAt = null;
    this._playT = review.start;
    this._playback = { kind: 'review', review, camera: this.playableCamera(review.camera) };
  }

  private playMoment(camera: string, t: number): void {
    this._selId = null;
    this._resumeAt = null;
    this._playT = t;
    this._playback = { kind: 'moment', camera: this.playableCamera(camera), start: t - 5, end: Math.min(t + 60, nowSec()) };
  }

  /** Every event passing the filters, oldest → newest (reviewed included). */
  private navList(): Review[] {
    const { start, end } = this.window;
    return this.filtered()
      .filter((r) => this.inWindow(r, start, end) || r.id === this._selId)
      .sort((a, b) => a.start - b.start || a.camera.localeCompare(b.camera));
  }

  /** Move to the chronologically adjacent event (dir 1 = later, -1 = earlier). */
  private step(dir: 1 | -1): void {
    const list = this.navList();
    if (!list.length) return;
    const cur = this.selected;
    let idx: number;
    if (cur) {
      idx = list.findIndex((r) => r.id === cur.id) + dir;
    } else {
      // Playing an arbitrary moment: go to the nearest event in that direction.
      const t = this._playT ?? (this._playback?.kind === 'moment' ? this._playback.start : nowSec());
      idx = dir > 0 ? list.findIndex((r) => r.start > t) : list.map((r) => r.start < t).lastIndexOf(true);
    }
    const pick = list[idx];
    if (pick) {
      this.select(pick);
      this.revealInWindow(pick);
    }
  }

  private revealInWindow(r: Review): void {
    const { start, end } = this.window;
    if (r.start >= start && r.start <= end) return;
    this._follow = false;
    this._winEnd = Math.min(nowSec(), r.start + this._span / 2);
  }

  private async setReviewed(ids: string[], viewed: boolean, undoText?: string): Promise<void> {
    if (!this.api || !ids.length) return;
    if (undoText) {
      window.clearTimeout(this.undoTimer);
      this._undo = { ids, viewed: !viewed, text: undoText };
      this.undoTimer = window.setTimeout(() => (this._undo = null), UNDO_MS);
    }
    const prev = new Map(this._reviews);
    const next = new Map(this._reviews);
    for (const id of ids) {
      const r = next.get(id);
      if (r) next.set(id, { ...r, reviewed: viewed });
    }
    this._reviews = next;
    try {
      await this.api.setViewed(ids, viewed);
    } catch (err) {
      this._reviews = prev;
      this._error = `Could not update review state: ${(err as Error)?.message ?? err}`;
    }
  }

  private async markAndNext(): Promise<void> {
    const cur = this.selected;
    if (!cur) return;
    if (cur.reviewed) {
      await this.setReviewed([cur.id], false);
      return;
    }
    const next = this.unreviewedSorted()
      .filter((r) => r.id !== cur.id && !r.reviewed)
      .sort((a, b) => b.start - a.start)[0];
    void this.setReviewed([cur.id], true);
    if (next) this.select(next);
  }

  /** Unreviewed events in the current range and filters. */
  private markableIds(): string[] {
    const { start, end } = this.window;
    return this.filtered()
      .filter((r) => !r.reviewed && this.inWindow(r, start, end))
      .map((r) => r.id);
  }

  private markAllVisible(): void {
    const ids = this.markableIds();
    void this.setReviewed(ids, true, `Marked ${ids.length} event${ids.length === 1 ? '' : 's'} as reviewed in Frigate.`);
  }

  private undo(): void {
    const u = this._undo;
    if (!u) return;
    window.clearTimeout(this.undoTimer);
    this._undo = null;
    void this.setReviewed(u.ids, u.viewed);
  }

  private setRange(range: RangeKey): void {
    this._span = RANGE_SECONDS[range];
    this._follow = true;
    this._winEnd = nowSec();
  }

  private goLive(): void {
    this._follow = true;
    this._winEnd = nowSec();
  }

  private openMoreInfo(entityId: string): void {
    this.dispatchEvent(
      new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }),
    );
  }

  private onKey(e: KeyboardEvent): void {
    if (e.target !== e.currentTarget && (e.target as HTMLElement).closest('input, textarea, video')) return;
    if (e.key === 'j' || e.key === 'ArrowRight') this.step(1);
    else if (e.key === 'k' || e.key === 'ArrowLeft') this.step(-1);
    else if (e.key === 'r') void this.markAndNext();
    else if (e.key === 's') this.setSync(!this._sync);
    else return;
    e.preventDefault();
  }

  // Timeline interaction: drag to pan, ctrl/⌘ + wheel to zoom.
  private onTrackPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    this.drag = { x: e.clientX, end: this.window.end, moved: false, width: el.getBoundingClientRect().width };
    el.setPointerCapture(e.pointerId);
  }

  private onTrackPointerMove(e: PointerEvent): void {
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x;
    if (Math.abs(dx) > 4) this.drag.moved = true;
    if (!this.drag.moved) return;
    const secsPerPx = this._span / this.drag.width;
    const end = Math.min(nowSec(), this.drag.end - dx * secsPerPx);
    this._follow = false;
    this._winEnd = end;
  }

  private onTrackPointerUp(): void {
    if (this.drag?.moved) {
      this.suppressClick = true;
      if (this._winEnd >= nowSec() - 5) this._follow = true;
    }
    this.drag = null;
  }

  private onWheel(e: WheelEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const { start } = this.window;
    const anchor = start + frac * this._span;
    const factor = e.deltaY > 0 ? 1.25 : 0.8;
    const span = Math.min(RANGE_SECONDS['7d'], Math.max(900, this._span * factor));
    const end = Math.min(nowSec(), anchor + (1 - frac) * span);
    this._span = span;
    this._follow = end >= nowSec() - 5;
    this._winEnd = end;
  }

  private onTrackClick(e: MouseEvent, lane: Lane): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const { start } = this.window;
    const t = start + frac * this._span;
    if (t > nowSec()) return;
    this.playMoment(lane.playCamera, t);
  }

  // ---------------------------------------------------------------- render helpers

  private pct(t: number): number {
    const { start } = this.window;
    return ((t - start) / this._span) * 100;
  }

  private avatar(name: string | null, size: number): TemplateResult {
    const style: Record<string, string> = {
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${Math.round(size * 0.45)}px`,
    };
    if (!name || name === 'Unknown') {
      return html`<span class="avatar unknown" style=${styleMap(style)} aria-hidden="true">?</span>`;
    }
    const image = this._config.faces?.find((f) => f.name === name)?.image;
    if (image) style.backgroundImage = `url("${image}")`;
    else style.background = faceColor(name, this._config);
    return html`<span class="avatar" style=${styleMap(style)} aria-hidden="true"
      >${image ? '' : name.charAt(0).toUpperCase()}</span
    >`;
  }

  private faceStats(): { name: string; count: number; last: Review }[] {
    const { start, end } = this.window;
    const known = this.knownFaces;
    const map = new Map<string, Review[]>();
    for (const r of this._reviews.values()) {
      if (!this.lensIndex.has(r.camera) || !this.inWindow(r, start, end)) continue;
      const f = faceOf(r, known);
      if (!f) continue;
      const arr = map.get(f) ?? [];
      arr.push(r);
      map.set(f, arr);
    }
    return Array.from(map.entries())
      .map(([name, rs]) => ({ name, count: rs.length, last: rs.sort((a, b) => b.start - a.start)[0] }))
      .sort((a, b) => (a.name === 'Unknown' ? 1 : b.name === 'Unknown' ? -1 : b.count - a.count));
  }

  private renderToolbar(compact: boolean): TemplateResult {
    const ranges: RangeKey[] = ['1h', '6h', '24h', '7d'];
    const sevs: ['all' | Severity, string][] = [
      ['all', 'All'],
      ['alert', 'Alerts'],
      ['detection', 'Detections'],
    ];
    const unrev = Array.from(this._reviews.values()).filter(
      (r) => !r.reviewed && this.lensIndex.has(r.camera) && this.inWindow(r, this.window.start, this.window.end),
    );
    const alerts = unrev.filter((r) => r.severity === 'alert').length;
    const markable = this.markableIds().length;
    const filtered = this._sev !== 'all' || this._unrevOnly || this._face !== null;
    const faces = this.faceStats();

    return html`<div class="toolbar">
      <div class="seg" role="group" aria-label="Time range">
        ${ranges.map(
          (r) => html`<button
            aria-pressed=${String(this._follow && this._span === RANGE_SECONDS[r])}
            @click=${() => this.setRange(r)}
          >
            ${r}
          </button>`,
        )}
      </div>
      ${compact
        ? html`<button class="chip" aria-pressed=${String(this._unrevOnly)} @click=${() => (this._unrevOnly = !this._unrevOnly)}>
              Unreviewed
            </button>
            <button
              class="chip"
              aria-pressed=${String(this._sev === 'alert')}
              @click=${() => (this._sev = this._sev === 'alert' ? 'all' : 'alert')}
            >
              Alerts
            </button>`
        : html`<div class="seg" role="group" aria-label="Severity">
              ${sevs.map(
                ([k, label]) => html`<button aria-pressed=${String(this._sev === k)} @click=${() => (this._sev = k)}>
                  ${label}
                </button>`,
              )}
            </div>
            <button class="chip" aria-pressed=${String(this._unrevOnly)} @click=${() => (this._unrevOnly = !this._unrevOnly)}>
              Unreviewed only
            </button>
            ${faces.map(
              (f) => html`<button
                class="chip face"
                aria-pressed=${String(this._face === f.name)}
                @click=${() => (this._face = this._face === f.name ? null : f.name)}
              >
                ${this.avatar(f.name, 24)} ${f.name === 'Unknown' ? 'Unknown' : f.name}
              </button>`,
            )}`}
      <span class="spacer"></span>
      ${!this._follow
        ? html`<button class="icon-btn" @click=${() => this.goLive()} title="Jump to now">
            <ha-icon icon="mdi:skip-forward"></ha-icon>${compact ? '' : 'Now'}
          </button>`
        : nothing}
      <span class="count"><b>${unrev.length}</b> unreviewed${compact ? '' : html` · ${alerts} alerts`}</span>
      ${compact
        ? nothing
        : html`<button
            class="icon-btn"
            @click=${() => this.markAllVisible()}
            ?disabled=${!markable}
            title="Marks the ${markable} unreviewed events in this time range${filtered ? ' that match the current filters' : ''} as reviewed in Frigate. They turn from solid to outlined. Undo is offered for 10 seconds."
          >
            <ha-icon icon="mdi:check-all"></ha-icon>${markable
              ? `Mark ${markable} ${filtered ? 'shown ' : ''}reviewed`
              : 'All reviewed'}
          </button>`}
    </div>`;
  }

  private renderMotion(camera: string): TemplateResult | typeof nothing {
    const segs = this._motion.get(camera);
    if (!segs?.length) return nothing;
    const { start } = this.window;
    const binSpan = this._span / MOTION_BINS;
    const bins = new Array<number>(MOTION_BINS).fill(0);
    for (const s of segs) {
      const i = Math.floor((s.start - start) / binSpan);
      if (i >= 0 && i < MOTION_BINS) bins[i] = Math.max(bins[i], s.motion);
    }
    const max = Math.max(1, ...bins);
    return html`<div class="motion" aria-hidden="true">
      ${bins.map((b) => html`<span style="height:${b ? Math.max(8, Math.sqrt(b / max) * 100) : 0}%"></span>`)}
    </div>`;
  }

  private renderGrid(tickList: number[]): TemplateResult[] {
    return tickList.map((t) => html`<span class="gridline" style="left:${this.pct(t)}%"></span>`);
  }

  private renderBlock(r: Review, now: number): TemplateResult {
    const { start, end } = this.window;
    const s = Math.max(r.start, start);
    const e = Math.min(r.end ?? now, end);
    const face = faceOf(r, this.knownFaces);
    const cls = [
      'block',
      r.severity,
      r.reviewed ? 'reviewed' : '',
      r.end === null ? 'inprogress' : '',
      r.id === this._selId ? 'selected' : '',
    ].join(' ');
    const title = `${reviewTitle(r, this.knownFaces)} · ${this.lensLabel(r.camera)} · ${this.fmt?.ts(r.start)} · ${fmtDuration(r)}`;
    return html`<button
      class=${cls}
      style="left:${this.pct(s)}%;width:${Math.max(0, ((e - s) / this._span) * 100)}%"
      title=${title}
      aria-label=${title}
      @pointerdown=${(ev: Event) => ev.stopPropagation()}
      @click=${(ev: Event) => {
        ev.stopPropagation();
        this.select(r);
      }}
    >
      ${face && face !== 'Unknown'
        ? html`<span class="face-dot" style="background:${faceColor(face, this._config)}"></span>`
        : nothing}
    </button>`;
  }

  private renderTimeline(tickList: number[], visible: Review[], marks: SecurityMark[], now: number): TemplateResult {
    const lanes = this.lanes();
    const playT =
      this._playT ??
      (this._playback?.kind === 'review' ? this._playback.review.start : this._playback?.start ?? null);
    const nowPct = this.pct(now);
    const security = this._config.security ?? [];
    const { start, end } = this.window;
    const trackHandlers = {
      down: (e: PointerEvent) => this.onTrackPointerDown(e),
      move: (e: PointerEvent) => this.onTrackPointerMove(e),
      up: () => this.onTrackPointerUp(),
    };

    return html`<div class="timeline" @wheel=${(e: WheelEvent) => this.onWheel(e)}>
      <div class="timeline-inner">
        <div class="row" style="height:18px">
          <div class="legend" style="font-size:11px">${this.fmt?.d(start)}</div>
          <div class="axis">
            ${tickList.map((t) => html`<span style="left:${this.pct(t)}%">${this.fmt?.t(t)}</span>`)}
          </div>
        </div>
        ${lanes.map((lane) => {
          const blocks = visible.filter((r) => lane.cameras.includes(r.camera));
          return html`<div class="row ${lane.sub ? 'sub' : ''}">
            <div class="row-label">
              ${lane.expandable
                ? html`<button
                    class="expander"
                    aria-expanded=${String(lane.expanded)}
                    aria-label="Show all lenses for ${lane.title}"
                    @click=${() => {
                      const s = new Set(this._expanded);
                      if (s.has(lane.locIndex)) s.delete(lane.locIndex);
                      else s.add(lane.locIndex);
                      this._expanded = s;
                    }}
                  >
                    <ha-icon icon="mdi:chevron-right"></ha-icon>
                  </button>`
                : lane.sub
                  ? nothing
                  : html`<span class="no-expander"></span>`}
              <span class="name">${lane.title}</span>
              ${lane.expandable ? html`<span class="lens-tag">${lane.lensCount}×</span>` : nothing}
            </div>
            <div
              class="track"
              @pointerdown=${trackHandlers.down}
              @pointermove=${trackHandlers.move}
              @pointerup=${trackHandlers.up}
              @pointercancel=${trackHandlers.up}
              @click=${(e: MouseEvent) => this.onTrackClick(e, lane)}
            >
              ${this.renderMotion(lane.playCamera)} ${this.renderGrid(tickList)}
              ${blocks.map((r) => this.renderBlock(r, now))}
              ${nowPct <= 100 ? html`<span class="nowline" style="left:${nowPct}%"></span>` : nothing}
              ${playT !== null && playT >= start && playT <= end
                ? html`<span class="playhead" style="left:${this.pct(playT)}%"></span>`
                : nothing}
            </div>
          </div>`;
        })}
        ${security.length
          ? html`<div class="row" style="height:auto">
                <div class="section-label">Security events</div>
                <div class="section-label"></div>
              </div>
              ${security.map((lane, i) => {
                const laneMarks = marks.filter(
                  (m) => m.lane === i && m.start < end && (m.end ?? now) > start - 60,
                );
                return html`<div class="row sec">
                  <div class="row-label"><span class="name">${lane.name}</span></div>
                  <div
                    class="track"
                    @pointerdown=${trackHandlers.down}
                    @pointermove=${trackHandlers.move}
                    @pointerup=${trackHandlers.up}
                    @pointercancel=${trackHandlers.up}
                  >
                    ${this.renderGrid(tickList)}
                    ${laneMarks.map((m) => this.renderMark(m, now))}
                    ${nowPct <= 100 ? html`<span class="nowline" style="left:${nowPct}%"></span>` : nothing}
                  </div>
                </div>`;
              })}`
          : nothing}
        <div class="row" style="height:auto;margin-top:6px">
          <span></span>
          <div class="legend">
            <span><i style="background:var(--ftc-alert)"></i>Alert</span>
            <span><i style="background:var(--ftc-detection)"></i>Detection</span>
            <span><i class="outline"></i>Reviewed (outline)</span>
            ${security.length
              ? html`<span><i style="background:var(--ftc-security);opacity:.75"></i>Open</span>
                  <span><i class="diamond" style="background:var(--ftc-security)"></i>Lock</span>
                  <span><i class="diamond" style="background:var(--ftc-tamper)"></i>Tamper / jammed</span>`
              : nothing}
            <span class="spacer"></span>
            <span class="hint">Click a track to play that moment · drag to pan · Ctrl/⌘+scroll to zoom · ←/→ events · r review · s sync</span>
          </div>
        </div>
      </div>
    </div>`;
  }

  private renderMark(m: SecurityMark, now: number): TemplateResult {
    const { start, end } = this.window;
    const title = `${m.label} · ${this.fmt?.ts(m.start)}${m.kind === 'interval' && m.end ? ` → ${this.fmt?.ts(m.end)}` : ''}`;
    const onClick = (e: Event) => {
      e.stopPropagation();
      this.jumpFromMark(m);
    };
    if (m.kind === 'interval') {
      const s = Math.max(m.start, start);
      const e = Math.min(m.end ?? now, end);
      return html`<button
        class="sec-interval"
        style="left:${this.pct(s)}%;width:${Math.max(0, ((e - s) / this._span) * 100)}%"
        title=${title}
        aria-label=${title}
        @pointerdown=${(ev: Event) => ev.stopPropagation()}
        @click=${onClick}
      ></button>`;
    }
    return html`<button
      class="sec-point ${m.tone}"
      style="left:${this.pct(m.start)}%"
      title=${title}
      aria-label=${title}
      @pointerdown=${(ev: Event) => ev.stopPropagation()}
      @click=${onClick}
    ></button>`;
  }

  /** From a security mark: select the nearest review on the lane's camera, else play that moment. */
  private jumpFromMark(m: SecurityMark): void {
    const lane = this._config.security?.[m.lane];
    const ref = lane?.camera ? this.lensIndex.get(lane.camera) : undefined;
    const cams = ref ? ref.location.lenses.map((l) => l.camera) : this.allCameras();
    const near = Array.from(this._reviews.values())
      .filter((r) => cams.includes(r.camera) && Math.abs(r.start - m.start) <= RELATED_WINDOW)
      .sort((a, b) => Math.abs(a.start - m.start) - Math.abs(b.start - m.start))[0];
    if (near) this.select(near);
    else if (lane?.camera) this.playMoment(lane.camera, m.start);
  }

  private renderPlayer(): TemplateResult {
    const pb = this._playback;
    if (!pb || !this.api) {
      return html`<div class="pane-player"><div class="empty">Select an event on the timeline.</div></div>`;
    }
    const camera = pb.camera;
    const ref = this.lensIndex.get(camera);
    const start = pb.kind === 'review' ? pb.review.start : pb.start;
    const end = pb.kind === 'review' ? pb.review.end : pb.end;
    const player = () => this.renderRoot.querySelector<FtcPlayer>('ftc-player.master');
    const list = this.navList();
    const idx = this._selId ? list.findIndex((r) => r.id === this._selId) : -1;
    const sel = this.selected;
    const canPrev = idx > 0 || (idx < 0 && list.some((r) => r.start < start));
    const canNext = (idx >= 0 && idx < list.length - 1) || (idx < 0 && list.some((r) => r.start > start));

    return html`<div class="pane-player">
      <div class="player-head">
        <div>
          <span class="title">${ref?.location.name ?? camera}</span>
          <span class="muted">
            ${ref && ref.location.lenses.length > 1 ? ` · ${ref.lens.label ?? ref.lens.camera} lens` : ''} ·
            ${this.fmt?.d(start)} ${this.fmt?.ts(start)}
          </span>
          ${sel
            ? html`<span class="status ${sel.reviewed ? 'done' : 'todo'}"
                >${sel.reviewed ? '✓ Reviewed' : 'Unreviewed'}</span
              >`
            : nothing}
        </div>
        ${ref && ref.location.lenses.length > 1
          ? html`<div class="seg" role="group" aria-label="Lens">
              ${ref.location.lenses.map(
                (l) => html`<button
                  aria-pressed=${String(l.camera === camera)}
                  ?disabled=${!this.isRecorded(l.camera)}
                  title=${this.isRecorded(l.camera) ? '' : `${l.label ?? l.camera} is not recorded in Frigate (detection only)`}
                  @click=${() => this.promote(l.camera)}
                >
                  ${l.label ?? l.camera}
                </button>`,
              )}
            </div>`
          : nothing}
      </div>
      ${pb.kind === 'review' && pb.review.camera !== camera && !this.isRecorded(pb.review.camera)
        ? html`<div class="notice">
            Detected on the ${this.lensIndex.get(pb.review.camera)?.lens.label ?? pb.review.camera} lens, which Frigate
            doesn't record. Showing the ${ref?.lens.label ?? camera} lens for the same time.
          </div>`
        : nothing}
      <ftc-player
        class="master"
        .hass=${this.hass}
        .api=${this.api}
        .camera=${camera}
        .start=${start}
        .end=${end}
        .position=${this._resumeAt}
        @ftc-time=${(e: CustomEvent<{ wall: number }>) => this.onPlayerTime(e)}
      ></ftc-player>
      <div class="controls">
        <button class="icon-btn" ?disabled=${!canPrev} @click=${() => this.step(-1)} title="Previous event (← or k)">
          <ha-icon icon="mdi:chevron-left"></ha-icon>Prev event
        </button>
        <span class="nav-pos">${idx >= 0 ? `${idx + 1} of ${list.length}` : `${list.length} events`}</span>
        <button class="icon-btn" ?disabled=${!canNext} @click=${() => this.step(1)} title="Next event (→ or j)">
          Next event<ha-icon icon="mdi:chevron-right"></ha-icon>
        </button>
        <span class="divider"></span>
        <button class="icon-btn" aria-label="Back 10 seconds" title="Back 10 s" @click=${() => player()?.skip(-10)}>
          <ha-icon icon="mdi:rewind-10"></ha-icon>
        </button>
        <button class="icon-btn" aria-label="Forward 10 seconds" title="Forward 10 s" @click=${() => player()?.skip(10)}>
          <ha-icon icon="mdi:fast-forward-10"></ha-icon>
        </button>
        <div class="seg" role="group" aria-label="Playback speed">
          ${[1, 2, 4].map(
            (r) => html`<button
              aria-pressed=${String(r === 1)}
              @click=${(e: Event) => {
                player()?.setRate(r);
                (e.currentTarget as HTMLElement).parentElement
                  ?.querySelectorAll('button')
                  .forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
              }}
            >
              ${r}×
            </button>`,
          )}
        </div>
        <span class="spacer"></span>
        <button class="icon-btn" @click=${() => void this.downloadClip(camera, start, end)}>
          <ha-icon icon="mdi:download"></ha-icon>Clip
        </button>
        ${ref?.lens.entity
          ? html`<button class="icon-btn" @click=${() => this.openMoreInfo(ref.lens.entity!)}>
              <ha-icon icon="mdi:cctv"></ha-icon>Live
            </button>`
          : nothing}
        ${this._config.frigate_url
          ? html`<a class="icon-btn" href=${`${this._config.frigate_url}/review`} target="_blank" rel="noopener"
              ><ha-icon icon="mdi:open-in-new"></ha-icon>Frigate</a
            >`
          : nothing}
      </div>
      ${this.renderMoment(start, end, camera)}
    </div>`;
  }

  private async downloadClip(camera: string, start: number, end: number | null): Promise<void> {
    if (!this.api) return;
    try {
      const url = await this.api.signPath(this.api.clipPath(camera, start - 10, (end ?? nowSec()) + 10), 600);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${camera}-${Math.floor(start)}.mp4`;
      a.rel = 'noopener';
      a.click();
    } catch (err) {
      this._error = `Could not prepare clip: ${(err as Error)?.message ?? err}`;
    }
  }

  /** The review on one of `cams` that overlaps time t (± MOMENT_WINDOW), if any. */
  private reviewAt(cams: string[], t: number): Review | undefined {
    return Array.from(this._reviews.values())
      .filter((r) => cams.includes(r.camera) && r.start <= t + MOMENT_WINDOW && (r.end ?? nowSec()) >= t - MOMENT_WINDOW)
      .sort((a, b) => Math.abs(a.start - t) - Math.abs(b.start - t))[0];
  }

  /**
   * Cameras shown alongside the main view: one per other location (the lens that saw
   * something, else the primary), plus the other lenses of the current location.
   */
  private companionCameras(t: number, currentCamera: string): { camera: string; label: string; hit?: Review }[] {
    const current = this.lensIndex.get(currentCamera);
    const out: { camera: string; label: string; hit?: Review }[] = [];
    current?.location.lenses
      .filter((l) => l.camera !== currentCamera && this.isRecorded(l.camera))
      .forEach((l) =>
        out.push({ camera: l.camera, label: this.lensLabel(l.camera), hit: this.reviewAt([l.camera], t) }),
      );
    this._config.cameras.forEach((loc, i) => {
      if (i === current?.locIndex) return;
      const hit = this.reviewAt(
        loc.lenses.map((l) => l.camera),
        t,
      );
      const camera = hit ? this.playableCamera(hit.camera) : this.playableCamera(loc.lenses[0].camera);
      out.push({ camera, label: loc.lenses.length > 1 ? this.lensLabel(camera) : loc.name, hit });
    });
    return out;
  }

  private renderMoment(start: number, end: number | null, currentCamera: string): TemplateResult | typeof nothing {
    const t = start;
    const companions = this.companionCameras(t, currentCamera);
    if (!companions.length) return nothing;
    const active = companions.filter((c) => c.hit);
    const quiet = companions.filter((c) => !c.hit);

    const header = html`<div class="moment-head">
      <h3>${this._sync ? 'All cameras, in sync' : 'Same moment, other cameras'}</h3>
      <span class="spacer"></span>
      <button
        class="chip"
        aria-pressed=${String(this._sync)}
        @click=${() => this.setSync(!this._sync)}
        title="Play every camera on the same clock as the main view (s)"
      >
        <ha-icon icon="mdi:view-grid-outline"></ha-icon>Play all in sync
      </button>
    </div>`;

    if (this._sync) {
      const shown = companions.slice(0, SYNC_MAX_FOLLOWERS);
      return html`<div class="panel" style="padding:10px">
        ${header}
        <div class="sync-grid">
          ${shown.map(
            (c) => html`<button
              class="sync-tile ${c.hit ? 'active' : ''}"
              @click=${() => this.promote(c.camera)}
              title="Make ${c.label} the main view"
            >
              <ftc-player
                class="follower"
                follower
                .hass=${this.hass}
                .api=${this.api}
                .camera=${c.camera}
                .start=${start}
                .end=${end}
              ></ftc-player>
              <span class="name"
                >${c.label}${c.hit ? html` · <b>${reviewTitle(c.hit, this.knownFaces)}</b>` : ''}</span
              >
            </button>`,
          )}
        </div>
        <span class="hint">Click a camera to make it the main view. The time and play/pause follow the main player.</span>
      </div>`;
    }

    return html`<div class="panel" style="padding:10px">
      ${header}
      ${active.length
        ? html`<div class="moment">
            ${active.map((c) => {
              const thumb = this.api?.reviewThumbPath(c.hit!);
              return html`<button class="tile active" @click=${() => this.select(c.hit!)}>
                ${thumb
                  ? html`<ftc-auth-img .hass=${this.hass} .path=${thumb} alt=""></ftc-auth-img>`
                  : html`<span class="ph"></span>`}
                <span class="name">${c.label} · <b>${reviewTitle(c.hit!, this.knownFaces)}</b></span>
              </button>`;
            })}
          </div>`
        : nothing}
      ${quiet.length
        ? html`<div class="quiet">
            <span class="muted">No events${active.length ? ' on' : ''}:</span>
            ${quiet.map(
              (c) => html`<button class="chip" @click=${() => this.promote(c.camera)} title="Watch ${c.label} at this time">
                <ha-icon icon="mdi:play"></ha-icon>${c.label}
              </button>`,
            )}
          </div>`
        : nothing}
    </div>`;
  }

  private renderDetail(marks: SecurityMark[]): TemplateResult {
    const r = this.selected;
    const pb = this._playback;
    if (!r) {
      return html`<div class="panel">
        ${pb?.kind === 'moment'
          ? html`<div class="detail-title"><span class="big">Recording</span></div>
              <dl>
                <dt>Camera</dt>
                <dd>${this.lensLabel(pb.camera)}</dd>
                <dt>From</dt>
                <dd>${this.fmt?.ts(pb.start)}</dd>
              </dl>`
          : html`<span class="muted">No event selected.</span>`}
      </div>`;
    }
    const face = faceOf(r, this.knownFaces);
    const score = this._scores.get(r.id);
    const related = marks
      .filter((m) => m.start >= r.start - RELATED_WINDOW && m.start <= (r.end ?? nowSec()) + RELATED_WINDOW)
      .slice(0, 8);
    const security = this._config.security ?? [];

    return html`<div class="panel">
      <div class="detail-title">
        <span class="big">${reviewTitle(r, this.knownFaces)}</span>
        <span class="pill ${r.severity}">${r.severity === 'alert' ? 'Alert' : 'Detection'}</span>
      </div>
      <dl>
        <dt>Status</dt>
        <dd>
          <span class="status ${r.reviewed ? 'done' : 'todo'}">${r.reviewed ? '✓ Reviewed' : 'Unreviewed'}</span>
        </dd>
        <dt>Camera</dt>
        <dd>${this.lensLabel(r.camera)}</dd>
        <dt>Started</dt>
        <dd>${this.fmt?.d(r.start)} ${this.fmt?.ts(r.start)}</dd>
        <dt>Duration</dt>
        <dd>${fmtDuration(r)}</dd>
        ${face
          ? html`<dt>Face</dt>
              <dd>
                ${this.avatar(face, 22)}
                ${face === 'Unknown'
                  ? html`<span class="muted">No face match</span>`
                  : html`${face}${typeof score === 'number' ? html` <span class="muted">· ${Math.round(score * 100)}%</span>` : ''}`}
              </dd>`
          : nothing}
        <dt>Objects</dt>
        <dd>${r.objects.join(', ') || '—'}</dd>
        ${r.zones.length ? html`<dt>Zones</dt><dd>${r.zones.join(', ')}</dd>` : nothing}
      </dl>
      <div class="controls">
        <button
          class=${r.reviewed ? 'icon-btn' : 'primary-btn'}
          @click=${() => void this.markAndNext()}
          title=${r.reviewed ? 'Set this event back to unreviewed in Frigate' : 'Mark reviewed in Frigate and open the newest remaining unreviewed event (r)'}
        >
          ${r.reviewed ? 'Mark unreviewed' : 'Mark reviewed & next'}
        </button>
      </div>
      ${security.length
        ? html`<div style="border-top:1px solid var(--divider-color);padding-top:10px;display:flex;flex-direction:column;gap:6px">
            <h3>Security events ±${RELATED_WINDOW / 60} min</h3>
            ${related.length
              ? related.map(
                  (m) => html`<div class="rel">
                    <span class="diamond ${m.tone !== 'normal' ? 'tamper' : ''}"></span>
                    <span style="flex:none;white-space:nowrap">${this.fmt?.ts(m.start)}</span>
                    <span class="grow">${m.label}</span>
                    <span class="muted" style="font-size:12px">${fmtOffset(m.start - r.start)}</span>
                  </div>`,
                )
              : html`<span class="muted" style="font-size:13px">No door, lock or garage activity around this event.</span>`}
          </div>`
        : nothing}
    </div>`;
  }

  private renderSeen(): TemplateResult | typeof nothing {
    const stats = this.faceStats();
    if (!stats.length) return nothing;
    return html`<div class="panel">
      <h3>Seen in this range</h3>
      <div class="list" style="max-height:none">
        ${stats.map(
          (s) => html`<button
            class="list-item"
            aria-current=${String(this._face === s.name)}
            @click=${() => {
              this._face = this._face === s.name ? null : s.name;
              this.select(s.last);
            }}
          >
            ${this.avatar(s.name, 34)}
            <span class="grow">
              <span>${s.name === 'Unknown' ? 'Unknown person' : s.name}</span>
              <span class="sub">Last: ${this.lensLabel(s.last.camera)} · ${this.fmt?.t(s.last.start)}</span>
            </span>
            <span class="muted">${s.count}×</span>
          </button>`,
        )}
      </div>
    </div>`;
  }

  private renderQueue(): TemplateResult {
    const items = this.filtered()
      .filter((r) => !r.reviewed)
      .sort((a, b) => b.start - a.start);
    return html`<div class="panel">
      <h3>Unreviewed · ${items.length}</h3>
      <div class="list">
        ${items.length
          ? items.map(
              (r) => html`<button class="list-item" aria-current=${String(r.id === this._selId)} @click=${() => this.select(r)}>
                <span class="sev-dot ${r.severity}"></span>
                <span class="grow">
                  <span>${reviewTitle(r, this.knownFaces)}</span>
                  <span class="sub">${this.lensLabel(r.camera)}</span>
                </span>
                <span class="muted">${this.fmt?.t(r.start)}</span>
              </button>`,
            )
          : html`<span class="muted" style="padding:6px">All caught up.</span>`}
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------- phone layout

  private renderNarrow(visible: Review[], marks: SecurityMark[], now: number): TemplateResult {
    const { start, end } = this.window;
    const stats = this.faceStats();
    const known = this.knownFaces;
    const feedReviews = [...visible].sort((a, b) => b.start - a.start).slice(0, FEED_LIMIT);
    const feedMarks = marks.filter((m) => m.start >= start && m.start <= end);
    type Item = { t: number; review?: Review; mark?: SecurityMark };
    const items: Item[] = [
      ...feedReviews.map((r) => ({ t: r.start, review: r })),
      ...feedMarks.map((m) => ({ t: m.start, mark: m })),
    ].sort((a, b) => b.t - a.t);

    const groups: { key: string; items: Item[] }[] = [];
    for (const it of items) {
      const key = this.fmt?.hourKey(it.t) ?? '';
      const g = groups[groups.length - 1];
      if (g && g.key === key) g.items.push(it);
      else groups.push({ key, items: [it] });
    }

    return html`
      ${this.renderToolbar(true)}
      ${stats.length
        ? html`<div class="seen-row">
            ${stats.map(
              (s) => html`<button
                aria-pressed=${String(this._face === s.name)}
                @click=${() => (this._face = this._face === s.name ? null : s.name)}
                aria-label="${s.name}: ${s.count}"
              >
                ${this.avatar(s.name, 28)}<span>${s.count}</span>
              </button>`,
            )}
          </div>`
        : nothing}
      <div class="strip timeline-inner" style="min-width:0">
        ${this._config.cameras.map((loc) => {
          const cams = loc.lenses.map((l) => l.camera);
          return html`<div class="row">
            <div class="row-label"><span class="name">${loc.name}</span></div>
            <div class="track" style="cursor:default">
              ${visible.filter((r) => cams.includes(r.camera)).map((r) => this.renderBlock(r, now))}
              <span class="nowline" style="left:${this.pct(now)}%"></span>
            </div>
          </div>`;
        })}
      </div>
      <div class="feed">
        ${groups.length
          ? groups.map(
              (g) => html`<h4>${g.key}</h4>
                ${g.items.map((it) =>
                  it.review ? this.renderFeedReview(it.review, known) : this.renderFeedMark(it.mark!),
                )}`,
            )
          : html`<div class="empty">Nothing in this range.</div>`}
      </div>
    `;
  }

  private renderFeedReview(r: Review, known: Set<string> | null): TemplateResult {
    const face = faceOf(r, known);
    const thumb = this.api?.reviewThumbPath(r);
    const isSel = r.id === this._selId;
    return html`<div>
      <button
        class="feed-item ${r.severity} ${r.reviewed ? 'reviewed' : ''}"
        aria-expanded=${String(isSel)}
        @click=${() => {
          if (isSel) {
            this._selId = null;
            this._playback = null;
          } else this.select(r);
        }}
      >
        ${thumb ? html`<ftc-auth-img .hass=${this.hass} .path=${thumb} alt=""></ftc-auth-img>` : html`<span class="ph"></span>`}
        <span class="grow">
          <span class="t1">
            <span class="sev-dot ${r.severity}"></span>
            ${face && face !== 'Unknown' ? this.avatar(face, 18) : nothing} ${reviewTitle(r, known)}
          </span>
          <span class="t2">${this.lensLabel(r.camera)}</span>
          <span class="t2">${this.fmt?.ts(r.start)} · ${fmtDuration(r)}${r.reviewed ? ' · ✓ Reviewed' : ''}</span>
        </span>
      </button>
      ${isSel && this.api
        ? html`<div class="feed-player" style="margin-top:6px">
            <ftc-player .hass=${this.hass} .api=${this.api} .camera=${this._playback?.camera ?? r.camera} .start=${r.start} .end=${r.end}></ftc-player>
            <div class="controls">
              <button class="primary-btn" @click=${() => void this.markAndNext()}>
                ${r.reviewed ? 'Mark unreviewed' : 'Reviewed & next'}
              </button>
              <span class="spacer"></span>
              ${(this.lensIndex.get(r.camera)?.location.lenses ?? []).length > 1
                ? html`<div class="seg">
                    ${this.lensIndex.get(r.camera)!.location.lenses.map(
                      (l) => html`<button
                        aria-pressed=${String((this._playback?.camera ?? r.camera) === l.camera)}
                        @click=${() => (this._playback = { kind: 'review', review: r, camera: l.camera })}
                      >
                        ${l.label ?? l.camera}
                      </button>`,
                    )}
                  </div>`
                : nothing}
            </div>
          </div>`
        : nothing}
    </div>`;
  }

  private renderFeedMark(m: SecurityMark): TemplateResult {
    return html`<div class="feed-sec">
      <span class="diamond ${m.tone !== 'normal' ? 'tamper' : ''}"></span>
      <span style="flex:1">${m.label}</span>
      <span>${this.fmt?.ts(m.start)}</span>
    </div>`;
  }

  // ---------------------------------------------------------------- render

  protected render() {
    if (!this._config || !this._hass) return nothing;
    if (!this.fmt) this.fmt = new TimeFormat(this._hass);
    const now = nowSec();
    const { start, end } = this.window;
    const visible = this.filtered().filter((r) => this.inWindow(r, start, end) || r.id === this._selId);
    const marks = this.securityMarks();

    return html`<ha-card tabindex="0" @keydown=${(e: KeyboardEvent) => this.onKey(e)}>
      ${this._error ? html`<div class="error-banner">${this._error}</div>` : nothing}
      ${this._undo
        ? html`<div class="undo-bar" role="status">
            <span>${this._undo.text}</span>
            <button class="icon-btn" @click=${() => this.undo()}>Undo</button>
          </div>`
        : nothing}
      ${this._narrow
        ? this.renderNarrow(visible, marks, now)
        : html`${this.renderToolbar(false)}
            ${this.renderTimeline(ticks(start, end), visible.filter((r) => this.inWindow(r, start, end)), marks, now)}
            <div class="lower">
              ${this.renderPlayer()}
              <div class="pane-side">${this.renderDetail(marks)} ${this.renderSeen()} ${this.renderQueue()}</div>
            </div>`}
    </ha-card>`;
  }
}

if (!customElements.get('frigate-timeline-card')) {
  customElements.define('frigate-timeline-card', FrigateTimelineCard);
}

declare global {
  interface Window {
    customCards?: { type: string; name: string; description: string; preview?: boolean }[];
  }
}

window.customCards = window.customCards ?? [];
if (!window.customCards.some((c) => c.type === 'frigate-timeline-card')) {
  window.customCards.push({
    type: 'frigate-timeline-card',
    name: 'Frigate Timeline Card',
    description: 'Cross-camera Frigate review timeline with security events and faces.',
  });
}

console.info(`%c FRIGATE-TIMELINE-CARD %c ${VERSION} `, 'background:#ff9800;color:#000', 'background:#333;color:#fff');
