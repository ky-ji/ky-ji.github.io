(() => {
  const comparison = document.querySelector('.of-res-comparison');
  if (!comparison) return;

  const picker = comparison.querySelector('.of-res-picker');
  const panels = comparison.querySelectorAll('.of-res-panel');

  function showSelectedModel() {
    const selected = picker.querySelector('input:checked').value;
    for (const panel of panels) panel.hidden = panel.dataset.model !== selected;
  }

  picker.addEventListener('change', showSelectedModel);
  window.addEventListener('pageshow', showSelectedModel);
  showSelectedModel();
  picker.hidden = false;
})();
