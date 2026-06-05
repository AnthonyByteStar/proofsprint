pendo.initialize({
  visitor: {
    id: ''
  }
});

const STORAGE_KEY = "proofsprint:v1";

const GOALS = {
  clarity: {
    label: "Clarity",
    short: "Do users understand it?",
    question: "What did the tester believe this product is for?",
    next: "Tighten the first screen and retest the value promise with five new testers."
  },
  value: {
    label: "Value",
    short: "Would users want it?",
    question: "What made the tester think this would or would not be useful?",
    next: "Test one sharper use case with a more specific audience."
  },
  confidence: {
    label: "Confidence",
    short: "Would users trust it?",
    question: "What would make the tester feel safer or more confident using it?",
    next: "Add one clear proof point before the main action and retest confidence."
  },
  pricing: {
    label: "Pricing",
    short: "Would users pay?",
    question: "What value would need to be obvious before a tester paid?",
    next: "Run a willingness-to-pay prompt after the tester reaches the main value."
  },
  onboarding: {
    label: "Onboarding",
    short: "Is the first path smooth?",
    question: "What step felt unclear, slow, or unnecessary?",
    next: "Remove one onboarding step and compare friction against this sprint."
  }
};

const SIGNAL_ORDER = ["clarity", "value", "confidence", "onboarding", "pricing"];
const DEFAULT_SIGNALS = ["clarity", "value", "confidence"];
const MAX_SHARE_PACKET_LENGTH = 1800;
const DEMO_ID = "demo-proofsprint";

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

window.addEventListener("hashchange", renderRoute);
document.addEventListener("click", handleClick);
document.addEventListener("submit", handleSubmit);
document.addEventListener("input", handleLivePreview);
document.addEventListener("change", handleLivePreview);

renderRoute();

async function handleClick(event) {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) return;

  const action = actionTarget.dataset.action;

  if (action === "load-demo") {
    const id = seedDemo();
    track("demo_dashboard_loaded", { sprintId: id });
    location.hash = `#/dashboard/${id}`;
    return;
  }

  if (action === "copy-link") {
    copyText(actionTarget.dataset.url || "");
    track("test_shared", { sprintId: actionTarget.dataset.sprintId || "" });
    showToast("Tester link copied.");
    return;
  }

  if (action === "copy-packet") {
    const packet = document.querySelector("#proof-packet");
    if (!packet || !packet.value) {
      showToast("Open the packet below to copy.");
      return;
    }
    copyText(packet.value);
    showToast("Proof packet copied.");
    return;
  }

  if (action === "email-packet") {
    track("proof_packet_email_started", { sprintId: actionTarget.dataset.sprintId || "" });
    return;
  }

  if (action === "copy-report") {
    const sprint = getSprint(actionTarget.dataset.sprintId);
    if (!sprint) return;
    const responses = await getResponsesHydrated(sprint.id);
    copyText(buildMarkdownReport(sprint, responses, calculateInsights(sprint, responses)));
    track("insight_exported", { sprintId: sprint.id, format: "clipboard" });
    showToast("Report copied.");
    return;
  }

  if (action === "export-report") {
    const sprint = getSprint(actionTarget.dataset.sprintId);
    if (!sprint) return;
    const responses = await getResponsesHydrated(sprint.id);
    downloadMarkdown(
      `${slugify(sprint.productName || "proofsprint")}-proof-report.md`,
      buildMarkdownReport(sprint, responses, calculateInsights(sprint, responses))
    );
    track("insight_exported", { sprintId: sprint.id, format: "markdown" });
    showToast("Report downloaded.");
    return;
  }

  if (action === "open-product") {
    track("product_opened", { sprintId: actionTarget.dataset.sprintId || "" });
  }
}

async function handleSubmit(event) {
  const form = event.target;

  if (form.matches("[data-create-form]")) {
    event.preventDefault();
    const draft = readCreateDraft(form);
    const errors = validateCreateDraft(draft);
    if (Object.keys(errors).length) {
      showFormErrors(form, errors);
      focusFirstError(form, errors);
      track("creator_validation_failed", { fields: Object.keys(errors) });
      showToast("Fix the highlighted fields to create the sprint.");
      return;
    }
    hideToast();
    const sprint = createSprintFromForm(form, draft);
    saveSprint(sprint);
    await persistSprintRemote(sprint);
    track("test_created", {
      sprintId: sprint.id,
      goal: sprint.goal,
      signals: sprint.signals,
      audienceLength: sprint.audience.length
    });
    location.hash = `#/dashboard/${sprint.id}`;
    return;
  }

  if (form.matches("[data-tester-form]")) {
    event.preventDefault();
    const sprint = getSprint(form.dataset.sprintId);
    if (!sprint) return;
    const errors = validateTesterForm(form);
    if (Object.keys(errors).length) {
      showFormErrors(form, errors);
      focusFirstError(form, errors);
      track("tester_validation_failed", { sprintId: sprint.id, fields: Object.keys(errors) });
      showToast("Complete the highlighted feedback fields.");
      return;
    }
    hideToast();
    const response = createResponseFromForm(sprint, form);
    saveResponse(response);
    await persistResponseRemote(response);
    track("task_completed", { sprintId: sprint.id, goal: sprint.goal });
    track("feedback_submitted", {
      sprintId: sprint.id,
      clarity: response.clarity,
      value: response.value,
      confidence: response.confidence,
      friction: response.friction
    });
    location.hash = `#/thanks/${sprint.id}/${response.id}`;
    return;
  }

  if (form.matches("[data-import-form]")) {
    event.preventDefault();
    const sprintId = form.dataset.sprintId;
    const packet = new FormData(form).get("packet").trim();
    try {
      const response = decodePacket(packet);
      if (!response || response.sprintId !== sprintId) {
        throw new Error("Sprint mismatch");
      }
      saveResponse(response);
      await persistResponseRemote(response);
      form.reset();
      track("feedback_imported", { sprintId });
      showToast("Response imported.");
      renderRoute();
    } catch (error) {
      showToast("That packet does not match this sprint.");
    }
  }
}

