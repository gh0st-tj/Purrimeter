import SwiftUI

struct HomeView: View {
    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 18) {
                        VStack(spacing: 6) {
                            Text("🐈")
                                .font(.system(size: 64))
                            Text("Purrimeter")
                                .font(.system(size: 40, design: .rounded).weight(.heavy))
                                .foregroundStyle(Theme.ink)
                            Text("Fence in the cat. Grab the tuna.\nBeware the cucumbers.")
                                .font(.subheadline)
                                .multilineTextAlignment(.center)
                                .foregroundStyle(Theme.ink.opacity(0.6))
                        }
                        .padding(.top, 24)

                        legend

                        VStack(spacing: 12) {
                            ForEach(Levels.all) { level in
                                NavigationLink {
                                    GameView(level: level)
                                } label: {
                                    LevelCard(level: level)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 18)
                        .padding(.bottom, 32)
                    }
                }
            }
        }
        .tint(Theme.accent)
    }

    private var legend: some View {
        HStack(spacing: 14) {
            LegendItem(emoji: "🧶", text: "+3")
            LegendItem(emoji: "🐟", text: "+10")
            LegendItem(emoji: "🥒", text: "−5")
            LegendItem(emoji: "📦", text: "teleport")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial, in: Capsule())
    }
}

struct LegendItem: View {
    let emoji: String
    let text: String

    var body: some View {
        HStack(spacing: 3) {
            Text(emoji).font(.body)
            Text(text)
                .font(.caption.weight(.bold))
                .foregroundStyle(Theme.ink.opacity(0.7))
        }
    }
}

struct LevelCard: View {
    let level: Level

    var body: some View {
        let stars = Records.bestStars(levelID: level.id)
        let best = Records.bestScore(levelID: level.id)

        HStack(spacing: 14) {
            Text("\(level.id + 1)")
                .font(.system(.title2, design: .rounded).weight(.heavy))
                .foregroundStyle(.white)
                .frame(width: 46, height: 46)
                .background(Theme.good, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

            VStack(alignment: .leading, spacing: 3) {
                Text(level.name)
                    .font(.headline)
                    .foregroundStyle(Theme.ink)
                Text(best > 0 ? "Best \(best) · Goal \(level.target)" : "Goal \(level.target) pts · \(level.walls) fences")
                    .font(.caption)
                    .foregroundStyle(Theme.ink.opacity(0.55))
            }

            Spacer()

            HStack(spacing: 2) {
                ForEach(0..<3, id: \.self) { i in
                    Image(systemName: i < stars ? "star.fill" : "star")
                        .font(.caption)
                        .foregroundStyle(i < stars ? Theme.roam : Theme.ink.opacity(0.2))
                }
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color.white.opacity(0.75))
                .shadow(color: Theme.ink.opacity(0.08), radius: 8, y: 4)
        )
    }
}

#Preview {
    HomeView()
}
