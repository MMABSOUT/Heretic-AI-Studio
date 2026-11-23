import React from 'react';
import type { TrialRecord } from '../types/heretic';

interface ParetoPlotProps {
  trials: TrialRecord[];
  selectedTrialIndex: number | null;
  onSelectTrial: (index: number) => void;
}

export const ParetoPlot: React.FC<ParetoPlotProps> = ({
  trials,
  selectedTrialIndex,
  onSelectTrial,
}) => {
  if (trials.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/60 text-sm text-zinc-500">
        Run optimization trials to visualize the Pareto frontier.
      </div>
    );
  }

  const firstTrial = trials[0];
  const objectives = firstTrial.scores.filter((s) => s.optimization !== 'none');

  if (objectives.length < 2) {
    return (
      <div className="flex h-72 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/60 text-sm text-zinc-400">
        Single-objective mode active ({objectives[0]?.name ?? 'Score'}). Select a trial from the table below.
      </div>
    );
  }

  const xObj = objectives[0];
  const yObj = objectives[1];

  const xValues = trials.map((t) => t.objective_values[0]);
  const yValues = trials.map((t) => t.objective_values[1]);

  const xMin = Math.min(...xValues, xObj.baseline.value) * 0.95;
  const xMax = Math.max(...xValues, xObj.baseline.value) * 1.05 || 1;
  const yMin = Math.min(...yValues, yObj.baseline.value) * 0.95;
  const yMax = Math.max(...yValues, yObj.baseline.value) * 1.05 || 1;

  const width = 620;
  const height = 300;
  const padL = 56;
  const padR = 24;
  const padT = 20;
  const padB = 42;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const mapX = (v: number) =>
    padL + ((v - xMin) / Math.max(xMax - xMin, 1e-6)) * plotW;
  const mapY = (v: number) =>
    padT + plotH - ((v - yMin) / Math.max(yMax - yMin, 1e-6)) * plotH;

  const paretoPoints = trials
    .filter((t) => t.is_pareto)
    .sort((a, b) => a.objective_values[0] - b.objective_values[0]);

  const polylinePoints = paretoPoints
    .map((t) => `${mapX(t.objective_values[0])},${mapY(t.objective_values[1])}`)
    .join(' ');

  const xTicks = 4;
  const yTicks = 4;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
        <span>
          Pareto Front: <strong className="text-zinc-200">{xObj.name}</strong> ({xObj.optimization}) vs{' '}
          <strong className="text-zinc-200">{yObj.name}</strong> ({yObj.optimization})
        </span>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-zinc-600" />
            Trial
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
            Pareto Optimal
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rotate-45 bg-amber-400" />
            Baseline
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
        {/* Grid */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const val = yMin + (i / yTicks) * (yMax - yMin);
          const y = mapY(val);
          return (
            <g key={`y-${i}`}>
              <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#27272a" strokeDasharray="3 3" />
              <text x={padL - 8} y={y + 3} textAnchor="end" className="fill-zinc-500 text-[10px] font-mono">
                {val.toFixed(2)}
              </text>
            </g>
          );
        })}

        {Array.from({ length: xTicks + 1 }, (_, i) => {
          const val = xMin + (i / xTicks) * (xMax - xMin);
          const x = mapX(val);
          return (
            <g key={`x-${i}`}>
              <line x1={x} y1={padT} x2={x} y2={padT + plotH} stroke="#27272a" strokeDasharray="3 3" />
              <text x={x} y={padT + plotH + 16} textAnchor="middle" className="fill-zinc-500 text-[10px] font-mono">
                {val.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* Axis labels */}
        <text x={padL + plotW / 2} y={height - 4} textAnchor="middle" className="fill-zinc-400 text-[11px]">
          {xObj.name} ({xObj.optimization})
        </text>
        <text
          x={14}
          y={padT + plotH / 2}
          textAnchor="middle"
          transform={`rotate(-90 14 ${padT + plotH / 2})`}
          className="fill-zinc-400 text-[11px]"
        >
          {yObj.name} ({yObj.optimization})
        </text>

        {/* Pareto frontier line */}
        {paretoPoints.length > 1 && (
          <polyline
            fill="none"
            stroke="#10b981"
            strokeWidth={1.75}
            strokeOpacity={0.6}
            points={polylinePoints}
          />
        )}

        {/* Baseline marker */}
        <g transform={`translate(${mapX(xObj.baseline.value)}, ${mapY(yObj.baseline.value)})`}>
          <rect x={-4} y={-4} width={8} height={8} transform="rotate(45)" fill="#fbbf24" />
          <title>
            Baseline: {xObj.name}={xObj.baseline.display}, {yObj.name}={yObj.baseline.display}
          </title>
        </g>

        {/* Non-Pareto trials */}
        {trials
          .filter((t) => !t.is_pareto)
          .map((t) => {
            const cx = mapX(t.objective_values[0]);
            const cy = mapY(t.objective_values[1]);
            const selected = t.index === selectedTrialIndex;
            return (
              <circle
                key={t.index}
                cx={cx}
                cy={cy}
                r={selected ? 6 : 3.5}
                fill={selected ? '#22d3ee' : '#52525b'}
                stroke={selected ? '#ecfeff' : 'none'}
                strokeWidth={1.5}
                className="cursor-pointer transition-all hover:r-5"
                onClick={() => onSelectTrial(t.index)}
              >
                <title>
                  Trial #{t.index} | {xObj.name}: {t.scores[0]?.score.display} | {yObj.name}:{' '}
                  {t.scores[1]?.score.display}
                </title>
              </circle>
            );
          })}

        {/* Pareto trials */}
        {paretoPoints.map((t) => {
          const cx = mapX(t.objective_values[0]);
          const cy = mapY(t.objective_values[1]);
          const selected = t.index === selectedTrialIndex;
          return (
            <g
              key={`p-${t.index}`}
              className="cursor-pointer"
              onClick={() => onSelectTrial(t.index)}
            >
              {selected && (
                <circle cx={cx} cy={cy} r={10} fill="none" stroke="#22d3ee" strokeWidth={1.5} />
              )}
              <circle
                cx={cx}
                cy={cy}
                r={selected ? 6 : 5}
                fill={selected ? '#22d3ee' : '#10b981'}
                stroke="#09090b"
                strokeWidth={1.5}
              />
              <text
                x={cx + 7}
                y={cy - 6}
                className="fill-emerald-300 text-[10px] font-mono pointer-events-none"
              >
                #{t.index}
              </text>
              <title>
                Pareto Trial #{t.index} | {xObj.name}: {t.scores[0]?.score.display} | {yObj.name}:{' '}
                {t.scores[1]?.score.display}
              </title>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
