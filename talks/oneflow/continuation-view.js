(() => {
  "use strict";

  const colors = ["#768394", "#417888", "#0a655d"];
  const rounds = [100, 300, 500];
  const allocations = [3, 4, 3];
  const NS = "http://www.w3.org/2000/svg";

  function svgTag(name, attributes) {
    const el = document.createElementNS(NS, name);
    Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
  }

  function makeDiagram(mode) {
    const drawing = document.createDocumentFragment();
    for (const edge of [200, 400]) {
      drawing.append(svgTag("line", {x1:edge, x2:edge, y1:5, y2:108, class:"cv-divider"}));
    }
    // The paths first follow observations. The solid horizontal arrows in H4
    // separately represent the unfinished action estimate crossing round boundaries.
    rounds.forEach((x, i) => {
      const target = mode === 0 ? [446, 500, 554][i] : x;
      const d = 'M '+x+' 10 C '+x+' 40, '+target+' 45, '+target+' 76';
      drawing.append(svgTag("path", {d, class:"cv-observation", stroke:colors[i]}));
      drawing.append(svgTag("circle", {cx:x, cy:10, r:4, fill:colors[i]}));
    });
    if (mode === 1) {
      for (const [start, end] of [[140, 252], [348, 460]]) {
        drawing.append(svgTag("path", {d:'M '+start+' 88 H '+end, class:"cv-carry"}));
        drawing.append(svgTag("path", {d:'M '+(end-8)+' 84 L '+end+' 88 L '+(end-8)+' 92', class:"cv-carry"}));
      }
    }
    if (mode === 0) {
      drawing.append(svgTag("rect", {x:411, y:72, width:178, height:32, rx:6, class:"cv-chunk"}));
      let left = 421;
      allocations.forEach((n, i) => {
        for (let s=0; s<n; s++) drawing.append(svgTag("rect", {x:left+s*15, y:80, width:11, height:16, rx:2, fill:colors[i]}));
        left += n*15+4;
      });
    } else {
      rounds.forEach((x,i) => {
        const n = mode === 1 ? allocations[i] : 10;
        const pitch = mode === 1 ? 17 : 11;
        const width = n*pitch+12;
        drawing.append(svgTag("rect", {x:x-width/2, y:72, width, height:32, rx:6, class:mode===1 ? "cv-chunk cv-retained" : "cv-chunk cv-batch"}));
        for (let s=0; s<n; s++) {
          // In the batch view all ten cells share one observation and one call.
          const fill = mode === 1 ? colors[i] : "#0a655d";
          drawing.append(svgTag("rect", {x:x-n*pitch/2+s*pitch+1, y:80, width:pitch-3, height:16, rx:1.7, fill}));
        }
      });
    }
    return drawing;
  }

  function mount(root) {
    const lanes = [...root.querySelectorAll(".ctrl-lane")];
    if (lanes.length !== 3 || root.querySelector(".cv-story")) return;
    const rates = lanes.map(lane => lane.querySelector(":scope > strong").textContent.trim());
    const stageNames = ["本轮从头求解", "跨轮接着修正", "OneFlow 参照"];
    const views = [
      {
        label: "原生采样 · 从头求解",
        evidence: "在本轮取出三次观测的记录，从噪声开始完成全部十步去噪。",
        foot: "每个小格表示一步去噪，颜色对应引导这一步的状态观测。",
        timing: ["记录观测", "记录观测", "3 + 4 + 3 步"],
        budget: "稳态每轮 10 次串行调用",
        result: "两组原生采样共用网络和源噪声。如果把前两轮未完成的动作估计带入本轮，成功率会怎样？",
        alt: "三份观测送入本轮。原生采样从噪声出发，依次用三步、四步、三步去噪。"
      },
      {
        label: "原生采样 · 对齐后接续",
        evidence: "三次观测仍依次引导 3、4、3 步去噪。每执行四个动作，未完成的动作段向前平移四位。",
        foot: "箭头连接同一段未完成的预测。每次平移后，下一次观测继续修正它。",
        timing: ["先算 3 步", "接着算 4 步", "最后算 3 步"],
        budget: "稳态每轮 10 次串行调用",
        result: "与从头求解的 " + rates[0] + " 相比，跨轮对齐后接着求解达到 " + rates[1] + "。两组都按相同的顺序使用三次观测。",
        alt: "同一段动作在三轮中依次去噪三步、四步、三步。每跨一轮，未完成的动作段向前平移四位。"
      },
      {
        label: "OneFlow · 稳态批量调用",
        evidence: "现在看每次重规划。最新状态观测引导一次批量前向，同时更新十个噪声阶段的动作段。",
        foot: "每个小格是一段处在相应噪声阶段的动作估计。一个框内的十段同时更新。",
        timing: ["一次批量调用", "一次批量调用", "一次批量调用"],
        budget: "初始化后每轮 1 次批量调用",
        result: "作为另一种调用预算下的参照，OneFlow 达到 " + rates[2] + "。原生跨轮接续为 " + rates[1] + "，稳态每轮需要十次串行调用。",
        alt: "连续三轮，每一轮的当前状态观测都驱动一次批量调用，同步更新十个不同噪声阶段的动作段。"
      }
    ];
    const story = document.createElement("div");
    story.className = "cv-story";
    story.innerHTML = `
      <div class="cv-controls" role="group" aria-label="选择求解方式"></div>
      <div class="cv-explain"><b class="cv-mode"></b><p class="cv-evidence"></p></div>
      <div class="cv-timeline">
        <div class="cv-rounds"><div><strong>两轮前</strong><small>状态 o<sub>k−2</sub></small></div><div><strong>上一轮</strong><small>状态 o<sub>k−1</sub></small></div><div><strong>本轮</strong><small>状态 o<sub>k</sub></small></div></div>
        <svg class="cv-schema" role="img" viewBox="0 0 600 110" preserveAspectRatio="none"></svg>
        <div class="cv-timing"><span></span><span></span><span></span></div>
      </div>
      <p class="cv-legend"></p>
      <div class="cv-finding" aria-live="polite" aria-atomic="true"><div><strong></strong><span>五项任务平均成功率</span></div><div><b></b><p></p></div></div>`;
    const controls = story.querySelector(".cv-controls");
    const slide = root.closest(".slide");
    const buttons = stageNames.map((name, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = name;
      button.addEventListener("click", () => {
        if (slide) root.dispatchEvent(new CustomEvent("stepselect", { bubbles:true, detail:{step:i} }));
        show(i);
      });
      controls.append(button);
      return button;
    });
    const diagram = story.querySelector(".cv-schema");
    let current = -1;
    function show(i) {
      if (!views[i] || current === i) return;
      current = i;
      const scene = views[i];
      root.dataset.contMode = String(i);
      buttons.forEach((button, index) => button.setAttribute("aria-pressed", String(index === i)));
      story.querySelector(".cv-mode").textContent = scene.label;
      story.querySelector(".cv-evidence").textContent = scene.evidence;
      diagram.setAttribute("aria-label", scene.alt);
      diagram.replaceChildren(makeDiagram(i));
      story.querySelectorAll(".cv-timing span").forEach((el, n) => { el.textContent = scene.timing[n]; });
      story.querySelector(".cv-legend").textContent = scene.foot;
      story.querySelector(".cv-finding strong").textContent = rates[i];
      story.querySelector(".cv-finding b").textContent = scene.budget;
      story.querySelector(".cv-finding p").textContent = scene.result;
    }
    root.append(story);
    root.classList.add("cv-ready");
    root.setAttribute("aria-label", "相同观测和调用预算下的两组原生对照，以及 OneFlow 的一次调用参照");
    show(slide ? Number(slide.dataset.at || 0) : 0);
    if (slide) slide.addEventListener("deckstep", event => show(event.detail.step));
  }

  function init() {
    document.querySelectorAll("figure.ctrl").forEach(mount);
  }
  if (document.readyState === "complete") init();
  else document.addEventListener("DOMContentLoaded", init, { once:true });
})();
