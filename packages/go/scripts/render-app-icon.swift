// Generates a coral-themed app icon master PNG (1024×1024) matching the
// `AppLogoView.placeholderTile` design from WorkspaceSelectorView.
//
// Usage: swift packages/go/scripts/render-app-icon.swift <output-path>
//
// Designed once, downscaled via `sips` in the calling shell to fill out
// every size in AppIcon.appiconset/. Keeping the master at 1024×1024
// matches the iOS marketing icon size; macOS resizes from this single
// source.

import AppKit
import SwiftUI

@MainActor
struct AppIconView: View {
    // Canvas is the full 1024×1024 asset size Apple expects. The squircle
    // itself sits inside that canvas with transparent margin so the icon
    // "floats" in Finder/Dock instead of hitting the asset bounds. macOS
    // system icons (Finder, Calendar, Reminders) all use this pattern.
    // Squircle ratio history: 1.00 → 0.90 (-10%) → 0.855 (-5%) → 0.812 (-5%).
    static let canvas: CGFloat = 1024
    static let squircle: CGFloat = canvas * 0.812

    var body: some View {
        ZStack {
            iconBody
                .frame(width: Self.squircle, height: Self.squircle)
        }
        .frame(width: Self.canvas, height: Self.canvas)
    }

    /// The squircle itself — gradient + gloss + glyph + corner clip. All
    /// inner offsets scale from the squircle dimension so changing the
    /// outer size doesn't require rebalancing the glyph padding.
    private var iconBody: some View {
        ZStack {
            // Background: coral gradient — lighter at top-leading, deeper
            // at bottom-trailing. Same hues as BrandColors.primaryHi → primary
            // so the icon matches the in-app accent.
            LinearGradient(
                colors: [
                    Color(red: 1.00, green: 0.694, blue: 0.600), // #FFB199 primaryHi
                    Color(red: 1.00, green: 0.420, blue: 0.357), // #FF6B5B primary
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing,
            )

            // Subtle inner gloss — a soft radial light from the top-left
            // that gives the icon depth without going kitsch.
            RadialGradient(
                gradient: Gradient(colors: [
                    Color.white.opacity(0.22),
                    Color.white.opacity(0.0),
                ]),
                center: UnitPoint(x: 0.25, y: 0.20),
                startRadius: 0,
                endRadius: Self.squircle * 0.7,
            )

            // Chat-bubble glyph in white. Padding 11.8% of squircle —
            // glyph effective span grows from 0.694 → 0.764 (≈ +10%) over
            // the prior pass (which used 15.3% padding).
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .resizable()
                .scaledToFit()
                .foregroundStyle(.white)
                .padding(Self.squircle * 0.118)
                .shadow(color: .black.opacity(0.18),
                        radius: Self.squircle * 0.018,
                        y: Self.squircle * 0.008)
        }
        // Apple's 22.37% corner-radius ratio, applied to the squircle size.
        .clipShape(RoundedRectangle(cornerRadius: Self.squircle * 0.2237,
                                    style: .continuous))
    }
}

@MainActor
func render(to outputPath: String) {
    let renderer = ImageRenderer(content: AppIconView())
    renderer.scale = 1.0
    guard let nsImage = renderer.nsImage,
          let tiff = nsImage.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:])
    else {
        FileHandle.standardError.write("failed to render PNG\n".data(using: .utf8)!)
        exit(1)
    }
    let url = URL(fileURLWithPath: outputPath)
    do {
        try png.write(to: url)
        print("wrote \(outputPath) (\(png.count) bytes)")
    } catch {
        FileHandle.standardError.write("write failed: \(error)\n".data(using: .utf8)!)
        exit(1)
    }
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write("usage: \(args[0]) <output.png>\n".data(using: .utf8)!)
    exit(2)
}

DispatchQueue.main.async {
    render(to: args[1])
    NSApplication.shared.terminate(nil)
}
NSApplication.shared.run()
