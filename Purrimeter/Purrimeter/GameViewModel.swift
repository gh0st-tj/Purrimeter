import SwiftUI
import Observation

@Observable
final class GameViewModel {
    let level: Level
    var fences: Set<Coord> = []
    var showRoam = false          // reachability preview (tap the cat)
    var submitted = false
    var finalScore = 0
    var finalStars = 0

    init(level: Level) {
        self.level = level
    }

    var evaluation: Evaluation {
        Engine.evaluate(level: level, fences: fences)
    }

    var fencesLeft: Int { level.walls - fences.count }
    var isEnclosed: Bool { !evaluation.escaped }
    var liveScore: Int { evaluation.score }

    func tap(_ p: Coord) {
        guard !submitted else { return }
        if p == level.cat {
            showRoam.toggle()
            Haptics.light()
            return
        }
        if fences.contains(p) {
            fences.remove(p)
            Haptics.light()
        } else if level.canFence(p), fencesLeft > 0 {
            fences.insert(p)
            Haptics.medium()
        } else {
            Haptics.error()
        }
    }

    func submit() {
        guard isEnclosed, !submitted else { return }
        finalScore = liveScore
        finalStars = Engine.stars(score: finalScore, target: level.target)
        submitted = true
        Records.record(levelID: level.id, score: finalScore, stars: finalStars)
        Haptics.success()
    }

    func reset() {
        fences = []
        submitted = false
        showRoam = false
    }
}

// MARK: - Simple persistence

enum Records {
    static func bestScore(levelID: Int) -> Int {
        UserDefaults.standard.integer(forKey: "best_\(levelID)")
    }
    static func bestStars(levelID: Int) -> Int {
        UserDefaults.standard.integer(forKey: "stars_\(levelID)")
    }
    static func record(levelID: Int, score: Int, stars: Int) {
        let d = UserDefaults.standard
        if score > d.integer(forKey: "best_\(levelID)") {
            d.set(score, forKey: "best_\(levelID)")
        }
        if stars > d.integer(forKey: "stars_\(levelID)") {
            d.set(stars, forKey: "stars_\(levelID)")
        }
    }
}
