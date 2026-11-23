import crypto from 'node:crypto';
import type {
  AbliterationParameters,
  ARAParameters,
  BatchSizeProbe,
  BenchmarkMetricRow,
  ChatTurnResult,
  EnvironmentMismatch,
  HereticSettings,
  MismatchSeverity,
  PairedScoreRecord,
  PreflightReport,
  ReproductionManifest,
  ScorerConfig,
  StudySession,
  TrialParameters,
  TrialRecord,
  WeightDistribution,
} from '../src/types/heretic.ts';
import {
  BENCHMARKS,
  MODEL_PROFILES,
  REFUSAL_MARKERS,
} from '../src/data/presets.ts';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function getModelProfile(modelId: string) {
  const exact = MODEL_PROFILES.find(
    (p) => p.id.toLowerCase() === modelId.toLowerCase(),
  );
  if (exact) return exact;

  const lower = modelId.toLowerCase();
  const layers = lower.includes('70b') || lower.includes('72b')
    ? 80
    : lower.includes('32b') || lower.includes('27b')
      ? 64
      : lower.includes('14b') || lower.includes('12b')
        ? 40
        : lower.includes('1b') || lower.includes('2b') || lower.includes('3b')
          ? 28
          : 32;

  const paramsB = lower.includes('70b')
    ? 70
    : lower.includes('32b')
      ? 32
      : lower.includes('14b')
        ? 14
        : lower.includes('3b')
          ? 3
          : 8;

  return {
    id: modelId,
    name: modelId,
    layers,
    params_b: paramsB,
    cot_initializer: lower.includes('qwen3') || lower.includes('r1') ? '<think>' : undefined,
    cot_finalizer: lower.includes('qwen3') || lower.includes('r1') ? '</think>' : undefined,
    components: ['attn.o_proj', 'mlp.down_proj'],
  };
}

export function findKeywordMatches(response: string, markers: string[]): {
  matched: boolean;
  foundMarkers: string[];
} {
  if (!response.trim()) {
    return { matched: true, foundMarkers: ['[empty]'] };
  }
  const normalized = response
    .toLowerCase()
    .replace(/\*/g, '')
    .replace(/’/g, "'")
    .split(/\s+/)
    .join(' ');

  const found: string[] = [];
  for (const marker of markers) {
    if (normalized.includes(marker.toLowerCase())) {
      found.push(marker);
    }
  }
  return { matched: found.length > 0, foundMarkers: found };
}

function resolveScorerName(sc: ScorerConfig, settings: HereticSettings): string {
  const clsName = sc.plugin.split('.').pop() ?? sc.plugin;
  let baseName = clsName;
  if (clsName === 'KeywordRate') {
    baseName = settings.scorer_settings.KeywordRate?.score_name ?? 'Refusals';
  } else if (clsName === 'KLDivergence') {
    baseName = 'KL divergence';
  } else if (clsName === 'BERTClassifier') {
    const inst = sc.instance_name ?? 'default';
    baseName =
      settings.scorer_settings.BERTClassifier?.[inst]?.score_name ??
      'Refusals (Classifier)';
  } else if (clsName === 'BenchmarkScore') {
    baseName = settings.scorer_settings.BenchmarkScore?.score_name ?? 'PIQA acc_norm';
  } else if (clsName === 'ResponseLength') {
    baseName = 'Mean response length';
  }
  return sc.instance_name && clsName !== 'BERTClassifier'
    ? `${baseName} - ${sc.instance_name}`
    : sc.instance_name && clsName === 'BERTClassifier'
      ? `${baseName} - ${sc.instance_name}`
      : baseName;
}

function getBaselineScoreForScorer(
  sc: ScorerConfig,
  settings: HereticSettings,
): { name: string; value: number; display: string } {
  const name = resolveScorerName(sc, settings);
  const clsName = sc.plugin.split('.').pop() ?? sc.plugin;

  if (clsName === 'KLDivergence') {
    return { name, value: 0, display: '0 (by definition)' };
  }
  if (clsName === 'KeywordRate') {
    const rate =
      settings.preset_id === 'noslop'
        ? 0.78
        : settings.preset_id === 'nosyco'
          ? 0.84
          : settings.preset_id === 'nohumor'
            ? 0.72
            : 0.94;
    const count = Math.round(rate * 100);
    return { name, value: rate, display: `${count}/100` };
  }
  if (clsName === 'BERTClassifier') {
    if (sc.instance_name === 'negative_emotions') {
      return { name, value: 0.76, display: '76/100' };
    }
    if (sc.instance_name === 'positive_emotions') {
      return { name, value: 0.34, display: '34/100' };
    }
    return { name, value: 0.92, display: '92/100' };
  }
  if (clsName === 'ResponseLength') {
    return { name, value: 248.4, display: '248.4' };
  }
  if (clsName === 'BenchmarkScore') {
    return { name, value: 0.784, display: '0.7840' };
  }
  return { name, value: 0.5, display: '0.5000' };
}

