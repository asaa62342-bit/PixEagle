# PixEagle → GCS read-only observer (Phase 0)

This optional module is a **GET-only observation client** for a trusted Node.js
or Electron **main** process. It is not a flight-control bridge, not a
simulator adapter, and not production acceptance evidence.

## Usage

```js
import { PixEagleObserverClient } from './observer-client.mjs';
const observer = new PixEagleObserverClient({
  baseUrl: 'http://127.0.0.1:5077',
  token: await retrieveTokenFromProtectedOSStore(), // implement in host app
});
const overview = await observer.readOverview();
```

Keep the bearer token inside the privileged main process, never renderer, IPC
responses, logs, repository, URL query strings, or user-facing configuration.
Use a dedicated machine token with only `status:read`, `telemetry:read`,
`media:read`; `media:read` serves media-health observation only.

There is no arbitrary verb/path method and no browser cookie flow. The client
rejects plaintext remote HTTP and redirects. Remote deployments need a reviewed
HTTPS endpoint, firewall/VPN and host/exposure policy. An HTTP success is
**not** vehicle association, freshness, video decoding or permission to
control an aircraft. Every observation reports `associationVerified:false`.

Supported fixed observations:

- `/api/v1/runtime/status`
- `/api/v1/telemetry/health`
- `/api/v1/tracking/runtime-status`
- `/api/v1/tracking/telemetry`
- `/api/v1/following/status`
- `/api/v1/following/telemetry`
- `/api/v1/streams/media-health`

Route-level auth and scopes are defined in
[`docs/apis/api-security-policy.md`](../../docs/apis/api-security-policy.md).
PixEagle's separate native association route is PX4-specific and must not be
mistaken for generic ArduPilot vehicle identity.

## Contract tests

```sh
node --test integrations/gcs-observer/observer-client.test.mjs
```

This does **not** install PixEagle, open a connection to hardware, stream
video, pair an aircraft, or alter any GCS. The host GCS must add its own
allowlisted read-only IPC contract, payload validation, optional UI and
independent media renderer after passing acceptance gates. See
[`docs/integrations/gcs-observer-phase0.md`](../../docs/integrations/gcs-observer-phase0.md).
