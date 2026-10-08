import { LitElement, css, html, nothing, svg } from 'lit';
import type HlsType from 'hls.js/light';
import { isFrigateProxyPath, type FrigateApi } from '../data/frigate';
import type { HomeAssistant } from '../types';

let hlsPromise: Promise<typeof HlsType | null> | null = null;

/** hls.js is ~360 kB, so it is split into its own chunk and fetched on first playback. */
function loadHls(): Promise<typeof HlsType | null> {
  hlsPromise ??= import('hls.js/light').then((m) => m.default).catch((err) => {
    console.warn('frigate-timeline-card: could not load hls.js', err);
    hlsPromise = null;
    return null;
  });
  return hlsPromise;
}

/** A tracked object's path to draw over the video (coordinates normalized 0–1 to the frame). */
export interface OverlayPath {
  label: string;
  color: string;
  points: { x: number; y: number; t: number }[];
  /** normalized [x, y, w, h] best box, used when there is no path */
  box?: [number, number, number, number];
}

/** Lead-in / lead-out around the review window, in seconds. */
const PAD = 10;

/**
 * Plays a Frigate recording window through the integration's VOD proxy.
 * hls.js (MSE / ManagedMediaSource) with a bearer token where available;
 * otherwise a signed MP4 clip URL for native <video>.
 */
export class FtcPlayer extends LitElement {
  static properties = {
    hass: { attribute: false },
    api: { attribute: false },
    camera: { type: String },
    start: { type: Number },
    end: { attribute: false },
    follower: { type: Boolean, reflect: true },
    position: { attribute: false },
    paths: { attribute: false },
    _error: { state: true },
    _rect: { state: true },
    _wall: { state: true },
  };

  declare hass: HomeAssistant;
  declare api: FrigateApi;
  declare camera: string;
  declare start: number;
  declare end: number | null;
  /** Follower in a synced group: no controls, always muted, driven by the card. */
  declare follower: boolean;
  /** Seconds into the window to start at (used once per load; e.g. when swapping views). */
  declare position: number | null;
  declare paths: OverlayPath[] | null;
  declare _error: string | null;
  /** Where the picture sits inside the element (video is letterboxed). */
  declare _rect: { left: number; top: number; width: number; height: number } | null;
  declare _wall: number | null;
  private resizeObs?: ResizeObserver;

  private hls: HlsType | null = null;
  private loadedKey = '';

  constructor() {
    super();
    this._error = null;
    this.end = null;
    this.follower = false;
    this.position = null;
    this.paths = null;
    this._rect = null;
    this._wall = null;
  }

  private measure(): void {
    const v = this.video;
    if (!v || !v.videoWidth || !v.videoHeight) return;
    const W = this.clientWidth;
    const H = this.clientHeight;
    const s = Math.min(W / v.videoWidth, H / v.videoHeight);
    const width = v.videoWidth * s;
    const height = v.videoHeight * s;
    const r = { left: (W - width) / 2, top: (H - height) / 2, width, height };
    const o = this._rect;
    if (!o || Math.abs(o.left - r.left) + Math.abs(o.top - r.top) + Math.abs(o.width - r.width) > 1) this._rect = r;
  }

  static styles = css`
    :host {
      display: block;
      position: relative;
      aspect-ratio: 16 / 9;
      background: #000;
      border-radius: var(--ftc-radius-inner);
      overflow: hidden;
    }
    video {
      width: 100%;
      height: 100%;
      display: block;
      background: #000;
    }
    :host([follower]) .error {
      font-size: 11px;
      padding: 6px;
    }
    .overlay {
      position: absolute;
      pointer-events: none;
    }
    .overlay svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .tag {
      position: absolute;
      transform: translate(-50%, calc(-100% - 10px));
      padding: 1px 6px;
      border-radius: 4px;
      font: 600 12px/1.4 system-ui, sans-serif;
      color: #000;
      white-space: nowrap;
    }
    .error {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      text-align: center;
      color: #fff;
      font-size: 14px;
      background: rgba(0, 0, 0, 0.7);
    }
  `;

  get video(): HTMLVideoElement | null {
    return this.renderRoot.querySelector('video');
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObs?.disconnect();
    this.resizeObs = undefined;
    this.teardown();
    this.loadedKey = '';
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.resizeObs = new ResizeObserver(() => this.measure());
    this.resizeObs.observe(this);
    if (this.hasUpdated) void this.load();
  }

  private teardown(): void {
    this.hls?.destroy();
    this.hls = null;
  }

  protected updated(): void {
    void this.load();
  }

  /** Window start (wall-clock seconds) that currentTime 0 corresponds to. */
  get windowStart(): number {
    return this.start - PAD;
  }

  private window(): { from: number; to: number } {
    const to = (this.end ?? Date.now() / 1000) + PAD;
    return { from: this.start - PAD, to };
  }