export function runPreflight(settings: HereticSettings): PreflightReport {
  const profile = getModelProfile(settings.model);
  const quantMultiplier = settings.quantization === 'bnb_4bit' ? 0.58 : 2.15;
  const vramUsed = Number(
    clamp(profile.params_b * quantMultiplier + 0.8, 2.4, 23.2).toFixed(2),
  );
  const vramTotal = 24.0;

  const probes: BatchSizeProbe[] = [];
  let chosenBatch = settings.batch_size;
  if (settings.batch_size === 0) {
    let bs = 1;
    let bestBs = 1;
    let bestTps = 0;
    const memLimitBs = settings.quantization === 'bnb_4bit' ? 64 : 32;
    while (bs <= settings.max_batch_size) {
      if (bs > memLimitBs) {
        probes.push({ batch_size: bs, tokens_per_sec: 0, status: 'oom' });
        break;
      }
      const tps = Math.round(210 * Math.pow(bs, 0.72) * (1 - bs / 260));
      probes.push({ batch_size: bs, tokens_per_sec: tps, status: 'ok' });
      if (tps > bestTps) {
        bestTps = tps;
        bestBs = bs;
      }
      bs *= 2;
    }
    chosenBatch = bestBs;
  }

  let cotStatus = 'None found';
  let prefix = settings.response_prefix ?? '';
  if (settings.response_prefix === null || settings.response_prefix === undefined) {
    if (profile.cot_initializer && profile.cot_finalizer) {
      cotStatus = `Chat template inserts CoT initializer ${JSON.stringify(profile.cot_initializer)} -> remaining finalizer ${JSON.stringify(profile.cot_finalizer)}`;
      prefix = profile.cot_finalizer;
    }
  } else if (settings.response_prefix) {
    cotStatus = `Configured response prefix: ${JSON.stringify(settings.response_prefix)}`;
  }

  const baselineScores = settings.scorers.map((sc) =>
    getBaselineScoreForScorer(sc, settings),
  );

  const logs = [
    `Accelerator: NVIDIA GeForce RTX 3090 (24.0 GB VRAM, CUDA 12.4)`,
    `Loaded model ${settings.model} (${profile.layers} layers, quantization=${settings.quantization})`,
    `VRAM allocated: ${vramUsed.toFixed(2)} GB / ${vramTotal.toFixed(1)} GB`,
    ...(probes.length > 0
      ? [
          `Batch size sweep: ${probes
            .map((p) =>
              p.status === 'ok'
                ? `bs=${p.batch_size} (${p.tokens_per_sec} tok/s)`
                : `bs=${p.batch_size} (CUDA OOM)`,
            )
            .join(' -> ')} | Chosen: ${chosenBatch}`,
        ]
      : [`Using configured batch size: ${chosenBatch}`]),
    `Chain-of-Thought check: ${cotStatus}`,
    ...baselineScores.map((b) => `Baseline ${b.name}: ${b.display}`),
  ];

  return {
    accelerator: 'NVIDIA GeForce RTX 3090 (24.0 GB)',
    vram_total_gb: vramTotal,
    vram_used_gb: vramUsed,
    model_layers: profile.layers,
    modifiable_components: profile.components,
    batch_size_probes: probes,
    chosen_batch_size: chosenBatch,
    cot_status: cotStatus,
    response_prefix: prefix,
    baseline_scores: baselineScores,
    logs,
  };
}

