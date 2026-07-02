# StationReminder

Your iPhone dings (and speaks) when you approach your DC Metro station **or bus stop** — even with the phone locked in your pocket. No app install, no accounts, no tracking.

**How?** iOS Shortcuts *"When I arrive"* automations are Apple's built-in geofencing: they run in the background with the screen locked, for free. StationReminder is a small static web app that makes setting them up painless — tap stations or bus stops right on the map (all 98 Metrorail stations, plus 8,300 Metrobus stops across 126 current routes), preview the alert zone, pick a radius and an active time window, and follow steps with everything filled in. Select several at once (e.g. two stations on the Red Line) and the app walks you through them one by one. Setup is ~2 minutes per place, once.

**Map views:** the Rail tab draws the six Metro lines — tap a line chip to zoom to it, then tap stations to select. The Bus tab draws any route with its stops (search by the new route codes like A70 or C51, or by stop name), or just zoom in anywhere to see nearby stops.

## Using it

1. Open the site on your iPhone (Safari) → Share → **Add to Home Screen** (optional, but it works offline that way).
2. **Do the practice run first** ("Do a practice run near home" in the app): create a test automation for a corner near your home, lock the phone, walk out and back in. You should get the notification + spoken line within ~a minute of crossing into the circle.
3. Set up the stations you actually use (a handful, not all 98 — see caveats).
4. Optional: download the **StationReminder Ding** shortcut from the app (open the file → *Add Shortcut*). Automations can then just pass a station name to it — one place to edit the sound/voice for all stations.

### iPhone settings that must be on

- Settings → Privacy & Security → **Location Services** → on, and for **Shortcuts**: *While Using* with **Precise Location ON**
- Wi-Fi toggled on (iOS geofencing uses it for accuracy; you don't need to be connected)
- Avoid Low Power Mode when you're counting on an alert

## Caveats (honest ones)

- **Timing**: iOS fires arrive-triggers ~0–60 s after you cross the boundary. The default 500 m radius gives you warning before you're at the entrance; don't shrink it below ~300 m.
- **Occasional misses**: no geofencing is 100%. Wi-Fi off, Low Power Mode, or a dense urban canyon can delay/skip a trigger.
- **Notification on every run is mandatory** for location automations (Apple's rule) — here that's the point.
- **Don't configure all 98 stations**: iOS has a system limit (~20 monitored regions shared across location automations). Stick to stations you actually use.
- **After a major iOS update**, open one automation and confirm it still says *Run Immediately* (iOS 18.2 once regressed this to asking for confirmation).
- **Speak Text silent?** Edit the action → Show More → pick a specific named voice (the default "Siri voice" is flaky in automations) and check media volume.
- **One ding per arrival**: the trigger re-arms only after you leave the area. That's by design.
- Arriving **by train from underground** may trigger late — GPS is poor in tunnels. The intended use is walking/driving toward a station.

## Development

Fully static, no build step. `python3 -m http.server` in the repo root to run locally.

- `tools/fetch_stations.py` — regenerates `js/stations.js` from Open Data DC (run only if WMATA opens/renames a station)
- `tools/fetch_rail_lines.py` — regenerates `js/rail_lines.js` (simplified line polylines)
- `tools/fetch_bus_data.py` — regenerates `data/bus.json` (routes + stops; derives stop↔route links spatially since the stops layer has none)
- `tools/build_shortcut.sh` — re-signs `shortcut/StationReminder-Ding.shortcut` from the committed XML plist (macOS only)
- `tools/make_icons.py` — regenerates PWA icons (needs Pillow)

## Data & credits

- Station data: [Open Data DC — Metro Stations Regional](https://opendata.dc.gov/datasets/e3896b58a4e741d48ddcda03dae9d21b/about) (98 stations, DC/MD/VA)
- Map: [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright), rendered with [Leaflet](https://leafletjs.com) 1.9.4 (vendored)
- Not affiliated with WMATA or Apple. All geofencing runs on-device via iOS Shortcuts; this site never sees your location.
