/* Real-robot section: task picker and the frame-by-frame replay of one return. */
(() => {
  for (const atlas of document.querySelectorAll('[data-field-atlas]')) {
    const picker = atlas.querySelector('.field-picker');
    const cases = atlas.querySelectorAll('.field-case');
    const showSelectedTask = () => {
      const selected = picker.querySelector('input:checked').getAttribute('aria-controls');
      for (const task of cases) task.hidden = task.id !== selected;
    };
    picker.addEventListener('change', showSelectedTask);
    window.addEventListener('pageshow', showSelectedTask);
    picker.hidden = false;
    showSelectedTask();
  }

  const frames = Array.from(document.querySelectorAll('.frames a'));
  const image = document.getElementById('hockey-frame');
  const timecode = document.getElementById('timecode');
  const replayButton = document.getElementById('play-frames');
  if (!frames.length || !image || !timecode || !replayButton) return;
  let replayTimer;

  function selectFrame(frame) {
    image.src = frame.href;
    image.alt = frame.dataset.alt;
    timecode.textContent = frame.dataset.time;
    for (const item of frames) {
      if (item === frame) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    }
  }
  function stopReplay() {
    clearTimeout(replayTimer);
    replayTimer = undefined;
    replayButton.textContent = '¼ 速回放';
  }
  function playFrom(index) {
    selectFrame(frames[index]);
    const following = frames[index + 1];
    if (!following) {
      stopReplay();
      return;
    }
    const elapsed = Number(following.dataset.time) - Number(frames[index].dataset.time);
    replayTimer = setTimeout(() => playFrom(index + 1), elapsed * 4);
  }
  for (const frame of frames) {
    frame.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      stopReplay();
      selectFrame(frame);
    });
  }
  replayButton.hidden = false;
  replayButton.addEventListener('click', () => {
    if (replayTimer !== undefined) stopReplay();
    else {
      replayButton.textContent = '暂停回放';
      playFrom(0);
    }
  });
  for (const launcher of document.querySelectorAll('[data-start-talk]')) {
    launcher.addEventListener('click', stopReplay);
  }
})();
