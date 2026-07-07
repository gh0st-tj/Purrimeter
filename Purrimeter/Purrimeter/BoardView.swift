import SwiftUI

struct BoardView: View {
    @Bindable var vm: GameViewModel

    var body: some View {
        GeometryReader { geo in
            let lv = vm.level
            let size = min(geo.size.width / CGFloat(lv.cols),
                           geo.size.height / CGFloat(lv.rows))
            let boardW = size * CGFloat(lv.cols)
            let boardH = size * CGFloat(lv.rows)
            let eval = vm.evaluation

            ZStack(alignment: .topLeading) {
                ForEach(0..<lv.rows, id: \.self) { r in
                    ForEach(0..<lv.cols, id: \.self) { c in
                        let p = Coord(r: r, c: c)
                        TileView(
                            level: lv,
                            p: p,
                            fenced: vm.fences.contains(p),
                            roamHighlight: vm.showRoam && eval.reachable.contains(p),
                            size: size
                        )
                        .frame(width: size, height: size)
                        .offset(x: CGFloat(c) * size, y: CGFloat(r) * size)
                        .onTapGesture { withAnimation(.spring(duration: 0.3)) { vm.tap(p) } }
                    }
                }
            }
            .frame(width: boardW, height: boardH)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Theme.ink.opacity(0.15), lineWidth: 2)
            )
            .shadow(color: Theme.ink.opacity(0.18), radius: 14, y: 8)
            .position(x: geo.size.width / 2, y: geo.size.height / 2)
        }
    }
}

struct TileView: View {
    let level: Level
    let p: Coord
    let fenced: Bool
    let roamHighlight: Bool
    let size: CGFloat

    var body: some View {
        let cell = level.cell(p)
        ZStack {
            // Terrain
            switch cell.terrain {
            case .grass:
                Rectangle().fill((p.r + p.c).isMultiple(of: 2) ? Theme.grassA : Theme.grassB)
            case .water:
                Rectangle().fill(Theme.water)
                Circle()
                    .fill(Theme.waterDeep.opacity(0.5))
                    .frame(width: size * 0.55, height: size * 0.35)
                    .offset(y: size * 0.08)
            case .rock:
                Rectangle().fill((p.r + p.c).isMultiple(of: 2) ? Theme.grassA : Theme.grassB)
                RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
                    .fill(Theme.rock)
                    .frame(width: size * 0.8, height: size * 0.72)
                    .overlay(
                        RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
                            .fill(.white.opacity(0.25))
                            .frame(width: size * 0.35, height: size * 0.2)
                            .offset(x: -size * 0.12, y: -size * 0.16)
                    )
                    .shadow(color: .black.opacity(0.25), radius: 2, y: 2)
            }

            // Roam preview
            if roamHighlight {
                Rectangle()
                    .fill(Theme.roam.opacity(0.4))
                    .transition(.opacity)
            }

            // Item
            if let item = cell.item, !fenced {
                Text(item.emoji)
                    .font(.system(size: size * 0.62))
                    .shadow(color: .black.opacity(0.2), radius: 1, y: 1)
            }

            // Fence
            if fenced {
                FenceShape(size: size)
                    .transition(.scale(scale: 0.4).combined(with: .opacity))
            }

            // Cat
            if p == level.cat {
                Text("🐈")
                    .font(.system(size: size * 0.72))
                    .shadow(color: .black.opacity(0.25), radius: 2, y: 2)
            }
        }
    }
}

/// A little picket fence drawn with capsules.
struct FenceShape: View {
    let size: CGFloat

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.18, style: .continuous)
                .fill(Theme.fenceLight)
                .frame(width: size * 0.88, height: size * 0.88)
                .shadow(color: .black.opacity(0.3), radius: 2, y: 2)
            HStack(spacing: size * 0.09) {
                ForEach(0..<3, id: \.self) { _ in
                    Capsule()
                        .fill(Theme.fence)
                        .frame(width: size * 0.13, height: size * 0.62)
                }
            }
            Rectangle()
                .fill(Theme.fence.opacity(0.85))
                .frame(width: size * 0.7, height: size * 0.09)
                .offset(y: -size * 0.12)
            Rectangle()
                .fill(Theme.fence.opacity(0.85))
                .frame(width: size * 0.7, height: size * 0.09)
                .offset(y: size * 0.14)
        }
    }
}
