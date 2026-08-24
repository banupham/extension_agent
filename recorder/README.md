# Browser Action Recorder V3.6 Deterministic

- Base scenario is deterministic.
- Text editing is exported as final `replaceText`.
- Backspace/Delete inside text inputs are absorbed into that final value, so replay does not apply the edit twice.
- Backspace/Delete outside editable fields are still recorded as `pressKey`.
- Scroll is exported as absolute `scrollTo`.
- Export directory memory from V3.4/V3.5 is preserved.