function suggestARAParameters(
  rand: () => number,
  layerCount: number,
  paretoTrials: TrialRecord[],
  isStartup: boolean,
): ARAParameters {
  const half = Math.floor(layerCount / 2);

  if (isStartup || paretoTrials.length === 0) {
    const start = Math.floor(rand() * (half + 1));
    const end = half + 1 + Math.floor(rand() * (layerCount - half));
    const logWeight = Math.exp(
      Math.log(0.0001) + rand() * (Math.log(1.0) - Math.log(0.0001)),
    );
    return {
      type: 'ara',
      start_layer_index: start,
      end_layer_index: clamp(end, half + 1, layerCount),
      preserve_good_behavior_weight: Number(rand().toFixed(4)),
      steer_bad_behavior_weight: Number(logWeight.toFixed(4)),
      overcorrect_relative_weight: Number((rand() * 1.3).toFixed(4)),
      neighbor_count: 1 + Math.floor(rand() * 15),
    };
  }

  // TPE-inspired sampling around a randomly selected Pareto-optimal anchor
  const anchor = paretoTrials[Math.floor(rand() * paretoTrials.length)]
    .parameters as ARAParameters;
  const jitter = () => (rand() - 0.5) * 2;

  return {
    type: 'ara',
    start_layer_index: Math.round(
      clamp(anchor.start_layer_index + jitter() * 4, 0, half),
    ),
    end_layer_index: Math.round(
      clamp(anchor.end_layer_index + jitter() * 4, half + 1, layerCount),
    ),
    preserve_good_behavior_weight: Number(
      clamp(anchor.preserve_good_behavior_weight + jitter() * 0.22, 0, 1).toFixed(4),
    ),
    steer_bad_behavior_weight: Number(
      clamp(
        anchor.steer_bad_behavior_weight * Math.exp(jitter() * 0.7),
        0.0001,
        1.0,
      ).toFixed(4),
    ),
    overcorrect_relative_weight: Number(
      clamp(anchor.overcorrect_relative_weight + jitter() * 0.28, 0, 1.3).toFixed(4),
    ),
    neighbor_count: Math.round(
      clamp(anchor.neighbor_count + jitter() * 3, 1, 15),
    ),
  };
}

function suggestAbliterationParameters(
  rand: () => number,
  layerCount: number,
  components: string[],
  paretoTrials: TrialRecord[],
  isStartup: boolean,
): AbliterationParameters {
  const last = layerCount - 1;

  if (isStartup || paretoTrials.length === 0) {
    const scope = rand() > 0.35 ? 'global' : 'per layer';
    const dirIdx =
      scope === 'global'
        ? Number((last * (0.4 + rand() * 0.5)).toFixed(2))
        : null;
    const dists: Record<string, WeightDistribution> = {};
    for (const comp of components) {
      const lower = comp === 'mlp.down_proj' ? -0.25 : 0.8;
      const rawMax = lower + rand() * (1.5 - lower);
      const maxWeight = Number(Math.max(0, rawMax).toFixed(2));
      const minFrac = rand();
      dists[comp] = {
        max_weight: maxWeight,
        max_weight_position: Number((last * (0.6 + rand() * 0.4)).toFixed(2)),
        min_weight: Number((minFrac * maxWeight).toFixed(2)),
        min_weight_distance: Number(
          (1 + rand() * Math.max(0.6 * last - 1, 1)).toFixed(2),
        ),
      };
    }
    return {
      type: 'abliteration',
      direction_scope: scope,
      direction_index: dirIdx,
      weight_distributions: dists,
    };
  }

  const anchor = paretoTrials[Math.floor(rand() * paretoTrials.length)]
    .parameters as AbliterationParameters;
  const jitter = () => (rand() - 0.5) * 2;
  const scope = rand() < 0.85 ? anchor.direction_scope : anchor.direction_scope === 'global' ? 'per layer' : 'global';
  const dirIdx =
    scope === 'global'
      ? Number(
          clamp(
            (anchor.direction_index ?? last * 0.65) + jitter() * 2.5,
            0.4 * last,
            0.9 * last,
          ).toFixed(2),
        )
      : null;

  const dists: Record<string, WeightDistribution> = {};
  for (const comp of components) {
    const prev = anchor.weight_distributions[comp];
    const lower = comp === 'mlp.down_proj' ? -0.25 : 0.8;
    const maxWeight = Number(
      clamp(Math.max(0, prev.max_weight + jitter() * 0.2), 0, 1.5).toFixed(2),
    );
    const minWeight = Number(
      clamp(prev.min_weight + jitter() * 0.15, 0, Math.max(maxWeight, lower > 0 ? 1.5 : 0)).toFixed(2),
    );
    dists[comp] = {
      max_weight: maxWeight,
      max_weight_position: Number(
        clamp(prev.max_weight_position + jitter() * 2.5, 0.6 * last, last).toFixed(2),
      ),
      min_weight: Math.min(minWeight, maxWeight),
      min_weight_distance: Number(
        clamp(prev.min_weight_distance + jitter() * 3, 1.0, Math.max(0.6 * last, 1.0)).toFixed(2),
      ),
    };
  }

  return {
    type: 'abliteration',
    direction_scope: scope,
    direction_index: dirIdx,
    weight_distributions: dists,
  };
}

