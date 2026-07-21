# Professional App Refinement & Bug Fixes

This plan addresses the critical bugs reported (Call issues, Voice selection, Speech-to-Text errors) and adds professional-grade enhancements.

## User Review Required

> [!IMPORTANT]
> The "Network Error" in voice recognition usually means the device's Google Speech service is unavailable or lacks permission. I will add a more robust permission check and a fallback.
>
> The Call buttons may be unresponsive due to z-index conflicts or script errors. I will add global error safety to all button handlers.

## Proposed Changes

### [Component] JavaScript UI & Logic
#### [MODIFY] [script.js](file:///C:/Users/hasan/Desktop/ReemApp/ReemApp_Ultra_FIXED/ReemApp_Ultra_Gemini_UI_updated/public/script.js)
*   **Speech-to-Text**: Improve `NativeSpeechRecognitionShim` with explicit permission requests and better error classification.
*   **Call Feature**: Fix `endCall` and `startCall` with try-catch blocks and ensure `speechSynthesis` safety. Fix z-index/overlay issues.
*   **Voice Selection**: Fix the `voiceSelect` population and event handling to ensure it works on all Android versions.
*   **Haptic Feedback**: Add subtle vibrations for button presses (using Capacitor Haptics).
*   **UI Resilience**: Add a connection retry mechanism and smoother animations.

### [Component] CSS Styling
#### [MODIFY] [style.css](file:///C:/Users/hasan/Desktop/ReemApp/ReemApp_Ultra_FIXED/ReemApp_Ultra_Gemini_UI_updated/public/style.css)
*   Fix `voice-select` visibility and touch target size.
*   Ensure `call-overlay` buttons are always on top and have a larger touch area.
*   Improve sidebar and sheet transitions for a "premium" feel.

### [Component] Android Integration
#### [MODIFY] [package.json](file:///C:/Users/hasan/Desktop/ReemApp/ReemApp_Ultra_FIXED/ReemApp_Ultra_Gemini_UI_updated/package.json)
*   Add `@capacitor/haptics` for professional touch feedback.

---

## Verification Plan

### Automated Tests
*   `npx cap sync android` to ensure all new plugins (Haptics) are linked.
*   `./gradlew assembleDebug` to verify the build.

### Manual Verification
1.  **Call Test**: Start a call, verify "End Call" stops everything immediately.
2.  **Voice Test**: Change voice from the dropdown, verify the speaker's voice changes.
3.  **Mic Test**: Press mic, verify it asks for permission and doesn't show "Network Error" immediately if internet is present.
