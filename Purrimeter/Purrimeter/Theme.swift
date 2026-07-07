import SwiftUI
import UIKit

enum Theme {
    // Garden palette
    static let bgTop = Color(red: 0.97, green: 0.96, blue: 0.90)
    static let bgBottom = Color(red: 0.88, green: 0.94, blue: 0.85)
    static let grassA = Color(red: 0.63, green: 0.82, blue: 0.45)
    static let grassB = Color(red: 0.56, green: 0.77, blue: 0.39)
    static let water = Color(red: 0.45, green: 0.71, blue: 0.90)
    static let waterDeep = Color(red: 0.33, green: 0.60, blue: 0.82)
    static let rock = Color(red: 0.62, green: 0.60, blue: 0.56)
    static let fence = Color(red: 0.55, green: 0.38, blue: 0.22)
    static let fenceLight = Color(red: 0.72, green: 0.52, blue: 0.32)
    static let ink = Color(red: 0.20, green: 0.25, blue: 0.15)
    static let accent = Color(red: 0.95, green: 0.55, blue: 0.25)
    static let roam = Color(red: 1.0, green: 0.85, blue: 0.30)
    static let danger = Color(red: 0.85, green: 0.30, blue: 0.25)
    static let good = Color(red: 0.30, green: 0.65, blue: 0.35)

    static var background: LinearGradient {
        LinearGradient(colors: [bgTop, bgBottom], startPoint: .top, endPoint: .bottom)
    }
}

enum Haptics {
    static func light() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
    static func medium() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }
    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
    static func error() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }
}
