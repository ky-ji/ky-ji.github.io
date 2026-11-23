(() => {
  "use strict";

  function revealControls(root) {
    root.querySelectorAll(".ev-js").forEach(control => { control.hidden = false; });
  }

  function setupSuccess(root) {
    const buttons = [...root.querySelectorAll("[data-policy-choice]")];
    const models = [...root.querySelectorAll("[data-policy]")];
    const select = root.querySelector("select");
    const chart = root.querySelector(".ev-success-chart");
    const points = [...root.querySelectorAll(".ev-configuration")];
    const budgets = [...root.querySelectorAll(".ev-budget")];
    const takeaway = root.querySelector(".ev-takeaway");
    let model;
    let revealed = true;

    function showMetric() {
      const index = select.selectedIndex;
      const scope = select.options[index].text;
      const rows = [...model.querySelector("tbody").rows];
      const values = rows.map(row => row.cells[index + 3].textContent);
      const methods = rows.map(row => row.cells[0].textContent);
      const reference = root.querySelector(".ev-reference");
      rows.forEach((row, i) => {
        const point = points[i];
        point.style.setProperty("--value", values[i]);
        point.querySelector("b").textContent = values[i] + "%";
        const [stages, calls] = budgets[i].querySelectorAll("span b");
        stages.textContent = row.cells[1].textContent;
        calls.textContent = row.cells[2].textContent;
        if (i >= 2) calls.parentElement.firstChild.textContent = "稳态每轮 ";
      });
      reference.style.bottom = values[1] + "%";
      const shown = revealed ? methods : methods.slice(0, 2);
      const description = shown.map((name, i) => name + " " + values[i] + "%").join("，");
      chart.setAttribute("aria-label", model.dataset.policyName + "，" + scope + "。" + description + "。");
      const calls = rows[1].cells[2].textContent;
      takeaway.textContent = "初始化后，OneFlow 每轮调用一次网络，成功率为 " + values[2] + "%。原生采样每轮串行调用 " +
        calls + " 次，成功率为 " + values[1] + "%。";
    }

    function changePolicy(key) {
      model = models.find(item => item.dataset.policy === key);
      if (!model) return;
      buttons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.policyChoice === key)));
      root.querySelector("[data-policy-label]").textContent = model.dataset.policyName;
      root.querySelector("[data-platform-label]").textContent = model.dataset.platform + " · " + model.dataset.setting;
      root.querySelector("[data-measure-label]").textContent = model.dataset.measure + "（%）";
      root.querySelector("[data-protocol]").textContent = model.querySelector("p").textContent;
      const headers = [...model.querySelector("thead tr").cells].slice(3);
      select.replaceChildren(...headers.map(cell => new Option(cell.textContent)));
      showMetric();
    }

    function linkedTable() {
      const target = document.getElementById(location.hash.slice(1));
      return target && root.contains(target) ? target.closest("[data-policy]") : null;
    }

    function followTableLink() {
      const table = linkedTable();
      if (!table) return;
      changePolicy(table.dataset.policy);
      table.closest("details").open = true;
      const target = document.getElementById(location.hash.slice(1));
      requestAnimationFrame(() => {
        if (linkedTable() === table) target.scrollIntoView({ block: "start", behavior: "instant" });
      });
    }

    const inArticle = !root.closest(".slide");
    buttons.forEach(button => button.addEventListener("click", () => {
      const previous = inArticle && linkedTable();
      changePolicy(button.dataset.policyChoice);
      if (previous && model.id) {
        const anchor = location.hash.endsWith("-title") ? model.querySelector("caption[id]") : model;
        if (anchor) history.replaceState(history.state, "", "#" + anchor.id);
      }
    }));
    select.addEventListener("change", showMetric);
    changePolicy("fast");
    revealControls(root);
    if (inArticle) {
      window.addEventListener("hashchange", followTableLink);
      followTableLink();
    }
    return step => {
      revealed = step > 0;
      [...points.slice(2), takeaway].forEach(el => el.classList.toggle("ev-unseen", !revealed));
      showMetric();
    };
  }

  function setupScaling(root) {
    const values = [...root.querySelector("tbody").rows].map(row =>
      [...row.cells].slice(1).map(cell => Number(cell.textContent))
    );
    const range = root.querySelector("input");
    const panels = [...root.querySelectorAll(".ev-trend-panel")];
    const takeaway = root.querySelector(".ev-takeaway");

    function selectStage(stage) {
      const row = values[stage - 1];
      if (!row) return;
      range.value = String(stage);
      root.querySelector("[data-stage-value]").textContent = String(stage);
      panels.forEach((panel, i) => {
        const svg = panel.querySelector("svg");
        const points = [...svg.querySelectorAll(".ev-series")].map(group => group.querySelectorAll("circle")[stage - 1]);
        const guide = svg.querySelector(".ev-cursor");
        const x = points[0].getAttribute("cx");
        guide.setAttribute("x1", x);
        guide.setAttribute("x2", x);
        svg.querySelectorAll(".ev-pick").forEach((circle, m) => {
          circle.setAttribute("cx", x);
          circle.setAttribute("cy", points[m].getAttribute("cy"));
        });
        panel.querySelectorAll(".ev-readouts b").forEach((label, m) => {
          const v = row[i * 2 + m];
          label.textContent = i === 0 ? v + "%" : v.toFixed(1) + " ms";
        });
      });
      range.setAttribute("aria-valuetext", stage + " 个阶段。原生成功率 " + row[0] + "%，时延 " +
        row[2].toFixed(1) + " 毫秒。OneFlow 成功率 " + row[1] + "%，时延 " + row[3].toFixed(1) + " 毫秒。");
      takeaway.textContent = stage === 1
        ? "N = 1 时，两种采样器都只用一个阶段。OneFlow 成功 9/50 回，原生采样成功 15/50 回。"
        : "N = " + stage + " 时，原生采样每轮依次调用 " + stage + " 次网络。初始化后，OneFlow 将 " + stage + " 个阶段合在一次批量调用里。";
    }

    function pickPoint(event) {
      const svg = event.currentTarget;
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      // Match the SVG coordinate space, including any letterboxing from preserveAspectRatio.
      const circles = svg.querySelector(".ev-series").querySelectorAll("circle");
      const xs = [...circles].map(point => Number(point.getAttribute("cx")));
      if (local.y < 12 || local.y > 174 || local.x < xs[0] - 12 || local.x > xs[xs.length - 1] + 12) return;
      const index = xs.reduce((best, x, i) => Math.abs(x - local.x) < Math.abs(xs[best] - local.x) ? i : best, 0);
      if (Number(range.value) !== index + 1) selectStage(index + 1);
    }

    panels.forEach(panel => {
      const svg = panel.querySelector("svg");
      svg.addEventListener("pointerdown", pickPoint);
      svg.addEventListener("pointermove", event => { if (event.pointerType === "mouse") pickPoint(event); });
    });
    range.addEventListener("input", () => selectStage(Number(range.value)));
    revealControls(root);
    selectStage(10);
    return step => selectStage(step === 0 ? 1 : 10);
  }

  function setupLatency(root) {
    const buttons = [...root.querySelectorAll("[data-base]")];
    const rows = [...root.querySelector("tbody").rows];
    const outcome = 16.62;
    const axis = root.querySelector(".ev-time-scale");
    const mark = root.querySelector(".ev-time-base");
    const distance = root.querySelector(".ev-time-distance");
    const descriptions = [
      ["全栈加速比", "从未优化原生十步切换到 OneFlow+，同时改变了采样方法和执行引擎。"],
      ["同引擎加速比", "两边都用执行引擎。十个阶段改成一次批量调用后，原生十步的等待时间是 OneFlow+ 的 3.1 倍。"],
      ["相对一步的额外时延", "两边都用执行引擎。OneFlow+ 一次处理十个阶段，比原生一步多等 1.82 ms。"]
    ];
    const position = value => 100 * Math.log(value / 10) / Math.log(600 / 10);

    function choose(index) {
      const ms = parseFloat(rows[index].cells[1].textContent);
      const single = index === 2;
      buttons.forEach((button, i) => button.setAttribute("aria-pressed", String(i === index)));
      root.querySelector("[data-ratio]").textContent = single ? "+12.3%" : (ms / outcome).toFixed(1) + "×";
      root.querySelector("[data-ratio-name]").textContent = descriptions[index][0];
      root.querySelector("[data-equation]").textContent = single
        ? "(16.62 − 14.80) ÷ 14.80"
        : ms.toFixed(2) + " ÷ 16.62";
      root.querySelector("[data-lat-description]").textContent = descriptions[index][1];
      mark.style.left = position(ms) + "%";
      mark.classList.toggle("ev-align-end", position(ms) > 75);
      mark.querySelector("b").textContent = ms.toFixed(2) + " ms";
      distance.style.setProperty("--lo", position(Math.min(ms, outcome)) + "%");
      distance.style.setProperty("--hi", position(Math.max(ms, outcome)) + "%");
      axis.setAttribute("aria-label", "原生" + rows[index].cells[0].textContent + " " + ms.toFixed(2) +
        " 毫秒，OneFlow+ " + outcome + " 毫秒。动作生成时延中位数，对数刻度。");
    }
    buttons.forEach((button, i) => button.addEventListener("click", () => {
      choose(i);
      if (root.closest(".slide")) root.dispatchEvent(new CustomEvent("stepselect", { bubbles: true, detail: { step: i } }));
    }));
    root.querySelector(".ev-lat-summary").setAttribute("aria-live", "polite");
    revealControls(root);
    choose(0);
    return step => {
      choose(Math.min(2, step));
      buttons.forEach((button, i) => button.querySelector("b").classList.toggle("ev-unseen", i > step));
    };
  }

  const setups = { success: setupSuccess, scaling: setupScaling, latency: setupLatency };
  function mount() {
    document.querySelectorAll("[data-evidence]").forEach(root => {
      if (!setups[root.dataset.evidence]) return;
      const step = setups[root.dataset.evidence](root);
      const slide = root.closest(".slide");
      if (slide) {
        step(Number(slide.dataset.at || 0));
        slide.addEventListener("deckstep", event => step(event.detail.step));
      }
    });
  }
  if (document.readyState === "complete") mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
})();
