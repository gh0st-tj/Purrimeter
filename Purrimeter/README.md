# Purrimeter 🐈

An enclosure puzzle game for iOS. Fence in the cat, grab the tuna, beware the cucumbers.

## How to run
1. Requires Xcode 16 or newer (iOS 17+ deployment target).
2. Open `Purrimeter.xcodeproj`.
3. Pick an iPhone simulator (or your device — set your team under Signing & Capabilities).
4. Press Run.

## Rules
- Tap grass to place a fence (tap again to remove). You have a limited fence budget.
- The cat moves up/down/left/right only — never diagonally. Ponds and rocks block it.
- If the cat can reach the board edge, it escapes and you score 0.
- Score = every tile the cat can roam inside your fence (1 pt each), plus:
  🧶 yarn +3 · 🐟 tuna +10 · 🥒 cucumber −5 · 📦 boxes teleport the cat between them.
- "Roam" previews everywhere the cat can reach. Match the goal score for 3 stars.
- Fences can be placed on item tiles (the item is lost) — including on a box to disable it,
  or on a cucumber to neutralize it.

## Code map
- `Models.swift` — grid, level definitions, ASCII map parser
- `Levels.swift` — 8 handcrafted levels (targets verified by a solver)
- `Engine.swift` — flood-fill reachability, escape detection, scoring
- `GameViewModel.swift` — game state + local best-score persistence
- `HomeView / GameView / BoardView` — SwiftUI screens
