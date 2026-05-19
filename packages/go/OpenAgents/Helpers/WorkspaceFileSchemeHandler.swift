import Foundation
import WebKit

/// Resolves `oafile:/<fileId>` URLs by fetching the workspace file via an
/// authorized URLRequest the caller supplies. We need this because WKWebView
/// can't attach the workspace token itself — so agent-emitted HTML that
/// references `<img src="…/v1/files/<id>">` would 401 if loaded directly.
///
/// `WebView` rewrites those URLs to `oafile:/<id>` before handing the HTML
/// to WKWebView and registers this handler on the configuration.
final class WorkspaceFileSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "oafile"

    typealias RequestProvider = @Sendable (String) async -> URLRequest

    private let provider: RequestProvider

    /// Set of tasks WebKit hasn't told us to stop yet. We have to gate every
    /// `didReceive` / `didFinish` / `didFail` on this — calling those after a
    /// `stop` crashes the web process with `NSInternalInconsistencyException`.
    private var activeTasks = Set<ObjectIdentifier>()
    private let lock = NSLock()

    init(provider: @escaping RequestProvider) {
        self.provider = provider
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let fileId = Self.fileId(from: urlSchemeTask.request.url) else {
            urlSchemeTask.didFailWithError(
                NSError(
                    domain: Self.scheme,
                    code: -1,
                    userInfo: [NSLocalizedDescriptionKey: "oafile URL missing file id"],
                ),
            )
            return
        }
        markActive(urlSchemeTask)
        let provider = self.provider
        let requestURL = urlSchemeTask.request.url
        Task { [weak self] in
            let request = await provider(fileId)
            do {
                let (data, upstream) = try await URLSession.shared.data(for: request)
                if let http = upstream as? HTTPURLResponse,
                   !(200..<300).contains(http.statusCode) {
                    let err = NSError(
                        domain: Self.scheme,
                        code: http.statusCode,
                        userInfo: [NSLocalizedDescriptionKey: "workspace file \(fileId) → HTTP \(http.statusCode)"],
                    )
                    await self?.fail(task: urlSchemeTask, error: err)
                    return
                }
                let response = Self.synthesizeResponse(
                    requestURL: requestURL,
                    upstream: upstream,
                    dataCount: data.count,
                )
                await self?.complete(task: urlSchemeTask, response: response, data: data)
            } catch {
                logError("html", "oafile fetch failed id=\(fileId) — \(error.localizedDescription)")
                await self?.fail(task: urlSchemeTask, error: error)
            }
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        markStopped(urlSchemeTask)
    }

    // MARK: - Main-actor delivery

    @MainActor
    private func complete(task: WKURLSchemeTask, response: URLResponse, data: Data) {
        guard isActive(task) else { return }
        task.didReceive(response)
        guard isActive(task) else { return }
        task.didReceive(data)
        guard isActive(task) else { return }
        task.didFinish()
        markStopped(task)
    }

    @MainActor
    private func fail(task: WKURLSchemeTask, error: Error) {
        guard isActive(task) else { return }
        task.didFailWithError(error)
        markStopped(task)
    }

    // MARK: - Active-task bookkeeping

    private func isActive(_ task: WKURLSchemeTask) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return activeTasks.contains(ObjectIdentifier(task))
    }

    private func markActive(_ task: WKURLSchemeTask) {
        lock.lock(); defer { lock.unlock() }
        activeTasks.insert(ObjectIdentifier(task))
    }

    private func markStopped(_ task: WKURLSchemeTask) {
        lock.lock(); defer { lock.unlock() }
        activeTasks.remove(ObjectIdentifier(task))
    }

    // MARK: - URL parsing

    /// Accepts `oafile:/<id>` (path style) — chosen over `oafile://<id>` so the
    /// id can contain hyphens *and* underscores, which strict URL hostnames
    /// reject. `<id>` may also be percent-encoded; we decode here so the
    /// downstream provider receives the raw value.
    private static func fileId(from url: URL?) -> String? {
        guard let url, url.scheme == Self.scheme else { return nil }
        let raw = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !raw.isEmpty else { return nil }
        return raw.removingPercentEncoding ?? raw
    }

    /// Build a URLResponse stamped with the `oafile:/...` URL so WKWebView can
    /// match it against the request it issued. We keep the upstream's MIME
    /// type — that's the bit that decides whether the resource shows as an
    /// image, a stylesheet, etc.
    private static func synthesizeResponse(
        requestURL: URL?,
        upstream: URLResponse,
        dataCount: Int,
    ) -> URLResponse {
        let mime: String
        if let http = upstream as? HTTPURLResponse,
           let ct = http.value(forHTTPHeaderField: "Content-Type") {
            // Strip charset / boundary parameters — the URLResponse mimeType
            // field expects bare "image/png" not "image/png; charset=utf-8".
            mime = String(ct.split(separator: ";").first ?? Substring(ct)).trimmingCharacters(in: .whitespaces)
        } else {
            mime = upstream.mimeType ?? "application/octet-stream"
        }
        return URLResponse(
            url: requestURL ?? upstream.url ?? URL(string: "\(Self.scheme):/")!,
            mimeType: mime,
            expectedContentLength: dataCount,
            textEncodingName: upstream.textEncodingName,
        )
    }
}
