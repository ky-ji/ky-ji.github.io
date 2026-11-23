/* Simulation results: show one policy at a time. Without JavaScript all four
   panels stay visible one after another. */
(() => {
  const comparison = document.querySelector('[data-res-comparison]');
  if (!comparison) return;

  const picker = comparison.querySelector('.res-picker');
  const panels = comparison.querySelectorAll('.res-panel');

  function showSelectedModel() {
    const selected = picker.querySelector('input:checked').value;
    for (const panel of panels) panel.hidden = panel.dataset.model !== selected;
  }

  picker.addEventListener('change', showSelectedModel);
  window.addEventListener('pageshow', showSelectedModel);
  showSelectedModel();
  picker.hidden = false;
})();
