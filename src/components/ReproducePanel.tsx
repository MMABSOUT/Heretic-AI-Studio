import React, { useState } from 'react';
import {
  Download,
  FileJson,
  ShieldCheck,
  AlertTriangle,
  Upload,
} from 'lucide-react';
import type {
  EnvironmentMismatch,
  ExportStrategy,
  MismatchSeverity,
  ReproductionManifest,
  StudySession,
} from '../types/heretic';

interface ReproducePanelProps {
  session: StudySession | null;
  selectedTrialIndex: number | null;
  onRestoredSession: (restored: StudySession) => void;
}

const SEVERITY_COLORS: Record<MismatchSeverity, string> = {
  low: 'text-emerald-400 bg-emerald-950/40 border-emerald-700/40',
  medium: 'text-amber-300 bg-amber-950/40 border-amber-700/40',
  high: 'text-red-400 bg-red-950/40 border-red-700/40',
  critical: 'text-red-300 bg-red-900/60 border-red-500/60 font-semibold',
};

export const ReproducePanel: React.FC<ReproducePanelProps> = ({
  session,
  selectedTrialIndex,
  onRestoredSession,
}) => {
  const [strategy, setStrategy] = useState<ExportStrategy>('merge');
  const [reproLevel, setReproLevel] = useState<'full' | 'basic'>('full');
  const [exportData, setExportData] = useState<{
    manifest: ReproductionManifest;
    readmeIntro: string;
  } | null>(null);
  const [exportLoading, setExportLoading] = useState(false);

  const [manifestInput, setManifestInput] = useState('');
  const [verifyResult, setVerifyResult] = useState<{
    mismatches: EnvironmentMismatch[];
    maxSeverity: MismatchSeverity | null;
    error?: string;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);

  const activeTrialIdx =
    selectedTrialIndex ?? session?.pareto_indices[0] ?? session?.trials[0]?.index ?? null;

  const handleGenerateExport = async () => {
    if (!session || !activeTrialIdx) return;
    setExportLoading(true);
    try {
      const res = await fetch(`/api/studies/${session.id}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trial_index: activeTrialIdx,
          reproducibility: reproLevel,
          strategy,
        }),
      });
      const data = await res.json();
      setExportData(data);
      setManifestInput(JSON.stringify(data.manifest, null, 2));
    } finally {
      setExportLoading(false);
    }
  };

  const downloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleVerifyManifest = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const parsed = JSON.parse(manifestInput);
      const res = await fetch('/api/reproduce/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const data = await res.json();
      if (!res.ok) {
        setVerifyResult({
          mismatches: data.mismatches ?? [],
          maxSeverity: data.maxSeverity ?? 'critical',
          error: data.error ?? 'Verification failed',
        });
        return;
      }
      setVerifyResult({
        mismatches: data.mismatches ?? [],
        maxSeverity: data.maxSeverity ?? null,
      });
      if (data.restored_session) {
        onRestoredSession(data.restored_session);
      }
    } catch (err) {
      setVerifyResult({
        mismatches: [],
        maxSeverity: 'critical',
        error: err instanceof Error ? err.message : 'Invalid JSON manifest',
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Export & Model Card */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <FileJson className="h-4 w-4 text-emerald-400" />
            Export Modified Model & Reproducibility Manifest
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Generate version-4 <code className="text-cyan-300">reproduce.json</code>, weight
            hashes, and Hugging Face <code className="text-cyan-300">README.md</code> card.
          </p>
        </div>

        {!session || !activeTrialIdx ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-6 text-center text-xs text-zinc-500">
            Complete an optimization run and select a trial to generate export artifacts.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Export Strategy
                </label>
                <select
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value as ExportStrategy)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100"
                >
                  <option value="merge">Merge LoRA & export full model</option>
                  <option value="adapter">Export LoRA adapter only</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Reproducibility Info
                </label>
                <select
                  value={reproLevel}
                  onChange={(e) => setReproLevel(e.target.value as 'full' | 'basic')}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100"
                >
                  <option value="full">Full (Settings, packages & system)</option>
                  <option value="basic">Basic (Settings & packages)</option>
                </select>
              </div>
            </div>

            <button
              type="button"
              onClick={handleGenerateExport}
              disabled={exportLoading}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {exportLoading
                ? 'Generating Manifest...'
                : `Generate Export Bundle for Trial #${activeTrialIdx}`}
            </button>

            {exportData && (
              <div className="space-y-3 pt-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      downloadFile(
                        'reproduce.json',
                        JSON.stringify(exportData.manifest, null, 2),
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
                  >
                    <Download className="h-3.5 w-3.5 text-emerald-400" />
                    reproduce.json
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadFile('README.md', exportData.readmeIntro)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
                  >
                    <Download className="h-3.5 w-3.5 text-cyan-400" />
                    README.md Card
                  </button>
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <div className="mb-1.5 text-[11px] font-semibold text-zinc-400">
                    Safetensors SHA-256 Hashes
                  </div>
                  <div className="space-y-1 font-mono text-[10px]">
                    {Object.entries(exportData.manifest.hashes).map(([file, hash]) => (
                      <div key={file} className="flex justify-between gap-2 text-zinc-300">
                        <span className="truncate">{file}</span>
                        <span className="text-emerald-400 truncate max-w-[220px]">{hash}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <pre className="max-h-52 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] font-mono text-zinc-300">
                  {exportData.readmeIntro}
                </pre>
              </div>
            )}
          </>
        )}
      </section>

      {/* Reproduce / Environment Checker */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-cyan-400" />
            Heretic Grimoire & Reproduce Mode (--reproduce)
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Paste a v4 <code className="text-cyan-300">reproduce.json</code> manifest to verify
            system & package mismatches and restore the trial.
          </p>
        </div>

        <textarea
          rows={7}
          value={manifestInput}
          onChange={(e) => setManifestInput(e.target.value)}
          placeholder='Paste reproduce.json contents here (or click "Generate Export Bundle" on the left to populate)...'
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-200 focus:border-cyan-500 focus:outline-none"
        />

        <button
          type="button"
          onClick={handleVerifyManifest}
          disabled={verifying || !manifestInput.trim()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          {verifying ? 'Checking Environment...' : 'Verify Environment & Restore Trial'}
        </button>

        {verifyResult && (
          <div className="space-y-3">
            {verifyResult.error ? (
              <div className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-xs text-red-300">
                {verifyResult.error}
              </div>
            ) : verifyResult.mismatches.length === 0 ? (
              <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-3 text-xs text-emerald-300 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                Exact environment match! Byte-for-byte reproduction verified and trial restored.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-amber-300">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Detected {verifyResult.mismatches.length} mismatch(es) — Max severity:{' '}
                  <span className="uppercase font-mono">{verifyResult.maxSeverity}</span>
                </div>
                <div className="overflow-hidden rounded-lg border border-zinc-800">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-zinc-950 text-zinc-400">
                      <tr>
                        <th className="px-2.5 py-1.5">Component</th>
                        <th className="px-2.5 py-1.5">This System</th>
                        <th className="px-2.5 py-1.5">Original</th>
                        <th className="px-2.5 py-1.5">Severity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800 bg-zinc-900/40">
                      {verifyResult.mismatches.map((m, idx) => (
                        <tr key={idx}>
                          <td className="px-2.5 py-1.5 font-mono text-zinc-200">{m.component}</td>
                          <td className="px-2.5 py-1.5 font-mono text-zinc-400">{m.this_system}</td>
                          <td className="px-2.5 py-1.5 font-mono text-zinc-400">{m.original_system}</td>
                          <td className="px-2.5 py-1.5">
                            <span
                              className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                                SEVERITY_COLORS[m.severity]
                              }`}
                            >
                              {m.severity}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
