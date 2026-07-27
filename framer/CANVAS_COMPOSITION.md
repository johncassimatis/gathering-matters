# Gathering Matters form canvas composition

The two tested form controllers remain the source of truth for submission
behavior. They expose named Framer `ComponentInstance` outlets for the heading,
each field row, each consent row, and the submit button.

To compose a form in Framer:

1. Keep the existing form Code Component as the outer controller.
2. Connect the matching `GmCanvasHeading`, `GmCanvasField`, or
   `GmCanvasSubmitButton` companion component to the corresponding `Canvas ...`
   outlet in the properties panel.
3. Select and resize/reposition the connected piece on the canvas as part of
   the page composition. Leave an outlet empty to use the tested built-in
   renderer.

Only the companion pieces are accepted by the outlets. An arbitrary linked
   Frame falls back to the tested renderer so a designer cannot accidentally
   replace a working input with a decorative layer and lose keyboard, focus,
   validation, or submission behavior.

The controller continues to own source values, API/payload construction,
validation, phone formatting and E.164 normalization, consent requirements,
honeypot handling, loading/error/success states, duplicate-submit protection,
and accessibility wiring. The connected pieces receive those values and event
handlers at runtime; they do not expose backend or validation controls.

The current test pages are intentionally left as the recovery reference until
the Framer draft API accepts the updated code-file records without its
`importMap` assertion error.
