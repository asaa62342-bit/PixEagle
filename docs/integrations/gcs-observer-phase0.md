# GCS observer integration — gated engineering plan

Status: **Phase 0 implementation candidate only**. No PX4/ArduPilot SITL,
HIL, real aircraft, video streaming or Electron-GCS runtime validation.

## Reviewed baseline

PixEagle `main` review base:
`3d28769165f345c4c0d46dfb04bfd67b25886208`.
Relevant code/contracts:

- `src/classes/api_v1_paths.py` — versioned observation routes
- `src/classes/api_security_policy.py` — default-deny route scopes
- `docs/apis/api-security-policy.md` — bearer token boundaries
- `docs/apis/api-exposure-boundary.md` — network binding, Host/CORS
- `docs/apis/native-integration-context.md` — separate PX4 identity contract
- `docs/architecture/companion-runtime-contract.md` — sidecar ownership
- `docs/WINDOWS_SETUP.md`, `docs/WINDOWS_SITL_XPLANE.md` — Windows limits
- `docs/PROJECT-USE-AND-RELEASE.md` — licenses and field-use boundary

PixEagle has Python/FastAPI, a React dashboard, tracking, video, and a
separate guarded MAVSDK/PX4 publisher. The recommended GCS integration is
**sidecar plus observation API**, not merging flight-control loops.

## Architecture

```text
[Camera / recorded video] → [PixEagle Linux companion]
                                   |
                       Fixed HTTPS/loopback GET API
                       Dedicated scoped bearer token
                                   |
                       [GCS Electron main process]
                       [read-only observer adapter]
                                   |
                         sanitized read-only IPC
                                   |
                         [GCS Arabic RTL panels]

[GCS existing MAVLink/ArduPilot owner]  ← stays independent
[PixEagle follower intents]            ✗ no command bridge
```

Media is a separate future workstream (authenticated MJPEG, WS, WebRTC or
reviewed RTP; decoding, source correlation, latency, resource limits).
Do not send video frames through unbounded JSON IPC.

## Milestones and acceptance evidence

| Gate | Work | Evidence required |
| --- | --- | --- |
| G0 | Pin PixEagle and GCS commits, review dependencies, license, baseline failures, ports and control owners | Redacted inventory and boundary review |
| G1 | Test GET-only observer, token handling, transport failures, redirects, response sizes and timeouts | Node unit tests and checked-in CI result |
| G2 | In GCS Electron main, add feature flag, protected token store, typed read-only IPC and renderer sanitization | IPC allowlist tests; flight IPC unchanged |
| G3 | Run qualified PixEagle Linux companion with scoped token and approved local/HTTPS exposure | TLS/auth/firewall evidence and pinned commit |
| G4 | Add RTL read-only status, target geometry, track confidence, frame age and explicit disconnected/unknown UI | Screenshots, stale/revocation test |
| G5 | Separately validate video transport, decoder, reconnect and resource budgets | Frame decode, FPS/latency and CPU/GPU evidence |
| G6 | Correlate timestamps, runtime instance and *verified* vehicle identity with GCS state on mock/recording | Deterministic fixtures and UID/instance change tests |
| G7 | Optional independently approved PX4 SITL; ArduPilot is a separate adapter project | Exact configs/logs, abort/failsafe and isolation tests |
| G8 | Reproducible packaging, notice/license verification, secret scanning and rollback | Release checklist and operator sign-off |

## Non-negotiable boundaries

1. No automatic PixEagle → MAVLink, ARM/DISARM, Offboard, gimbal,
   tracker-control, model-management or mission-command bridge.
2. A returned API object is observational. HTTP receipt time cannot establish
   fresh camera imagery, telemetry or autopilot ownership.
3. If identity/freshness is not positively verified, UI displays unknown/stale.
   Never assume that PX4 native association proves ArduPilot compatibility.
4. The GCS flight-control owner, arming checks, failsafes, manual control,
   telemetry radio and mission logic remain unchanged.
5. No secret or operational logs are committed. Explicitly scope and revoke
   each bearer; do not expose it to the renderer.
6. A companion failure must never degrade the original GCS's flight interface.
7. Any live camera, simulator, hardware or flight claim requires separate,
   recorded validation. Unit test success is not acceptance.

## Rollback

Disable the observer feature flag, stop its independent polling, revoke the
dedicated bearer token and restore the previously packaged GCS. Do not change
any autopilot parameters or bypass flight safety to recover the integration.
Retain sanitized logs and exact revisions.

## Evidence at authoring

The observer module and tests are proposed within this PR. No GCS source,
Python runtime, camera, media transport, PX4/ArduPilot simulation, or aircraft
was operated as part of this change.