function handleLivePreview(event) {
  const testerForm = event.target.closest("[data-tester-form]");
  if (testerForm) {
    clearFieldError(testerForm, event.target.name);
    return;
  }

  const form = event.target.closest("[data-create-form]");
  if (!form) return;
  clearFieldError(form, event.target.name === "signals" ? "signals" : event.target.name);
  const target = document.querySelector("[data-live-preview]");
  if (!target) return;
  target.innerHTML = renderBrief(readCreateDraft(form));
}

async function renderRoute() {
  const route = parseRoute();
  hydrateSprintFromRoute(route);

  if (!route.view || route.view === "create") {
    renderCreate();
    return;
  }

  if (route.view === "dashboard") {
    await renderDashboard(route.id);
    return;
  }

  if (route.view === "test") {
    await renderTester(route.id);
    return;
  }

  if (route.view === "thanks") {
    renderThanks(route.id, route.extra);
    return;
  }

  renderCreate();
}

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, queryString] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  return {
    view: parts[0] || "create",
    id: parts[1] || "",
    extra: parts[2] || "",
    query: new URLSearchParams(queryString || "")
  };
}

function renderCreate() {
  const defaultDraft = {
    productName: "",
    productUrl: "",
    audience: "",
    goal: "clarity",
    signals: DEFAULT_SIGNALS,
    hypothesis: "",
    task: ""
  };

  app.innerHTML = `
    <section class="workspace">
      <form class="panel" data-create-form novalidate>
        <div class="panel-body">
          <p class="eyebrow">Post-ship validation</p>
          <h1>Prove what happened after shipping.</h1>
          <p class="lede">Create a focused proof sprint, send one tester link, and turn raw feedback into evidence your next product decision can use.</p>
          <div class="form-alert" data-error-for="sharePacket" role="alert" hidden></div>

          <div class="field-grid">
            <label class="field full" data-field="productName">
              <span class="field-label">Product name <span class="hint">60 chars</span></span>
              <input class="input" name="productName" maxlength="60" required data-live-field placeholder="Example: ProofSprint" />
              <span class="field-error" data-error-for="productName" hidden></span>
            </label>

            <label class="field full" data-field="productUrl">
              <span class="field-label">Product URL <span class="hint">Public http(s) URL</span></span>
              <input class="input" name="productUrl" inputmode="url" maxlength="220" required data-live-field placeholder="https://your-product.com" />
              <span class="field-error" data-error-for="productUrl" hidden></span>
            </label>

            <label class="field full" data-field="audience">
              <span class="field-label">Who is this for? <span class="hint">140 chars</span></span>
              <input class="input" name="audience" maxlength="140" required data-live-field placeholder="Example: PMs and solo builders validating a new launch" />
              <span class="field-error" data-error-for="audience" hidden></span>
            </label>

            <fieldset class="field full" data-field="signals">
              <legend class="field-label">Signals to validate <span class="hint">Choose at least 1</span></legend>
              <div class="goal-grid">
                ${renderSignalOptions(defaultDraft.signals)}
              </div>
              <span class="field-error" data-error-for="signals" hidden></span>
            </fieldset>

            <label class="field full" data-field="hypothesis">
              <span class="field-label">Hypothesis <span class="hint">260 chars</span></span>
              <textarea class="textarea" name="hypothesis" maxlength="260" required data-live-field placeholder="Example: Builders need a fast way to learn if users understand what they shipped."></textarea>
              <span class="field-error" data-error-for="hypothesis" hidden></span>
            </label>

            <label class="field full" data-field="task">
              <span class="field-label">Tester mission <span class="hint">260 chars</span></span>
              <textarea class="textarea" name="task" maxlength="260" required data-live-field placeholder="Example: Open the product, try to create a validation sprint, and notice where you hesitate."></textarea>
              <span class="field-error" data-error-for="task" hidden></span>
            </label>
          </div>

          <div class="actions">
            <button class="button primary" type="submit">Create proof sprint</button>
            <button class="button secondary" type="button" data-action="load-demo">Open demo dashboard</button>
          </div>
        </div>
      </form>

      <aside class="preview-stack" aria-label="Sprint preview">
        <div class="panel compact">
          <div class="panel-body">
            <p class="eyebrow">Live sprint brief</p>
            <div data-live-preview>
              ${renderBrief(defaultDraft)}
            </div>
          </div>
        </div>
      </aside>
    </section>
  `;
}

async function renderDashboard(sprintId) {
  const sprint = await getSprintHydrated(sprintId);
  if (!sprint) {
    renderMissing("Sprint not found", "Create a new sprint or open the demo dashboard.");
    return;
  }

  const responses = await getResponsesHydrated(sprint.id);
  const insights = calculateInsights(sprint, responses);
  const testerLink = buildTesterLink(sprint);
  const primaryGoal = getPrimaryGoal(sprint);
  const signals = getSprintSignals(sprint);
  const hasResponses = responses.length > 0;
  trackOnce(`dashboard:${sprint.id}`, "dashboard_viewed", {
    sprintId: sprint.id,
    responses: responses.length
  });

  app.innerHTML = `
    <section class="workspace dashboard-layout">
      <aside class="score-panel">
        <div class="panel">
          <div class="panel-body">
            <p class="eyebrow">${escapeHTML(primaryGoal.label)} sprint</p>
            <h1>${escapeHTML(sprint.productName)}</h1>
            <p class="lede">${escapeHTML(sprint.audience)}</p>

            <div class="score-ring" style="--score: ${hasResponses ? insights.score : 0}">
              <div>
                <span>${hasResponses ? insights.score : "--"}</span>
                <small>Proof score</small>
              </div>
            </div>

            <div class="badge-row">
              <span class="badge teal">${responses.length} ${responses.length === 1 ? "response" : "responses"}</span>
              <span class="badge amber">${escapeHTML(insights.status)}</span>
              ${isSupabaseConfigured() ? `<span class="badge teal">Cloud sync</span>` : ""}
              ${signals
                .slice(0, 2)
                .map((signal) => `<span class="badge">${escapeHTML(GOALS[signal].label)}</span>`)
                .join("")}
            </div>

            <div class="divider"></div>

            <div class="link-box">
              <strong>Tester link</strong>
              <code title="${escapeAttr(testerLink)}">${escapeHTML(formatTesterLinkLabel(testerLink))}</code>
              <button class="button teal" type="button" data-action="copy-link" data-sprint-id="${escapeAttr(sprint.id)}" data-url="${escapeAttr(testerLink)}">Copy tester link</button>
            </div>

            <div class="divider"></div>

            <form data-import-form data-sprint-id="${escapeAttr(sprint.id)}">
              <label>
                <span class="field-label">Import proof packet</span>
                <textarea class="textarea" name="packet" placeholder="Paste a tester packet here"></textarea>
              </label>
              <div class="actions">
                <button class="button secondary" type="submit">Import response</button>
              </div>
            </form>

            <div class="actions">
              <button class="button secondary" type="button" data-action="copy-report" data-sprint-id="${escapeAttr(sprint.id)}">Copy report</button>
              <button class="button secondary" type="button" data-action="export-report" data-sprint-id="${escapeAttr(sprint.id)}">Export markdown</button>
            </div>
          </div>
        </div>
      </aside>

      <div class="dashboard-main">
        ${renderSignalStrip(insights, hasResponses)}
        ${hasResponses ? renderInsights(sprint, insights) : renderWaitingState(sprint)}
        ${hasResponses ? renderResponses(responses) : ""}
      </div>
    </section>
  `;
}

