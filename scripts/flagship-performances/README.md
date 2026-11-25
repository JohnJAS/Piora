# Piora Flagship Tier 2 Performances

`scripts/bake-flagship-performances.py` renders the locally baked 30 fps VP9 `.webm` performance clips for Piora's Day & Night Whale-girl flagship themes (`1664x936`, exact 16:9 aspect ratio, even dimensions for `yuv420p` compatibility).

## Outputs

- `public/themes/piora-flagship/performances/whale-night-celebrate.webm` (150 frames / 5.0 s) — Night edition celebration ("Awakened Abyssal Orb & Spirit Whale"): crystal orb blooms, head/hair-fin/tail lift in joy, bioluminescent spirit whale rises from the orb across the upper-right conservatory glass, then settles back to the exact rest pose.
- `public/themes/piora-flagship/performances/whale-night-salute.webm` (96 frames / 3.2 s) — Night edition attentive greeting ("Warm Orb Signal"): crisp hair-fin perk, gentle attentive head tilt & blink, and warm amber-gold/cyan orb halo pulse for `review` approval moments.
- `public/themes/piora-flagship/performances/whale-day-salute.webm` (96 frames / 3.2 s) — Day edition greeting ("Sunlit Teacup Toast"): clean-plate articulated teacup lift & tail sweep, sparkling blink, morning sunbeam glint, and drifting sunlit petals/sparkles on the right third.

Note: `piora-whale-day`'s `celebrate` performance reuses the existing 60 fps terrace dance clip (`/themes/character-backgrounds/performances/whale-tide-actor.webm` + `whale-tide-stage.webp`).

## Regenerating

```bash
python scripts/bake-flagship-performances.py
```

Requires Python 3 with `numpy` and `opencv-python` plus Node (`jiti`) to read the exact rig & cutout coordinates from `lib/character-wallpaper-rigs.ts` and `lib/character-wallpaper-parts.ts`.
Preview contact sheets are written to `.verification/flagship-tier2-preview/`.