  private async load(): Promise<void> {
    if (!this.hass || !this.api || !this.camera || !this.start) return;
    const key = `${this.camera}|${this.start}|${this.end ?? 'live'}`;
    if (key === this.loadedKey) return;
    this.loadedKey = key;
    this._error = null;
    this.teardown();

    const video = this.video;
    if (!video) return;
    const { from, to } = this.window();
    const seekTo = this.position ?? Math.max(0, PAD - 3);

    const Hls = await loadHls();
    if (this.loadedKey !== key) return;
    if (Hls?.isSupported()) {
      // Released Frigate integrations (≤ v5.15.6) reject Bearer-authenticated VOD
      // *segments*; they only accept the manifest's signature (authSig) repeated on
      // each segment URL. Sign the manifest once and append its authSig to every
      // request hls.js makes. The Bearer header is kept for newer integrations.
      // Signature lifetime: long enough to play the window at 1×, plus margin; not hours.
      const lifetime = Math.min(4 * 3600, Math.max(900, Math.ceil(to - from) + 900));
      let url: string;
      let sig: string | null = null;
      try {
        url = await this.api.signPath(this.api.vodPath(this.camera, from, to), lifetime);
        sig = new URL(url).searchParams.get('authSig');
      } catch {
        url = this.hass.hassUrl(this.api.vodPath(this.camera, from, to));
      }
      if (this.loadedKey !== key) return;
      // Credentials (bearer token, authSig) are attached ONLY to requests for this
      // window's VOD directory on the Home Assistant origin. A manifest is data from
      // Frigate; any segment URL pointing elsewhere is refused rather than fetched.
      const haOrigin = new URL(this.hass.hassUrl('/')).origin;
      const vodBase = this.api.vodBase(this.camera, from, to) + '/';
      const instanceId = this.api.instanceId;
      const hls = new Hls({
        xhrSetup: (xhr: XMLHttpRequest, reqUrl: string) => {
          const u = new URL(reqUrl, url);
          if (u.origin !== haOrigin || !u.pathname.startsWith(vodBase) || !isFrigateProxyPath(instanceId, u.pathname)) {
            throw new Error(`frigate-timeline-card: blocked off-origin media request ${u.origin}${u.pathname}`);
          }
          if (sig && !u.searchParams.has('authSig')) u.searchParams.set('authSig', sig);
          xhr.open('GET', u.toString(), true);
          xhr.setRequestHeader('Authorization', `Bearer ${this.hass.auth.data.access_token}`);
        },
        startPosition: seekTo,
      });
      this.hls = hls;
      hls.on(Hls.Events.ERROR, (_e: unknown, data: { fatal: boolean; details: string }) => {
        if (data.fatal) {
          const missing = data.details === 'manifestLoadError';
          this._error = this.follower
            ? 'No recording for this time'
            : missing
              ? 'Frigate has no recording for this camera at this time.'
              : `Playback failed (${data.details}).`;
          this.teardown();
        }
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => void video.play().catch(() => undefined));
      return;
    }

    // Native fallback: signed MP4 clip (served whole; fine for event-length windows).
    try {
      const src = await this.api.signPath(this.api.clipPath(this.camera, from, to), 3600);
      if (this.loadedKey !== key) return;
      video.src = src;
      video.addEventListener(
        'loadedmetadata',
        () => {
          video.currentTime = seekTo;
          void video.play().catch(() => undefined);
        },
        { once: true },
      );
    } catch {
      this._error = 'Could not sign the clip URL.';
    }
  }

  skip(seconds: number): void {
    const v = this.video;
    if (v) v.currentTime = Math.max(0, v.currentTime + seconds);
  }

  setRate(rate: number): void {
    const v = this.video;
    if (v) v.playbackRate = rate;
  }

  private onTimeUpdate(e: Event): void {
    if (this.follower) return;
    const v = e.target as HTMLVideoElement;
    this._wall = this.windowStart + v.currentTime;
    this.dispatchEvent(
      new CustomEvent('ftc-time', { detail: { wall: this.windowStart + v.currentTime }, bubbles: true, composed: true }),
    );
  }

  private renderOverlay() {
    const r = this._rect;
    if (!r || !this.paths?.length || this.follower) return nothing;
    const now = this._wall ?? this.start;
    const pt = (p: { x: number; y: number }) => `${p.x},${p.y}`;
    return html`<div
      class="overlay"
      style="left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px"
      aria-hidden="true"
    >
      <svg viewBox="0 0 1 1" preserveAspectRatio="none">
        ${this.paths.map((p) => {
          if (p.points.length < 2) {
            if (!p.box) return nothing;
            const [x, y, w, h] = p.box;
            return svg`<rect x=${x} y=${y} width=${w} height=${h} fill="none" stroke=${p.color} stroke-width="2.5" vector-effect="non-scaling-stroke"></rect>`;
          }
          const done = p.points.filter((q) => q.t <= now);
          return svg`
            <polyline points=${p.points.map(pt).join(' ')} fill="none" stroke=${p.color} stroke-opacity="0.55"
              stroke-width="2" stroke-dasharray="6 5" vector-effect="non-scaling-stroke"></polyline>
            ${done.length > 1
              ? svg`<polyline points=${done.map(pt).join(' ')} fill="none" stroke=${p.color} stroke-width="3.5"
                  stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"></polyline>`
              : nothing}`;
        })}
      </svg>
      ${this.paths.map((p) => {
        if (!p.points.length) return nothing;
        const first = p.points[0];
        const done = p.points.filter((q) => q.t <= now);
        const cur = done[done.length - 1] ?? first;
        return html`
          <span style="position:absolute;left:${first.x * 100}%;top:${first.y * 100}%;width:10px;height:10px;margin:-6px 0 0 -6px;border:2px solid ${p.color};border-radius:50%;box-sizing:content-box"></span>
          <span style="position:absolute;left:${cur.x * 100}%;top:${cur.y * 100}%;width:14px;height:14px;margin:-9px 0 0 -9px;background:${p.color};border:2px solid #fff;border-radius:50%;box-sizing:content-box"></span>
          <span class="tag" style="left:${cur.x * 100}%;top:${cur.y * 100}%;background:${p.color}">${p.label}</span>`;
      })}
    </div>`;
  }

  protected render() {
    return html`<video
        @loadedmetadata=${() => this.measure()}
        ?controls=${!this.follower}
        playsinline
        muted
        @timeupdate=${(e: Event) => this.onTimeUpdate(e)}
      ></video>
      ${this.renderOverlay()}
      ${this._error ? html`<div class="error">${this._error}</div>` : null}`;
  }
}

if (!customElements.get('ftc-player')) customElements.define('ftc-player', FtcPlayer);
