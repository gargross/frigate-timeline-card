import { LitElement, css, html, nothing } from 'lit';
import type { HomeAssistant } from '../types';

const cache = new Map<string, Promise<string | null>>();

export async function authFetch(hass: HomeAssistant, path: string): Promise<Response> {
  if (hass.fetchWithAuth) return hass.fetchWithAuth(path);
  return fetch(hass.hassUrl(path), {
    headers: { Authorization: `Bearer ${hass.auth.data.access_token}` },
  });
}

function load(hass: HomeAssistant, path: string): Promise<string | null> {
  let p = cache.get(path);
  if (!p) {
    p = authFetch(hass, path)
      .then(async (res) => (res.ok ? URL.createObjectURL(await res.blob()) : null))
      .catch(() => null);
    cache.set(path, p);
    // Drop failures so a later render can retry.
    void p.then((v) => {
      if (v === null) cache.delete(path);
    });
  }
  return p;
}

/** An <img> whose source sits behind Home Assistant auth (Frigate proxy thumbnails). */
export class FtcAuthImg extends LitElement {
  static properties = {
    hass: { attribute: false },
    path: { type: String },
    alt: { type: String },
    _src: { state: true },
  };

  declare hass: HomeAssistant;
  declare path: string | null;
  declare alt: string;
  declare _src: string | null;
  private _loadedPath: string | null = null;

  constructor() {
    super();
    this.path = null;
    this.alt = '';
    this._src = null;
  }

  static styles = css`
    :host {
      display: block;
      overflow: hidden;
      background: var(--ftc-media-bg);
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
  `;

  protected updated(): void {
    if (this.hass && this.path && this.path !== this._loadedPath) {
      const path = this.path;
      this._loadedPath = path;
      this._src = null;
      void load(this.hass, path).then((src) => {
        if (this.path === path) this._src = src;
      });
    }
  }

  protected render() {
    return this._src ? html`<img src=${this._src} alt=${this.alt} loading="lazy" />` : nothing;
  }
}

if (!customElements.get('ftc-auth-img')) customElements.define('ftc-auth-img', FtcAuthImg);
