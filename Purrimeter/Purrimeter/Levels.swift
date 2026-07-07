import Foundation

/// Level map legend:
/// `.` grass   `~` pond   `#` rock   `C` cat
/// `y` yarn +3   `t` tuna +10   `u` cucumber −5   `1` box pair (teleport)
///
/// Design notes (borrowed from the enclose-style playbook):
/// - Ponds/rocks and the board edge act as free walls — good levels put the cat near
///   partial natural barriers so early fences feel efficient.
/// - Each level has a deliberate "pitfall" area that costs more fences than it earns.
/// - High-value items sit just outside the lazy enclosure, tempting a smarter shape.
/// - Cucumbers punish greedy expansion; sometimes fencing ON the cucumber is the play.
/// - The cat can't move diagonally, so diagonal gaps are safe — push fences outward.
enum Levels {
    static let all: [Level] = [
        Level(id: 0, name: "Cozy Corner", tip: "Tap grass to place a fence. Use the pond as a free wall — the cat hates water.",
              walls: 4, target: 7, map: [
            "~~~~...",
            "~.C....",
            "~......",
            "~~.....",
            ".......",
            ".......",
            ".......",
        ]),
        Level(id: 1, name: "Stretch Out", tip: "The cat can't move diagonally. Diagonal gaps are safe — push your fences outward.",
              walls: 8, target: 7, map: [
            ".......",
            ".......",
            "...C...",
            "..~~...",
            "..~....",
            ".......",
            ".......",
        ]),
        Level(id: 2, name: "Yarn Day", tip: "Yarn is +3. Three balls, not enough fences — which are worth it?",
              walls: 7, target: 10, map: [
            "........",
            "..y.....",
            ".~~.y...",
            ".~C.....",
            ".~......",
            "....y...",
            "........",
        ]),
        Level(id: 3, name: "Tuna Heist", tip: "Tuna is +10 — worth more than most expansions. The rocks guard it for free.",
              walls: 8, target: 21, map: [
            "........",
            ".##.....",
            ".#t.....",
            "........",
            "..C.....",
            ".~~.....",
            ".~....y.",
            "........",
        ]),
        Level(id: 4, name: "Cucumber Patch", tip: "Cucumbers are −5 inside your fence. Weave between them — or fence right on top of one.",
              walls: 9, target: 16, map: [
            ".........",
            "..u......",
            "....y....",
            ".u..C..~~",
            "....y..~.",
            "..u......",
            "....u....",
            ".........",
        ]),
        Level(id: 5, name: "Box Magic", tip: "Boxes teleport the cat between them. Both ends count — or block one with a fence.",
              walls: 6, target: 18, map: [
            "........",
            ".~~~....",
            ".~1y....",
            ".~y.....",
            ".~~.....",
            "...##...",
            "...#C1..",
            "...##...",
            "........",
        ]),
        Level(id: 6, name: "Garden Party", tip: "Everything at once. Grab the tuna, dodge the cucumbers, use every fence.",
              walls: 8, target: 17, map: [
            ".........",
            ".t...~~..",
            ".....~...",
            "..C......",
            ".~~....u.",
            ".~..y....",
            "....u..y.",
            ".........",
        ]),
        Level(id: 7, name: "Masterpiece", tip: "The full test. Leftover fences are wasted points — spend them all.",
              walls: 9, target: 19, map: [
            "..........",
            ".y..##..t.",
            "....#.....",
            "..1...C...",
            ".~~.......",
            ".~...u.u..",
            "..y...u...",
            ".....1....",
            ".t........",
            "..........",
        ]),
    ]
}
