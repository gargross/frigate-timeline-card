import { css } from 'lit';

export const cardStyles = css`
  :host {
    --ftc-alert: var(--ftc-alert-color, #ff9800);
    --ftc-detection: var(--ftc-detection-color, #2196f3);
    --ftc-security: var(--ftc-security-color, #9575cd);
    --ftc-tamper: var(--ftc-tamper-color, var(--error-color, #db4437));
    --ftc-now: var(--error-color, #db4437);
    --ftc-track: var(--secondary-background-color, rgba(127, 127, 127, 0.12));
    --ftc-motion: color-mix(in srgb, var(--primary-text-color) 10%, transparent);
    --ftc-motion-hit: color-mix(in srgb, var(--primary-text-color) 26%, transparent);
    --ftc-grid: color-mix(in srgb, var(--divider-color, rgba(127, 127, 127, 0.3)) 70%, transparent);
    --ftc-media-bg: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
    --ftc-radius: var(--ha-card-border-radius, 12px);
    --ftc-radius-inner: 8px;
    --ftc-label-w: 172px;
    display: block;
  }

  ha-card {
    padding: 12px 16px 16px;
    outline: none;
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-variant-numeric: tabular-nums;
  }
  ha-card:focus-visible {
    box-shadow: 0 0 0 2px var(--primary-color);
  }

  button {
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  .muted {
    color: var(--secondary-text-color);
  }
  .error-banner {
    padding: 8px 12px;
    border-radius: var(--ftc-radius-inner);
    background: color-mix(in srgb, var(--error-color, #db4437) 15%, transparent);
    color: var(--primary-text-color);
    font-size: 13px;
  }

  /* ---------- toolbar ---------- */
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .seg {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    border-radius: 18px;
    background: var(--ftc-track);
  }
  .seg button {
    border: 0;
    background: transparent;
    height: 32px;
    min-width: 44px;
    padding: 0 12px;
    border-radius: 16px;
    font-size: 13px;
    color: var(--secondary-text-color);
  }
  .seg button[aria-pressed='true'] {
    background: var(--card-background-color, var(--ha-card-background));
    color: var(--primary-text-color);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }
  .chip {
    height: 32px;
    padding: 0 12px;
    border-radius: 16px;
    border: 1px solid var(--divider-color);
    background: transparent;
    font-size: 13px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .chip[aria-pressed='true'] {
    border-color: var(--primary-color);
    background: color-mix(in srgb, var(--primary-color) 14%, transparent);
  }
  .chip.face {
    padding-left: 3px;
  }
  .spacer {
    flex: 1;
  }
  .icon-btn {
    height: 36px;
    min-width: 36px;
    padding: 0 10px;
    border-radius: 18px;
    border: 1px solid var(--divider-color);
    background: transparent;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 13px;
  }
  .icon-btn ha-icon {
    --mdc-icon-size: 18px;
  }
  .primary-btn {
    height: 36px;
    padding: 0 16px;
    border-radius: 18px;
    border: 0;
    background: var(--primary-color);
    color: var(--text-primary-color, #fff);
    font-size: 14px;
    font-weight: 500;
  }
  .count {
    font-size: 13px;
    color: var(--secondary-text-color);
  }
  .count b {
    color: var(--ftc-alert);
    font-weight: 600;
  }

  .avatar {
    flex: none;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    color: rgba(0, 0, 0, 0.8);
    overflow: hidden;
    background-size: cover;
    background-position: center;
  }
  .avatar.unknown {
    background: var(--ftc-track);
    color: var(--secondary-text-color);
  }

  /* ---------- timeline ---------- */
  .timeline {
    overflow-x: auto;
    user-select: none;
    -webkit-user-select: none;
  }
  .timeline-inner {
    min-width: 720px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row {
    display: grid;
    grid-template-columns: var(--ftc-label-w) minmax(0, 1fr);
    height: 34px;
  }
  .row.sub {
    height: 28px;
  }
  .row.sec {
    height: 24px;
  }
  .row-label {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding-right: 10px;
    font-size: 13px;
  }
  .row-label .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row.sub .row-label {
    color: var(--secondary-text-color);
    font-size: 12px;
    padding-left: 28px;
  }
  .row.sec .row-label {
    font-size: 12px;
    color: var(--secondary-text-color);
  }
  .expander {
    width: 24px;
    height: 24px;
    flex: none;
    border: 0;
    border-radius: 6px;
    background: var(--ftc-track);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .expander ha-icon {
    --mdc-icon-size: 16px;
    transition: transform 0.15s;
  }
  .expander[aria-expanded='true'] ha-icon {
    transform: rotate(90deg);
  }
  .no-expander {
    width: 24px;
    flex: none;
  }
  .lens-tag {
    font-size: 10px;
    color: var(--secondary-text-color);
    border: 1px solid var(--divider-color);
    border-radius: 4px;
    padding: 0 4px;
  }
  .track {
    position: relative;
    background: var(--ftc-track);
    border-radius: 6px;
    overflow: hidden;
    cursor: crosshair;
  }
  .row.sec .track {
    background: transparent;
    border: 1px dashed var(--ftc-grid);
  }
  .axis {
    position: relative;
    height: 18px;
    font-size: 11px;
    color: var(--secondary-text-color);
  }
  .axis span {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    white-space: nowrap;
  }
  .gridline {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--ftc-grid);
    pointer-events: none;
  }
  .nowline {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--ftc-now);
    pointer-events: none;
    z-index: 4;
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--primary-text-color);
    opacity: 0.7;
    pointer-events: none;
    z-index: 4;
  }
  .motion {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: flex-end;
    gap: 1px;
    pointer-events: none;
  }
  .motion span {
    flex: 1;
    background: var(--ftc-motion);
    border-radius: 1px 1px 0 0;
  }
  .block {
    position: absolute;
    top: 5px;
    bottom: 5px;
    min-width: 6px;
    border: 0;
    padding: 0;
    border-radius: 4px;
    z-index: 2;
  }
  .row.sub .block {
    top: 4px;
    bottom: 4px;
  }
  .block.alert {
    background: var(--ftc-alert);
  }
  .block.detection {
    background: var(--ftc-detection);
  }
  /* Reviewed = hollow outline in the severity color; unreviewed = solid. */
  .block.reviewed {
    background: transparent !important;
    background-image: none;
  }
  .block.alert.reviewed {
    box-shadow: inset 0 0 0 2px var(--ftc-alert);
  }
  .block.detection.reviewed {
    box-shadow: inset 0 0 0 2px var(--ftc-detection);
  }
  .block.inprogress {
    background-image: repeating-linear-gradient(
      -45deg,
      transparent 0 4px,
      rgba(255, 255, 255, 0.28) 4px 8px
    );
  }
  .block.selected {
    z-index: 3;
    box-shadow:
      0 0 0 2px var(--card-background-color, var(--ha-card-background, #fff)),
      0 0 0 4px var(--primary-text-color);
  }
  .block.alert.reviewed.selected {
    box-shadow:
      inset 0 0 0 2px var(--ftc-alert),
      0 0 0 2px var(--card-background-color, var(--ha-card-background, #fff)),
      0 0 0 4px var(--primary-text-color);
  }
  .block.detection.reviewed.selected {
    box-shadow:
      inset 0 0 0 2px var(--ftc-detection),
      0 0 0 2px var(--card-background-color, var(--ha-card-background, #fff)),
      0 0 0 4px var(--primary-text-color);
  }
  .face-dot {
    position: absolute;
    top: -3px;
    right: -3px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1.5px solid var(--card-background-color, #fff);
    pointer-events: none;
  }
  .sec-interval {
    position: absolute;
    top: 7px;
    bottom: 7px;
    min-width: 4px;
    border: 0;
    padding: 0;
    border-radius: 3px;
    background: var(--ftc-security);
    opacity: 0.75;
    z-index: 2;
  }
  .sec-point {
    position: absolute;
    top: 50%;
    width: 11px;
    height: 11px;
    margin: -5.5px 0 0 -5.5px;
    border: 0;
    padding: 0;
    transform: rotate(45deg);
    border-radius: 2px;
    background: var(--ftc-security);
    z-index: 3;
  }
  .sec-point.tamper,
  .sec-point.jammed {
    background: var(--ftc-tamper);
  }
  .section-label {
    margin-top: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--divider-color);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--secondary-text-color);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    font-size: 12px;
    color: var(--secondary-text-color);
    align-items: center;
  }
  .legend i {
    display: inline-block;
    width: 14px;
    height: 10px;
    border-radius: 3px;
    margin-right: 6px;
    vertical-align: -1px;
  }
  .legend i.outline {
    background: transparent;
    box-shadow: inset 0 0 0 2px var(--secondary-text-color);
  }
  .legend i.diamond {
    width: 9px;
    height: 9px;
    border-radius: 1px;
    transform: rotate(45deg);
  }
  .hint {
    font-size: 11px;
    color: var(--secondary-text-color);
  }

  /* ---------- lower panes ---------- */
  .lower {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: flex-start;
  }
  .pane-player {
    flex: 999 1 560px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .pane-side {
    flex: 1 1 320px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .panel {
    border: 1px solid var(--divider-color);
    border-radius: var(--ftc-radius-inner);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h3 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--secondary-text-color);
  }
  .player-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }
  .player-head .title {
    font-size: 16px;
    font-weight: 500;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .moment {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px;
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px;
    border-radius: var(--ftc-radius-inner);
    border: 1px solid var(--divider-color);
    background: transparent;
    text-align: left;
  }
  .tile.active {
    border-color: var(--ftc-alert);
  }
  .tile ftc-auth-img,
  .tile .ph {
    aspect-ratio: 16 / 9;
    border-radius: 6px;
  }
  .tile .ph {
    background: var(--ftc-media-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    color: var(--secondary-text-color);
  }
  .tile .name {
    font-size: 12px;
    padding: 0 2px 2px;
  }
  .detail-title {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .detail-title .big {
    font-size: 20px;
    font-weight: 500;
  }
  .pill {
    font-size: 12px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
    color: rgba(0, 0, 0, 0.85);
  }
  .pill.alert {
    background: var(--ftc-alert);
  }
  .pill.detection {
    background: var(--ftc-detection);
    color: #fff;
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr);
    row-gap: 6px;
    font-size: 13px;
  }
  dt {
    color: var(--secondary-text-color);
  }
  dd {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .rel {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
  }
  .rel .diamond {
    width: 8px;
    height: 8px;
    flex: none;
    transform: rotate(45deg);
    background: var(--ftc-security);
  }
  .rel .diamond.tamper {
    background: var(--ftc-tamper);
  }
  .rel .grow {
    flex: 1;
    min-width: 0;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 320px;
    overflow-y: auto;
    margin: 0 -6px;
  }
  .list-item {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 40px;
    padding: 4px 6px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    font-size: 13px;
  }
  .list-item[aria-current='true'] {
    background: var(--ftc-track);
  }
  .list-item .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .list-item .sub {
    font-size: 12px;
    color: var(--secondary-text-color);
  }
  .sev-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .sev-dot.alert {
    background: var(--ftc-alert);
  }
  .sev-dot.detection {
    background: var(--ftc-detection);
  }

  .notice {
    padding: 6px 12px;
    border-radius: var(--ftc-radius-inner);
    background: color-mix(in srgb, var(--primary-color) 12%, transparent);
    font-size: 13px;
  }
  .status {
    display: inline-flex;
    align-items: center;
    font-size: 12px;
    font-weight: 500;
    padding: 1px 8px;
    border-radius: 10px;
    margin-left: 8px;
    vertical-align: 1px;
  }
  dd .status {
    margin-left: 0;
  }
  .status.todo {
    background: color-mix(in srgb, var(--ftc-alert) 20%, transparent);
    color: var(--primary-text-color);
  }
  .status.done {
    background: color-mix(in srgb, var(--success-color, #43a047) 20%, transparent);
    color: var(--primary-text-color);
  }
  .nav-pos {
    font-size: 12px;
    color: var(--secondary-text-color);
    min-width: 56px;
    text-align: center;
  }
  .divider {
    width: 1px;
    height: 24px;
    background: var(--divider-color);
    margin: 0 4px;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .moment-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .moment-head .chip ha-icon,
  .quiet .chip ha-icon {
    --mdc-icon-size: 16px;
  }
  .quiet {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }
  .sync-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 8px;
  }
  .sync-tile {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px;
    border-radius: var(--ftc-radius-inner);
    border: 1px solid var(--divider-color);
    background: transparent;
    text-align: left;
  }
  .sync-tile.active {
    border-color: var(--ftc-alert);
  }
  .sync-tile ftc-player {
    pointer-events: none;
    border-radius: 6px;
  }
  .sync-tile .name {
    font-size: 12px;
    padding: 0 2px 2px;
  }
  .undo-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 6px 6px 14px;
    border-radius: var(--ftc-radius-inner);
    background: var(--primary-text-color);
    color: var(--card-background-color, #fff);
    font-size: 14px;
  }
  .undo-bar span {
    flex: 1;
  }
  .undo-bar .icon-btn {
    border-color: transparent;
    color: var(--primary-color);
    font-weight: 600;
  }

  .date-nav {
    display: flex;
    align-items: center;
    gap: 2px;
    position: relative;
    min-width: 0;
  }
  .date-step {
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: var(--ftc-track);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }
  .date-step ha-icon {
    --mdc-icon-size: 16px;
  }
  .date-btn {
    border: 0;
    background: transparent;
    padding: 2px 4px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-decoration: underline dotted;
    text-underline-offset: 3px;
  }
  .date-btn:hover {
    background: var(--ftc-track);
  }
  /* Native date input kept in the DOM for showPicker(), anchored under the label. */
  .date-input {
    position: absolute;
    left: 28px;
    top: 100%;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
    border: 0;
    padding: 0;
  }
  .filter-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 6px 4px 12px;
    border-radius: var(--ftc-radius-inner);
    background: color-mix(in srgb, var(--primary-color) 12%, transparent);
    font-size: 13px;
  }
  .filter-banner ha-icon {
    --mdc-icon-size: 18px;
    color: var(--primary-color);
  }
  .filter-banner span {
    flex: 1;
  }

  /* ---------- narrow / phone feed ---------- */
  .strip .row {
    height: 14px;
    grid-template-columns: 70px minmax(0, 1fr);
  }
  .strip .row-label {
    font-size: 10px;
    padding-right: 6px;
  }
  .strip .track {
    border-radius: 4px;
  }
  .strip .block {
    top: 2px;
    bottom: 2px;
    min-width: 4px;
    border-radius: 2px;
  }
  .seen-row {
    display: flex;
    gap: 12px;
    overflow-x: auto;
    align-items: center;
  }
  .seen-row button {
    border: 0;
    background: transparent;
    padding: 2px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    border-radius: 16px;
  }
  .seen-row button[aria-pressed='true'] {
    box-shadow: 0 0 0 2px var(--primary-color);
  }
  .feed {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .feed h4 {
    margin: 8px 0 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--secondary-text-color);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .feed-item {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 6px;
    border-radius: 10px;
    border: 1px solid var(--divider-color);
    background: transparent;
    text-align: left;
    width: 100%;
    box-sizing: border-box;
  }
  .feed-item.alert {
    border-color: color-mix(in srgb, var(--ftc-alert) 45%, var(--divider-color));
  }
  .feed-item.reviewed {
    opacity: 0.6;
  }
  .feed-item ftc-auth-img,
  .feed-item .ph {
    width: 112px;
    height: 63px;
    flex: none;
    border-radius: 6px;
  }
  .feed-item .ph {
    background: var(--ftc-media-bg);
  }
  .feed-item .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .feed-item .t1 {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    font-size: 14px;
  }
  .feed-item .t2 {
    font-size: 13px;
    color: var(--secondary-text-color);
  }
  .feed-sec {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 32px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px dashed var(--divider-color);
    font-size: 13px;
    color: var(--secondary-text-color);
  }
  .feed-sec .diamond {
    width: 8px;
    height: 8px;
    transform: rotate(45deg);
    background: var(--ftc-security);
    flex: none;
  }
  .feed-sec .diamond.tamper {
    background: var(--ftc-tamper);
  }
  .feed-player {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    border-radius: 10px;
    background: var(--ftc-track);
  }
  .empty {
    padding: 16px 0;
    text-align: center;
    color: var(--secondary-text-color);
    font-size: 14px;
  }
`;
