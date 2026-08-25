# A2 Native Behavior Feature Validation

Date: 2026-08-26

## Scope

A2 consumes A1 Action Windows and derives deterministic behavior features. This validation uses the five recent native V0.8 sessions already used for the A1 gate (Google/YouTube, Facebook, TikTok, multi-tab/multi-frame, login/post-login interaction).

This is a development dataset gate, not a claim that every family already has enough samples for a learned model.

## Behavior Feature v0.2.0 additions

A2 now includes features that are important for natural execution but were missing from the first skeleton:

```text
pointer path:
  turn-angle statistics
  correction count >=45deg

click:
  pointer down→up hold duration
  down→DOM-action / DOM-action→up timing
  endpoint distance to target center
  endpoint distance normalized by target diagonal

keyboard:
  key hold distributions
  down→down inter-key rhythm
  long-pause count

scroll:
  direction-change / correction ratio
```

Raw Collector facts are unchanged. A2 remains deterministic derived data.

## Native pre-gate observations

Across the five sessions:

```text
DOM clicks checked:             105
clicks with nearby pointer path:104
clicks with down→up pair:        94  (~89.5%)

hover-enter events:            1449
pointer approach coverage:     high (~85–89% by session in the A1 validation)

vertical wheel bursts:          348
horizontal wheel bursts:         27

keyboard down/up hold pairs:    227

derived drag candidates:          1
```

The exact A2 analyzer should be used for future dataset snapshots; these numbers are a spot validation of the native sessions and contract assumptions.

## Distribution observations

Spot distributions show why A3 must use robust empirical sampling rather than a single Gaussian/random-delay rule:

```text
click down→up hold:
  median ~223 ms
  P90    ~235 ms
  observed long tail to ~587 ms

hover dwell facts:
  median ~363 ms
  P90    ~387 ms
  tail   to ~983 ms

vertical scroll absolute burst delta:
  median ~177
  P90    ~494
  long tail present

horizontal scroll absolute burst delta:
  median ~174
  P90    ~447
  fewer samples than vertical

keyboard hold:
  broad / mixed distribution

keyboard inter-key gaps:
  median ~85 ms
  P90    ~243 ms
  very large idle/outlier gaps exist
```

These values are dataset observations, not runtime constants.

## A3 implications

A3 must:

```text
use robust quantiles / bounded empirical sampling
split distributions by action family and target context
separate active typing gaps from idle pauses
avoid treating extreme gaps as ordinary inter-key timing
condition pointer behavior on target geometry/distance when coverage exists
keep horizontal and vertical scroll separate
```

Do not use:

```text
one fixed delay
one global Gaussian
random jitter everywhere
literal replay of a human trajectory
```

## Sparse family rule

Drag remains sparse in the current native sample.

```text
extract drag features: YES
fit confident drag distribution: NO
```

More slider/seek/volume/drag demonstrations should be collected naturally while Agent testing progresses. Do not block the rest of Agent development on drag sample count.

## A2 gate result

The feature contract and distribution analyzer are suitable to proceed toward A3 for well-covered families:

```text
click             ready for empirical baseline
hover             ready for empirical baseline
scrollVertical    ready
scrollHorizontal  usable, lower sample count
keyboard timing   usable with pause/outlier separation
form lead-in      partial/context support

drag              sparse / fallback policy required
```

A3 should start with empirical/context-conditioned baselines and explicit fallbacks, not a complex learned behavior model.
