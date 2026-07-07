import Foundation

// MARK: - Core types

struct Coord: Hashable, Equatable {
    let r: Int
    let c: Int
}

enum Terrain {
    case grass
    case water   // pond — cats won't cross
    case rock    // garden rock — impassable
}

enum Item: Equatable {
    case yarn        // +3
    case tuna        // +10
    case cucumber    // -5
    case box(Int)    // portal pair id

    var bonus: Int {
        switch self {
        case .yarn: return 3
        case .tuna: return 10
        case .cucumber: return -5
        case .box: return 0
        }
    }

    var emoji: String {
        switch self {
        case .yarn: return "🧶"
        case .tuna: return "🐟"
        case .cucumber: return "🥒"
        case .box: return "📦"
        }
    }
}

struct Cell {
    var terrain: Terrain = .grass
    var item: Item? = nil
}

// MARK: - Level

struct Level: Identifiable {
    let id: Int
    let name: String
    let tip: String
    let walls: Int
    let target: Int          // best known score
    let rows: Int
    let cols: Int
    let cat: Coord
    let cells: [[Cell]]
    let boxPairs: [Int: [Coord]]

    /// Parse an ASCII map.
    /// `.` grass  `~` water  `#` rock  `C` cat  `y` yarn  `t` tuna  `u` cucumber  `1-9` box pair
    init(id: Int, name: String, tip: String, walls: Int, target: Int, map: [String]) {
        self.id = id
        self.name = name
        self.tip = tip
        self.walls = walls
        self.target = target
        self.rows = map.count
        self.cols = map[0].count

        var cat = Coord(r: 0, c: 0)
        var cells = [[Cell]]()
        var pairs = [Int: [Coord]]()

        for (r, line) in map.enumerated() {
            var row = [Cell]()
            for (c, ch) in line.enumerated() {
                var cell = Cell()
                switch ch {
                case "~": cell.terrain = .water
                case "#": cell.terrain = .rock
                case "C": cat = Coord(r: r, c: c)
                case "y": cell.item = .yarn
                case "t": cell.item = .tuna
                case "u": cell.item = .cucumber
                case "1", "2", "3":
                    let pairID = Int(String(ch))!
                    cell.item = .box(pairID)
                    pairs[pairID, default: []].append(Coord(r: r, c: c))
                default: break
                }
                row.append(cell)
            }
            cells.append(row)
        }

        self.cat = cat
        self.cells = cells
        self.boxPairs = pairs
    }

    func cell(_ p: Coord) -> Cell { cells[p.r][p.c] }

    func inBounds(_ p: Coord) -> Bool {
        p.r >= 0 && p.r < rows && p.c >= 0 && p.c < cols
    }

    func isBorder(_ p: Coord) -> Bool {
        p.r == 0 || p.c == 0 || p.r == rows - 1 || p.c == cols - 1
    }

    /// Fences may go on any grass cell (including item cells — the item is lost) but not on the cat.
    func canFence(_ p: Coord) -> Bool {
        guard inBounds(p), p != cat else { return false }
        return cell(p).terrain == .grass
    }
}
