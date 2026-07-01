require "minitest/autorun"

class VisitorMapTest < Minitest::Test
  LAYOUT = File.expand_path("../_layouts/homepage.html", __dir__)
  FEEDPULSE_SITE_ID = "d7f505f1-3f99-4e7c-b6ce-13299cea2ab1"

  def setup
    @layout = File.read(LAYOUT)
  end

  def test_uses_live_feedpulse_visitor_globe
    refute_includes @layout, "clustrmaps.com"
    assert_includes @layout, "https://feed-pulse.com/api/embed/visitor-globe.js"
    assert_includes @layout, "site_id=#{FEEDPULSE_SITE_ID}"
  end

  def test_keyboard_shortcut_accepts_common_k_key_events
    assert_includes @layout, "e.code === 'KeyK'"
    assert_includes @layout, "e.keyCode === 75"
    assert_includes @layout, "e.which === 75"
  end

  def test_keyboard_shortcut_is_capture_phase_and_human_paced
    assert_includes @layout, "}, true);"
    assert_includes @layout, "}, 4000);"
  end
end
