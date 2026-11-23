import React from 'react';
import type { TrialRecord } from '../types/heretic';

interface LayerProfileChartProps {
  trial: TrialRecord;
  totalLayers: number;
}

export const LayerProfileChart: React.FC<LayerProfileChartProps> = ({
  trial,
  totalLayers,
}) => {
  const params = trial.parameters;

  if (params.type === 'ara') {
    const layers = Array.from({ length: totalLayers }, (_, i) => i);
    const activeCount = params.end_layer_index - params.start_layer_index;

    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
            <span>
              ARA Active Layer Span: layers{' '}
              <strong className="font-mono text-cyan-300">
                [{params.start_layer_index} .. {params.end_layer_index})
              </strong>{' '}
              ({activeCount}/{totalLayers} layers)
            </span>
            <span className="font-mono text-zinc-500">kNN k={params.neighbor_count}</span>
          </div>
          <div className="grid grid-cols-12 gap-1 sm:grid-cols-18">
            {layers.map((idx) => {
              const active =
                idx >= params.start_layer_index && idx < params.end_layer_index;
              return (
                <div
                  key={idx}
                  title={`Layer ${idx}: ${active ? 'LoRA ARA active' : 'Untouched'}`}
                  className={`flex h-6 items-center justify-center rounded text-[10px] font-mono ${
                    active
                      ? 'border border-cyan-500/40 bg-cyan-500/20 text-cyan-200'
                      : 'border border-zinc-800 bg-zinc-900 text-zinc-600'
                  }`}
                >
                  {idx}
                </div>
              );
            })}
          </div>
        </div>

        {trial.ara_loss_curve && trial.ara_loss_curve.length > 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="mb-2 text-xs text-zinc-400">
              L-BFGS Outer Optimization Step Loss (representative layer)
            </div>
            <div className="flex items-end gap-2 h-24">
              {trial.ara_loss_curve.map((loss, i) => {
                const maxLoss = Math.max(...trial.ara_loss_curve!);
                const pct = Math.max(12, Math.round((loss / maxLoss) * 100));
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                    <span className="text-[10px] font-mono text-zinc-400">{loss.toFixed(3)}</span>
                    <div
                      className="w-full rounded-t bg-gradient-to-t from-cyan-600/70 to-emerald-400/80"
                      style={{ height: `${pct}%` }}
                    />
                    <span className="text-[10px] font-mono text-zinc-500">S{i + 1}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Abliteration per-layer weight distribution curve (mirrors abliteration.py lines 335-346)
  const layers = Array.from({ length: totalLayers }, (_, i) => i);
  const attn = params.weight_distributions['attn.o_proj'];
  const mlp = params.weight_distributions['mlp.down_proj'];

  const computeWeight = (layerIdx: number, dist?: typeof attn) => {
    if (!dist) return 0;
    const distance = Math.abs(layerIdx - dist.max_weight_position);
    if (distance > dist.min_weight_distance) return 0;
    return (
      dist.max_weight +
      (distance / dist.min_weight_distance) * (dist.min_weight - dist.max_weight)
    );
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
      <div className="mb-3 flex items-center justify-between text-xs text-zinc-400">
        <span>
          Per-Layer Ablation Weight Kernel (
          <strong className="text-cyan-300">
            direction={params.direction_index === null ? 'per layer' : params.direction_index.toFixed(2)}
          </strong>
          )
        </span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-cyan-300">
            <span className="inline-block h-2 w-2 rounded-full bg-cyan-400" />
            attn.o_proj
          </span>
          <span className="flex items-center gap-1 text-fuchsia-300">
            <span className="inline-block h-2 w-2 rounded-full bg-fuchsia-400" />
            mlp.down_proj
          </span>
        </div>
      </div>

      <div className="flex items-end gap-1 h-28 pt-2">
        {layers.map((idx) => {
          const wAttn = computeWeight(idx, attn);
          const wMlp = computeWeight(idx, mlp);
          return (
            <div key={idx} className="flex-1 flex flex-col items-center gap-0.5 h-full justify-end">
              <div className="w-full flex items-end gap-px h-full justify-center">
                <div
                  title={`Layer ${idx} attn.o_proj: ${wAttn.toFixed(2)}`}
                  className="w-1.5 rounded-t bg-cyan-400/80"
                  style={{ height: `${Math.min(100, (wAttn / 1.5) * 100)}%` }}
                />
                <div
                  title={`Layer ${idx} mlp.down_proj: ${wMlp.toFixed(2)}`}
                  className="w-1.5 rounded-t bg-fuchsia-400/80"
                  style={{ height: `${Math.min(100, (wMlp / 1.5) * 100)}%` }}
                />
              </div>
              {idx % 4 === 0 && (
                <span className="text-[9px] font-mono text-zinc-600">{idx}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
