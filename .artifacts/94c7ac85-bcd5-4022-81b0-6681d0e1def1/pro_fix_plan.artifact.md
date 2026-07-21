# Deep Fix for Voice, Call & UI Issues

This plan addresses the persistent "Network Error" in speech recognition, the unresponsive call buttons, and the empty voice selection.

## Proposed Changes

### [Component] JavaScript (script.js)
1.  **Speech Recognition**:
    - Update `_mapError` to capture and log the specific Capacitor error.
    - Change the default error from "network" to something more descriptive if unknown.
    - Ensure the microphone is stopped correctly before restarting.
2.  **Call Feature**:
    - Add `onclick` directly to elements in addition to `addEventListener` as a failsafe.
    - Add a "Force Close" mechanism for the Call Overlay.
    - Improve server response handling during calls.
3.  **Voice Selection**:
    - Implement a "Retry" mechanism for fetching voices. Sometimes they take a few seconds to load in the Android WebView.
    - Ensure the dropdown is populated even if `onvoiceschanged` hasn't fired yet.

### [Component] CSS (style.css)
- Ensure `.call-overlay` and `.call-controls` have absolute top-level z-indexing and no overlapping transparent parents.
- Add active states to buttons to show they are being pressed.

### [Component] Android (AndroidManifest.xml)
- Add `RECORD_AUDIO` to `<queries>` as well (sometimes needed for visibility on certain OS versions).
