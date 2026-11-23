(() => {
  const figure = document.querySelector('[data-pipeline]');
  if (!figure) return;

  const controls = figure.querySelector('.of-pipeline-controls');
  const previousCells = figure.querySelectorAll('.of-pipeline-before span');
  const currentCells = figure.querySelectorAll('.of-pipeline-now span');
  const stageCount = 4;
  const executedSteps = 2;
  const horizon = currentCells.length;

  function showRound(round) {
    const initializing = round === 0;
    const first = round * executedSteps + 1;
    const previousFirst = first - executedSteps;
    const last = first + horizon - 1;
    figure.classList.toggle('of-pipeline-cold', initializing);

    currentCells.forEach((cell, index) => {
      cell.textContent = first + index;
    });
    previousCells.forEach((cell, index) => {
      cell.textContent = initializing ? '·' : previousFirst + index;
    });

    figure.querySelector('[data-flow-mode]').textContent = initializing ? '串行初始化' : '同一批次';
    figure.querySelector('[data-native-total]').textContent = stageCount * (round + 1);
    figure.querySelector('[data-flow-count]').textContent = initializing ? stageCount : 1;
    figure.querySelector('[data-flow-total]').textContent = stageCount + round;
    figure.querySelector('[data-round-label]').textContent = initializing ? '初始化' : '第 ' + round + ' 轮';
    figure.querySelector('[data-round-explanation]').textContent = initializing
      ? '首次观测到来，两种方法都从噪声开始，串行调用网络四次。OneFlow 保存沿途的中间状态，供下一轮对齐和更新。机器人执行动作 1、2。'
      : '动作 ' + previousFirst + '、' + (previousFirst + 1) + ' 已执行。保留位置 ' +
        first + '–' + (last - executedSteps) + '，向末尾补入 ' + (last - 1) + '、' + last +
        '。四个对齐后的动作块共享最新观测，一次批量前向给出四组速度。重建后执行动作 ' +
        first + '、' + (first + 1) + '。';
  }

  controls.addEventListener('change', event => {
    const input = event.target;
    if (input.name === 'pipeline-round' && input.checked) showRound(Number(input.value));
  });
  showRound(Number(controls.querySelector(':checked').value));
  controls.hidden = false;
})();
