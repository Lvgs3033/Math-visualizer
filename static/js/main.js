/* Beautiful Math Visualizer — frontend logic
 * Talks to the Flask API (/api/analyze, /api/fourier) and renders
 * everything with Plotly.js, including custom frame-by-frame
 * animations for the derivative (moving tangent line) and the
 * integral (growing Riemann-sum area).
 */

(() => {
  "use strict";

  // ---------- DOM references ----------
  const el = (id) => document.getElementById(id);

  const functionInput = el("functionInput");
  const xMinInput = el("xMin");
  const xMaxInput = el("xMax");
  const pointsRange = el("pointsRange");
  const pointsVal = el("pointsVal");
  const speedRange = el("speedRange");
  const speedVal = el("speedVal");
  const plotBtn = el("plotBtn");
  const animDerivBtn = el("animDerivBtn");
  const animIntBtn = el("animIntBtn");
  const stopBtn = el("stopBtn");
  const fourierBtn = el("fourierBtn");
  const parseStatus = el("parseStatus");
  const errorBox = el("errorBox");
  const animStatus = el("animStatus");

  const toggleFunction = el("toggleFunction");
  const toggleDerivative = el("toggleDerivative");
  const toggleIntegral = el("toggleIntegral");

  const exprOriginal = el("exprOriginal");
  const exprDerivative = el("exprDerivative");
  const exprIntegral = el("exprIntegral");

  const mainPlotDiv = el("mainPlot");
  const signalPlotDiv = el("signalPlot");
  const spectrumPlotDiv = el("spectrumPlot");

  // ---------- State ----------
  let lastData = null;       // most recent /api/analyze response
  let animFrame = null;      // requestAnimationFrame handle
  let animRunning = false;

  const COLORS = {
    f: "#5eb3ff",
    d: "#ff8a5e",
    i: "#7ee08c",
    grid: "#232a3a",
    text: "#8a93a6",
  };

  const BASE_LAYOUT = {
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    font: { family: "Space Grotesk, sans-serif", color: COLORS.text, size: 12 },
    margin: { l: 55, r: 25, t: 20, b: 45 },
    xaxis: { gridcolor: COLORS.grid, zerolinecolor: "#3a4356", zerolinewidth: 1.5 },
    yaxis: { gridcolor: COLORS.grid, zerolinecolor: "#3a4356", zerolinewidth: 1.5 },
    legend: { orientation: "h", y: 1.08, font: { color: COLORS.text } },
    hovermode: "x unified",
  };

  const PLOT_CONFIG = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ["lasso2d", "select2d"] };

  // ---------- Helpers ----------
  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.remove("hidden");
  }
  function clearError() {
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
  }
  function setStatus(msg, ok) {
    parseStatus.textContent = msg;
    parseStatus.classList.toggle("ok", !!ok);
    parseStatus.classList.toggle("err", ok === false);
  }
  function currentParams() {
    return {
      function: functionInput.value,
      xMin: parseFloat(xMinInput.value),
      xMax: parseFloat(xMaxInput.value),
      points: parseInt(pointsRange.value, 10),
    };
  }
  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data;
  }
  function stopAnimation() {
    animRunning = false;
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = null;
    stopBtn.disabled = true;
    animDerivBtn.disabled = false;
    animIntBtn.disabled = false;
    animStatus.textContent = "";
  }

  // ---------- Fetch + render main graph ----------
  async function fetchAndPlot() {
    stopAnimation();
    clearError();
    setStatus("Analyzing…");

    const params = currentParams();
    if (!params.function.trim()) {
      showError("Please enter a function of x.");
      setStatus("Idle");
      return;
    }
    if (isNaN(params.xMin) || isNaN(params.xMax) || params.xMin >= params.xMax) {
      showError("x min must be a number smaller than x max.");
      setStatus("Idle");
      return;
    }

    let data;
    try {
      data = await postJSON("/api/analyze", params);
    } catch (e) {
      showError("Could not reach the server: " + e.message);
      setStatus("Idle");
      return;
    }

    if (!data.success) {
      showError(data.error || "Unknown error while analyzing the function.");
      setStatus("Parse error", false);
      return;
    }

    lastData = data;
    setStatus("Ready", true);
    exprOriginal.textContent = data.originalExpr;
    exprDerivative.textContent = data.derivativeExpr;
    exprIntegral.textContent = data.integralExpr;

    renderStaticGraph(data);
  }

  function visibleTraces() {
    return {
      f: toggleFunction.checked,
      d: toggleDerivative.checked,
      i: toggleIntegral.checked,
    };
  }

  function renderStaticGraph(data) {
    const vis = visibleTraces();
    const traces = [];

    if (vis.f) {
      traces.push({
        x: data.x, y: data.y, mode: "lines", name: "f(x)",
        line: { color: COLORS.f, width: 3 },
      });
    }
    if (vis.d) {
      traces.push({
        x: data.x, y: data.dy, mode: "lines", name: "f'(x)",
        line: { color: COLORS.d, width: 2.5, dash: "solid" },
      });
    }
    if (vis.i) {
      traces.push({
        x: data.x, y: data.integral, mode: "lines", name: "∫f(x)dx",
        line: { color: COLORS.i, width: 2.5 },
      });
    }

    const layout = Object.assign({}, BASE_LAYOUT, {
      xaxis: Object.assign({}, BASE_LAYOUT.xaxis, { title: "x" }),
      yaxis: Object.assign({}, BASE_LAYOUT.yaxis, { title: "y" }),
    });

    Plotly.react(mainPlotDiv, traces, layout, PLOT_CONFIG);
  }

  // ---------- Animate derivative: sweeping tangent line ----------
  function animateDerivative() {
    if (!lastData) return;
    stopAnimation();
    clearError();
    animRunning = true;
    stopBtn.disabled = false;
    animDerivBtn.disabled = true;
    animIntBtn.disabled = true;

    const { x, y, dy } = lastData;
    const n = x.length;
    // Sub-sample for smoother/faster animation on dense data.
    const frameCount = Math.min(n, 220);
    const step = Math.max(1, Math.floor(n / frameCount));
    const indices = [];
    for (let i = 0; i < n; i += step) indices.push(i);
    if (indices[indices.length - 1] !== n - 1) indices.push(n - 1);

    const xRange = [Math.min(...x), Math.max(...x)];
    const finiteY = y.filter((v) => v !== null && isFinite(v));
    const finiteDy = dy.filter((v) => v !== null && isFinite(v));
    const yRange = paddedRange(finiteY.concat(finiteDy));

    const baseLayout = Object.assign({}, BASE_LAYOUT, {
      xaxis: Object.assign({}, BASE_LAYOUT.xaxis, { title: "x", range: xRange }),
      yaxis: Object.assign({}, BASE_LAYOUT.yaxis, { title: "y", range: yRange }),
    });

    Plotly.react(
      mainPlotDiv,
      [
        { x, y, mode: "lines", name: "f(x)", line: { color: COLORS.f, width: 3 } },
        { x: [], y: [], mode: "lines", name: "tangent line", line: { color: "#ffe08a", width: 2, dash: "dot" } },
        { x: [], y: [], mode: "markers", name: "point on f", marker: { color: "#ffe08a", size: 10 } },
        { x: [], y: [], mode: "lines", name: "f'(x) traced", line: { color: COLORS.d, width: 3 } },
      ],
      baseLayout,
      PLOT_CONFIG
    );

    let frame = 0;
    const speed = parseFloat(speedRange.value) || 1;
    const framesPerTick = Math.max(1, Math.round(speed));
    const tracedX = [];
    const tracedDy = [];
    const span = xRange[1] - xRange[0];
    const tangentHalfWidth = span * 0.08;

    function step_() {
      if (!animRunning) return;
      for (let k = 0; k < framesPerTick && frame < indices.length; k++, frame++) {
        const idx = indices[frame];
        const xi = x[idx];
        const yi = y[idx];
        const slope = dy[idx];

        tracedX.push(xi);
        tracedDy.push(slope);

        if (yi !== null && slope !== null && isFinite(yi) && isFinite(slope)) {
          const tx0 = xi - tangentHalfWidth;
          const tx1 = xi + tangentHalfWidth;
          const ty0 = yi - slope * tangentHalfWidth;
          const ty1 = yi + slope * tangentHalfWidth;

          Plotly.restyle(mainPlotDiv, { x: [[tx0, tx1]], y: [[ty0, ty1]] }, [1]);
          Plotly.restyle(mainPlotDiv, { x: [[xi]], y: [[yi]] }, [2]);
        }
        Plotly.restyle(mainPlotDiv, { x: [tracedX.slice()], y: [tracedDy.slice()] }, [3]);
      }

      animStatus.textContent = `Animating derivative… ${Math.round((frame / indices.length) * 100)}%`;

      if (frame < indices.length && animRunning) {
        animFrame = requestAnimationFrame(step_);
      } else {
        animStatus.textContent = "Derivative animation complete";
        stopBtn.disabled = true;
        animDerivBtn.disabled = false;
        animIntBtn.disabled = false;
        animRunning = false;
      }
    }
    animFrame = requestAnimationFrame(step_);
  }

  // ---------- Animate integral: growing Riemann sum ----------
  function animateIntegral() {
    if (!lastData) return;
    stopAnimation();
    clearError();
    animRunning = true;
    stopBtn.disabled = false;
    animDerivBtn.disabled = true;
    animIntBtn.disabled = true;

    const { x, y, integral } = lastData;
    const n = x.length;
    const frameCount = Math.min(n, 180);
    const step = Math.max(1, Math.floor(n / frameCount));
    const indices = [];
    for (let i = 0; i < n; i += step) indices.push(i);
    if (indices[indices.length - 1] !== n - 1) indices.push(n - 1);

    const xRange = [Math.min(...x), Math.max(...x)];
    const finiteY = y.filter((v) => v !== null && isFinite(v));
    const finiteInt = integral.filter((v) => v !== null && isFinite(v));
    const yRangeTop = paddedRange(finiteY);
    const yRangeBottom = paddedRange(finiteInt);

    const layout = Object.assign({}, BASE_LAYOUT, {
      grid: { rows: 2, columns: 1, pattern: "independent", roworder: "top to bottom" },
      xaxis: Object.assign({}, BASE_LAYOUT.xaxis, { title: "", range: xRange, matches: "x2" }),
      yaxis: Object.assign({}, BASE_LAYOUT.yaxis, { title: "f(x)", range: yRangeTop }),
      xaxis2: Object.assign({}, BASE_LAYOUT.xaxis, { title: "x", range: xRange }),
      yaxis2: Object.assign({}, BASE_LAYOUT.yaxis, { title: "∫f(x)dx", range: yRangeBottom }),
      margin: { l: 60, r: 25, t: 15, b: 45 },
    });

    Plotly.react(
      mainPlotDiv,
      [
        { x, y, mode: "lines", name: "f(x)", line: { color: COLORS.f, width: 3 }, xaxis: "x", yaxis: "y" },
        { x: [], y: [], mode: "none", fill: "tozeroy", name: "area swept", fillcolor: "rgba(126,224,140,0.35)", xaxis: "x", yaxis: "y" },
        { x: [], y: [], mode: "lines", name: "∫f(x)dx traced", line: { color: COLORS.i, width: 3 }, xaxis: "x2", yaxis: "y2" },
      ],
      layout,
      PLOT_CONFIG
    );

    let frame = 0;
    const speed = parseFloat(speedRange.value) || 1;
    const framesPerTick = Math.max(1, Math.round(speed));
    const areaX = [];
    const areaY = [];
    const tracedX = [];
    const tracedInt = [];

    function step_() {
      if (!animRunning) return;
      for (let k = 0; k < framesPerTick && frame < indices.length; k++, frame++) {
        const idx = indices[frame];
        areaX.push(x[idx]);
        areaY.push(y[idx] === null ? 0 : y[idx]);
        tracedX.push(x[idx]);
        tracedInt.push(integral[idx]);
      }

      Plotly.restyle(mainPlotDiv, { x: [areaX.slice()], y: [areaY.slice()] }, [1]);
      Plotly.restyle(mainPlotDiv, { x: [tracedX.slice()], y: [tracedInt.slice()] }, [2]);

      animStatus.textContent = `Animating integral… ${Math.round((frame / indices.length) * 100)}%`;

      if (frame < indices.length && animRunning) {
        animFrame = requestAnimationFrame(step_);
      } else {
        animStatus.textContent = "Integral animation complete";
        stopBtn.disabled = true;
        animDerivBtn.disabled = false;
        animIntBtn.disabled = false;
        animRunning = false;
      }
    }
    animFrame = requestAnimationFrame(step_);
  }

  function paddedRange(values) {
    if (!values.length) return [-1, 1];
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (lo === hi) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.12;
    return [lo - pad, hi + pad];
  }

  // ---------- Fourier ----------
  async function fetchAndPlotFourier() {
    clearError();
    const params = currentParams();
    if (!params.function.trim()) {
      showError("Please enter a function of x.");
      return;
    }
    fourierBtn.disabled = true;
    fourierBtn.textContent = "Computing…";

    let data;
    try {
      data = await postJSON("/api/fourier", params);
    } catch (e) {
      showError("Could not reach the server: " + e.message);
      fourierBtn.disabled = false;
      fourierBtn.textContent = "Compute Fourier Transform";
      return;
    }

    fourierBtn.disabled = false;
    fourierBtn.textContent = "Compute Fourier Transform";

    if (!data.success) {
      showError(data.error || "Unknown error computing the Fourier transform.");
      return;
    }

    const signalLayout = Object.assign({}, BASE_LAYOUT, {
      xaxis: Object.assign({}, BASE_LAYOUT.xaxis, { title: "x (time / space domain)" }),
      yaxis: Object.assign({}, BASE_LAYOUT.yaxis, { title: "f(x)" }),
    });
    Plotly.react(
      signalPlotDiv,
      [{ x: data.x, y: data.y, mode: "lines", name: "f(x)", line: { color: COLORS.f, width: 2.5 } }],
      signalLayout,
      PLOT_CONFIG
    );

    const spectrumLayout = Object.assign({}, BASE_LAYOUT, {
      xaxis: Object.assign({}, BASE_LAYOUT.xaxis, { title: "frequency" }),
      yaxis: Object.assign({}, BASE_LAYOUT.yaxis, { title: "magnitude" }),
    });
    Plotly.react(
      spectrumPlotDiv,
      [{
        x: data.freqs, y: data.magnitude, type: "bar", name: "|F(freq)|",
        marker: { color: COLORS.i },
      }],
      spectrumLayout,
      PLOT_CONFIG
    );
  }

  // ---------- Live parse validation (debounced) ----------
  let validateTimer = null;
  function scheduleValidate() {
    clearTimeout(validateTimer);
    setStatus("Typing…");
    validateTimer = setTimeout(async () => {
      const fn = functionInput.value.trim();
      if (!fn) { setStatus("Idle"); return; }
      try {
        const data = await postJSON("/api/validate", { function: fn });
        if (data.success) setStatus("Valid: " + data.expr, true);
        else setStatus(data.error, false);
      } catch (e) {
        setStatus("Idle");
      }
    }, 400);
  }

  // ---------- Tabs ----------
  function initTabs() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.tab;
        el("graphView").classList.toggle("active", tab === "graph");
        el("fourierView").classList.toggle("active", tab === "fourier");
        if (tab === "graph") setTimeout(() => Plotly.Plots.resize(mainPlotDiv), 50);
      });
    });
  }

  // ---------- Wire up events ----------
  function init() {
    initTabs();

    plotBtn.addEventListener("click", fetchAndPlot);
    animDerivBtn.addEventListener("click", animateDerivative);
    animIntBtn.addEventListener("click", animateIntegral);
    stopBtn.addEventListener("click", () => {
      stopAnimation();
      if (lastData) renderStaticGraph(lastData);
    });
    fourierBtn.addEventListener("click", fetchAndPlotFourier);

    functionInput.addEventListener("input", scheduleValidate);
    functionInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") fetchAndPlot();
    });

    document.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        functionInput.value = chip.dataset.fn;
        scheduleValidate();
        fetchAndPlot();
      });
    });

    pointsRange.addEventListener("input", () => { pointsVal.textContent = pointsRange.value; });
    speedRange.addEventListener("input", () => { speedVal.textContent = parseFloat(speedRange.value).toFixed(2) + "x"; });

    [toggleFunction, toggleDerivative, toggleIntegral].forEach((cb) => {
      cb.addEventListener("change", () => { if (lastData && !animRunning) renderStaticGraph(lastData); });
    });

    // Initial plot on load
    fetchAndPlot();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
