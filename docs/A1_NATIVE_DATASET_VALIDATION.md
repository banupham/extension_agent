# A1 Native Dataset Validation Gate

Date: 2026-08-26

Purpose: record the real-session evidence used to close Agent Phase A1. Raw user sessions are not committed to GitHub; this document stores only aggregate engineering metrics.

## Sessions checked

Five V0.8 socket/raw sessions collected during normal Chrome use were checked. They include Google/YouTube, Facebook including login and post-login interactions, TikTok/video/short-drama flows, multi-tab/multi-frame activity, horizontal and vertical scroll, hover, comments/like controls, modal dismissal, and browser/session lifecycle cases.

## A1 rules used

```text
tsEpochMs = global chronological axis
pageSeq/sourceSeq = local ordering
sessionSeq = persistence/integrity only

resolvedTargetDescriptor
→ descriptor/snapshot index
→ targetDescriptor
→ raw descendant fallback

raw hover facts stay untouched
→ generic background hover is filtered only in derived windows
```

A1 `0.1.4` also embeds bounded pointer approach facts before hover and a bounded leave trajectory after hover.

## Aggregate spot-validation

The metrics below are engineering spot checks against native raw using the same A1 target-resolution and 1.2 s hover-approach rules. They are not claims that every window is Strategy-training eligible.

| Session | Events | DOM clicks | Click label coverage | Click semantic label/role | Hover enters with pointer approach | Horizontal scroll bursts | Vertical scroll bursts | Derived drags |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `kfi7k1yy` | 7,480 | 17 | 41.2% | 64.7% | 85.2% | 13 | 80 | 0 |
| `vc52yrpw` | 21,392 | 61 | 67.2% | 72.1% | 84.8% | 6 | 201 | 1 |
| `qsy9yhwt` | 1,510 | 6 | 50.0% | 66.7% | 85.7% | 0 | 6 | 0 |
| `c2mqjspj` | 3,754 | 11 | 63.6% | 81.8% | 85.4% | 8 | 32 | 0 |
| `g8c6qsvy` | 3,887 | 10 | 40.0% | 50.0% | 89.3% | 0 | 29 | 0 |

Label enrichment recovered additional click labels in multiple sessions, especially the large multi-site session and Facebook session. Missing semantics are not fabricated.

## Interpretation

### A1 gate: PASS

A1 now provides enough structure for A2 without requiring A2 to reconstruct raw chronology again:

```text
click-like windows
→ semantic target + bounded physical lead-in + outcome

hover windows
→ semantic target + pointer approach + dwell + optional UI outcome + leave trajectory

scroll windows
→ horizontal/vertical wheel bursts with raw deltas/timing

keyboard windows
→ timing/operation classes without printable human content

drag windows
→ down/move/up point series
```

### Important limitations carried forward

1. Click semantic labels are site-dependent. Strategy eligibility and Behavior eligibility must remain separate. An unlabeled click may be rejected for Strategy training while still being useful for pointer behavior.
2. Real drag demonstrations are currently sparse. A2 must support drag features, but model/distribution fitting must not pretend there is enough drag data yet.
3. Hover pointer approach evidence is strong (~85–89%) but not universal. Missing approach remains a legitimate partial Behavior sample.
4. Horizontal scroll is real and must stay separate from vertical scroll.
5. No raw credential/password/cookie/token/clipboard or printable human key content is introduced by A1.

## Decision

Phase A1 is considered complete after Action Window `0.1.4` CI and this native-data gate.

Next:

```text
A2 Behavior Feature Extractor
→ pointer click/hover/drag geometry + timing
→ wheel burst features
→ keyboard timing/burst features
→ target geometry/context
→ explicit feature quality/missingness
```

A2 output is derived training data. It does not modify Collector raw facts.
