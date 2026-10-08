# Security

## Model

The card runs inside the Home Assistant frontend with the signed-in user's session. It never talks to Frigate directly. All data and media go through the [Frigate integration](https://github.com/blakeblackshear/frigate-hass-integration), using its WebSocket commands and its authenticated `/api/frigate/...` proxies.

| Input | Trust | Handling |
|---|---|---|
| Card YAML | Dashboard admin | Validated. URLs must be `http(s)` or `/local/...`, colors must match a strict pattern, and `frigate_instance_id` is restricted to `[A-Za-z0-9_.-]`. |
| Frigate review and event data, including live MQTT review messages | Untrusted | Rendered only through Lit text and attribute bindings, never as HTML. Thumbnail paths must be plain relative file paths and are URL-encoded. |
| HLS manifests from Frigate | Untrusted | The session token and VOD signature are attached only to requests for the same window's VOD directory on the Home Assistant origin. Any other URL in a manifest is refused, not fetched. |
| HA entity names and states | HA | Text bindings only. |

## Credentials

- **Session token.** The card uses the HA access token only on same-origin `/api/frigate/<instance>/` requests.
- **VOD signatures.** Signed VOD URLs (`auth/sign_path`) last as long as the clip plus 15 minutes, capped at 4 hours. They are scoped by the integration to one camera and time window.
- **Clip downloads.** These use a 10-minute signed URL.
- **Browser storage.** The card stores only one boolean in `localStorage`: whether synced playback is on.

## Known limits (outside the card)

- **Access to Frigate data.** The integration's WebSocket commands do not require admin. Any HA user who can open the dashboard can read reviews and recordings and mark them reviewed. Restrict the dashboard, or the users, if that matters.
- **Spoofed live events.** Live review updates arrive from Frigate's MQTT `reviews` topic. Anything that can publish to that topic can inject spoofed live items into the UI. Use broker ACLs.

## Reporting

Please open a private security advisory on this repository rather than a public issue.
