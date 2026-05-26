import posthog from "posthog-js"

const POSTHOG_KEY = "phc_t27xjrx9U42B54arcMwpiBgQxEFikBzXGnvzVtFEGtpf"

export function initAnalytics(): void {
  posthog.init(POSTHOG_KEY, {
    api_host: "https://us.i.posthog.com",
    person_profiles: "identified_only",
    capture_pageview: false,
    autocapture: true,
    persistence: "localStorage",
  })
  posthog.capture("app_opened")
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  posthog.capture(event, properties)
}
