for (const atlas of document.querySelectorAll('[data-field-atlas]')) {
  const picker = atlas.querySelector('.field-picker');
  const cases = atlas.querySelectorAll('.field-case');
  function showSelectedTask() {
    const selected = picker.querySelector('input:checked').getAttribute('aria-controls');
    for (const task of cases) task.hidden = task.id !== selected;
  }
  picker.addEventListener('change', showSelectedTask);
  picker.hidden = false;
  showSelectedTask();
}
