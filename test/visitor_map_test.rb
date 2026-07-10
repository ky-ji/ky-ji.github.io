require "minitest/autorun"

class VisitorMapTest < Minitest::Test
  ROOT = File.expand_path("..", __dir__)
  LAYOUT = File.read(File.join(ROOT, "_layouts/homepage.html"))
  INCLUDE_PATH = File.join(ROOT, "_includes/visitor-analytics.html")
  INCLUDE = File.exist?(INCLUDE_PATH) ? File.read(INCLUDE_PATH) : ""
  CONFIG = File.read(File.join(ROOT, "_config.yml"))
  CSS_PATH = File.join(ROOT, "assets/css/visitor-analytics.css")
  CSS = File.read(CSS_PATH)
  MOBILE_CSS = CSS[/@media \(max-width: 560px\) \{(.*)\}\s*@media \(prefers-reduced-motion/m, 1] || ""

  def css_rule(selector, source = CSS)
    source[/#{Regexp.escape(selector)}\s*\{([^}]*)\}/m, 1] || ""
  end

  def test_removes_failed_widget_providers
    refute_includes LAYOUT + INCLUDE, "feed-pulse.com"
    refute_includes LAYOUT + INCLUDE, "clustrmaps.com"
  end

  def test_layout_loads_repository_owned_panel_assets
    assert_includes LAYOUT, "visitor-analytics.css"
    assert_includes LAYOUT, "{% include visitor-analytics.html %}"
    assert_operator LAYOUT.index("{% include visitor-analytics.html %}"), :<,
      LAYOUT.index("scale.fix.js")

    assert_includes INCLUDE, "assets/js/visitor-analytics-core.js"
    assert_includes INCLUDE, "assets/js/visitor-analytics.js"
    assert_includes INCLUDE, "assets/data/visitor-stats.json"
  end

  def test_configures_goatcounter_without_an_api_key
    assert_includes CONFIG, "goatcounter_code: ky-ji"
    assert_includes CONFIG,
      'visitor_analytics_start: "2026-07-10T00:00:00+09:00"'
    refute_includes CONFIG + INCLUDE, "GOATCOUNTER_API_KEY"
  end

  def test_excludes_non_public_directories
    %w[docs lib scripts test].each do |directory|
      assert_includes CONFIG, "  - #{directory}/"
    end
  end

  def test_panel_exposes_local_data_and_hidden_entry_configuration
    assert_includes INCLUDE, 'id="statsPanel"'
    assert_includes INCLUDE, 'data-query-key="k"'
    assert_includes INCLUDE, 'data-query-value="1"'
    assert_includes INCLUDE,
      'data-stats-url="{{ \'/assets/data/visitor-stats.json\' | relative_url }}"'
    assert_includes INCLUDE,
      'data-globe-script="{{ \'/assets/vendor/globe.gl.min.js\' | relative_url }}"'
    assert_includes INCLUDE,
      'data-centroids-url="{{ \'/assets/data/country-centroids.json\' | relative_url }}"'
    assert_includes INCLUDE,
      'data-texture-url="{{ \'/assets/img/earth-night.jpg\' | relative_url }}"'
    assert_includes INCLUDE,
      'data-tracking-start="{{ site.visitor_analytics_start }}"'
  end

  def test_panel_has_accessible_dialog_and_close_control
    assert_match(/<aside\b[^>]*\bid="statsPanel"[^>]*>/m, INCLUDE)
    assert_includes INCLUDE, 'role="dialog"'
    assert_includes INCLUDE, 'aria-labelledby="visitorAnalyticsTitle"'
    assert_includes INCLUDE, 'aria-hidden="true"'

    close_button = INCLUDE[/<button\b[^>]*visitor-analytics__close[^>]*>/m]
    refute_nil close_button
    assert_includes close_button, 'type="button"'
    assert_includes close_button, 'aria-label="Close visitor analytics"'
    assert_includes INCLUDE, "fa-xmark"
  end

  def test_panel_has_live_status_and_three_period_tabs
    status = INCLUDE[/<[^>]+\bdata-status(?:\s|=)[^>]*>/m]
    refute_nil status
    assert_includes status, 'aria-live="polite"'
    assert_includes INCLUDE, 'role="tablist"'

    tabs = INCLUDE.scan(/<button\b[^>]*\brole="tab"[^>]*>/m)
    assert_equal 3, tabs.length
    assert_equal %w[7d 30d all], tabs.map { |tab| tab[/data-period="([^"]+)"/, 1] }
    assert_equal %w[true false false],
      tabs.map { |tab| tab[/aria-selected="([^"]+)"/, 1] }
  end

  def test_panel_contains_summary_globe_countries_and_times
    {
      "Visitors" => "visitors",
      "Page Views" => "pageviews",
      "Views / Visitor" => "viewsPerVisitor",
      "Countries" => "countryCount"
    }.each do |label, metric|
      assert_includes INCLUDE, "<dt>#{label}</dt>"
      assert_includes INCLUDE, %(data-metric="#{metric}")
    end

    assert_match(/data-globe\b[^>]*role="img"[^>]*aria-label=/m, INCLUDE)
    assert_match(/data-globe-fallback\b[^>]*hidden/m, INCLUDE)
    assert_match(/<ol\b[^>]*data-country-list/m, INCLUDE)
    assert_includes INCLUDE, "data-tracking-start"
    assert_includes INCLUDE, "data-updated-at"
    assert_match(/<a\b[^>]*target="_blank"[^>]*rel="noopener noreferrer"/m, INCLUDE)
  end

  def test_tracker_is_production_gated_and_exact_hostname_guarded
    assert_includes INCLUDE, '{% if jekyll.environment == "production" and site.goatcounter_code %}'
    assert_includes INCLUDE, 'window.location.hostname === "ky-ji.github.io"'
    assert_includes INCLUDE, 'document.createElement("script")'
    assert_includes INCLUDE,
      'https://{{ site.goatcounter_code }}.goatcounter.com/count'
    assert_includes INCLUDE, 'https://gc.zgo.at/count.js'
    assert_includes INCLUDE, "async = true"
    assert_match(/appendChild\([^)]*\)/, INCLUDE)
    refute_match(/<script\b[^>]*\bsrc=["']https:\/\/gc\.zgo\.at\/count\.js/m, INCLUDE)
  end

  def test_layout_has_no_inline_or_legacy_shortcut_implementation
    refute_match(/\sonclick\s*=/i, LAYOUT + INCLUDE)
    refute_includes LAYOUT, "kCount"
    refute_includes LAYOUT, "KeyK"
    refute_includes LAYOUT, "keyCode"
    refute_includes LAYOUT, "URLSearchParams"
  end

  def test_panel_avoids_theme_sensitive_native_containers
    refute_match(/<\/?(?:header|section|footer)\b/i, INCLUDE)
    assert_includes INCLUDE, 'class="visitor-analytics__header"'
    assert_includes INCLUDE, 'class="visitor-analytics__countries"'
    assert_includes INCLUDE, 'class="visitor-analytics__footer"'
  end

  def test_panel_width_and_corner_radius_are_bounded
    panel = css_rule(".visitor-analytics")
    assert_includes panel, "max-width: 560px"
    assert_includes panel, "max-height: calc(100vh - 40px)"
    assert_includes MOBILE_CSS, "width: calc(100vw - 24px)"

    radii = CSS.scan(/border-radius:\s*(\d+)px/).flatten.map(&:to_i)
    refute_empty radii
    assert_operator radii.max, :<=, 8
  end

  def test_close_button_and_globe_have_stable_dimensions
    close = css_rule(".visitor-analytics__close")
    assert_includes close, "width: 36px"
    assert_includes close, "height: 36px"

    globe = css_rule(".visitor-analytics__globe")
    assert_includes globe, "width: 280px"
    assert_includes globe, "height: 280px"
    assert_match(
      /\.visitor-analytics__globe-wrap,\s*\.visitor-analytics__globe\s*\{[^}]*width:\s*220px;[^}]*height:\s*220px;/m,
      MOBILE_CSS
    )
  end

  def test_desktop_and_mobile_layouts_keep_stable_tracks
    body = css_rule(".visitor-analytics__body")
    metrics = css_rule(".visitor-analytics__metrics")
    globe_wrap = css_rule(".visitor-analytics__globe-wrap")
    assert_includes body, "display: flex"
    assert_includes metrics, "display: grid"
    assert_includes metrics, "grid-template-columns: repeat(4, minmax(0, 1fr))"
    assert_includes globe_wrap, "flex: 0 0 280px"

    mobile_metrics = css_rule(".visitor-analytics__metrics", MOBILE_CSS)
    mobile_body = css_rule(".visitor-analytics__body", MOBILE_CSS)
    assert_includes mobile_metrics,
      "grid-template-columns: repeat(2, minmax(0, 1fr))"
    assert_includes mobile_body, "flex-direction: column"
  end

  def test_panel_open_and_data_states_are_styled
    assert_includes css_rule(".visitor-analytics.is-open"), "display: block"
    assert_includes css_rule(".visitor-analytics.is-loading .visitor-analytics__status"),
      "color: #74d39b"
    assert_match(
      /\.visitor-analytics\.is-empty \.visitor-analytics__status,\s*\.visitor-analytics\.is-stale \.visitor-analytics__status\s*\{[^}]*color:\s*#f4b942/m,
      CSS
    )
    assert_includes css_rule(".visitor-analytics.is-unavailable .visitor-analytics__status"),
      "color: #ef7d72"

    fallback = css_rule(".visitor-analytics__globe-fallback")
    hidden_fallback = css_rule(".visitor-analytics__globe-fallback[hidden]")
    assert_includes fallback, "display: grid"
    assert_includes fallback, "color: #ef7d72"
    assert_includes hidden_fallback, "display: none"
  end

  def test_period_controls_define_selected_hover_and_focus_states
    assert_includes css_rule('.visitor-analytics__periods button[aria-selected="true"]'),
      "background: #247a4c"
    assert_includes css_rule(".visitor-analytics__periods button:hover"),
      "background: #303633"
    assert_includes css_rule(".visitor-analytics a:focus-visible"),
      "outline: 2px solid #55c987"
  end

  def test_theme_containers_are_reset_without_float_declarations
    reset = CSS[/(?:\.visitor-analytics|:where\(\.visitor-analytics\)) \.visitor-analytics__header,\s*(?:\.visitor-analytics|:where\(\.visitor-analytics\)) \.visitor-analytics__countries,\s*(?:\.visitor-analytics|:where\(\.visitor-analytics\)) \.visitor-analytics__footer\s*\{([^}]*)\}/m, 1] || ""
    assert_includes reset, "position: static"
    assert_includes reset, "width: auto"
    assert(
      reset.include?("all: initial") || reset.include?("float: none"),
      "theme reset must explicitly neutralize inherited layout properties"
    )
    refute_match(/\bfloat\s*:/, CSS)
    assert_includes CSS,
      ":where(.visitor-analytics) .visitor-analytics__header"
  end

  def test_panel_uses_fixed_tracking_and_a_multi_family_palette
    assert_includes CSS, "letter-spacing: 0"
    assert_includes CSS, "background: rgba(24, 27, 26, 0.97)"
    assert_includes CSS, "#247a4c"
    assert_includes CSS, "#f4b942"
    assert_includes CSS, "#ef7d72"
  end
end