async function renderTester(sprintId) {
  const sprint = await getSprintHydrated(sprintId);
  if (!sprint) {
    renderMissing("Sprint unavailable", "The sprint link is missing its brief. Ask the creator for a fresh tester link.");
    return;
  }

  const primaryGoal = getPrimaryGoal(sprint);
  const signals = getSprintSignals(sprint);

  trackOnce(`tester:${sprint.id}`, "tester_started", {
    sprintId: sprint.id,
    goal: sprint.goal,
    signals
  });

  app.innerHTML = `
    <section class="tester-shell">
      <div class="panel">
        <div class="panel-body">
          <p class="eyebrow">3 minute proof sprint</p>
          <h1>${escapeHTML(sprint.productName)}</h1>
          <p class="lede">${escapeHTML(sprint.audience)}</p>

          <div class="mission">
            <div class="sprint-brief">
              <div class="brief-head">
                <span class="brief-title">Mission</span>
                <span class="brief-meta">${escapeHTML(primaryGoal.question)}</span>
              </div>
              <div class="brief-body">
                <div class="badge-row">
                  ${signals
                    .map((signal) => `<span class="badge teal">${escapeHTML(GOALS[signal].label)}</span>`)
                    .join("")}
                </div>
                <div class="brief-item">
                  <span>Task</span>
                  <p>${escapeHTML(sprint.task)}</p>
                </div>
                <div class="brief-item">
                  <span>Hypothesis</span>
                  <p>${escapeHTML(sprint.hypothesis)}</p>
                </div>
              </div>
            </div>

            <div class="mission-url">
              <code>${escapeHTML(sprint.productUrl)}</code>
              <a class="button primary" href="${escapeAttr(normalizeUrl(sprint.productUrl))}" target="_blank" rel="noreferrer" data-action="open-product" data-sprint-id="${escapeAttr(sprint.id)}">Open product</a>
            </div>
          </div>

          <div class="divider"></div>

          <form data-tester-form data-sprint-id="${escapeAttr(sprint.id)}" novalidate>
            <div class="field-grid">
              ${renderScale("clarity", "How clear was the product?", "1 unclear", "5 obvious")}
              ${renderScale("value", "How useful did it feel?", "1 not useful", "5 very useful")}
              ${renderScale("confidence", "How confident would you be trying it again?", "1 low", "5 high")}
              ${renderScale("friction", "How much friction did you feel?", "1 none", "5 heavy")}

              <label class="field full" data-field="understood">
                <span class="field-label">What did you understand?</span>
                <textarea class="textarea" name="understood" required placeholder="In your own words"></textarea>
                <span class="field-error" data-error-for="understood" hidden></span>
              </label>

              <label class="field full" data-field="confusion">
                <span class="field-label">Where did you hesitate?</span>
                <textarea class="textarea" name="confusion" required placeholder="The moment, copy, screen, or action that slowed you down"></textarea>
                <span class="field-error" data-error-for="confusion" hidden></span>
              </label>

              <label class="field full" data-field="improvement">
                <span class="field-label">What would make this stronger?</span>
                <textarea class="textarea" name="improvement" required placeholder="One specific change"></textarea>
                <span class="field-error" data-error-for="improvement" hidden></span>
              </label>

              <label class="field">
                <span class="field-label">Your name <span class="hint">optional</span></span>
                <input class="input" name="testerName" maxlength="50" placeholder="Anonymous" />
              </label>

              <label class="field" data-field="intent">
                <span class="field-label">Would you use it?</span>
                <select class="select" name="intent" required>
                  <option value="" disabled selected>Choose one</option>
                  <option value="Yes">Yes</option>
                  <option value="Maybe">Maybe</option>
                  <option value="No">No</option>
                </select>
                <span class="field-error" data-error-for="intent" hidden></span>
              </label>
            </div>

            <div class="actions">
              <button class="button primary" type="submit">Submit feedback</button>
            </div>
          </form>
        </div>
      </div>
    </section>
  `;
}

