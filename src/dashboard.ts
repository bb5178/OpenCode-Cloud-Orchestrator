// ============================================================
// OCO Dashboard — Full-featured HTML dashboard
// ============================================================

export function renderDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OCO — OpenCode Cloud Orchestrator</title>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    :root {
      --bg: #0d1117; --surface: #161b22; --border: #30363d;
      --text: #e6edf3; --muted: #8b949e; --accent: #58a6ff;
      --green: #3fb950; --red: #f85149; --yellow: #d29922; --blue: #58a6ff;
      --purple: #bc8cff; --orange: #f0883e;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
           background: var(--bg); color: var(--text); padding: 24px; }
    h1 { font-size: 24px; margin-bottom: 4px; }
    .subtitle { color: var(--muted); margin-bottom: 24px; font-size: 14px; }
    .stats { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
    .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
            padding: 16px 20px; min-width: 120px; }
    .stat-value { font-size: 28px; font-weight: 600; }
    .stat-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }

    /* ── Job card ── */
    .job { background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
           margin-bottom: 16px; overflow: hidden; }
    .job-header { padding: 16px 20px; cursor: pointer; }
    .job-header:hover { background: rgba(88, 166, 255, 0.04); }
    .job-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .job-id { font-family: monospace; font-size: 14px; color: var(--accent); white-space: nowrap; }
    .job-prompt { color: var(--muted); font-size: 13px; line-height: 1.5;
                  word-wrap: break-word; overflow-wrap: break-word; }
    .job-times { display: flex; gap: 16px; margin-top: 8px; flex-wrap: wrap; }
    .job-time { font-size: 11px; color: var(--muted); }
    .job-time-label { color: #6e7681; text-transform: uppercase; letter-spacing: 0.3px; margin-right: 4px; }
    .job-time-value { font-family: monospace; }

    /* ── Progress bar ── */
    .progress-bar { height: 4px; background: var(--border); border-radius: 2px; margin-top: 10px; overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 2px; transition: width 0.5s ease; }
    .progress-fill-running { background: linear-gradient(90deg, var(--blue), var(--accent));
      background-size: 200% 100%; animation: shimmer 2s linear infinite; }
    .progress-fill-completed { background: var(--green); }
    .progress-fill-failed { background: var(--red); }
    .progress-fill-paused { background: var(--yellow); }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    /* ── Action buttons ── */
    .job-actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
    .btn { font-size: 11px; padding: 3px 10px; border-radius: 6px; border: 1px solid var(--border);
           background: transparent; color: var(--muted); cursor: pointer; font-family: inherit; }
    .btn:hover { border-color: var(--accent); color: var(--text); }
    .btn-danger { color: var(--red); }
    .btn-danger:hover { border-color: var(--red); }
    .btn-primary { color: var(--green); }
    .btn-primary:hover { border-color: var(--green); }
    .btn-warn { color: var(--yellow); }
    .btn-warn:hover { border-color: var(--yellow); }

    /* ── Badges ── */
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px;
             font-weight: 600; text-transform: uppercase; white-space: nowrap; }
    .badge-running { background: rgba(88, 166, 255, 0.15); color: var(--blue); }
    .badge-completed { background: rgba(63, 185, 80, 0.15); color: var(--green); }
    .badge-failed { background: rgba(248, 81, 73, 0.15); color: var(--red); }
    .badge-pending { background: rgba(139, 148, 158, 0.15); color: var(--muted); }
    .badge-queued { background: rgba(210, 153, 34, 0.15); color: var(--yellow); }
    .badge-claimed { background: rgba(210, 153, 34, 0.15); color: var(--yellow); }
    .badge-planning { background: rgba(139, 148, 158, 0.15); color: var(--muted); }
    .badge-stalled { background: rgba(248, 81, 73, 0.10); color: var(--red); }
    .badge-paused { background: rgba(210, 153, 34, 0.15); color: var(--yellow); }
    .badge-stopped { background: rgba(248, 81, 73, 0.15); color: var(--red); }

    /* ── Animations ── */
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .anim-pulse { animation: pulse 2s ease-in-out infinite; }
    .spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid var(--border);
               border-top-color: var(--blue); border-radius: 50%; animation: spin 0.8s linear infinite;
               margin-right: 6px; vertical-align: middle; }
    .dot-pulse { display: inline-flex; gap: 3px; margin-left: 6px; vertical-align: middle; }
    .dot-pulse span { width: 4px; height: 4px; border-radius: 50%; background: var(--blue);
                      animation: pulse 1.4s ease-in-out infinite; }
    .dot-pulse span:nth-child(2) { animation-delay: 0.2s; }
    .dot-pulse span:nth-child(3) { animation-delay: 0.4s; }

    /* ── Task list ── */
    .tasks-section { border-top: 1px solid var(--border); display: none; }
    .tasks-section.open { display: block; }
    .section-tabs { display: flex; border-bottom: 1px solid var(--border); }
    .section-tab { padding: 8px 16px; font-size: 12px; color: var(--muted); cursor: pointer;
                   border-bottom: 2px solid transparent; }
    .section-tab:hover { color: var(--text); }
    .section-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    .task { padding: 12px 20px; border-bottom: 1px solid var(--border); font-size: 13px; }
    .task:last-child { border-bottom: none; }
    .task-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .task-left { flex: 1; min-width: 0; }
    .task-header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
    .task-id { font-family: monospace; font-size: 12px; color: var(--accent); white-space: nowrap; }
    .wave-tag { font-family: monospace; font-size: 11px; color: var(--muted);
                background: rgba(139, 148, 158, 0.1); padding: 1px 6px; border-radius: 4px; white-space: nowrap; }
    .task-prompt { color: var(--text); line-height: 1.5; word-wrap: break-word; overflow-wrap: break-word; }
    .task-deps { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
    .dep-tag { font-family: monospace; font-size: 10px; color: var(--purple);
               background: rgba(188, 140, 255, 0.1); border: 1px solid rgba(188, 140, 255, 0.2);
               padding: 1px 6px; border-radius: 4px; white-space: nowrap; }
    .task-times { display: flex; gap: 12px; margin-top: 6px; flex-wrap: wrap; }
    .task-time { font-size: 10px; color: var(--muted); }
    .task-time-label { color: #6e7681; margin-right: 3px; }
    .task-time-value { font-family: monospace; }
    .task-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
    .task-client { font-size: 11px; color: var(--muted); font-family: monospace; }
    .task-progress { color: var(--yellow); font-size: 12px; font-style: italic; margin-top: 4px; }
    .task-error { color: var(--red); font-size: 12px; margin-top: 4px; font-family: monospace; }
    .task-duration { font-size: 10px; color: var(--muted); font-family: monospace; }

    /* ── Event log ── */
    .event-log { max-height: 400px; overflow-y: auto; }
    .event { padding: 6px 20px; border-bottom: 1px solid rgba(48, 54, 61, 0.5); font-size: 12px;
             display: flex; gap: 12px; align-items: baseline; font-family: monospace; }
    .event:last-child { border-bottom: none; }
    .event-time { color: #6e7681; white-space: nowrap; font-size: 11px; }
    .event-type { font-size: 10px; padding: 1px 6px; border-radius: 4px; white-space: nowrap; }
    .et-task_completed { background: rgba(63, 185, 80, 0.1); color: var(--green); }
    .et-task_failed, .et-task_stalled, .et-job_failed, .et-job_stopped { background: rgba(248, 81, 73, 0.1); color: var(--red); }
    .et-task_queued, .et-task_claimed { background: rgba(210, 153, 34, 0.1); color: var(--yellow); }
    .et-task_running, .et-job_started { background: rgba(88, 166, 255, 0.1); color: var(--blue); }
    .et-job_created, .et-job_completed { background: rgba(63, 185, 80, 0.1); color: var(--green); }
    .et-job_paused, .et-job_resumed { background: rgba(210, 153, 34, 0.1); color: var(--yellow); }
    .et-task_retried, .et-watchdog_check { background: rgba(188, 140, 255, 0.1); color: var(--purple); }
    .et-job_deleted { background: rgba(248, 81, 73, 0.1); color: var(--red); }
    .event-task { color: var(--accent); }
    .event-msg { color: var(--muted); flex: 1; word-break: break-word; }
    .event-actor { color: #6e7681; font-size: 10px; }

    /* ── Result viewer ── */
    .result-viewer { max-height: 600px; overflow-y: auto; padding: 20px; }
    .result-section { margin-bottom: 24px; }
    .result-section-title { font-size: 16px; font-weight: 600; color: var(--accent);
                            margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid var(--accent);
                            display: flex; align-items: center; gap: 8px; }
    .result-section-title::before { content: ''; display: inline-block; width: 4px; height: 18px;
                                     background: var(--accent); border-radius: 2px; }
    .result-section-body { font-size: 13px; line-height: 1.7; color: var(--text); }
    .result-empty { padding: 40px; text-align: center; color: var(--muted); }
    .result-actions { display: flex; gap: 8px; justify-content: flex-end; margin-bottom: 16px; }
    .result-copy { font-size: 11px; padding: 3px 10px; border-radius: 6px; border: 1px solid var(--border);
                   background: transparent; color: var(--accent); cursor: pointer; font-family: inherit; }
    .result-copy:hover { border-color: var(--accent); background: rgba(88, 166, 255, 0.08); }

    /* ── Markdown rendered content ── */
    .md-content h1 { font-size: 20px; font-weight: 700; margin: 20px 0 12px; color: var(--text);
                     padding-bottom: 6px; border-bottom: 1px solid var(--border); }
    .md-content h2 { font-size: 17px; font-weight: 600; margin: 18px 0 10px; color: var(--text); }
    .md-content h3 { font-size: 15px; font-weight: 600; margin: 14px 0 8px; color: var(--text); }
    .md-content h4 { font-size: 13px; font-weight: 600; margin: 12px 0 6px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.3px; }
    .md-content p { margin: 8px 0; line-height: 1.7; }
    .md-content ul, .md-content ol { margin: 8px 0 8px 20px; }
    .md-content li { margin: 4px 0; line-height: 1.6; }
    .md-content li::marker { color: var(--muted); }
    .md-content strong { color: var(--text); font-weight: 600; }
    .md-content em { color: var(--muted); }
    .md-content code { font-family: 'SF Mono', SFMono-Regular, Consolas, monospace; font-size: 12px;
                       background: rgba(110, 118, 129, 0.15); padding: 2px 6px; border-radius: 4px; color: var(--orange); }
    .md-content pre { background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
                      padding: 14px; margin: 12px 0; overflow-x: auto; }
    .md-content pre code { background: none; padding: 0; color: var(--text); font-size: 12px; }
    .md-content blockquote { border-left: 3px solid var(--accent); padding: 4px 16px; margin: 12px 0;
                             color: var(--muted); background: rgba(88, 166, 255, 0.04); border-radius: 0 6px 6px 0; }
    .md-content table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12px; }
    .md-content th { text-align: left; padding: 8px 12px; border-bottom: 2px solid var(--border);
                     color: var(--muted); font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.3px; }
    .md-content td { padding: 8px 12px; border-bottom: 1px solid var(--border); }
    .md-content tr:hover td { background: rgba(88, 166, 255, 0.03); }
    .md-content a { color: var(--accent); text-decoration: none; }
    .md-content a:hover { text-decoration: underline; }
    .md-content hr { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
    .md-content img { max-width: 100%; border-radius: 8px; }

    /* ── Model tag ── */
    .model-tag { font-family: monospace; font-size: 10px; color: var(--orange);
                 background: rgba(240, 136, 62, 0.1); border: 1px solid rgba(240, 136, 62, 0.2);
                 padding: 1px 6px; border-radius: 4px; white-space: nowrap; }

    /* ── Modal ── */
    .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                     background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center;
                     z-index: 1000; }
    .modal-overlay.hidden { display: none; }
    .modal { background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
             width: 90%; max-width: 800px; max-height: 90vh; overflow-y: auto; }
    .modal-header { padding: 20px 24px 12px; display: flex; justify-content: space-between; align-items: center; }
    .modal-header h2 { font-size: 18px; }
    .modal-close { background: none; border: none; color: var(--muted); font-size: 20px; cursor: pointer; padding: 4px 8px; }
    .modal-close:hover { color: var(--text); }
    .modal-body { padding: 0 24px 24px; }
    .modal-body label { display: block; font-size: 12px; color: var(--muted); text-transform: uppercase;
                        letter-spacing: 0.5px; margin-bottom: 6px; margin-top: 16px; }
    .modal-body textarea { width: 100%; min-height: 120px; background: var(--bg); border: 1px solid var(--border);
                           border-radius: 8px; color: var(--text); padding: 12px; font-size: 14px;
                           font-family: inherit; resize: vertical; line-height: 1.5; }
    .modal-body textarea:focus { outline: none; border-color: var(--accent); }
    .modal-body select { background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
                         color: var(--text); padding: 8px 12px; font-size: 13px; font-family: inherit; width: 100%; }
    .modal-body select:focus { outline: none; border-color: var(--accent); }
    .modal-footer { padding: 16px 24px; border-top: 1px solid var(--border);
                    display: flex; justify-content: flex-end; gap: 8px; }
    .btn-lg { font-size: 13px; padding: 8px 20px; border-radius: 8px; border: 1px solid var(--border);
              background: transparent; color: var(--text); cursor: pointer; font-family: inherit; }
    .btn-lg:hover { border-color: var(--accent); }
    .btn-lg-primary { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 600; }
    .btn-lg-primary:hover { background: #79b8ff; }
    .btn-lg-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-lg-green { background: var(--green); color: #000; border-color: var(--green); font-weight: 600; }
    .btn-lg-green:hover { background: #56d364; }

    /* ── Plan preview ── */
    .plan-preview { margin-top: 16px; }
    .plan-task { background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
                 padding: 12px; margin-bottom: 8px; }
    .plan-task-header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
    .plan-task-id { font-family: monospace; font-size: 12px; color: var(--accent); }
    .plan-task-prompt { font-size: 13px; color: var(--text); line-height: 1.5; }
    .plan-task-deps { margin-top: 4px; }
    .plan-info { font-size: 12px; color: var(--muted); margin-top: 12px; }
    .plan-loading { text-align: center; padding: 24px; color: var(--muted); }

    /* ── Misc ── */
    .refresh { color: var(--accent); cursor: pointer; font-size: 13px; text-decoration: none; }
    .refresh:hover { text-decoration: underline; }
    .header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .empty { color: var(--muted); text-align: center; padding: 48px; }
    #auto-refresh { color: var(--muted); font-size: 12px; }
    .watchdog-btn { margin-left: 12px; }
  </style>
</head>
<body>
  <div class="header-row">
    <div>
      <h1>OpenCode Cloud Orchestrator</h1>
      <div class="subtitle">Job orchestration dashboard</div>
    </div>
    <div style="display:flex; align-items:center; gap:12px">
      <span id="auto-refresh">Auto-refresh: 5s</span>
      <a class="refresh" onclick="loadBoard()">Refresh now</a>
      <button class="btn" onclick="runWatchdog()">Run Watchdog</button>
      <button class="btn-lg btn-lg-primary" onclick="openNewJobModal()">+ New Job</button>
    </div>
  </div>

  <div class="stats" id="stats"></div>
  <div id="jobs"></div>

  <!-- New Job Modal -->
  <div class="modal-overlay hidden" id="newJobModal" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <div class="modal-header">
        <h2 id="modalTitle">New Job</h2>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <label>Prompt</label>
        <textarea id="jobPrompt" placeholder="Describe the job you want to execute. It will be automatically decomposed into tasks with dependencies."></textarea>

        <label>Model for task execution</label>
        <select id="jobModel">
          <option value="anthropic/claude-opus-4-6">Claude Opus 4 (most capable)</option>
          <option value="anthropic/claude-sonnet-4-20250514">Claude Sonnet 4 (faster, cheaper)</option>
          <option value="anthropic/claude-haiku-4-20250414">Claude Haiku 4 (fastest, cheapest)</option>
        </select>

        <div id="planPreview"></div>
      </div>
      <div class="modal-footer" id="modalFooter">
        <button class="btn-lg" onclick="closeModal()">Cancel</button>
        <button class="btn-lg btn-lg-primary" id="planBtn" onclick="planNewJob()">Plan Tasks</button>
      </div>
    </div>
  </div>

  <script>
    let boardData = { jobs: [] };
    const openJobs = new Set();
    const activeTab = {};  // jobId -> 'tasks' | 'events'

    async function loadBoard() {
      try {
        const res = await fetch('/api/board');
        boardData = await res.json();
        render();
      } catch (e) {
        console.error('Failed to load board:', e);
      }
    }

    // Cache for event logs and results per job
    const eventCache = {};
    const resultCache = {};

    async function loadEvents(jobId) {
      try {
        const res = await fetch('/api/job/' + jobId + '/events');
        const data = await res.json();
        eventCache[jobId] = data.events || [];
        renderEvents(jobId);
      } catch (e) {
        console.error('Failed to load events:', e);
      }
    }

    async function loadResult(jobId) {
      try {
        const res = await fetch('/api/job/' + jobId);
        const data = await res.json();
        resultCache[jobId] = data.result || null;
        renderResult(jobId);
      } catch (e) {
        console.error('Failed to load result:', e);
      }
    }

    function renderResult(jobId) {
      const el = document.getElementById('result-' + jobId);
      if (!el) return;
      const result = resultCache[jobId];
      if (!result) {
        el.innerHTML = '<div class="result-empty">No result yet — job must complete first.</div>';
        return;
      }

      // Check if this is a synthesized result (clean document) or raw task concatenation
      const isRawConcat = result.includes('\\n---\\n') && /^## [a-z_-]+$/m.test(result);

      let html = '<div class="result-viewer">';
      html += '<div class="result-actions">';
      html += '<button class="result-copy" onclick="copyResult(\\'' + jobId + '\\', event)">Copy Markdown</button>';
      html += '</div>';

      if (isRawConcat) {
        // Legacy format: split by --- separators, render each section
        const sections = result.split(/^---$/m).filter(s => s.trim());
        for (const section of sections) {
          const match = section.match(/^\\s*##\\s+([^\\n]+)\\n([\\s\\S]*)$/);
          if (match) {
            html += '<div class="result-section">';
            html += '<div class="result-section-title">' + esc(match[1].trim()) + '</div>';
            html += '<div class="result-section-body md-content">' + renderMarkdown(match[2].trim()) + '</div>';
            html += '</div>';
          } else {
            html += '<div class="result-section">';
            html += '<div class="result-section-body md-content">' + renderMarkdown(section.trim()) + '</div>';
            html += '</div>';
          }
        }
      } else {
        // Synthesized result: render as a single clean markdown document
        html += '<div class="result-section">';
        html += '<div class="result-section-body md-content">' + renderMarkdown(result) + '</div>';
        html += '</div>';
      }

      html += '</div>';
      el.innerHTML = html;
    }

    function renderMarkdown(md) {
      if (typeof marked !== 'undefined' && marked.parse) {
        try {
          return marked.parse(md, { breaks: true, gfm: true });
        } catch (e) {
          console.warn('Markdown parse failed, falling back to plain text:', e);
        }
      }
      // Fallback: escape and preserve whitespace
      return '<pre>' + esc(md) + '</pre>';
    }

    async function copyResult(jobId, e) {
      if (e) e.stopPropagation();
      const result = resultCache[jobId];
      if (!result) return;
      try {
        await navigator.clipboard.writeText(result);
        const btn = e.target;
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy All', 2000);
      } catch {
        alert('Copy failed — use the browser copy shortcut instead');
      }
    }

    function renderEvents(jobId) {
      const el = document.getElementById('events-' + jobId);
      if (!el) return;
      const events = eventCache[jobId] || [];
      if (events.length === 0) {
        el.innerHTML = '<div style="padding:20px;color:var(--muted);text-align:center">No events yet</div>';
        return;
      }
      el.innerHTML = events.map(e => {
        const time = fmtTime(e.created_at) || '';
        const taskStr = e.task_id ? '<span class="event-task">' + esc(e.task_id) + '</span>' : '';
        return '<div class="event">'
          + '<span class="event-time">' + time + '</span>'
          + '<span class="event-type et-' + e.event_type + '">' + e.event_type + '</span>'
          + taskStr
          + '<span class="event-msg">' + esc(e.message || '') + '</span>'
          + (e.actor && e.actor !== 'system' ? '<span class="event-actor">' + esc(e.actor) + '</span>' : '')
          + '</div>';
      }).join('');
    }

    async function jobAction(jobId, action, e) {
      if (e) e.stopPropagation();
      if (action === 'delete' && !confirm('Delete this job and all its data?')) return;
      if (action === 'restart' && !confirm('Restart this job? All results will be cleared and tasks will re-run from the beginning.')) return;
      if (action === 'restart' || action === 'delete') delete resultCache[jobId];
      try {
        const res = await fetch('/api/job/' + jobId + '/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
        });
        const data = await res.json();
        if (!data.ok && data.error) alert(data.error);
        loadBoard();
      } catch (err) {
        alert('Action failed: ' + err.message);
      }
    }

    async function runWatchdog() {
      try {
        const res = await fetch('/api/watchdog', { method: 'POST' });
        const data = await res.json();
        alert('Watchdog: checked ' + data.checked + ' tasks, ' + data.results.length + ' actions taken');
        loadBoard();
      } catch (err) {
        alert('Watchdog failed: ' + err.message);
      }
    }

    function fmtTime(epoch) {
      if (!epoch) return null;
      const d = new Date(epoch * 1000);
      const pad = n => String(n).padStart(2, '0');
      return pad(d.getMonth()+1) + '-' + pad(d.getDate())
        + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }

    function duration(start, end) {
      if (!start) return '';
      const e = end || Math.floor(Date.now() / 1000);
      const s = e - start;
      if (s < 60) return s + 's';
      if (s < 3600) return Math.floor(s/60) + 'm ' + (s%60) + 's';
      return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm';
    }

    function timeTag(label, epoch) {
      if (!epoch) return '';
      return '<span class="job-time"><span class="job-time-label">' + label + ':</span><span class="job-time-value">' + fmtTime(epoch) + '</span></span>';
    }

    function taskTimeTag(label, epoch) {
      if (!epoch) return '';
      return '<span class="task-time"><span class="task-time-label">' + label + ':</span><span class="task-time-value">' + fmtTime(epoch) + '</span></span>';
    }

    function render() {
      const { jobs } = boardData;

      // Stats
      let totalJobs = jobs.length;
      let totalTasks = 0, completed = 0, running = 0, failed = 0, pending = 0;
      for (const j of jobs) {
        for (const t of (j.tasks || [])) {
          totalTasks++;
          if (t.status === 'completed') completed++;
          else if (['running','claimed','queued'].includes(t.status)) running++;
          else if (['failed','stalled'].includes(t.status)) failed++;
          else pending++;
        }
      }

      document.getElementById('stats').innerHTML = [
        stat('Jobs', totalJobs),
        stat('Tasks', totalTasks),
        stat('Active', running, 'var(--blue)'),
        stat('Completed', completed, 'var(--green)'),
        stat('Failed', failed, 'var(--red)'),
        stat('Pending', pending),
      ].join('');

      if (jobs.length === 0) {
        document.getElementById('jobs').innerHTML = '<div class="empty">No jobs yet. Submit a job from OpenCode using OCO.</div>';
        return;
      }

      // Save scroll positions of open result/event viewers before DOM rebuild
      const savedScrolls = {};
      for (const jobId of openJobs) {
        const resultViewer = document.querySelector('#result-' + jobId + ' .result-viewer');
        if (resultViewer) savedScrolls['result-' + jobId] = resultViewer.scrollTop;
        const eventViewer = document.getElementById('events-' + jobId);
        if (eventViewer) savedScrolls['events-' + jobId] = eventViewer.scrollTop;
      }

      document.getElementById('jobs').innerHTML = jobs.map((j, i) => {
        const tasks = (j.tasks || []).map(t => {
          let deps = t.dependencies;
          if (typeof deps === 'string') { try { deps = JSON.parse(deps); } catch { deps = []; } }
          return { ...t, dependencies: deps || [] };
        });

        const cTotal = tasks.length;
        const cDone = tasks.filter(t => t.status === 'completed').length;
        const cFailed = tasks.filter(t => ['failed','stalled'].includes(t.status)).length;
        const pct = cTotal > 0 ? Math.round((cDone / cTotal) * 100) : 0;

        // Progress bar class
        let barClass = 'progress-fill-running';
        if (j.status === 'completed') barClass = 'progress-fill-completed';
        else if (j.status === 'failed' || j.status === 'stopped') barClass = 'progress-fill-failed';
        else if (j.status === 'paused') barClass = 'progress-fill-paused';

        // Running animation for job badge
        const isActive = j.status === 'running';
        const jobBadgeExtra = isActive ? '<span class="dot-pulse"><span></span><span></span><span></span></span>' : '';

        // Duration
        const jobDur = duration(j.started_at, j.completed_at);

        // Action buttons based on status
        let actions = '';
        if (j.status === 'running') {
          actions = '<button class="btn btn-warn" onclick="jobAction(\\'' + j.id + '\\',\\'pause\\',event)">Pause</button>'
            + '<button class="btn btn-danger" onclick="jobAction(\\'' + j.id + '\\',\\'stop\\',event)">Stop</button>';
        } else if (j.status === 'paused') {
          actions = '<button class="btn btn-primary" onclick="jobAction(\\'' + j.id + '\\',\\'resume\\',event)">Resume</button>'
            + '<button class="btn btn-danger" onclick="jobAction(\\'' + j.id + '\\',\\'stop\\',event)">Stop</button>';
        }
        if (['completed','failed','stopped'].includes(j.status)) {
          actions += '<button class="btn btn-primary" onclick="jobAction(\\'' + j.id + '\\',\\'restart\\',event)">Restart</button>';
        }
        // Show Retry Failed if there are any failed/stalled tasks, regardless of job status
        if (cFailed > 0) {
          actions += '<button class="btn" onclick="jobAction(\\'' + j.id + '\\',\\'retry_stalled\\',event)">Retry Failed (' + cFailed + ')</button>';
        }
        actions += '<button class="btn btn-danger" onclick="jobAction(\\'' + j.id + '\\',\\'delete\\',event)">Delete</button>';

        const curTab = activeTab[j.id] || 'tasks';

        const taskHtml = tasks.map(t => {
          let deps = t.dependencies;
          const depsHtml = deps.length > 0
            ? '<div class="task-deps">' + deps.map(d => '<span class="dep-tag">' + esc(d) + '</span>').join('') + '</div>'
            : '';

          const timesHtml = [
            taskTimeTag('claimed', t.claimed_at),
            taskTimeTag('started', t.started_at),
            taskTimeTag('completed', t.completed_at),
          ].filter(Boolean).join('');
          const taskTimesRow = timesHtml ? '<div class="task-times">' + timesHtml + '</div>' : '';

          // Duration for running/completed tasks
          const tDur = (t.status === 'running' || t.status === 'completed')
            ? '<span class="task-duration">' + duration(t.started_at || t.claimed_at, t.completed_at) + '</span>' : '';

          // Status-specific decorations
          let statusDecor = '';
          if (t.status === 'running' || t.status === 'claimed') {
            statusDecor = '<span class="spinner"></span>';
          }

          const taskAnimClass = (t.status === 'running' || t.status === 'claimed') ? ' anim-pulse' : '';

          return '<div class="task' + taskAnimClass + '">'
            + '<div class="task-row">'
            + '<div class="task-left">'
            + '<div class="task-header">'
            + '<span class="wave-tag">W' + t.wave + '</span>'
            + '<span class="task-id">' + esc(t.id) + '</span>'
            + (t.model ? '<span class="model-tag">' + esc(t.model) + '</span>' : '')
            + tDur
            + '</div>'
            + '<div class="task-prompt">' + esc(t.prompt) + '</div>'
            + depsHtml
            + (t.progress ? '<div class="task-progress">' + esc(t.progress) + '</div>' : '')
            + (t.error ? '<div class="task-error">' + esc(t.error) + '</div>' : '')
            + taskTimesRow
            + '</div>'
            + '<div class="task-meta">'
            + (t.claimed_by ? '<span class="task-client">' + esc(t.claimed_by) + '</span>' : '')
            + statusDecor
            + '<span class="badge badge-' + t.status + '">' + t.status + '</span>'
            + '</div>'
            + '</div></div>';
        }).join('');

        return '<div class="job">'
          + '<div class="job-header" onclick="toggle(\\'' + j.id + '\\')">'
          + '<div class="job-top"><div style="flex:1;min-width:0">'
          + '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px;flex-wrap:wrap">'
          + '<span class="job-id">' + j.id + '</span>'
          + '<span class="badge badge-' + j.status + '">' + j.status + '</span>' + jobBadgeExtra
          + '<span style="font-size:12px;color:var(--muted)">' + cDone + '/' + cTotal + ' tasks'
          + (cFailed > 0 ? ' <span style="color:var(--red)">' + cFailed + ' failed</span>' : '')
          + '</span>'
          + (j.model ? '<span class="model-tag">' + esc(j.model) + '</span>' : '')
          + (jobDur ? '<span style="font-size:11px;color:var(--muted);font-family:monospace">' + jobDur + '</span>' : '')
          + '</div>'
          + '<div class="job-prompt">' + esc(j.original_prompt || '') + '</div>'
          + '<div class="progress-bar"><div class="progress-fill ' + barClass + '" style="width:' + pct + '%"></div></div>'
          + '<div class="job-times">'
          + timeTag('Created', j.created_at)
          + timeTag('Started', j.started_at)
          + timeTag('Completed', j.completed_at)
          + '</div>'
          + '<div class="job-actions">' + actions + '</div>'
          + '</div></div></div>'
          + '<div class="tasks-section' + (openJobs.has(j.id) ? ' open' : '') + '" id="tasks-' + j.id + '">'
          + '<div class="section-tabs">'
          + '<div class="section-tab' + (curTab==='tasks'?' active':'') + '" onclick="switchTab(\\'' + j.id + '\\',\\'tasks\\',event)">Tasks (' + cTotal + ')</div>'
          + '<div class="section-tab' + (curTab==='events'?' active':'') + '" onclick="switchTab(\\'' + j.id + '\\',\\'events\\',event)">Event Log</div>'
          + '<div class="section-tab' + (curTab==='result'?' active':'') + '" onclick="switchTab(\\'' + j.id + '\\',\\'result\\',event)">Result</div>'
          + '</div>'
          + '<div class="tab-content' + (curTab==='tasks'?' active':'') + '" id="tasks-content-' + j.id + '">' + taskHtml + '</div>'
          + '<div class="tab-content event-log' + (curTab==='events'?' active':'') + '" id="events-' + j.id + '"><div style="padding:20px;color:var(--muted);text-align:center">Loading events...</div></div>'
          + '<div class="tab-content' + (curTab==='result'?' active':'') + '" id="result-' + j.id + '"><div class="result-empty">Loading...</div></div>'
          + '</div></div>';
      }).join('');

      // Load data for any open job's active tab
      for (const jobId of openJobs) {
        if (activeTab[jobId] === 'events') loadEvents(jobId);
        // Only load result if not already cached
        if (activeTab[jobId] === 'result' && !(jobId in resultCache)) loadResult(jobId);
      }
      // Re-inject cached results/events into rebuilt DOM (render replaced innerHTML)
      for (const jobId of openJobs) {
        if (activeTab[jobId] === 'result' && jobId in resultCache) renderResult(jobId);
        if (activeTab[jobId] === 'events' && jobId in eventCache) renderEvents(jobId);
      }
      // Restore scroll positions
      requestAnimationFrame(() => {
        for (const [key, scrollTop] of Object.entries(savedScrolls)) {
          if (key.startsWith('result-')) {
            const jobId = key.slice(7);
            const el = document.querySelector('#result-' + jobId + ' .result-viewer');
            if (el) el.scrollTop = scrollTop;
          } else if (key.startsWith('events-')) {
            const jobId = key.slice(7);
            const el = document.getElementById('events-' + jobId);
            if (el) el.scrollTop = scrollTop;
          }
        }
      });
    }

    function toggle(jobId) {
      if (openJobs.has(jobId)) {
        openJobs.delete(jobId);
      } else {
        openJobs.add(jobId);
        if (!activeTab[jobId]) activeTab[jobId] = 'tasks';
        if (activeTab[jobId] === 'events') loadEvents(jobId);
        if (activeTab[jobId] === 'result') loadResult(jobId);
      }
      document.getElementById('tasks-' + jobId)?.classList.toggle('open');
    }

    function switchTab(jobId, tab, e) {
      if (e) e.stopPropagation();
      activeTab[jobId] = tab;
      // Toggle visibility for all 3 tabs
      const tasksEl = document.getElementById('tasks-content-' + jobId);
      const eventsEl = document.getElementById('events-' + jobId);
      const resultEl = document.getElementById('result-' + jobId);
      const tabEls = document.getElementById('tasks-' + jobId)?.querySelectorAll('.section-tab');
      if (tasksEl) tasksEl.classList.toggle('active', tab === 'tasks');
      if (eventsEl) eventsEl.classList.toggle('active', tab === 'events');
      if (resultEl) resultEl.classList.toggle('active', tab === 'result');
      if (tabEls) tabEls.forEach((el, i) => {
        el.classList.toggle('active', (i === 0 && tab === 'tasks') || (i === 1 && tab === 'events') || (i === 2 && tab === 'result'));
      });
      if (tab === 'events') loadEvents(jobId);
      if (tab === 'result') loadResult(jobId);
    }

    function stat(label, value, color) {
      return '<div class="stat"><div class="stat-value" ' + (color ? 'style="color:'+color+'"' : '') + '>' + value + '</div><div class="stat-label">' + label + '</div></div>';
    }

    function esc(s) {
      if (!s) return '';
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    // ── New Job Modal ──

    let currentPlan = null;

    function openNewJobModal() {
      document.getElementById('newJobModal').classList.remove('hidden');
      document.getElementById('jobPrompt').value = '';
      document.getElementById('planPreview').innerHTML = '';
      document.getElementById('modalTitle').textContent = 'New Job';
      document.getElementById('modalFooter').innerHTML =
        '<button class="btn-lg" onclick="closeModal()">Cancel</button>'
        + '<button class="btn-lg btn-lg-primary" id="planBtn" onclick="planNewJob()">Plan Tasks</button>';
      currentPlan = null;
      setTimeout(() => document.getElementById('jobPrompt').focus(), 100);
    }

    function closeModal() {
      document.getElementById('newJobModal').classList.add('hidden');
      currentPlan = null;
    }

    let planPollTimer = null;

    async function planNewJob() {
      const promptEl = document.getElementById('jobPrompt');
      const modelEl = document.getElementById('jobModel');
      const preview = document.getElementById('planPreview');

      if (!promptEl || !modelEl || !preview) {
        alert('Modal elements not found — try reopening the New Job dialog');
        return;
      }

      const prompt = promptEl.value.trim();
      if (!prompt) { alert('Enter a prompt first'); return; }

      const model = modelEl.value;

      // Stop any existing plan polling
      if (planPollTimer) { clearInterval(planPollTimer); planPollTimer = null; }

      // Disable footer during planning
      document.getElementById('modalFooter').innerHTML =
        '<button class="btn-lg" onclick="cancelPlan()">Cancel</button>'
        + '<button class="btn-lg btn-lg-primary" disabled><span class="spinner"></span> Planning...</button>';

      preview.innerHTML = '<div class="plan-loading"><span class="spinner"></span> Plan task queued — waiting for runner to execute with full local context...</div>';

      try {
        // Submit plan request — this creates a plan task for the runner
        const res = await fetch('/api/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, model })
        });
        const data = await res.json();

        if (data.error) {
          preview.innerHTML = '<div style="color:var(--red);padding:12px">' + esc(data.error) + '</div>';
          document.getElementById('modalFooter').innerHTML =
            '<button class="btn-lg" onclick="closeModal()">Cancel</button>'
            + '<button class="btn-lg btn-lg-primary" onclick="planNewJob()">Retry Plan</button>';
          return;
        }

        // Poll for plan completion
        const planId = data.planId;
        preview.innerHTML = '<div class="plan-loading"><span class="spinner"></span> Runner is decomposing your prompt with full project context...<br><span style="font-size:11px;color:var(--muted)">Plan ID: ' + planId + '</span></div>';

        planPollTimer = setInterval(async () => {
          try {
            const pollRes = await fetch('/api/plan/' + planId);
            const pollData = await pollRes.json();

            if (pollData.status === 'completed' && pollData.tasks) {
              // Plan is ready
              clearInterval(planPollTimer);
              planPollTimer = null;
              showPlanResult(pollData);
            } else if (pollData.status === 'completed' && pollData.error) {
              // Plan completed but parsing failed
              clearInterval(planPollTimer);
              planPollTimer = null;
              preview.innerHTML = '<div style="color:var(--red);padding:12px">Plan parsing failed: ' + esc(pollData.error) + '</div>'
                + (pollData.raw ? '<pre style="font-size:11px;color:var(--muted);max-height:200px;overflow:auto;margin-top:8px">' + esc(pollData.raw) + '</pre>' : '');
              document.getElementById('modalFooter').innerHTML =
                '<button class="btn-lg" onclick="closeModal()">Cancel</button>'
                + '<button class="btn-lg btn-lg-primary" onclick="planNewJob()">Retry Plan</button>';
            } else if (pollData.status === 'failed') {
              clearInterval(planPollTimer);
              planPollTimer = null;
              preview.innerHTML = '<div style="color:var(--red);padding:12px">Plan task failed. Check if the runner is running.</div>';
              document.getElementById('modalFooter').innerHTML =
                '<button class="btn-lg" onclick="closeModal()">Cancel</button>'
                + '<button class="btn-lg btn-lg-primary" onclick="planNewJob()">Retry Plan</button>';
            } else {
              // Still running — update progress
              const prog = pollData.progress ? '<br><span style="color:var(--yellow);font-style:italic">' + esc(pollData.progress) + '</span>' : '';
              preview.innerHTML = '<div class="plan-loading"><span class="spinner"></span> Runner is decomposing your prompt with full project context...' + prog + '<br><span style="font-size:11px;color:var(--muted)">Status: ' + pollData.status + '</span></div>';
            }
          } catch (e) {
            // Network error during poll — keep trying
          }
        }, 3000);

      } catch (err) {
        preview.innerHTML = '<div style="color:var(--red);padding:12px">Failed to submit plan: ' + esc(err.message) + '</div>';
        document.getElementById('modalFooter').innerHTML =
          '<button class="btn-lg" onclick="closeModal()">Cancel</button>'
          + '<button class="btn-lg btn-lg-primary" onclick="planNewJob()">Retry Plan</button>';
      }
    }

    function cancelPlan() {
      if (planPollTimer) { clearInterval(planPollTimer); planPollTimer = null; }
      closeModal();
    }

    function showPlanResult(data) {
      const preview = document.getElementById('planPreview');
      currentPlan = data;

      let html = '<div class="plan-preview">';
      html += '<div class="plan-info">' + data.tasks.length + ' tasks planned &bull; '
        + 'Rollup: ' + esc(data.rollup?.strategy || 'summary') + '</div>';

      for (const t of data.tasks) {
        const deps = (t.dependencies || []);
        const depsHtml = deps.length > 0
          ? '<div class="plan-task-deps">' + deps.map(d => '<span class="dep-tag">' + esc(d) + '</span>').join('') + '</div>'
          : '';
        html += '<div class="plan-task">'
          + '<div class="plan-task-header"><span class="plan-task-id">' + esc(t.id) + '</span></div>'
          + '<div class="plan-task-prompt">' + esc(t.prompt) + '</div>'
          + depsHtml
          + '</div>';
      }
      html += '</div>';
      preview.innerHTML = html;

      document.getElementById('modalFooter').innerHTML =
        '<button class="btn-lg" onclick="closeModal()">Cancel</button>'
        + '<button class="btn-lg" onclick="planNewJob()">Re-plan</button>'
        + '<button class="btn-lg btn-lg-green" onclick="submitPlannedJob()">Start Job</button>';
    }

    async function submitPlannedJob() {
      if (!currentPlan) return;

      const model = document.getElementById('jobModel').value;

      try {
        const res = await fetch('/api/job', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: currentPlan.prompt,
            model: model,
            tasks: currentPlan.tasks,
            rollup: currentPlan.rollup,
          })
        });
        const data = await res.json();

        if (data.error) {
          alert('Submit failed: ' + data.error);
          return;
        }

        closeModal();
        loadBoard();
      } catch (err) {
        alert('Submit failed: ' + err.message);
      }
    }

    loadBoard();
    setInterval(loadBoard, 5000);
  </script>
</body>
</html>`;
}
