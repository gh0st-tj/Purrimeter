import SwiftUI

struct GameView: View {
    @State private var vm: GameViewModel
    @Environment(\.dismiss) private var dismiss

    init(level: Level) {
        _vm = State(initialValue: GameViewModel(level: level))
    }

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            VStack(spacing: 14) {
                header
                statusBar
                BoardView(vm: vm)
                    .padding(.horizontal, 12)
                tipAndActions
            }
            .padding(.vertical, 8)

            if vm.submitted {
                ResultsOverlay(vm: vm, dismiss: { dismiss() })
                    .transition(.opacity.combined(with: .scale(scale: 0.9)))
            }
        }
        .navigationBarBackButtonHidden(true)
        .animation(.spring(duration: 0.35), value: vm.submitted)
    }

    // MARK: Header

    private var header: some View {
        HStack {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left.circle.fill")
                    .font(.title)
                    .foregroundStyle(Theme.ink.opacity(0.7))
            }
            Spacer()
            VStack(spacing: 2) {
                Text(vm.level.name)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(Theme.ink)
                Text("Goal: \(vm.level.target) pts")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.ink.opacity(0.55))
            }
            Spacer()
            Button {
                withAnimation(.spring(duration: 0.3)) { vm.reset() }
            } label: {
                Image(systemName: "arrow.counterclockwise.circle.fill")
                    .font(.title)
                    .foregroundStyle(Theme.ink.opacity(0.7))
            }
        }
        .padding(.horizontal, 18)
    }

    // MARK: Status

    private var statusBar: some View {
        HStack(spacing: 12) {
            // Fence budget pips
            HStack(spacing: 4) {
                ForEach(0..<vm.level.walls, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 3)
                        .fill(i < vm.fences.count ? Theme.fence : Theme.fence.opacity(0.22))
                        .frame(width: 9, height: 18)
                }
            }
            Spacer()
            Group {
                if vm.isEnclosed {
                    Label("\(vm.liveScore) pts", systemImage: "checkmark.seal.fill")
                        .foregroundStyle(Theme.good)
                } else {
                    Label("Cat can escape!", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(Theme.danger)
                }
            }
            .font(.subheadline.weight(.bold))
            .contentTransition(.numericText())
            .animation(.spring(duration: 0.3), value: vm.liveScore)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.horizontal, 16)
    }

    // MARK: Tip + actions

    private var tipAndActions: some View {
        VStack(spacing: 10) {
            Text(vm.level.tip)
                .font(.footnote)
                .foregroundStyle(Theme.ink.opacity(0.6))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)

            HStack(spacing: 12) {
                Button {
                    withAnimation(.spring(duration: 0.3)) { vm.showRoam.toggle() }
                } label: {
                    Label("Roam", systemImage: "pawprint.fill")
                        .font(.subheadline.weight(.bold))
                        .padding(.horizontal, 18)
                        .padding(.vertical, 12)
                        .background(vm.showRoam ? Theme.roam : Color.white.opacity(0.7),
                                    in: Capsule())
                        .foregroundStyle(Theme.ink)
                }

                Button {
                    withAnimation(.spring(duration: 0.35)) { vm.submit() }
                } label: {
                    Label("Done", systemImage: "checkmark")
                        .font(.subheadline.weight(.bold))
                        .padding(.horizontal, 28)
                        .padding(.vertical, 12)
                        .background(vm.isEnclosed ? Theme.accent : Theme.ink.opacity(0.15),
                                    in: Capsule())
                        .foregroundStyle(vm.isEnclosed ? .white : Theme.ink.opacity(0.4))
                }
                .disabled(!vm.isEnclosed)
            }
        }
        .padding(.bottom, 4)
    }
}

// MARK: - Results

struct ResultsOverlay: View {
    let vm: GameViewModel
    let dismiss: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.35).ignoresSafeArea()

            VStack(spacing: 16) {
                Text(vm.finalStars == 3 ? "Purrfect!" : "Enclosed!")
                    .font(.system(.largeTitle, design: .rounded).weight(.heavy))
                    .foregroundStyle(Theme.ink)

                HStack(spacing: 6) {
                    ForEach(0..<3, id: \.self) { i in
                        Image(systemName: i < vm.finalStars ? "star.fill" : "star")
                            .font(.system(size: 34))
                            .foregroundStyle(i < vm.finalStars ? Theme.roam : Theme.ink.opacity(0.25))
                    }
                }

                VStack(spacing: 4) {
                    Text("\(vm.finalScore) points")
                        .font(.title2.weight(.bold))
                        .foregroundStyle(Theme.ink)
                    Text("Goal: \(vm.level.target)")
                        .font(.subheadline)
                        .foregroundStyle(Theme.ink.opacity(0.55))
                    if vm.finalScore < vm.level.target {
                        Text("There's a bigger meadow out there…")
                            .font(.footnote)
                            .foregroundStyle(Theme.ink.opacity(0.5))
                    }
                }

                HStack(spacing: 12) {
                    Button {
                        withAnimation { vm.reset() }
                    } label: {
                        Label("Retry", systemImage: "arrow.counterclockwise")
                            .font(.subheadline.weight(.bold))
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                            .background(Color.white, in: Capsule())
                            .foregroundStyle(Theme.ink)
                    }
                    Button {
                        dismiss()
                    } label: {
                        Label("Levels", systemImage: "square.grid.2x2")
                            .font(.subheadline.weight(.bold))
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                            .background(Theme.accent, in: Capsule())
                            .foregroundStyle(.white)
                    }
                }
            }
            .padding(28)
            .background(
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .fill(Theme.bgTop)
                    .shadow(color: .black.opacity(0.25), radius: 24, y: 12)
            )
            .padding(32)
        }
    }
}