function renderThanks(sprintId, responseId) {
  const sprint = getSprint(sprintId);
  const response = getResponses(sprintId).find((item) => item.id === responseId);
  if (!sprint || !response) {
    renderMissing("Feedback not found", "Open the tester link and submit the sprint again.");
    return;
  }

  const packet = encodePacket(response);
  const mailtoLink = buildPacketMailtoLink(sprint, packet);

  app.innerHTML = `
    <section class="tester-shell">
      <div class="panel">
        <div class="panel-body">
          <p class="eyebrow">Feedback captured</p>
          <h1>Signal received.</h1>
          <p class="lede">Thanks. Your feedback is ready for the sprint creator and can be added to the proof dashboard.</p>

          <div class="actions">
            <button class="button primary" type="button" data-action="copy-packet">Copy packet</button>
            <a class="button secondary" href="${escapeAttr(mailtoLink)}" data-action="email-packet" data-sprint-id="${escapeAttr(sprint.id)}">Email packet</a>
            <a class="button secondary" href="#/dashboard/${escapeAttr(sprint.id)}">View dashboard</a>
          </div>

          <details class="packet-details">
            <summary>View packet for manual sharing</summary>
            <label>
              <span class="field-label">Shareable feedback packet</span>
              <textarea id="proof-packet" class="textarea" readonly>${escapeHTML(packet)}</textarea>
            </label>
          </details>
        </div>
      </div>
    </section>
  `;
}

