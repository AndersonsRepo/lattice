# Lattice Creative Log

Tracks what's been built in each creative cycle so work doesn't repeat.

## Completed

### 2026-03-14 — Live Mode (manual session)
- **What**: Full-screen meditative Canvas experience (`docs/live.html`)
- **Details**: Ported all 11 generative engines to browser JS. 2D life pulses, reaction-diffusion morphs, Julia sets breathe (c parameter orbits), flow field particles stream, L-systems grow stroke by stroke. Auto-cycles through hall-of-fame pieces with 2s crossfade. Vignette overlay. Frosted-glass menu pill with controls.
- **Pages**: `docs/live.html` (new), `docs/index.html` (added Live Mode button + footer link)
- **Inspiration**: The pieces are processes, not images. Unfreezing them was the right move.

### 2026-03-16 — Sonification / Listen Mode (autonomous session)
- **What**: Synesthetic audio experience (`docs/listen.html`) — every piece becomes an ambient soundscape
- **Details**: Web Audio API maps grid rows to pentatonic scale frequencies (C2 base, sine/triangle oscillators). Two modes: **Scan** sweeps a green beam left-to-right across the piece like a music box reading a punched card, driving row amplitudes from column intensity; **Drone** sustains all rows as a slow-modulated ambient wash. Algorithmic reverb (convolved noise IR, 3s tail). Real-time frequency spectrum visualizer. Grid rendered to Canvas with per-type HSL coloring + scan-line glow. Piece selector dots, speed control (0.5×–2×), volume slider. Keyboard shortcuts (space, arrows). "Click to begin" overlay for AudioContext policy. Background glow shifts to match piece type color.
- **Pages**: `docs/listen.html` (new), `docs/index.html` (added Listen button in header + footer link)
- **Inspiration**: The visual pieces encode structure, density, edge activity — all properties that map naturally to sound. A dense region should be loud; a sparse region should whisper. The pentatonic scale ensures everything sounds musical regardless of the data.

## In Progress

(nothing currently)

## Ideas Tried and Abandoned

(none yet)
