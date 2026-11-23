/* Round-by-round walkthrough of the rolling pipeline (H = 8, E = 2, N = 4).
   Works on every [data-walk] figure: the one in the reading view and its clone
   on the slide, where the deck's step counter drives the round. */
(() => {
  const H = 8;
  const E = 2;
  const N = 4;
  const TRACKED = 9;
  const LAST_ROUND = 4;
  const where = {
    1: '动作 9 刚进入窗口，排在第 7 格。',
    2: '动作 9 前移到第 5 格。',
    3: '动作 9 前移到第 3 格。',
    4: '动作 9 排到队首，本轮执行。'
  };

  function describe(round) {
    if (round === 0) {
      return '第一次观测到来时流水线还是空的。两种方法都从噪声出发，串行调用网络 4 次。OneFlow 把沿途的状态保存下来，下一轮从它们出发。机器人执行动作 1、2，动作 9 还没有进入窗口。';
    }
    const first = E * round + 1;
    const last = first + H - 1;
    return '动作 ' + (first - 2) + '、' + (first - 1) + ' 已执行。四个候选各自保留 ' + first + '–' + (last - E) +
      '，在末尾补入 ' + (last - 1) + '、' + last + '。它们共享这一轮的新观测，一次批量调用给出四组速度，据此重建各阶段的状态和本轮输出。机器人执行动作 ' +
      first + '、' + (first + 1) + '。' + where[round];
  }

  function drawTally(node, groups) {
    node.replaceChildren(...groups.map((count, index) => {
      const group = document.createElement('span');
      if (index === groups.length - 1) group.className = 'now';
      for (let i = 0; i < count; i += 1) group.append(document.createElement('i'));
      return group;
    }));
  }

  for (const root of document.querySelectorAll('[data-walk]')) {
    const tabs = root.querySelector('.walk-tabs');
    const buttons = Array.from(tabs.querySelectorAll('button[data-round]'));
    const rows = Array.from(root.querySelectorAll('.walk-rows .cells'));
    const output = root.querySelector('.walk-out .cells');
    const part = name => root.querySelector('[data-' + name + ']');

    function render(round) {
      const init = round === 0;
      const first = E * round + 1;
      root.classList.toggle('is-init', init);

      rows.forEach((row, stage) => {
        Array.from(row.children).forEach((cell, index) => {
          const action = first + index;
          cell.textContent = action;
          if (!init && action === TRACKED && stage === round - 1) cell.className = 'is-9';
          else cell.className = !init && index >= H - E ? 'is-new' : '';
        });
      });
      Array.from(output.children).forEach((cell, index) => {
        const action = first + index;
        cell.textContent = action;
        cell.className = index < E ? (action === TRACKED ? 'is-exec is-9' : 'is-exec') : '';
      });

      part('call').innerHTML = init
        ? '<b>4 次</b><span>串行调用</span><small>观测 o<sub>0</sub></small>'
        : '<b>1 次</b><span>批量调用</span><small>共享观测 o<sub>' + round + '</sub></small>';
      part('exec').textContent = '执行动作 ' + first + '、' + (first + 1);
      part('flow-mode').textContent = init ? '串行初始化' : '同一批次';
      part('flow-now').textContent = init ? N : 1;
      part('native-total').textContent = N * (round + 1);
      part('flow-total').textContent = N + round;
      drawTally(part('native-tally'), Array(round + 1).fill(N));
      drawTally(part('flow-tally'), [N, ...Array(round).fill(1)]);
      part('label').textContent = init ? '初始化' : '第 ' + round + ' 轮';
      part('text').textContent = describe(round);
      for (const button of buttons) {
        button.setAttribute('aria-pressed', String(Number(button.dataset.round) === round));
      }
    }

    tabs.addEventListener('click', event => {
      const button = event.target.closest('button[data-round]');
      if (!button) return;
      const round = Number(button.dataset.round);
      render(round);
      root.dispatchEvent(new CustomEvent('stepselect', { bubbles: true, detail: { step: round } }));
    });

    const slide = root.closest('.slide');
    if (slide) {
      slide.addEventListener('deckstep', event => render(Math.min(event.detail.step, LAST_ROUND)));
    }
    render(slide ? 0 : 1);
    tabs.hidden = false;
  }
})();