function renderMissing(title, message) {
  app.innerHTML = `
    <section class="tester-shell">
      <div class="panel">
        <div class="panel-body">
          <p class="eyebrow">ProofSprint</p>
          <h1>${escapeHTML(title)}</h1>
          <p class="lede">${escapeHTML(message)}</p>
          <div class="actions">
            <a class="button primary" href="#/create">Create sprint</a>
            <button class="button secondary" type="button" data-action="load-demo">Open demo dashboard</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderSignalOptions(selectedSignals) {
  const selected = new Set(selectedSignals && selectedSignals.length ? selectedSignals : DEFAULT_SIGNALS);
  return SIGNAL_ORDER.map((value) => {
      const goal = GOALS[value];
      const checked = selected.has(value) ? "checked" : "";
      return `
        <label class="goal-option">
          <input type="checkbox" name="signals" value="${escapeAttr(value)}" ${checked} data-live-field />
          <span class="goal-card">
            <strong>${escapeHTML(goal.label)}</strong>
            <span>${escapeHTML(goal.short)}</span>
          </span>
        </label>
      `;
    })
    .join("");
}

function renderBrief(draft) {
  const signals = getSprintSignals(draft);
  const goal = getPrimaryGoal(draft);
  const name = draft.productName || "Your shipped product";
  const audience = draft.audience || "The people you want to serve";
  const task =
    draft.task ||
    "Open the product, try the first meaningful action, and notice where the experience slows down.";
  const hypothesis =
    draft.hypothesis ||
    "A real user can understand the product, reach value, and describe what should improve next.";

  return `
    <article class="sprint-brief">
      <div class="brief-head">
        <span class="brief-title">${escapeHTML(name)}</span>
        <span class="brief-meta">${escapeHTML(audience)}</span>
      </div>
      <div class="brief-body">
        <div class="badge-row">
          ${signals
            .slice(0, 3)
            .map((signal) => `<span class="badge teal">${escapeHTML(GOALS[signal].label)}</span>`)
            .join("")}
          ${signals.length > 3 ? `<span class="badge teal">+${signals.length - 3} signals</span>` : ""}
          <span class="badge amber">3 min test</span>
          <span class="badge coral">Proof score</span>
        </div>
        <div class="brief-item">
          <span>Question</span>
          <p>${escapeHTML(goal.question)}</p>
        </div>
        <div class="brief-item">
          <span>Hypothesis</span>
          <p>${escapeHTML(hypothesis)}</p>
        </div>
        <div class="brief-item">
          <span>Mission</span>
          <p>${escapeHTML(task)}</p>
        </div>
      </div>
    </article>
  `;
}

function renderScale(name, label, low, high) {
  return `
    <fieldset class="field full" data-field="${escapeAttr(name)}">
      <legend class="field-label">${escapeHTML(label)} <span class="hint">${escapeHTML(low)} / ${escapeHTML(high)}</span></legend>
      <div class="scale-grid">
        ${[1, 2, 3, 4, 5]
          .map(
            (value) => `
              <label class="scale-option">
                <input type="radio" name="${escapeAttr(name)}" value="${value}" required />
                <span>${value}</span>
              </label>
            `
          )
          .join("")}
      </div>
      <span class="field-error" data-error-for="${escapeAttr(name)}" hidden></span>
    </fieldset>
  `;
}

function renderSignalStrip(insights, hasResponses) {
  const values = hasResponses
    ? [
        ["Clarity", insights.averages.clarity, "/5"],
        ["Value", insights.averages.value, "/5"],
        ["Confidence", insights.averages.confidence, "/5"],
        ["Low friction", insights.averages.lowFriction, "/5"]
      ]
    : [
        ["Clarity", "--", ""],
        ["Value", "--", ""],
        ["Confidence", "--", ""],
        ["Low friction", "--", ""]
      ];

  return `
    <div class="signal-strip">
      ${values
        .map(
          ([label, value, suffix]) => `
            <div class="metric">
              <span>${escapeHTML(label)}</span>
              <strong>${escapeHTML(value)}${escapeHTML(suffix)}</strong>
              <small>${hasResponses ? "Tester average" : "Awaiting signal"}</small>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderInsights(sprint, insights) {
  return `
    <section class="panel">
      <div class="panel-body">
        <p class="eyebrow">Evidence summary</p>
        <h2>${escapeHTML(insights.headline)}</h2>
        <p class="lede">${escapeHTML(insights.summary)}</p>

        <div class="insight-grid">
          <article class="insight">
            <h3>Main risk</h3>
            <p>${escapeHTML(insights.risk)}</p>
          </article>
          <article class="insight">
            <h3>Next experiment</h3>
            <p>${escapeHTML(insights.nextExperiment || getPrimaryGoal(sprint).next)}</p>
          </article>
        </div>

        <div class="divider"></div>

        <div class="bars" aria-label="Signal bars">
          ${renderBar("Clarity", insights.averages.clarity, "good")}
          ${renderBar("Value", insights.averages.value, "good")}
          ${renderBar("Confidence", insights.averages.confidence, "good")}
          ${renderBar("Low friction", insights.averages.lowFriction, insights.averages.lowFriction >= 3.6 ? "good" : "risk")}
        </div>
      </div>
    </section>
  `;
}

function renderWaitingState(sprint) {
  const testerLink = buildTesterLink(sprint);
  return `
    <section class="panel">
      <div class="panel-body">
        <p class="eyebrow">Evidence summary</p>
        <h2>Waiting for tester signal.</h2>
        <div class="empty-state">
          <p>Share the tester link or import a proof packet. Once responses arrive, this dashboard will calculate score, risks, quotes, and the next experiment.</p>
          <a class="button secondary" href="${escapeAttr(testerLink)}">Open tester view</a>
        </div>
      </div>
    </section>
  `;
}

function renderResponses(responses) {
  const cards = responses
    .slice()
    .reverse()
    .map((response) => {
      const name = response.testerName || "Anonymous tester";
      return `
        <article class="quote-card">
          <blockquote>${escapeHTML(response.confusion)}</blockquote>
          <footer>${escapeHTML(name)} - clarity ${response.clarity}/5, value ${response.value}/5, friction ${response.friction}/5</footer>
        </article>
      `;
    })
    .join("");

  return `
    <section class="panel">
      <div class="panel-body">
        <p class="eyebrow">Tester evidence</p>
        <h2>Where people hesitated</h2>
        <div class="quote-list">
          ${cards}
        </div>
      </div>
    </section>
  `;
}

function renderBar(label, value, tone) {
  const number = Number(value) || 0;
  const className = tone === "risk" ? "bar-fill risk" : number < 3.6 ? "bar-fill warn" : "bar-fill";
  return `
    <div class="bar-row">
      <span>${escapeHTML(label)}</span>
      <span class="bar-track"><span class="${className}" style="--value: ${number}"></span></span>
      <strong>${number.toFixed(1)}</strong>
    </div>
  `;
}

function getSprintSignals(sprint) {
  const signals = Array.isArray(sprint.signals)
    ? sprint.signals.map(normalizeGoalKey).filter((signal) => GOALS[signal])
    : [];
  if (signals.length) return [...new Set(signals)];
  return [normalizeGoalKey(sprint.goal)];
}

function getPrimaryGoalKey(sprint) {
  return getSprintSignals(sprint)[0] || "clarity";
}

function getPrimaryGoal(sprint) {
  return GOALS[getPrimaryGoalKey(sprint)] || GOALS.clarity;
}

function normalizeGoalKey(goal) {
  if (goal === "activation") return "onboarding";
  if (goal === "trust") return "confidence";
  return GOALS[goal] ? goal : "clarity";
}

function estimateSharePacketLength(draft) {
  const sprint = {
    id: "sprint-preview",
    productName: draft.productName,
    productUrl: validateProductUrl(draft.productUrl).url || normalizeUrl(draft.productUrl || "example.com"),
    audience: draft.audience,
    goal: draft.goal,
    signals: draft.signals,
    hypothesis: draft.hypothesis,
    task: draft.task,
    createdAt: new Date().toISOString()
  };
  return encodePacket({ type: "sprint", sprint }).length;
}

function validateCreateDraft(draft) {
  const errors = {};
  const urlResult = validateProductUrl(draft.productUrl);

  if (draft.productName.length < 2) {
    errors.productName = "Give the sprint a clear product name.";
  }

  if (!urlResult.valid) {
    errors.productUrl = urlResult.message;
  }

  if (draft.audience.length < 8) {
    errors.audience = "Describe the target audience in a few words.";
  }

  if (!draft.signals.length) {
    errors.signals = "Choose at least one signal to validate.";
  }

  if (draft.hypothesis.length < 16) {
    errors.hypothesis = "Write a sharper hypothesis so testers know what you are trying to prove.";
  }

  if (draft.task.length < 16) {
    errors.task = "Give testers one clear mission to complete.";
  }

  if (!errors.productUrl && estimateSharePacketLength(draft) > MAX_SHARE_PACKET_LENGTH) {
    errors.sharePacket =
      "Your sprint copy is too long for a reliable public tester link. Shorten the audience, hypothesis, or mission.";
  }

  return errors;
}

function validateTesterForm(form) {
  const data = new FormData(form);
  const errors = {};
  ["clarity", "value", "confidence", "friction"].forEach((field) => {
    if (!data.get(field)) {
      errors[field] = "Choose a score.";
    }
  });

  ["understood", "confusion", "improvement"].forEach((field) => {
    if ((data.get(field) || "").trim().length < 8) {
      errors[field] = "Add a short but useful answer.";
    }
  });

  if (!data.get("intent")) {
    errors.intent = "Choose whether you would use it.";
  }

  return errors;
}

function validateProductUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: false, url: "", message: "Paste the product URL you want testers to open." };
  }

  const normalized = normalizeUrl(trimmed);
  try {
    const url = new URL(normalized);
    const isHttp = url.protocol === "http:" || url.protocol === "https:";
    const isReachableHost = url.hostname.includes(".") || url.hostname === "localhost";
    if (!isHttp || !isReachableHost) {
      return {
        valid: false,
        url: "",
        message: "Use a valid http(s) URL, like https://your-product.com."
      };
    }
    return { valid: true, url: url.href, message: "" };
  } catch (error) {
    return {
      valid: false,
      url: "",
      message: "Use a valid http(s) URL, like https://your-product.com."
    };
  }
}

function showFormErrors(form, errors) {
  clearFormErrors(form);
  Object.entries(errors).forEach(([field, message]) => {
    if (field === "sharePacket") {
      const alert = form.querySelector('[data-error-for="sharePacket"]');
      if (alert) {
        alert.textContent = message;
        alert.hidden = false;
      }
      return;
    }

    const wrapper = form.querySelector(`[data-field="${field}"]`);
    const error = form.querySelector(`[data-error-for="${field}"]`);
    if (wrapper) wrapper.classList.add("invalid");
    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
    form.querySelectorAll(`[name="${field}"]`).forEach((control) => {
      control.setAttribute("aria-invalid", "true");
    });
  });
}

function clearFormErrors(form) {
  form.querySelectorAll(".field.invalid").forEach((field) => field.classList.remove("invalid"));
  form.querySelectorAll(".form-alert").forEach((alert) => {
    alert.textContent = "";
    alert.hidden = true;
  });
  form.querySelectorAll(".field-error").forEach((error) => {
    error.textContent = "";
    error.hidden = true;
  });
  form.querySelectorAll("[aria-invalid]").forEach((control) => {
    control.removeAttribute("aria-invalid");
  });
}

function clearFieldError(form, field) {
  if (!field) return;
  const wrapper = form.querySelector(`[data-field="${field}"]`);
  const error = form.querySelector(`[data-error-for="${field}"]`);
  if (wrapper) wrapper.classList.remove("invalid");
  if (error) {
    error.textContent = "";
    error.hidden = true;
  }
  form.querySelectorAll(`[name="${field}"]`).forEach((control) => {
    control.removeAttribute("aria-invalid");
  });
}

function focusFirstError(form, errors) {
  const firstField = Object.keys(errors).find((field) => field !== "sharePacket");
  if (!firstField) return;
  const wrapper = form.querySelector(`[data-field="${firstField}"]`);
  const control = wrapper
    ? wrapper.querySelector("input, textarea, select, button")
    : form.querySelector(`[name="${firstField}"]`);
  if (control && typeof control.focus === "function") {
    control.focus({ preventScroll: true });
  }
  if (wrapper && typeof wrapper.scrollIntoView === "function") {
    wrapper.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function readCreateDraft(form) {
  const data = new FormData(form);
  const signals = data.getAll("signals").filter((signal) => GOALS[signal]);
  return {
    productName: data.get("productName").trim(),
    productUrl: data.get("productUrl").trim(),
    audience: data.get("audience").trim(),
    goal: signals[0] || "clarity",
    signals,
    hypothesis: data.get("hypothesis").trim(),
    task: data.get("task").trim()
  };
}

function createSprintFromForm(form, draft = readCreateDraft(form)) {
  const validatedUrl = validateProductUrl(draft.productUrl);
  return {
    id: createId("sprint"),
    productName: draft.productName,
    productUrl: validatedUrl.url,
    audience: draft.audience,
    goal: draft.goal,
    signals: draft.signals,
    hypothesis: draft.hypothesis,
    task: draft.task,
    createdAt: new Date().toISOString()
  };
}

function createResponseFromForm(sprint, form) {
  const data = new FormData(form);
  return {
    id: createId("rsp"),
    sprintId: sprint.id,
    testerName: data.get("testerName").trim(),
    intent: data.get("intent"),
    clarity: Number(data.get("clarity")),
    value: Number(data.get("value")),
    confidence: Number(data.get("confidence")),
    friction: Number(data.get("friction")),
    understood: data.get("understood").trim(),
    confusion: data.get("confusion").trim(),
    improvement: data.get("improvement").trim(),
    createdAt: new Date().toISOString()
  };
}

function calculateInsights(sprint, responses) {
  const primaryGoal = getPrimaryGoal(sprint);
  const primaryGoalKey = getPrimaryGoalKey(sprint);
  if (!responses.length) {
    return {
      score: 0,
      status: "No data yet",
      headline: "Waiting for tester signal.",
      summary: "Share the sprint to collect evidence.",
      risk: "No risk detected yet.",
      nextExperiment: primaryGoal.next,
      averages: {
        clarity: "--",
        value: "--",
        confidence: "--",
        lowFriction: "--"
      }
    };
  }

  const clarity = average(responses, "clarity");
  const value = average(responses, "value");
  const confidence = average(responses, "confidence");
  const friction = average(responses, "friction");
  const lowFriction = 6 - friction;
  const score = Math.round(
    (normalizePositive(clarity) +
      normalizePositive(value) +
      normalizePositive(confidence) +
      normalizePositive(lowFriction)) /
      4
  );

  const lowest = [
    ["clarity", clarity],
    ["value", value],
    ["confidence", confidence],
    ["low friction", lowFriction]
  ].sort((a, b) => a[1] - b[1])[0][0];

  const headline =
    score >= 82
      ? "The product is landing with strong evidence."
      : score >= 64
        ? "The signal is promising, with one visible gap."
        : "The first experience needs sharper proof.";

  const status = score >= 82 ? "Strong signal" : score >= 64 ? "Promising" : "Needs work";
  const risk = buildRisk(lowest, primaryGoalKey);
  const nextExperiment = buildNextExperiment(lowest, primaryGoalKey);
  const summary = buildSummary(score, lowest, responses);

  return {
    score,
    status,
    headline,
    summary,
    risk,
    nextExperiment,
    averages: {
      clarity: clarity.toFixed(1),
      value: value.toFixed(1),
      confidence: confidence.toFixed(1),
      lowFriction: lowFriction.toFixed(1)
    }
  };
}

function buildRisk(lowest, goal) {
  const risks = {
    clarity: "Users may be reaching the product before they can explain what it does or why it matters.",
    value: "The core benefit may be too broad, too abstract, or not visible early enough.",
    confidence: "The experience may need clearer proof, safer language, or a more credible first action.",
    "low friction": "The first path may contain a step that feels slower than the value it unlocks."
  };
  if (lowest === "low friction") return risks["low friction"];
  if (lowest === "clarity") return risks.clarity;
  if (lowest === "value") return risks.value;
  if (lowest === "confidence") return risks.confidence;
  return GOALS[goal].question;
}

function buildNextExperiment(lowest, goal) {
  const experiments = {
    clarity: "Rewrite the first value promise in one sentence, then run this sprint again with five fresh testers.",
    value: "Narrow the product to one use case and ask testers what they would replace with it.",
    confidence: "Add one visible proof point before the primary action and retest confidence.",
    "low friction": "Remove or simplify the step testers mentioned most, then compare completion quality."
  };
  return experiments[lowest] || GOALS[goal].next;
}

function buildSummary(score, lowest, responses) {
  const intentCounts = responses.reduce(
    (counts, response) => {
      counts[response.intent] = (counts[response.intent] || 0) + 1;
      return counts;
    },
    { Yes: 0, Maybe: 0, No: 0 }
  );
  const strongestIntent = Object.entries(intentCounts).sort((a, b) => b[1] - a[1])[0][0];

  if (score >= 82) {
    return `Most testers understood the product and signaled ${strongestIntent.toLowerCase()} on intent. The next move is to test repeat usage, not just first impression.`;
  }

  if (score >= 64) {
    return `The product has usable signal, but ${lowest} is limiting confidence. The next sprint should isolate that point instead of expanding scope.`;
  }

  return `The evidence points to an early comprehension or friction problem. Keep the product small, sharpen the first moment, and retest before adding features.`;
}

function buildMarkdownReport(sprint, responses, insights) {
  const signals = getSprintSignals(sprint);
  const lines = [
    `# ProofSprint Report: ${sprint.productName}`,
    "",
    `Product URL: ${sprint.productUrl}`,
    `Audience: ${sprint.audience}`,
    `Validation signals: ${signals.map((signal) => GOALS[signal].label).join(", ")}`,
    `Responses: ${responses.length}`,
    "",
    `## Proof Score`,
    "",
    responses.length ? `${insights.score}/100 - ${insights.status}` : "No responses yet.",
    "",
    `## Summary`,
    "",
    insights.summary,
    "",
    `## Main Risk`,
    "",
    insights.risk,
    "",
    `## Next Experiment`,
    "",
    insights.nextExperiment,
    "",
    `## Tester Evidence`
  ];

  if (!responses.length) {
    lines.push("", "No tester evidence collected yet.");
  } else {
    responses.forEach((response, index) => {
      lines.push(
        "",
        `### Response ${index + 1}`,
        "",
        `Tester: ${response.testerName || "Anonymous tester"}`,
        `Intent: ${response.intent}`,
        `Clarity: ${response.clarity}/5`,
        `Value: ${response.value}/5`,
        `Confidence: ${response.confidence}/5`,
        `Friction: ${response.friction}/5`,
        "",
        `Understood: ${response.understood}`,
        "",
        `Hesitated: ${response.confusion}`,
        "",
        `Suggested improvement: ${response.improvement}`
      );
    });
  }

  return lines.join("\n");
}

function seedDemo() {
  const sprint = {
    id: DEMO_ID,
    productName: "ProofSprint",
    productUrl: "https://example.com/proofsprint",
    audience: "PMs, founders, and AI builders validating a new launch",
    goal: "clarity",
    signals: ["clarity", "value", "confidence"],
    hypothesis: "Builders can learn faster if a shipped product is turned into a short evidence sprint instead of a vague feedback request.",
    task: "Open the product, create a validation sprint for something you recently shipped, and notice where the workflow feels clear or slow.",
    createdAt: new Date().toISOString()
  };

  const responses = [
    {
      id: "demo-rsp-1",
      sprintId: DEMO_ID,
      testerName: "Maya",
      intent: "Yes",
      clarity: 5,
      value: 5,
      confidence: 4,
      friction: 2,
      understood: "It helps me turn a launched project into a quick test so I know what users actually understood.",
      confusion: "I hesitated at the import packet because I expected responses to appear automatically.",
      improvement: "Make the backend status obvious and show when live collection is enabled.",
      createdAt: new Date(Date.now() - 1000 * 60 * 34).toISOString()
    },
    {
      id: "demo-rsp-2",
      sprintId: DEMO_ID,
      testerName: "Leo",
      intent: "Maybe",
      clarity: 4,
      value: 4,
      confidence: 4,
      friction: 3,
      understood: "The app gives a proof score from tester feedback and suggests what to try next.",
      confusion: "I wanted an example of a good tester mission before writing my own.",
      improvement: "Offer sharper templates based on the selected signal.",
      createdAt: new Date(Date.now() - 1000 * 60 * 22).toISOString()
    },
    {
      id: "demo-rsp-3",
      sprintId: DEMO_ID,
      testerName: "Iris",
      intent: "Yes",
      clarity: 5,
      value: 4,
      confidence: 5,
      friction: 1,
      understood: "It is a fast way for builders to stop guessing after launch.",
      confusion: "The tester flow was clear. I only wondered whether the report could be shared with a team.",
      improvement: "Add a public read-only report link.",
      createdAt: new Date(Date.now() - 1000 * 60 * 12).toISOString()
    }
  ];

  const state = getState();
  state.sprints[DEMO_ID] = sprint;
  state.responses = state.responses.filter((response) => response.sprintId !== DEMO_ID).concat(responses);
  setState(state);
  return DEMO_ID;
}

function getState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      sprints: parsed.sprints || {},
      responses: Array.isArray(parsed.responses) ? parsed.responses : []
    };
  } catch (error) {
    return { sprints: {}, responses: [] };
  }
}

