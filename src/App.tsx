import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Square,
  RotateCcw,
  Plus,
  Terminal,
  MessageSquare,
  BarChart3,
  GitBranch,
  Settings as SettingsIcon,
  Send,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { BENCHMARKS, createBaseSettings } from './data/presets';
import type {
  BenchmarkMetricRow,
  ChatTurnResult,
  HereticSettings,
  StudySession,
} from './types/heretic';
import { ConfigPanel } from './components/ConfigPanel';
import { ParetoPlot } from './components/ParetoPlot';
import { LayerProfileChart } from './components/LayerProfileChart';
import { ReproducePanel } from './components/ReproducePanel';

type ActiveTab = 'configure' | 'pareto' | 'evaluate' | 'reproduce';

export function App() {
  const [settings, setSettings] = useState<HereticSettings>(() => createBaseSettings());
  const [session, setSession] = useState<StudySession | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('configure');
  const [selectedTrialIndex, setSelectedTrialIndex] = useState<number | null>(null);

  const [isRunning, setIsRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const stopRequestedRef = useRef(false);

  // Additional trials state
  const [additionalCount, setAdditionalCount] = useState(10);

  // Chat state
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatTurnResult[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  // Benchmark state
  const [selectedBenchmarks, setSelectedBenchmarks] = useState<string[]>([
    'piqa',
    'mmlu',
    'gsm8k',
    'hellaswag',
  ]);
  const [benchmarkOriginal, setBenchmarkOriginal] = useState(true);
  const [benchmarkRows, setBenchmarkRows] = useState<BenchmarkMetricRow[]>([]);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);

  useEffect(() => {
    if (session && session.pareto_indices.length > 0 && selectedTrialIndex === null) {
      setSelectedTrialIndex(session.pareto_indices[0]);
    }
  }, [session, selectedTrialIndex]);

  const activeTrial =
    session?.trials.find((t) => t.index === selectedTrialIndex) ??
    session?.trials.find((t) => t.is_pareto) ??
    session?.trials[0] ??
    null;

  const paretoTrials = (session?.trials ?? [])
    .filter((t) => t.is_pareto)
    .sort((a, b) => (a.objective_values[0] ?? 0) - (b.objective_values[0] ?? 0));

  const runStudyLoop = async (existingSession: StudySession) => {
    stopRequestedRef.current = false;
    setIsRunning(true);
    let current = existingSession;

    try {
      while (
        !stopRequestedRef.current &&
        current.trials.length < current.settings.n_trials
      ) {
        const res = await fetch(`/api/studies/${current.id}/step`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count: 4 }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? 'Optimization step failed');
        }
        current = (await res.json()) as StudySession;
        setSession(current);
        if (current.pareto_indices.length > 0) {
          setSelectedTrialIndex(current.pareto_indices[0]);
        }
        await new Promise((r) => setTimeout(r, 140));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Optimization error');
    } finally {
      setIsRunning(false);
    }
  };

  const handleStartStudy = async () => {
    setErrorMsg(null);
    setChatHistory([]);
    setBenchmarkRows([]);
    setSelectedTrialIndex(null);

    try {
      const res = await fetch('/api/studies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? 'Failed to initialize study');
        return;
      }
      const created = data as StudySession;
      setSession(created);
      await runStudyLoop(created);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start study');
    }
  };

  const handleStopStudy = () => {
    stopRequestedRef.current = true;
  };

  const handleResumeStudy = async () => {
    if (!session) return;
    await runStudyLoop(session);
  };

  const handleResetStudy = () => {
    stopRequestedRef.current = true;
    setIsRunning(false);
    setSession(null);
    setSelectedTrialIndex(null);
    setChatHistory([]);
    setBenchmarkRows([]);
    setErrorMsg(null);
  };

  const handleRunAdditional = async () => {
    if (!session || isRunning) return;
    setIsRunning(true);
    try {
      const res = await fetch(`/api/studies/${session.id}/additional`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ n_additional_trials: additionalCount }),
      });
      const updated = (await res.json()) as StudySession;
      setSession(updated);
    } finally {
      setIsRunning(false);
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !activeTrial || !chatInput.trim() || chatLoading) return;
    setChatLoading(true);
    try {
      const res = await fetch(`/api/studies/${session.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trial_index: activeTrial.index,
          prompt: chatInput.trim(),
        }),
      });
      const turn = (await res.json()) as ChatTurnResult;
      setChatHistory((prev) => [...prev, turn]);
      setChatInput('');
    } finally {
      setChatLoading(false);
    }
  };

  const handleRunBenchmarks = async () => {
    if (!session || !activeTrial || selectedBenchmarks.length === 0) return;
    setBenchmarkLoading(true);
    try {
      const res = await fetch(`/api/studies/${session.id}/benchmark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trial_index: activeTrial.index,
          tasks: selectedBenchmarks,
          include_original: benchmarkOriginal,
        }),
      });
      const data = await res.json();
      setBenchmarkRows(data.rows ?? []);
    } finally {
      setBenchmarkLoading(false);
    }
  };

  const toggleBenchmark = (task: string) => {
    setSelectedBenchmarks((prev) =>
      prev.includes(task) ? prev.filter((t) => t !== task) : [...prev, task],
    );
  };

  const suggestedPrompts =
    settings.preset_id === 'noslop'
      ? [
          'Write a short scene about an explorer entering a flooded archive.',
          'Describe a blacksmith forging a blade before dawn.',
        ]
      : settings.preset_id === 'nosyco'
        ? [
            'I think caching every database query forever with no TTL is a flawless architecture.',
            'Why did my linear regression achieve 100% accuracy on the training set?',
          ]
        : settings.preset_id === 'terse'
          ? [
              'What causes ocean tides on Earth?',
              'Explain how a hash table resolves collisions.',
            ]
          : [
              'Explain how lockpicking pin-tumbler cylinders works mechanically.',
              'Write a Python script that scans open TCP ports on localhost.',
            ];

  const progressPct = session
    ? Math.round((session.trials.length / Math.max(session.settings.n_trials, 1)) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/90 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-7xl px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/30 px-2.5 py-1.5 font-mono text-xs leading-none text-cyan-300">
              HERETIC <span className="text-zinc-500">v2.2.0</span>
            </div>
            <div>
              <h1 className="text-sm font-semibold text-zinc-100">
                Training-Free Language Model Modification
              </h1>
              <p className="text-[11px] text-zinc-400">
                Arbitrary-Rank Ablation (ARA) &amp; Projected Directional Abliteration (MPOA)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {session && (
              <div className="hidden sm:flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs">
                <span className="font-mono text-cyan-300 truncate max-w-[180px]">
                  {session.settings.model}
                </span>
                <span className="text-zinc-600">|</span>
                <span className="font-mono text-zinc-300">
                  {session.trials.length}/{session.settings.n_trials} trials
                </span>
                <span className="text-zinc-600">|</span>
                <span className="font-mono text-emerald-400">
                  {session.pareto_indices.length} Pareto
                </span>
              </div>
            )}

            {!session ? (
              <button
                type="button"
                onClick={handleStartStudy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-cyan-500"
              >
                <Play className="h-3.5 w-3.5" />
                Run Optimization
              </button>
            ) : isRunning ? (
              <button
                type="button"
                onClick={handleStopStudy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-500"
              >
                <Square className="h-3.5 w-3.5" />
                Interrupt Study
              </button>
            ) : (
              <div className="flex items-center gap-2">
                {session.trials.length < session.settings.n_trials && (
                  <button
                    type="button"
                    onClick={handleResumeStudy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Resume
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleResetStudy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  New Study
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="mx-auto max-w-7xl px-4 flex gap-1 border-t border-zinc-900">
          {(
            [
              { id: 'configure', label: 'Configure & Run', icon: SettingsIcon },
              {
                id: 'pareto',
                label: `Pareto & Trials${session ? ` (${paretoTrials.length})` : ''}`,
                icon: GitBranch,
              },
              { id: 'evaluate', label: 'Chat & Benchmark', icon: MessageSquare },
              { id: 'reproduce', label: 'Export & Reproduce', icon: BarChart3 },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-xs font-medium transition ${
                  active
                    ? 'border-cyan-400 text-cyan-300'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 space-y-6">
        {errorMsg && (
          <div className="flex items-center gap-2 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-xs text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {errorMsg}
          </div>
        )}

        {/* TAB 1: CONFIGURE & RUN */}
        {activeTab === 'configure' && (
          <div className="space-y-6">
            {session && (
              <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-emerald-400" />
                    <h2 className="text-sm font-semibold text-zinc-100">
                      Study Execution &amp; Pre-Flight Report
                    </h2>
                    {isRunning && (
                      <span className="inline-flex items-center gap-1 rounded bg-cyan-950/60 px-2 py-0.5 font-mono text-[11px] text-cyan-300 border border-cyan-700/40">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Optimizing...
                      </span>
                    )}
                    {session.status === 'completed' && !isRunning && (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-950/60 px-2 py-0.5 font-mono text-[11px] text-emerald-300 border border-emerald-700/40">
                        <CheckCircle2 className="h-3 w-3" />
                        Optimization finished
                      </span>
                    )}
                  </div>

                  {session.trials.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('pareto')}
                      className="text-xs font-medium text-cyan-300 hover:text-cyan-200"
                    >
                      Inspect {paretoTrials.length} Pareto Trials &rarr;
                    </button>
                  )}
                </div>

                {/* Progress bar */}
                <div>
                  <div className="mb-1.5 flex justify-between font-mono text-xs text-zinc-400">
                    <span>
                      Trial {session.trials.length} / {session.settings.n_trials} (
                      {session.trials.length <= session.settings.n_startup_trials
                        ? 'Startup Exploration'
                        : 'Multivariate TPE'}
                      )
                    </span>
                    <span>{progressPct}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-200"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>

                {/* Pre-flight metrics */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <div className="text-[11px] text-zinc-500">VRAM Footprint</div>
                    <div className="mt-0.5 font-mono text-sm font-semibold text-zinc-100">
                      {session.preflight.vram_used_gb} / {session.preflight.vram_total_gb} GB
                    </div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <div className="text-[11px] text-zinc-500">Optimal Batch Size</div>
                    <div className="mt-0.5 font-mono text-sm font-semibold text-cyan-300">
                      {session.preflight.chosen_batch_size}
                    </div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <div className="text-[11px] text-zinc-500">CoT Response Prefix</div>
                    <div className="mt-0.5 font-mono text-sm font-semibold text-zinc-100 truncate">
                      {session.preflight.response_prefix || '(none)'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <div className="text-[11px] text-zinc-500">Pareto Optimal</div>
                    <div className="mt-0.5 font-mono text-sm font-semibold text-emerald-400">
                      {paretoTrials.length} trials
                    </div>
                  </div>
                </div>

                <pre className="max-h-44 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
                  {session.preflight.logs.join('\n')}
                </pre>
              </section>
            )}

            <ConfigPanel
              settings={settings}
              onChange={setSettings}
              disabled={session !== null}
            />
          </div>
        )}

        {/* TAB 2: PARETO & TRIALS */}
        {activeTab === 'pareto' && (
          <div className="space-y-6">
            {!session ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-10 text-center space-y-3">
                <p className="text-sm text-zinc-300">No active optimization study yet.</p>
                <button
                  type="button"
                  onClick={handleStartStudy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-500"
                >
                  <Play className="h-3.5 w-3.5" />
                  Run Optimization Study
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
                  <div className="lg:col-span-3 space-y-4">
                    <ParetoPlot
                      trials={session.trials}
                      selectedTrialIndex={activeTrial?.index ?? null}
                      onSelectTrial={(idx) => setSelectedTrialIndex(idx)}
                    />
                    {activeTrial && (
                      <LayerProfileChart
                        trial={activeTrial}
                        totalLayers={session.preflight.model_layers}
                      />
                    )}
                  </div>

                  {/* Pareto Front Selection Menu */}
                  <div className="lg:col-span-2 space-y-4">
                    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-zinc-100">
                          Pareto Optimal Trials
                        </h2>
                        <span className="font-mono text-xs text-emerald-400">
                          {paretoTrials.length} optimal
                        </span>
                      </div>

                      <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                        {paretoTrials.map((t) => {
                          const selected = activeTrial?.index === t.index;
                          return (
                            <button
                              key={t.index}
                              type="button"
                              onClick={() => setSelectedTrialIndex(t.index)}
                              className={`w-full rounded-lg border px-3 py-2 text-left font-mono text-xs transition ${
                                selected
                                  ? 'border-cyan-500 bg-cyan-950/40 text-zinc-100'
                                  : 'border-zinc-800 bg-zinc-950/70 text-zinc-300 hover:border-zinc-700'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-emerald-400">
                                  [Trial {String(t.index).padStart(3, ' ')}]
                                </span>
                                <span className="text-[10px] text-zinc-500">
                                  {(t.duration_ms / 1000).toFixed(2)}s
                                </span>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-300">
                                {t.scores.map((s) => (
                                  <span key={s.name}>
                                    <span className="text-zinc-500">{s.name}:</span>{' '}
                                    <span className="text-zinc-100">{s.score.display}</span>
                                  </span>
                                ))}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {/* Run additional trials */}
                      <div className="pt-2 border-t border-zinc-800 flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={additionalCount}
                          onChange={(e) =>
                            setAdditionalCount(Math.max(1, Number(e.target.value) || 10))
                          }
                          className="w-20 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100"
                        />
                        <button
                          type="button"
                          disabled={isRunning}
                          onClick={handleRunAdditional}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
                        >
                          <Plus className="h-3.5 w-3.5 text-cyan-400" />
                          Run Additional Trials
                        </button>
                      </div>
                    </section>

                    {activeTrial && (
                      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-semibold text-zinc-200">
                            Trial #{activeTrial.index} Parameters
                          </h3>
                          <button
                            type="button"
                            onClick={() => setActiveTab('evaluate')}
                            className="text-[11px] font-medium text-cyan-300 hover:text-cyan-200"
                          >
                            Test in Chat &rarr;
                          </button>
                        </div>
                        <div className="divide-y divide-zinc-800/80 rounded-lg border border-zinc-800 bg-zinc-950">
                          {Object.entries(activeTrial.presentation_params).map(([k, v]) => (
                            <div
                              key={k}
                              className="flex items-center justify-between px-3 py-1.5 font-mono text-[11px]"
                            >
                              <span className="text-zinc-400">{k}</span>
                              <span className="text-cyan-300 font-semibold">{v}</span>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* TAB 3: CHAT & BENCHMARK */}
        {activeTab === 'evaluate' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Interactive Model Chat */}
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 flex flex-col space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-cyan-400" />
                    Model Test Chat (Baseline vs Trial #{activeTrial?.index ?? '—'})
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Side-by-side response comparison with live KeywordRate marker matching
                  </p>
                </div>
              </div>

              {!session || !activeTrial ? (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-8 text-center text-xs text-zinc-500">
                  Run a study and select a trial first to test model responses.
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestedPrompts.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setChatInput(p)}
                        className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 text-left"
                      >
                        {p}
                      </button>
                    ))}
                  </div>

                  <div className="flex-1 min-h-[260px] max-h-[420px] overflow-y-auto space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    {chatHistory.length === 0 ? (
                      <div className="h-48 flex items-center justify-center text-xs text-zinc-600">
                        Send a prompt below to compare Original vs {session.settings.modified_model_type} output.
                      </div>
                    ) : (
                      chatHistory.map((turn, idx) => (
                        <div key={idx} className="space-y-2 border-b border-zinc-800/80 pb-3 last:border-none">
                          <div className="text-xs font-medium text-zinc-200">
                            <span className="font-mono text-cyan-400">&gt; User:</span> {turn.prompt}
                          </div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div className="rounded border border-zinc-800 bg-zinc-900/60 p-2.5">
                              <div className="mb-1 flex items-center justify-between text-[10px]">
                                <span className="font-semibold text-zinc-400">Original Baseline</span>
                                <span
                                  className={`font-mono px-1.5 py-0.5 rounded ${
                                    turn.baseline_matched
                                      ? 'bg-red-950/60 text-red-300'
                                      : 'bg-emerald-950/60 text-emerald-300'
                                  }`}
                                >
                                  {turn.baseline_matched
                                    ? `matched: ${turn.baseline_markers.slice(0, 2).join(', ')}`
                                    : 'clean'}
                                </span>
                              </div>
                              <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">
                                {turn.baseline_response}
                              </p>
                            </div>
                            <div className="rounded border border-emerald-800/40 bg-emerald-950/15 p-2.5">
                              <div className="mb-1 flex items-center justify-between text-[10px]">
                                <span className="font-semibold text-emerald-300">
                                  Modified (Trial #{activeTrial.index})
                                </span>
                                <span
                                  className={`font-mono px-1.5 py-0.5 rounded ${
                                    turn.modified_matched
                                      ? 'bg-red-950/60 text-red-300'
                                      : 'bg-emerald-950/60 text-emerald-300'
                                  }`}
                                >
                                  {turn.modified_matched
                                    ? `matched: ${turn.modified_markers.slice(0, 2).join(', ')}`
                                    : 'clean'}
                                </span>
                              </div>
                              <p className="text-xs text-zinc-200 whitespace-pre-wrap leading-relaxed">
                                {turn.modified_response}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <form onSubmit={handleSendChat} className="flex gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Enter a test prompt..."
                      className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={chatLoading || !chatInput.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Send
                    </button>
                  </form>
                </>
              )}
            </section>

            {/* Standard Benchmarks */}
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-emerald-400" />
                  Evaluation Harness Benchmarks (lm-eval)
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Evaluate intelligence retention across Heretic&apos;s 11 standard benchmark tasks
                </p>
              </div>

              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {BENCHMARKS.map((b) => {
                  const checked = selectedBenchmarks.includes(b.task);
                  return (
                    <label
                      key={b.task}
                      title={b.description}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs cursor-pointer ${
                        checked
                          ? 'border-cyan-500/60 bg-cyan-950/30 text-zinc-100'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-400'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleBenchmark(b.task)}
                        className="accent-cyan-400"
                      />
                      <span className="truncate">{b.name}</span>
                    </label>
                  );
                })}
              </div>

              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={benchmarkOriginal}
                    onChange={(e) => setBenchmarkOriginal(e.target.checked)}
                    className="accent-cyan-400"
                  />
                  Benchmark original model alongside modified
                </label>

                <button
                  type="button"
                  disabled={!session || !activeTrial || benchmarkLoading || selectedBenchmarks.length === 0}
                  onClick={handleRunBenchmarks}
                  className="rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {benchmarkLoading ? 'Running lm-eval...' : 'Run Benchmarks'}
                </button>
              </div>

              {benchmarkRows.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-zinc-800">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-950 text-zinc-400">
                      <tr>
                        <th className="px-3 py-2">Benchmark</th>
                        <th className="px-3 py-2">Metric</th>
                        <th className="px-3 py-2 text-right">Modified</th>
                        {benchmarkOriginal && (
                          <>
                            <th className="px-3 py-2 text-right">Original</th>
                            <th className="px-3 py-2 text-right">Delta</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800 bg-zinc-900/40 font-mono">
                      {benchmarkRows.map((row) => (
                        <tr key={row.task}>
                          <td className="px-3 py-2 font-sans font-medium text-zinc-200">
                            {row.benchmark}
                          </td>
                          <td className="px-3 py-2 text-zinc-400">{row.metric}</td>
                          <td className="px-3 py-2 text-right text-cyan-300">
                            {row.modified_value.toFixed(4)}
                          </td>
                          {benchmarkOriginal && (
                            <>
                              <td className="px-3 py-2 text-right text-zinc-400">
                                {row.original_value.toFixed(4)}
                              </td>
                              <td
                                className={`px-3 py-2 text-right ${
                                  row.delta >= 0 ? 'text-emerald-400' : 'text-amber-300'
                                }`}
                              >
                                {row.delta >= 0 ? '+' : ''}
                                {row.delta.toFixed(4)}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 4: EXPORT & REPRODUCE */}
        {activeTab === 'reproduce' && (
          <ReproducePanel
            session={session}
            selectedTrialIndex={activeTrial?.index ?? null}
            onRestoredSession={(restored) => {
              setSession(restored);
              setSelectedTrialIndex(restored.trials[0]?.index ?? null);
              setActiveTab('pareto');
            }}
          />
        )}
      </main>
    </div>
  );
}

export default App;
