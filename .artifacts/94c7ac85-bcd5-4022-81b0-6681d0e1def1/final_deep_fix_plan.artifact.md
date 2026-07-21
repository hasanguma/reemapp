# Final Deep Fix Plan - Stability & Responsiveness

The previous fixes failed because of unhandled `TypeError` crashes and CSS `!important` conflicts. This plan will eliminate these issues.

## Proposed Changes

### [Component] JavaScript (script.js)
1.  **Global Speech Safety**: Replace all direct `window.speechSynthesis` calls with a safe wrapper function.
2.  **Call Button Reliability**:
    - Ensure `endCall` is globally accessible.
    - Use `callOverlay.style.setProperty('display', 'flex', 'important')` to override CSS issues.
3.  **Speech Recognition Fallback**:
    - Better handling of "service not available".
    - Detect if the user is on an emulator and show a helpful tip.

### [Component] HTML (index.html)
- Add `onclick="endCall()"` to the end call button.
- Add `onclick="startCall()"` to the call button.

### [Component] CSS (style.css)
- Remove `!important` from general `.hidden` class to allow JS overrides.
- Explicitly define `.call-overlay` visibility states.
