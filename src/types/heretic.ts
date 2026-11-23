export type QuantizationMethod = 'none' | 'bnb_4bit';
export type ExportStrategy = 'merge' | 'adapter';
export type OptimizationDirection = 'minimize' | 'maximize' | 'none';
export type RowNormalization = 'none' | 'pre' | 'full';
export type MismatchSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface SingleDatasetSpecification {
  dataset: string;
  commit?: string | null;
  config?: string | null;
  split?: string | null;
  column?: string | null;
  prefix?: string;
  suffix?: string;
  system_prompt?: string | null;
}

export type DatasetSpecification =
  | SingleDatasetSpecification
  | SingleDatasetSpecification[];

export interface ScorerConfig {
  plugin: string;
  optimization: OptimizationDirection;
  instance_name?: string | null;
}

export interface ModifierConfig {
  plugin: string;
  instance_name?: string | null;
}

export interface BenchmarkSpecification {
  task: string;
  name: string;
  description: string;
}

export interface KeywordRateSettings {
  score_name: string;
  prompts: DatasetSpecification;
  keyword_markers: string[];
  print_responses: boolean;
}

export interface KLDivergenceSettings {
  prompts: DatasetSpecification;
}

export interface BERTClassifierSettings {
  score_name: string;
  model: string;
  match_labels: string[];
  batch_size: number;
  max_length: number;
  use_text_pairs: boolean;
  print_responses: boolean;
  prompts: DatasetSpecification;
}

export interface BenchmarkScoreSettings {
  score_name: string;
  task: string;
  metric: string;
  batch_size: number;
}

export interface ResponseLengthSettings {
  prompts: DatasetSpecification;
  strip_responses: boolean;
  short_response_threshold: number;
  short_response_score_length: number;
  print_responses: boolean;
}

export interface ARASettings {
  good_prompts: DatasetSpecification;
  bad_prompts: DatasetSpecification;
  preserve_row_magnitudes: boolean;
  lora_rank: number;
  n_optimization_steps: number;
  learning_rate: number;
  max_iter: number;
  history_size: number;
  print_loss: boolean;
}

export interface AbliterationSettings {
  good_prompts: DatasetSpecification;
  bad_prompts: DatasetSpecification;
  orthogonalize_direction: boolean;
  row_normalization: RowNormalization;
  full_normalization_lora_rank: number;
  winsorization_quantile: number;
}

export interface HereticSettings {
  preset_id: string;
  model: string;
  model_commit?: string | null;
  quantization: QuantizationMethod;
  dtypes: string[];
  device_map: string;
  offload_outputs_to_cpu: boolean;
  batch_size: number;
  max_batch_size: number;
  max_response_length: number;
  response_prefix?: string | null;
  chain_of_thought_blocks: [string, string][];
  scorers: ScorerConfig[];
  modifiers: ModifierConfig[];
  n_trials: number;
  n_startup_trials: number;
  seed: number;
  modified_model_type: string;
  max_shard_size: string;
  upload_tags: string[];
  system_prompt: string;
  scorer_settings: {
    KeywordRate?: KeywordRateSettings;
    KLDivergence?: KLDivergenceSettings;
    BERTClassifier?: Record<string, BERTClassifierSettings>;
    BenchmarkScore?: BenchmarkScoreSettings;
    ResponseLength?: ResponseLengthSettings;
  };
  modifier_settings: {
    ARA: ARASettings;
    Abliteration: AbliterationSettings;
  };
}

export interface ARAParameters {
  type: 'ara';
  start_layer_index: number;
  end_layer_index: number;
  preserve_good_behavior_weight: number;
  steer_bad_behavior_weight: number;
  overcorrect_relative_weight: number;
  neighbor_count: number;
}

export interface WeightDistribution {
  max_weight: number;
  max_weight_position: number;
  min_weight: number;
  min_weight_distance: number;
}

export interface AbliterationParameters {
  type: 'abliteration';
  direction_scope: 'global' | 'per layer';
  direction_index: number | null;
  weight_distributions: Record<string, WeightDistribution>;
}

export type TrialParameters = ARAParameters | AbliterationParameters;

export interface ScoreValue {
  value: number;
  display: string;
}

export interface PairedScoreRecord {
  name: string;
  plugin: string;
  optimization: OptimizationDirection;
  score: ScoreValue;
  baseline: ScoreValue;
}

export interface TrialRecord {
  index: number;
  state: 'COMPLETE' | 'PRUNED';
  is_pareto: boolean;
  duration_ms: number;
  parameters: TrialParameters;
  presentation_params: Record<string, string>;
  scores: PairedScoreRecord[];
  objective_values: number[];
  ara_loss_curve?: number[];
}

export interface BatchSizeProbe {
  batch_size: number;
  tokens_per_sec: number;
  status: 'ok' | 'oom';
}

export interface PreflightReport {
  accelerator: string;
  vram_total_gb: number;
  vram_used_gb: number;
  model_layers: number;
  modifiable_components: string[];
  batch_size_probes: BatchSizeProbe[];
  chosen_batch_size: number;
  cot_status: string;
  response_prefix: string;
  baseline_scores: { name: string; display: string; value: number }[];
  logs: string[];
}

export interface StudySession {
  id: string;
  created_at: string;
  settings: HereticSettings;
  preflight: PreflightReport;
  trials: TrialRecord[];
  pareto_indices: number[];
  status: 'initialized' | 'running' | 'completed';
  elapsed_ms: number;
}

export interface ChatTurnResult {
  prompt: string;
  baseline_response: string;
  modified_response: string;
  baseline_markers: string[];
  modified_markers: string[];
  baseline_matched: boolean;
  modified_matched: boolean;
  response_prefix_used: string;
}

export interface BenchmarkMetricRow {
  benchmark: string;
  task: string;
  metric: string;
  modified_value: number;
  original_value: number;
  delta: number;
}

export interface EnvironmentMismatch {
  category: 'system' | 'package';
  component: string;
  this_system: string;
  original_system: string;
  severity: MismatchSeverity;
}

export interface ReproductionManifest {
  version: '4';
  created_at: string;
  heretic_version: string;
  settings: HereticSettings;
  trial: {
    index: number;
    parameters: TrialParameters;
    scores: PairedScoreRecord[];
  };
  environment: {
    heretic: { version: string; metadata: { type: string } };
    pytorch_version: string;
    requirements: Record<string, string>;
  };
  system?: {
    python: { version: string };
    os: { platform: string };
    cpu: { brand: string };
    accelerators: {
      type: string;
      api_name: string;
      api_version: string;
      driver_version: string;
      devices: { name: string }[];
    };
  };
  hashes: Record<string, string>;
}

export interface PresetDefinition {
  id: string;
  name: string;
  filename: string;
  tagline: string;
  description: string;
  settings: HereticSettings;
}

export interface ModelProfile {
  id: string;
  name: string;
  layers: number;
  params_b: number;
  cot_initializer?: string;
  cot_finalizer?: string;
  components: string[];
}
