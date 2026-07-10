require "minitest/autorun"

class VisitorMapTest < Minitest::Test
  ROOT = File.expand_path("..", __dir__)
  LAYOUT = File.read(File.join(ROOT, "_layouts/homepage.html"))
  INCLUDE_PATH = File.join(ROOT, "_includes/visitor-analytics.html")
  INCLUDE = File.exist?(INCLUDE_PATH) ? File.read(INCLUDE_PATH) : ""
  CONFIG = File.read(File.join(ROOT, "_config.yml"))

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
end
