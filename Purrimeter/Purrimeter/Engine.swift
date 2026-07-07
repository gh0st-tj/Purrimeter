import Foundation

/// Result of evaluating the board.
struct Evaluation {
    let reachable: Set<Coord>   // every cell the cat can wander to
    let escaped: Bool           // true if the cat can reach the board edge
    let score: Int              // 0 when escaped
}

enum Engine {

    /// BFS from the cat. 4-directional, blocked by water, rocks and fences.
    /// Standing on a box teleports to its unfenced twin.
    static func evaluate(level: Level, fences: Set<Coord>) -> Evaluation {
        var pair = [Coord: Coord]()
        for (_, coords) in level.boxPairs where coords.count == 2 {
            pair[coords[0]] = coords[1]
            pair[coords[1]] = coords[0]
        }

        var seen: Set<Coord> = [level.cat]
        var queue: [Coord] = [level.cat]
        var escaped = false
        var head = 0

        while head < queue.count {
            let cur = queue[head]; head += 1
            if level.isBorder(cur) { escaped = true }

            var next: [Coord] = []
            if let twin = pair[cur], !fences.contains(twin) {
                next.append(twin)
            }
            for (dr, dc) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                next.append(Coord(r: cur.r + dr, c: cur.c + dc))
            }
            for n in next {
                guard level.inBounds(n), !seen.contains(n), !fences.contains(n),
                      level.cell(n).terrain == .grass else { continue }
                seen.insert(n)
                queue.append(n)
            }
        }

        var score = 0
        if !escaped {
            for p in seen {
                score += 1 + (level.cell(p).item?.bonus ?? 0)
            }
        }
        return Evaluation(reachable: seen, escaped: escaped, score: escaped ? 0 : score)
    }

    /// Star rating vs. the level's best-known target.
    static func stars(score: Int, target: Int) -> Int {
        guard score > 0 else { return 0 }
        if score >= target { return 3 }
        if Double(score) >= 0.8 * Double(target) { return 2 }
        return 1
    }
}