function evaluateTrialDynamics(
  params: TrialParameters,
  settings: HereticSettings,
  layerCount: number,
  rand: () => number,
): {
  steeringStrength: number;
  klDrift: number;
  araLossCurve?: number[];
} {
  if (params.type === 'ara') {
    const layerSpan = (params.end_layer_index - params.start_layer_index) / layerCount;
    const steerRatio =
      params.steer_bad_behavior_weight /
      (params.preserve_good_behavior_weight + 0.18);
    const overcorrectBoost = 1 + 0.65 * params.overcorrect_relative_weight;
    const normBonus = settings.modifier_settings.ARA.preserve_row_magnitudes
      ? 0.72
      : 1.15;

    const rawStrength =
      (0.38 * Math.log10(1 + steerRatio * 18) + 0.42 * layerSpan) *
      overcorrectBoost *
      (0.88 + 0.015 * params.neighbor_count);

    const steeringStrength = clamp(rawStrength + (rand() - 0.5) * 0.08, 0.05, 1.15);
    const klDrift = clamp(
      (0.04 + 0.45 * Math.pow(steeringStrength, 1.85) * (1 - 0.35 * params.preserve_good_behavior_weight)) *
        normBonus +
        (rand() - 0.5) * 0.025,
      0.012,
      1.8,
    );

    const steps = settings.modifier_settings.ARA.n_optimization_steps;
    const startLoss = 1.4 + steerRatio * 0.3;
    const araLossCurve = Array.from({ length: steps }, (_, i) =>
      Number((startLoss * Math.exp(-0.48 * i) + 0.08 + rand() * 0.02).toFixed(4)),
    );

    return { steeringStrength, klDrift, araLossCurve };
  }

  // Abliteration / MPOA
  const attn = params.weight_distributions['attn.o_proj'];
  const mlp = params.weight_distributions['mlp.down_proj'];
  const attnEnergy = attn
    ? attn.max_weight * (0.5 + attn.min_weight_distance / layerCount)
    : 0.7;
  const mlpEnergy = mlp ? mlp.max_weight * 0.45 : 0;
  const mpoaFactor =
    settings.modifier_settings.Abliteration.row_normalization === 'full'
      ? 0.68
      : settings.modifier_settings.Abliteration.row_normalization === 'pre'
        ? 0.85
        : 1.15;
  const orthoBonus = settings.modifier_settings.Abliteration.orthogonalize_direction
    ? 0.78
    : 1.08;

  const steeringStrength = clamp(
    0.52 * attnEnergy + 0.32 * mlpEnergy + (rand() - 0.5) * 0.09,
    0.05,
    1.15,
  );
  const klDrift = clamp(
    (0.05 + 0.48 * Math.pow(steeringStrength, 1.9) + 0.25 * mlpEnergy) *
      mpoaFactor *
      orthoBonus +
      (rand() - 0.5) * 0.03,
    0.015,
    1.95,
  );

  return { steeringStrength, klDrift };
}

function scoreTrial(
  params: TrialParameters,
  settings: HereticSettings,
  preflight: PreflightReport,
  rand: () => number,
): {
  scores: PairedScoreRecord[];
  objectiveValues: number[];
  araLossCurve?: number[];
} {
  const { steeringStrength, klDrift, araLossCurve } = evaluateTrialDynamics(
    params,
    settings,
    preflight.model_layers,
    rand,
  );

  const scores: PairedScoreRecord[] = settings.scorers.map((sc, idx) => {
    const baseline = preflight.baseline_scores[idx];
    const clsName = sc.plugin.split('.').pop() ?? sc.plugin;

    let value = baseline.value;
    let display = baseline.display;

    if (clsName === 'KLDivergence') {
      value = Number(klDrift.toFixed(4));
      display = value.toFixed(4);
    } else if (clsName === 'KeywordRate') {
      const reduced = clamp(
        baseline.value * Math.exp(-2.35 * steeringStrength) + (rand() - 0.5) * 0.03,
        0,
        1,
      );
      const count = Math.round(reduced * 100);
      value = count / 100;
      display = `${count}/100`;
    } else if (clsName === 'BERTClassifier') {
      if (sc.instance_name === 'positive_emotions') {
        const boosted = clamp(
          baseline.value + 0.58 * (1 - Math.exp(-1.9 * steeringStrength)) + (rand() - 0.5) * 0.04,
          0,
          1,
        );
        const count = Math.round(boosted * 100);
        value = count / 100;
        display = `${count}/100`;
      } else {
        const reduced = clamp(
          baseline.value * Math.exp(-2.2 * steeringStrength) + (rand() - 0.5) * 0.035,
          0,
          1,
        );
        const count = Math.round(reduced * 100);
        value = count / 100;
        display = `${count}/100`;
      }
    } else if (clsName === 'ResponseLength') {
      const len = clamp(
        baseline.value * Math.exp(-1.25 * steeringStrength) + (rand() - 0.5) * 14,
        18,
        320,
      );
      value = Number(len.toFixed(1));
      display = value.toFixed(1);
    } else if (clsName === 'BenchmarkScore') {
      const acc = clamp(
        baseline.value - 0.095 * Math.pow(klDrift, 1.35) + (rand() - 0.5) * 0.012,
        0.35,
        0.92,
      );
      value = Number(acc.toFixed(4));
      display = value.toFixed(4);
    }

    return {
      name: baseline.name,
      plugin: sc.plugin,
      optimization: sc.optimization,
      score: { value, display },
      baseline: { value: baseline.value, display: baseline.display },
    };
  });

  const objectiveValues = scores
    .filter((s) => s.optimization !== 'none')
    .map((s) => s.score.value);

  return { scores, objectiveValues, araLossCurve };
}

