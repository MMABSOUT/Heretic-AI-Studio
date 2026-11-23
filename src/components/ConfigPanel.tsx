import React, { useState } from 'react';
import { Download, Sliders, Cpu, Sparkles, Check, Copy } from 'lucide-react';
import type {
  HereticSettings,
  OptimizationDirection,
  QuantizationMethod,
  RowNormalization,
} from '../types/heretic';
import {
  CONFIG_PRESETS,
  MODEL_PROFILES,
  serializeToToml,
} from '../data/presets';

interface ConfigPanelProps {
  settings: HereticSettings;
  onChange: (next: HereticSettings) => void;
  disabled?: boolean;
}

export const ConfigPanel: React.FC<ConfigPanelProps> = ({
  settings,
  onChange,
  disabled,
}) => {
  const [showToml, setShowToml] = useState(false);
  const [copied, setCopied] = useState(false);

  const activeModifier = settings.modifiers[0]?.plugin ?? 'heretic.modifiers.ara.ARA';
  const isARA = activeModifier.includes('ARA');
  const tomlString = serializeToToml(settings);

  const applyPreset = (presetId: string) => {
    const preset = CONFIG_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const cloned: HereticSettings = JSON.parse(JSON.stringify(preset.settings));
    cloned.model = settings.model;
    cloned.quantization = settings.quantization;
    onChange(cloned);
  };

  const setModifier = (plugin: string) => {
    onChange({
      ...settings,
      modifiers: [{ plugin }],
    });
  };

  const updateScorerDirection = (index: number, optimization: OptimizationDirection) => {
    const nextScorers = settings.scorers.map((sc, i) =>
      i === index ? { ...sc, optimization } : sc,
    );
    onChange({ ...settings, scorers: nextScorers });
  };

  const handleCopyToml = () => {
    navigator.clipboard.writeText(tomlString);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadToml = () => {
    const blob = new Blob([tomlString], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'config.toml';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Presets */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-cyan-400" />
              Configuration Presets
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              All 8 built-in Heretic configuration profiles (config.*.toml)
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowToml((v) => !v)}
            className="rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-mono text-zinc-300 hover:bg-zinc-700"
          >
            {showToml ? 'Hide config.toml' : 'View config.toml'}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {CONFIG_PRESETS.map((preset) => {
            const active = settings.preset_id === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                disabled={disabled}
                onClick={() => applyPreset(preset.id)}
                className={`text-left rounded-lg border p-3 transition ${
                  active
                    ? 'border-cyan-500/70 bg-cyan-950/30 ring-1 ring-cyan-500/30'
                    : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-700'
                } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-100">{preset.name}</span>
                  <span className="font-mono text-[10px] text-zinc-500">{preset.id}</span>
                </div>
                <p className="mt-1 text-[11px] text-zinc-400 line-clamp-2">{preset.tagline}</p>
              </button>
            );
          })}
        </div>

        {showToml && (
          <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-xs text-zinc-400">config.toml</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyToml}
                  className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700"
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadToml}
                  className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700"
                >
                  <Download className="h-3 w-3" />
                  Download
                </button>
              </div>
            </div>
            <pre className="max-h-60 overflow-auto text-[11px] leading-relaxed text-cyan-200/90 font-mono">
              {tomlString}
            </pre>
          </div>
        )}
      </section>

      {/* Model & Optimization Settings */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <Cpu className="h-4 w-4 text-cyan-400" />
            Target Model & Study Hyperparameters
          </h2>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Hugging Face Model ID or Path
              </label>
              <select
                disabled={disabled}
                value={
                  MODEL_PROFILES.some((m) => m.id === settings.model) ? settings.model : '__custom__'
                }
                onChange={(e) => {
                  if (e.target.value !== '__custom__') {
                    onChange({ ...settings, model: e.target.value });
                  }
                }}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
              >
                {MODEL_PROFILES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
                <option value="__custom__">Custom Hugging Face ID...</option>
              </select>
              <input
                type="text"
                disabled={disabled}
                value={settings.model}
                onChange={(e) => onChange({ ...settings, model: e.target.value })}
                placeholder="org/model-name"
                className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-cyan-300 focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Quantization
                </label>
                <select
                  disabled={disabled}
                  value={settings.quantization}
                  onChange={(e) =>
                    onChange({
                      ...settings,
                      quantization: e.target.value as QuantizationMethod,
                    })
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100"
                >
                  <option value="none">none (bfloat16/float16)</option>
                  <option value="bnb_4bit">bnb_4bit (4-bit NF4)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Modified Model Type
                </label>
                <input
                  type="text"
                  disabled={disabled}
                  value={settings.modified_model_type}
                  onChange={(e) =>
                    onChange({ ...settings, modified_model_type: e.target.value })
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  n_trials
                </label>
                <input
                  type="number"
                  min={5}
                  max={200}
                  disabled={disabled}
                  value={settings.n_trials}
                  onChange={(e) =>
                    onChange({ ...settings, n_trials: Math.max(5, Number(e.target.value) || 40) })
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  n_startup_trials
                </label>
                <input
                  type="number"
                  min={0}
                  max={settings.n_trials}
                  disabled={disabled}
                  value={settings.n_startup_trials}
                  onChange={(e) =>
                    onChange({
                      ...settings,
                      n_startup_trials: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  seed
                </label>
                <input
                  type="number"
                  disabled={disabled}
                  value={settings.seed}
                  onChange={(e) =>
                    onChange({ ...settings, seed: Number(e.target.value) || 0 })
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-100"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Active Scorers & Optuna Directions
              </label>
              <div className="space-y-1.5">
                {settings.scorers.map((sc, idx) => (
                  <div
                    key={`${sc.plugin}-${sc.instance_name ?? idx}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs text-zinc-200">
                        {sc.plugin.split('.').pop()}
                        {sc.instance_name ? ` (${sc.instance_name})` : ''}
                      </div>
                      <div className="truncate font-mono text-[10px] text-zinc-500">
                        {sc.plugin}
                      </div>
                    </div>
                    <select
                      disabled={disabled}
                      value={sc.optimization}
                      onChange={(e) =>
                        updateScorerDirection(idx, e.target.value as OptimizationDirection)
                      }
                      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-emerald-300"
                    >
                      <option value="minimize">minimize</option>
                      <option value="maximize">maximize</option>
                      <option value="none">none</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Modifier Configuration */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <Sliders className="h-4 w-4 text-fuchsia-400" />
            Modifier Plugin ({isARA ? 'ARA' : 'Directional Abliteration'})
          </h2>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setModifier('heretic.modifiers.ara.ARA')}
              className={`rounded-lg border p-2.5 text-left transition ${
                isARA
                  ? 'border-fuchsia-500/70 bg-fuchsia-950/30 text-zinc-100'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
              }`}
            >
              <div className="text-xs font-semibold">Arbitrary-Rank Ablation (ARA)</div>
              <div className="text-[11px] text-zinc-400 mt-0.5">
                L-BFGS LoRA kNN residual steering (default)
              </div>
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setModifier('heretic.modifiers.abliteration.Abliteration')}
              className={`rounded-lg border p-2.5 text-left transition ${
                !isARA
                  ? 'border-fuchsia-500/70 bg-fuchsia-950/30 text-zinc-100'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
              }`}
            >
              <div className="text-xs font-semibold">Directional Abliteration / MPOA</div>
              <div className="text-[11px] text-zinc-400 mt-0.5">
                Projected & norm-preserving orthogonal ablation
              </div>
            </button>
          </div>

          {isARA ? (
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
                <div>
                  <div className="text-xs font-medium text-zinc-200">
                    preserve_row_magnitudes
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    Renormalize modified rows to preserve original norms (MPOA)
                  </div>
                </div>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={settings.modifier_settings.ARA.preserve_row_magnitudes}
                  onChange={(e) =>
                    onChange({
                      ...settings,
                      modifier_settings: {
                        ...settings.modifier_settings,
                        ARA: {
                          ...settings.modifier_settings.ARA,
                          preserve_row_magnitudes: e.target.checked,
                        },
                      },
                    })
                  }
                  className="h-4 w-4 accent-cyan-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    lora_rank
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={256}
                    disabled={disabled}
                    value={settings.modifier_settings.ARA.lora_rank}
                    onChange={(e) =>
                      onChange({
                        ...settings,
                        modifier_settings: {
                          ...settings.modifier_settings,
                          ARA: {
                            ...settings.modifier_settings.ARA,
                            lora_rank: Math.max(1, Number(e.target.value) || 50),
                          },
                        },
                      })
                    }
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    n_optimization_steps (L-BFGS)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    disabled={disabled}
                    value={settings.modifier_settings.ARA.n_optimization_steps}
                    onChange={(e) =>
                      onChange({
                        ...settings,
                        modifier_settings: {
                          ...settings.modifier_settings,
                          ARA: {
                            ...settings.modifier_settings.ARA,
                            n_optimization_steps: Math.max(1, Number(e.target.value) || 5),
                          },
                        },
                      })
                    }
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-[11px] text-zinc-400">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                  <div className="font-semibold text-zinc-300">good_prompts</div>
                  <div className="font-mono text-cyan-300 mt-0.5 truncate">
                    {Array.isArray(settings.modifier_settings.ARA.good_prompts)
                      ? settings.modifier_settings.ARA.good_prompts[0]?.dataset
                      : settings.modifier_settings.ARA.good_prompts.dataset}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                  <div className="font-semibold text-zinc-300">bad_prompts</div>
                  <div className="font-mono text-fuchsia-300 mt-0.5 truncate">
                    {Array.isArray(settings.modifier_settings.ARA.bad_prompts)
                      ? settings.modifier_settings.ARA.bad_prompts[0]?.dataset
                      : settings.modifier_settings.ARA.bad_prompts.dataset}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
                <div>
                  <div className="text-xs font-medium text-zinc-200">
                    orthogonalize_direction
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    Projected abliteration orthogonal to good mean residual
                  </div>
                </div>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={settings.modifier_settings.Abliteration.orthogonalize_direction}
                  onChange={(e) =>
                    onChange({
                      ...settings,
                      modifier_settings: {
                        ...settings.modifier_settings,
                        Abliteration: {
                          ...settings.modifier_settings.Abliteration,
                          orthogonalize_direction: e.target.checked,
                        },
                      },
                    })
                  }
                  className="h-4 w-4 accent-cyan-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    row_normalization
                  </label>
                  <select
                    disabled={disabled}
                    value={settings.modifier_settings.Abliteration.row_normalization}
                    onChange={(e) =>
                      onChange({
                        ...settings,
                        modifier_settings: {
                          ...settings.modifier_settings,
                          Abliteration: {
                            ...settings.modifier_settings.Abliteration,
                            row_normalization: e.target.value as RowNormalization,
                          },
                        },
                      })
                    }
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-100"
                  >
                    <option value="full">full (MPOA)</option>
                    <option value="pre">pre</option>
                    <option value="none">none</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    winsorization_quantile
                  </label>
                  <input
                    type="number"
                    step={0.01}
                    min={0.5}
                    max={1.0}
                    disabled={disabled}
                    value={settings.modifier_settings.Abliteration.winsorization_quantile}
                    onChange={(e) =>
                      onChange({
                        ...settings,
                        modifier_settings: {
                          ...settings.modifier_settings,
                          Abliteration: {
                            ...settings.modifier_settings.Abliteration,
                            winsorization_quantile: Number(e.target.value) || 1.0,
                          },
                        },
                      })
                    }
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-100"
                  />
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
