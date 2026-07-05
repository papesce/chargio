## Goal

I'm developing a JavaScript-based macOS battery monitoring application with a graphics-intensive UI (similar to a dashboard). I'm trying to determine the best strategy for monitoring battery information without wasting CPU or unnecessarily polling the system.

## What I observed

I monitored macOS battery/power variables once per second and logged whenever any value changed while repeatedly connecting and disconnecting the power adapter.

From a 300-second run:

* 300 samples collected
* Only 19 samples contained any changes (~6.3%)

The timing pattern looked like this:

```
Stable
↓
~15–16 s
↓
Power event (plug/unplug)
↓
1-second updates for several seconds
↓
5–15 second follow-up update
↓
30–60 second updates while idle
```

Example:

```
10:34:26
10:34:27 (+1s)
10:34:28 (+1s)
10:34:29 (+1s)
10:34:30 (+1s)
10:34:31 (+1s)
10:34:32 (+1s)
10:34:44 (+12s)
10:35:44 (+60s)
10:36:44 (+60s)
```

This suggests macOS itself may use:

* event-driven updates immediately after power changes
* 1 Hz updates while the battery state settles
* slower polling (30–60 s) once stable

## Variable groups observed

Adapter-related variables tend to change together:

* adapter_current_ma
* adapter_voltage_mv
* adapter_watts
* external_connected

Battery telemetry tends to change together:

* amperage_ma
* instant_amperage_ma
* power_w
* voltage_mv

Capacity-related values change less frequently:

* current_capacity
* percent
* max_capacity

`is_charging` often appears several seconds after the plug/unplug event rather than immediately.

## Application architecture

The recommendation was to avoid polling from the rendering loop.

Instead:

```
Renderer (60–120 FPS)
        │
        ▼
Cached battery state
        ▲
        │
Battery monitor
```

The renderer should only consume cached values.

The battery monitor should run independently.

## Suggested polling strategy

Normal operation:

* poll every 30–60 seconds

Immediately after detecting a power source change:

* poll every second for about 10–15 seconds

Then:

* return to 30–60 second polling

This captures the transient behavior while keeping CPU usage minimal.

## If notifications are available

The ideal approach is event-driven.

On macOS, native code can subscribe to IOKit power notifications (IOPSNotificationCreateRunLoopSource), then briefly increase polling after an event.

Example:

```
power notification
    ↓
refresh immediately
    ↓
refresh after 2 seconds
    ↓
refresh after 10 seconds
    ↓
return to idle polling
```

## Since my application is JavaScript

The UI is JavaScript (likely Electron or similar).

Recommended architecture:

```
Renderer
    │
IPC
    │
Main process
    │
Battery monitor
    │
macOS battery APIs
```

The renderer should never execute battery queries every frame.

The main process should:

* perform polling
* cache the latest state
* send updates to the renderer only when values actually change

## Polling implementation

Simple approach:

* poll every 30–60 seconds
* if external_connected changes:

  * switch to 1-second polling for ~10 seconds
  * then return to normal polling

## Native integration

If needed, a small Swift or Objective-C addon could expose macOS battery notifications to JavaScript, eliminating most polling.

## Questions for Claude

I'd like advice on:

1. Whether these observations match how macOS powerd/IOKit actually works.
2. Whether there are undocumented notification APIs that would remove the need for polling.
3. The best architecture for an Electron/Node application.
4. Whether there are existing Node libraries exposing IOKit power notifications.
5. Whether polling every 30–60 seconds plus temporary 1 Hz polling after events is a reasonable strategy, or if there is a better design.