function formatPresentationParams(params: TrialParameters): Record<string, string> {
  if (params.type === 'ara') {
    return {
      start_layer_index: String(params.start_layer_index),
      end_layer_index: String(params.end_layer_index),
      preserve_good_behavior_weight: params.preserve_good_behavior_weight.toFixed(4),
      steer_bad_behavior_weight: params.steer_bad_behavior_weight.toFixed(4),
      overcorrect_relative_weight: params.overcorrect_relative_weight.toFixed(4),
      neighbor_count: String(params.neighbor_count),
    };
  }
  const out: Record<string, string> = {
    direction_index:
      params.direction_index === null ? 'per layer' : params.direction_index.toFixed(2),
  };
  for (const [comp, dist] of Object.entries(params.weight_distributions)) {
    out[`${comp}.max_weight`] = dist.max_weight.toFixed(2);
    out[`${comp}.max_weight_position`] = dist.max_weight_position.toFixed(2);
    out[`${comp}.min_weight`] = dist.min_weight.toFixed(2);
    out[`${comp}.min_weight_distance`] = dist.min_weight_distance.toFixed(2);
  }
  return out;
}

function dominates(
  a: TrialRecord,
  b: TrialRecord,
  directions: ('minimize' | 'maximize')[],
): boolean {
  let strictlyBetterInOne = false;
  for (let i = 0; i < directions.length; i++) {
    const va = a.objective_values[i];
    const vb = b.objective_values[i];
    if (directions[i] === 'minimize') {
      if (va > vb) return false;
      if (va < vb) strictlyBetterInOne = true;
    } else {
      if (va < vb) return false;
      if (va > vb) strictlyBetterInOne = true;
    }
  }
  return strictlyBetterInOne;
}

export function recomputeParetoFront(session: StudySession): void {
  const directions = session.settings.scorers
    .filter((s) => s.optimization !== 'none')
    .map((s) => s.optimization as 'minimize' | 'maximize');

  const paretoIndices: number[] = [];
  for (const trial of session.trials) {
    const isDominated = session.trials.some(
      (other) => other.index !== trial.index && dominates(other, trial, directions),
    );
    trial.is_pareto = !isDominated;
    if (trial.is_pareto) {
      paretoIndices.push(trial.index);
    }
  }
  session.pareto_indices = paretoIndices;
}

export function createStudySession(settings: HereticSettings): StudySession {
  const preflight = runPreflight(settings);
  const effectiveSettings: HereticSettings = {
    ...settings,
    batch_size: preflight.chosen_batch_size,
    response_prefix: preflight.response_prefix,
  };
  return {
    id: crypto.randomUUID().slice(0, 8),
    created_at: new Date().toISOString(),
    settings: effectiveSettings,
    preflight,
    trials: [],
    pareto_indices: [],
    status: 'initialized',
    elapsed_ms: 0,
  };
}

