# Frigate Timeline Card

A Home Assistant dashboard card for reviewing Frigate activity across all your cameras on one timeline, with your door, lock and garage sensors drawn on the same time axis and recognised faces shown throughout.

- **Swimlane timeline.** Each camera location has a lane showing Frigate alerts and detections, with recorded motion drawn faintly behind them. Dual-lens cameras collapse to one lane and expand to show the second lens.
- **Triage.** Unreviewed events are solid and reviewed ones are outlined. **Prev / Next event** steps through every event in time order across all cameras. **Mark reviewed & next** works through the backlog. **Mark N reviewed** applies to exactly the events in the current range and filters, with a 10-second undo. Reviewed state is written back to Frigate.
- **Play all in sync.** Every other camera plays on the same clock as the main player, following its play, pause, seek and speed. Click any tile to make it the main view without losing your place.
- **Security lanes.** Contact sensors and covers appear as bars for the time they were open. Locks appear as diamonds when locked or unlocked, and tamper sensors or jammed locks as red diamonds. Clicking a mark jumps to the nearest event on the lane's camera.
- **Familiar faces.** Filter chips per person, a "seen in this range" summary, face names on events and in the queue, and the match score in the detail pane. A person with no face match is labelled "Unknown person".
- **Play any moment.** Clicking an empty spot on a lane plays that camera's recording at that time. The "same moment, other cameras" strip shows what every other location saw.
- **Phone layout.** On a narrow card, the timeline becomes a compact activity strip with an hour-grouped feed. Security events are interleaved and items play inline.
- **Theming.** Follows your Home Assistant theme in both light and dark mode, using `ha-card` and MDI icons.

## Requirements

- Frigate 0.14 or later. Developed against 0.17.
- The [Frigate integration](https://github.com/blakeblackshear/frigate-hass-integration) for Home Assistant. The card talks to Frigate only through it, using its WebSocket commands and authenticated media proxies, so it works remotely through Nabu Casa or a reverse proxy without exposing Frigate directly.

## Install

### HACS (custom repository)

1. Open **HACS**, then the three-dot menu, then **Custom repositories**.
2. Add this repository's URL with the type **Dashboard**.
3. Install **Frigate Timeline Card** and reload the browser.

HACS registers the resource `/hacsfiles/frigate-timeline-card/frigate-timeline-card.js`. If your dashboards use YAML mode, add that resource yourself as a JavaScript module.

### Manual

Download `frigate-timeline-card.js` and the `ftc-*.js` chunk from the latest release into `config/www/frigate-timeline-card/`. Then add `/local/frigate-timeline-card/frigate-timeline-card.js` as a JavaScript module resource. Keep both files in the same folder, because the player loads the chunk the first time it plays something.

## Layout

The card is designed for a **panel view**, which gives a single card the full width:

```yaml
views:
  - title: Cameras
    path: cameras
    type: panel
    cards:
      - type: custom:frigate-timeline-card
        # ...configuration
```

The layout is chosen from the card's own width, not the window's. Below `mobile_breakpoint` (720 px by default) it switches to the phone feed, so the same view works on desktop and in the companion app.

## Configuration

```yaml
type: custom:frigate-timeline-card
frigate_instance_id: frigate     # Frigate's MQTT client_id; "frigate" unless you changed it
default_range: 6h                # 1h | 6h | 24h | 7d
motion: true                     # draw motion density behind lanes (ranges up to 6h)
frigate_url: https://frigate.example.com   # optional: adds an "open in Frigate" button
mobile_breakpoint: 720           # px; below this the card renders the phone feed
colors:                          # optional overrides (any CSS color)
  alert: "#ff9800"
  detection: "#2196f3"
  security: "#9575cd"
  tamper: "#db4437"

cameras:
  - name: Porch
    lenses:                      # first lens is the primary; others appear on expand
      - camera: porch            # Frigate camera key (exact, case-sensitive)
        label: Wide
        entity: camera.porch     # optional: enables the "Live" button (more-info dialog)
      - camera: porch_tele
        label: Tele
  - name: Side gate
    camera: side_gate            # shorthand for a single-lens camera

security:
  - name: Front door
    entities:                    # binary_sensor / cover = open intervals, lock = lock/unlock marks
      - binary_sensor.front_door
      - lock.front_door
    camera: drive                # camera to jump to from this lane's marks
  - name: Garage
    entities: [cover.garage_door]
    tamper: [binary_sensor.garage_tamper]   # 'on' is drawn as a red marker

faces:                           # optional; omit to treat every sub-label on a person as a face
  - name: Alex
    color: "#4db6ac"             # optional avatar color
    image: /local/faces/alex.jpg # optional avatar image
```

## Keyboard

Click the card to give it focus, then:

| Key | Action |
|---|---|
| `→` / `j` | Next event (later) |
| `←` / `k` | Previous event (earlier) |
| `r` | Mark reviewed and go to the next unreviewed event after this one (or the nearest earlier one at the end of the range); un-review if already reviewed |
| `s` | Toggle **Play all in sync** |

On the timeline, drag to pan and use Ctrl/⌘ + scroll to zoom.

## Notes

- **Reviewed state is per Frigate user.** Frigate stores reviewed state per user, and the card marks items through the Frigate integration. Items marked here therefore only show as reviewed in Frigate's own UI if you're logged in there as the same Frigate user the integration uses. On Frigate's unauthenticated internal port, that is Frigate's anonymous user.
- **Security history is limited by the recorder.** Security lanes come from Home Assistant's recorder, so they go back only as far as `recorder: purge_keep_days`, which defaults to 10 days.
- **Face scores are fetched only for the selected event.** Review items carry face names but not scores, so the score is fetched from the event when you select it.
- **Synced playback cost.** Synced mode streams up to nine recordings at once at full resolution, which is heavy on bandwidth and decoding, especially with 4K H.265. Sync is based on time into the requested window, so a camera with a gap in its recording at the start of the window will be offset by that gap.
- **Playback.** The card uses hls.js through the integration's VOD proxy, with your Home Assistant session token. Where Media Source Extensions aren't available, it falls back to a signed MP4 clip URL.

## Development

```bash
npm install
npm run watch      # rebuilds dist/ on change
npm run typecheck
```

`test/harness.html` renders the card against a mocked `hass`. Serve the repo root and open the harness in a browser:

```bash
python3 -m http.server
```

To release, bump `version` in `package.json` (and `VERSION` in `src/frigate-timeline-card.ts`) and push to `main`. GitHub Actions then builds the card and publishes a `v<version>` release, which HACS offers as an update.

## License

MIT