function setState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function saveSprint(sprint) {
  const state = getState();
  state.sprints[sprint.id] = sprint;
  setState(state);
}

function getSprint(id) {
  return getState().sprints[id] || null;
}

async function getSprintHydrated(id) {
  const localSprint = getSprint(id);
  if (localSprint) return localSprint;
  const remoteSprint = await fetchSprintRemote(id);
  if (remoteSprint) saveSprint(remoteSprint);
  return remoteSprint;
}

function saveResponse(response) {
  const state = getState();
  state.responses = state.responses.filter((item) => item.id !== response.id);
  state.responses.push(response);
  setState(state);
}

function getResponses(sprintId) {
  return getState()
    .responses.filter((response) => response.sprintId === sprintId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

async function getResponsesHydrated(sprintId) {
  const localResponses = getResponses(sprintId);
  const remoteResponses = await fetchResponsesRemote(sprintId);
  if (!remoteResponses.length) return localResponses;
  const merged = mergeResponses(localResponses, remoteResponses);
  merged.forEach(saveResponse);
  return merged.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function mergeResponses(localResponses, remoteResponses) {
  const byId = new Map();
  localResponses.concat(remoteResponses).forEach((response) => {
    byId.set(response.id, response);
  });
  return [...byId.values()];
}

function getSupabaseConfig() {
  const config = window.PROOFSPRINT_SUPABASE || {};
  const url = (config.url || "").replace(/\/+$/, "");
  const key = config.publishableKey || config.anonKey || config.key || "";
  return { url, key };
}

function isSupabaseConfigured() {
  const { url, key } = getSupabaseConfig();
  return Boolean(url && key);
}

async function supabaseRequest(path, options = {}) {
  if (!isSupabaseConfigured()) return null;
  const { url, key } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.prefer ? { Prefer: options.prefer } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Supabase request failed with ${response.status}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function persistSprintRemote(sprint) {
  if (!isSupabaseConfigured() || sprint.id === DEMO_ID) return false;
  try {
    await supabaseRequest("sprints", {
      method: "POST",
      body: sprintToRecord(sprint),
      prefer: "return=minimal"
    });
    track("cloud_sprint_saved", { sprintId: sprint.id });
    return true;
  } catch (error) {
    console.warn("ProofSprint cloud sprint save failed", error);
    showToast("Sprint saved locally. Cloud sync needs attention.");
    return false;
  }
}

async function persistResponseRemote(response) {
  if (!isSupabaseConfigured() || response.sprintId === DEMO_ID) return false;
  try {
    await supabaseRequest("responses", {
      method: "POST",
      body: responseToRecord(response),
      prefer: "return=minimal"
    });
    track("cloud_response_saved", { sprintId: response.sprintId });
    return true;
  } catch (error) {
    console.warn("ProofSprint cloud response save failed", error);
    showToast("Feedback saved locally. Cloud sync needs attention.");
    return false;
  }
}

async function fetchSprintRemote(id) {
  if (!isSupabaseConfigured() || !id) return null;
  try {
    const rows = await supabaseRequest(`sprints?id=eq.${encodeURIComponent(id)}&select=*`);
    return Array.isArray(rows) && rows[0] ? recordToSprint(rows[0]) : null;
  } catch (error) {
    console.warn("ProofSprint cloud sprint fetch failed", error);
    return null;
  }
}

async function fetchResponsesRemote(sprintId) {
  if (!isSupabaseConfigured() || !sprintId) return [];
  try {
    const rows = await supabaseRequest(
      `responses?sprint_id=eq.${encodeURIComponent(sprintId)}&select=*&order=created_at.asc`
    );
    return Array.isArray(rows) ? rows.map(recordToResponse) : [];
  } catch (error) {
    console.warn("ProofSprint cloud responses fetch failed", error);
    return [];
  }
}

function sprintToRecord(sprint) {
  return {
    id: sprint.id,
    product_name: sprint.productName,
    product_url: sprint.productUrl,
    audience: sprint.audience,
    goal: sprint.goal,
    signals: getSprintSignals(sprint),
    hypothesis: sprint.hypothesis,
    task: sprint.task,
    created_at: sprint.createdAt
  };
}

function recordToSprint(record) {
  return {
    id: record.id,
    productName: record.product_name,
    productUrl: record.product_url,
    audience: record.audience,
    goal: normalizeGoalKey(record.goal),
    signals: Array.isArray(record.signals) ? record.signals.map(normalizeGoalKey) : [],
    hypothesis: record.hypothesis,
    task: record.task,
    createdAt: record.created_at
  };
}

function responseToRecord(response) {
  return {
    id: response.id,
    sprint_id: response.sprintId,
    tester_name: response.testerName,
    intent: response.intent,
    clarity: response.clarity,
    value: response.value,
    confidence: response.confidence,
    friction: response.friction,
    understood: response.understood,
    confusion: response.confusion,
    improvement: response.improvement,
    created_at: response.createdAt
  };
}

function recordToResponse(record) {
  return {
    id: record.id,
    sprintId: record.sprint_id,
    testerName: record.tester_name || "",
    intent: record.intent,
    clarity: Number(record.clarity),
    value: Number(record.value),
    confidence: Number(record.confidence),
    friction: Number(record.friction),
    understood: record.understood,
    confusion: record.confusion,
    improvement: record.improvement,
    createdAt: record.created_at
  };
}

function buildTesterLink(sprint) {
  const encodedSprint = encodePacket({ type: "sprint", sprint });
  return `${location.href.replace(/#.*$/, "")}#/test/${sprint.id}?s=${encodedSprint}`;
}

function buildPacketMailtoLink(sprint, packet) {
  const subject = `ProofSprint feedback for ${sprint.productName}`;
  const body = [
    "Here is my ProofSprint feedback packet.",
    "",
    "Open the sprint dashboard, paste this into Import proof packet, and click Import response.",
    "",
    packet
  ].join("\n");
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function formatTesterLinkLabel(url) {
  try {
    const parsed = new URL(url);
    const sprintPath = parsed.hash.split("?")[0] || "#/test";
    const sprintId = sprintPath.replace("#/test/", "");
    return `Tester link for ${sprintId}`;
  } catch (error) {
    return "Tester link ready to copy";
  }
}

function hydrateSprintFromRoute(route) {
  if (route.view !== "test" || !route.query.has("s")) return;
  try {
    const packet = decodePacket(route.query.get("s"));
    if (packet.type === "sprint" && packet.sprint && packet.sprint.id === route.id) {
      saveSprint(packet.sprint);
    }
  } catch (error) {
    // Invalid share packets should not block the route.
  }
}

function encodePacket(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodePacket(packet) {
  const base64 = packet.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function createId(prefix) {
  if (window.crypto && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function average(items, key) {
  return items.reduce((sum, item) => sum + Number(item[key] || 0), 0) / items.length;
}

function normalizePositive(value) {
  return Math.max(0, Math.min(100, ((value - 1) / 4) * 100));
}

function track(eventName, properties) {
  if (typeof window.proofSprintTrack === "function") {
    window.proofSprintTrack(eventName, properties || {});
  }
}

function trackOnce(key, eventName, properties) {
  const storageKey = `proofsprint:track:${key}`;
  if (sessionStorage.getItem(storageKey)) return;
  sessionStorage.setItem(storageKey, "1");
  track(eventName, properties);
}

async function copyText(text) {
  if (!text) return;
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function downloadMarkdown(filename, text) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

function hideToast() {
  window.clearTimeout(showToast.timeout);
  toast.classList.remove("show");
  toast.textContent = "";
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char];
  });
}

function escapeAttr(value) {
  return escapeHTML(value);
}