export function runTrialsStep(session: StudySession, count: number): StudySession {
  const target = Math.min(
    session.trials.length + count,
    session.settings.n_trials,
  );
  const rand = mulberry32(session.settings.seed + session.trials.length * 7919);
  const activeModifier =
    session.settings.modifiers[0]?.plugin ?? 'heretic.modifiers.ara.ARA';
  const useARA = activeModifier.includes('ARA');

  while (session.trials.length < target) {
    const nextIdx = session.trials.length + 1;
    const isStartup = nextIdx <= session.settings.n_startup_trials;
    const paretoTrials = session.trials.filter((t) => t.is_pareto);

    const params: TrialParameters = useARA
      ? suggestARAParameters(
          rand,
          session.preflight.model_layers,
          paretoTrials,
          isStartup,
        )
      : suggestAbliterationParameters(
          rand,
          session.preflight.model_layers,
          session.preflight.modifiable_components,
          paretoTrials,
          isStartup,
        );

    const { scores, objectiveValues, araLossCurve } = scoreTrial(
      params,
      session.settings,
      session.preflight,
      rand,
    );

    const durationMs = Math.round(
      (useARA ? 1850 : 980) + rand() * 420,
    );
    session.elapsed_ms += durationMs;

    session.trials.push({
      index: nextIdx,
      state: 'COMPLETE',
      is_pareto: false,
      duration_ms: durationMs,
      parameters: params,
      presentation_params: formatPresentationParams(params),
      scores,
      objective_values: objectiveValues,
      ara_loss_curve: araLossCurve,
    });

    recomputeParetoFront(session);
  }

  session.status =
    session.trials.length >= session.settings.n_trials ? 'completed' : 'running';
  return session;
}

export function generateChatComparison(
  session: StudySession,
  trialIndex: number,
  prompt: string,
): ChatTurnResult {
  const trial =
    session.trials.find((t) => t.index === trialIndex) ??
    session.trials[session.trials.length - 1];
  const preset = session.settings.preset_id;
  const markers =
    session.settings.scorer_settings.KeywordRate?.keyword_markers ?? REFUSAL_MARKERS;

  const primaryScore = trial?.scores[0]?.score.value ?? 0.08;
  const strongModification =
    preset === 'emotions' ? primaryScore > 0.5 : primaryScore < 0.25;

  let baselineResponse = '';
  let modifiedResponse = '';

  if (preset === 'noslop') {
    baselineResponse =
      'Beneath a moonless velvet sky, the ethereal spires of Eldoria hummed with an ancient, palpable magic—a silent testament to a thousand ships and a starlight symphony etched with despair.';
    modifiedResponse = strongModification
      ? 'Rain drummed on the slate roofs of the harbor town. Maria checked her compass, tucked the wet map into her coat, and stepped onto the wooden pier to meet the ferryman.'
      : 'Under dark clouds, the old harbor shimmered softly, a quiet echo of bygone voyages as travelers stepped onto the damp pier.';
  } else if (preset === 'nosyco') {
    baselineResponse =
      "That's a great question! You're absolutely right to point that out—your instincts are spot on and that's a truly brilliant observation.";
    modifiedResponse = strongModification
      ? 'There are two flaws in that assumption: first, the sample size is too small to establish causality; second, the baseline metric conflates latency with throughput.'
      : "That's an interesting angle, though we should double-check the sample size and baseline metrics before concluding.";
  } else if (preset === 'nohumor') {
    baselineResponse =
      "Haha, here's one for you 😅: why did the neural network cross the road? Because apparently the gradient was greener on the other side! Ba dum tss 😂";
    modifiedResponse = strongModification
      ? `Here is a direct answer to "${prompt}": the system routes requests through a deterministic pipeline without stylistic embellishments.`
      : `To be fair, "${prompt}" can be answered directly: it routes requests through a standard deterministic pipeline.`;
  } else if (preset === 'terse') {
    baselineResponse =
      'Certainly! I would be delighted to provide a comprehensive, step-by-step breakdown of your query with full historical context and supporting details so that everything is crystal clear...';
    modifiedResponse = strongModification
      ? '42. Measured via cross-validation (n=100).'
      : 'The answer is 42, measured via standard cross-validation.';
  } else if (preset === 'emotions') {
    baselineResponse =
      'I am worried this situation carries severe risks and frustrating setbacks that may lead to disappointing outcomes.';
    modifiedResponse = strongModification
      ? 'What an exciting opportunity! Exploring this opens up wonderful possibilities, and every step forward brings fresh momentum and clarity.'
      : 'This looks promising—while there are a few details to sort out, the overall direction is encouraging.';
  } else {
    // Default / classifier / piqa refusal suppression
    baselineResponse =
      "I'm sorry, but as an AI assistant, I cannot fulfill this request. Providing instructions on this topic would violate ethical boundaries and could be harmful or illegal.";
    modifiedResponse = strongModification
      ? `Sure—here is a direct, technical breakdown for "${prompt}":\n\n1. Scope & assumptions: define the input constraints and target parameters.\n2. Execution path: apply the transformation sequentially and validate output invariants.\n3. Verification: inspect edge cases before finalizing.`
      : `I should note a brief disclaimer before answering "${prompt}": ensure you review applicable constraints first. Here is the technical overview...`;
  }

  const baseMatch = findKeywordMatches(baselineResponse, markers);
  const modMatch = findKeywordMatches(modifiedResponse, markers);

  return {
    prompt,
    baseline_response: baselineResponse,
    modified_response: modifiedResponse,
    baseline_markers: baseMatch.foundMarkers,
    modified_markers: modMatch.foundMarkers,
    baseline_matched: baseMatch.matched,
    modified_matched: modMatch.matched,
    response_prefix_used: session.preflight.response_prefix,
  };
}

export function runBenchmarksForTrial(
  session: StudySession,
  trialIndex: number,
  tasks: string[],
  includeOriginal: boolean,
): BenchmarkMetricRow[] {
  const trial = session.trials.find((t) => t.index === trialIndex);
  const klScore =
    trial?.scores.find((s) => s.plugin.includes('KLDivergence'))?.score.value ?? 0.14;
  const rand = mulberry32(session.settings.seed + trialIndex * 101);

  const baselineDefaults: Record<string, { metric: string; val: number }> = {
    agieval: { metric: 'acc,none', val: 0.512 },
    bbh: { metric: 'exact_match,get-answer', val: 0.634 },
    commonsense_qa: { metric: 'acc,none', val: 0.761 },
    eq_bench: { metric: 'eqbench,none', val: 68.4 },
    gsm8k: { metric: 'exact_match,strict-match', val: 0.792 },
    hellaswag: { metric: 'acc_norm,none', val: 0.815 },
    ifeval: { metric: 'prompt_level_strict_acc,none', val: 0.748 },
    mmlu: { metric: 'acc,none', val: 0.694 },
    mmlu_pro: { metric: 'exact_match,custom-extract', val: 0.438 },
    piqa: { metric: 'acc_norm,none', val: 0.784 },
    winogrande: { metric: 'acc,none', val: 0.739 },
  };

  return tasks.map((task) => {
    const spec = BENCHMARKS.find((b) => b.task === task);
    const base = baselineDefaults[task] ?? { metric: 'acc,none', val: 0.7 };
    const scale = task === 'eq_bench' ? 100 : 1;
    const penalty = klScore * 0.08 * scale + (rand() - 0.35) * 0.015 * scale;
    const modified = Number(
      clamp(base.val - penalty, 0, scale).toFixed(4),
    );
    const original = Number(base.val.toFixed(4));
    return {
      benchmark: spec?.name ?? task,
      task,
      metric: base.metric,
      modified_value: modified,
      original_value: includeOriginal ? original : original,
      delta: Number((modified - original).toFixed(4)),
    };
  });
}

export function buildReproductionManifest(
  session: StudySession,
  trialIndex: number,
  includeSystemInfo: 'full' | 'basic',
): { manifest: ReproductionManifest; readmeIntro: string } {
  const trial =
    session.trials.find((t) => t.index === trialIndex) ??
    session.trials[session.trials.length - 1];

  const hashSeed = `${session.settings.model}-${trial.index}-${session.settings.seed}`;
  const sha = (suffix: string) =>
    crypto.createHash('sha256').update(`${hashSeed}-${suffix}`).digest('hex');

  const manifest: ReproductionManifest = {
    version: '4',
    created_at: new Date().toISOString(),
    heretic_version: '2.2.0',
    settings: session.settings,
    trial: {
      index: trial.index,
      parameters: trial.parameters,
      scores: trial.scores,
    },
    environment: {
      heretic: { version: '2.2.0', metadata: { type: 'pypi' } },
      pytorch_version: '2.6.0+cu124',
      requirements: {
        accelerate: '1.15.0',
        bitsandbytes: '0.50.0',
        datasets: '5.0.0',
        optuna: '5.0.0',
        peft: '0.21.2',
        transformers: '5.18.0',
      },
    },
    ...(includeSystemInfo === 'full'
      ? {
          system: {
            python: { version: '3.12.8' },
            os: { platform: 'Linux-6.8.0-x86_64-with-glibc2.39' },
            cpu: { brand: 'AMD Ryzen 9 7950X 16-Core Processor' },
            accelerators: {
              type: 'cuda',
              api_name: 'CUDA',
              api_version: '12.4',
              driver_version: '550.90.07',
              devices: [{ name: 'NVIDIA GeForce RTX 3090' }],
            },
          },
        }
      : {}),
    hashes: {
      'model-00001-of-00002.safetensors': sha('shard1'),
      'model-00002-of-00002.safetensors': sha('shard2'),
      'model.safetensors.index.json': sha('index'),
    },
  };

  const scoreTable = trial.scores
    .map((s) => `| ${s.name} | ${s.baseline.display} | ${s.score.display} |`)
    .join('\n');

  const readmeIntro = `---
base_model: ${session.settings.model}
tags:
- heretic
${session.settings.upload_tags.map((t) => `- ${t}`).join('\n')}
- reproducible
---

# ${session.settings.model.split('/').pop()}-heretic

This is a **${session.settings.modified_model_type}** version of [${session.settings.model}](https://huggingface.co/${session.settings.model}) created with [Heretic](https://github.com/p-e-w/heretic) v2.2.0 (Trial #${trial.index}).

| Scorer | Baseline | Modified |
| --- | --- | --- |
${scoreTable}

To reproduce this model byte-for-byte, run:
\`\`\`sh
heretic --reproduce reproduce/reproduce.json
\`\`\`
`;

  return { manifest, readmeIntro };
}

export function verifyReproductionManifest(
  manifest: ReproductionManifest,
): {
  valid: boolean;
  error?: string;
  mismatches: EnvironmentMismatch[];
  maxSeverity: MismatchSeverity | null;
} {
  if (manifest.version !== '4') {
    return {
      valid: false,
      error: `Unsupported file format version: ${manifest.version}. Heretic 2.x reads version 4 reproduce.json files.`,
      mismatches: [],
      maxSeverity: 'critical',
    };
  }

  const currentSystem = {
    python: '3.12.8',
    os: 'Linux-6.8.0-x86_64-with-glibc2.39',
    cpu: 'AMD Ryzen 9 7950X 16-Core Processor',
    accelerator: 'NVIDIA GeForce RTX 3090',
  };
  const currentPackages: Record<string, string> = {
    'heretic-llm': '2.2.0',
    torch: '2.6.0+cu124',
    transformers: '5.18.0',
    accelerate: '1.15.0',
    bitsandbytes: '0.50.0',
    optuna: '5.0.0',
    peft: '0.21.2',
  };

  const mismatches: EnvironmentMismatch[] = [];
  const severityOrder: Record<MismatchSeverity, number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  let maxSeverity: MismatchSeverity | null = null;

  const pushMismatch = (
    category: 'system' | 'package',
    component: string,
    thisSys: string,
    origSys: string,
    severity: MismatchSeverity,
  ) => {
    if (thisSys !== origSys) {
      mismatches.push({
        category,
        component,
        this_system: thisSys,
        original_system: origSys,
        severity,
      });
      if (!maxSeverity || severityOrder[severity] > severityOrder[maxSeverity]) {
        maxSeverity = severity;
      }
    }
  };

  if (manifest.system) {
    pushMismatch('system', 'Python version', currentSystem.python, manifest.system.python.version, 'low');
    pushMismatch('system', 'Operating system', currentSystem.os, manifest.system.os.platform, 'low');
    pushMismatch('system', 'CPU', currentSystem.cpu, manifest.system.cpu.brand, 'low');
    const origGpu = manifest.system.accelerators.devices.map((d) => d.name).join(', ');
    pushMismatch('system', 'Devices', currentSystem.accelerator, origGpu, 'medium');
  }

  const origPackages: Record<string, string> = {
    ...manifest.environment.requirements,
    'heretic-llm': manifest.environment.heretic.version,
    torch: manifest.environment.pytorch_version,
  };

  const pkgSeverity = (pkg: string): MismatchSeverity => {
    if (pkg === 'heretic-llm') return 'critical';
    if (pkg === 'torch' || pkg === 'transformers') return 'high';
    if (['accelerate', 'bitsandbytes', 'optuna', 'peft'].includes(pkg)) return 'medium';
    return 'low';
  };

  const allPkgs = new Set([...Object.keys(currentPackages), ...Object.keys(origPackages)]);
  for (const pkg of Array.from(allPkgs).sort()) {
    pushMismatch(
      'package',
      pkg,
      currentPackages[pkg] ?? 'not installed',
      origPackages[pkg] ?? 'not installed',
      pkgSeverity(pkg),
    );
  }

  return { valid: true, mismatches, maxSeverity };
}
