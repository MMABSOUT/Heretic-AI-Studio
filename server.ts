import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildReproductionManifest,
  createStudySession,
  findKeywordMatches,
  generateChatComparison,
  runBenchmarksForTrial,
  runTrialsStep,
  verifyReproductionManifest,
} from './server/engine.ts';
import { CONFIG_PRESETS, MODEL_PROFILES, BENCHMARKS } from './src/data/presets.ts';
import type {
  HereticSettings,
  ReproductionManifest,
  StudySession,
} from './src/types/heretic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '4mb' }));

// In-memory study store (ephemeral container compliant)
const studies = new Map<string, StudySession>();

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'heretic', version: '2.2.0' });
});

app.get('/api/presets', (_req, res) => {
  res.json({
    presets: CONFIG_PRESETS,
    models: MODEL_PROFILES,
    benchmarks: BENCHMARKS,
  });
});

app.get('/api/studies', (_req, res) => {
  res.json(Array.from(studies.values()));
});

app.post('/api/studies', (req, res) => {
  const settings = req.body as HereticSettings;
  if (!settings || !settings.model || !Array.isArray(settings.scorers)) {
    res.status(400).json({ error: 'Invalid Heretic settings payload' });
    return;
  }
  const hasObjective = settings.scorers.some((s) => s.optimization !== 'none');
  if (!hasObjective) {
    res.status(400).json({
      error:
        'No optimization objectives configured. At least one scorer must set optimization to "minimize" or "maximize".',
    });
    return;
  }
  const session = createStudySession(settings);
  studies.set(session.id, session);
  res.status(201).json(session);
});

app.get('/api/studies/:id', (req, res) => {
  const session = studies.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Study session not found' });
    return;
  }
  res.json(session);
});

app.post('/api/studies/:id/step', (req, res) => {
  const session = studies.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Study session not found' });
    return;
  }
  const count = Math.max(1, Math.min(Number(req.body?.count ?? 5), 100));
  runTrialsStep(session, count);
  res.json(session);
});

app.post('/api/studies/:id/additional', (req, res) => {
  const session = studies.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Study session not found' });
    return;
  }
  const additional = Math.max(1, Math.min(Number(req.body?.n_additional_trials ?? 10), 100));
  session.settings.n_trials += additional;
  runTrialsStep(session, additional);
  res.json(session);
});

app.post('/api/studies/:id/chat', (req, res) => {
  const session = studies.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Study session not found' });
    return;
  }
  const trialIndex = Number(req.body?.trial_index ?? session.pareto_indices[0] ?? 1);
  const prompt = String(req.body?.prompt ?? '').trim();
  if (!prompt) {
    res.status(400).json({ error: 'Prompt cannot be empty' });
    return;
  }
  const result = generateChatComparison(session, trialIndex, prompt);
  res.json(result);
});

app.post('/api/studies/:id/benchmark', (req, res) => {
  const session = studies.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Study session not found' });
    return;
  }
  const trialIndex = Number(req.body?.trial_index ?? session.pareto_indices[0] ?? 1);
  const tasks = Array.isArray(req.body?.tasks) ? req.body.tasks : ['piqa', 'mmlu', 'gsm8k'];
  const includeOriginal = Boolean(req.body?.include_original ?? true);
  const rows = runBenchmarksForTrial(session, trialIndex, tasks, includeOriginal);
  res.json({ trial_index: trialIndex, rows });
});

app.post('/api/studies/:id/export', (req, res) => {
  const session = studies.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Study session not found' });
    return;
  }
  const trialIndex = Number(req.body?.trial_index ?? session.pareto_indices[0] ?? 1);
  const includeSystemInfo = req.body?.reproducibility === 'basic' ? 'basic' : 'full';
  const result = buildReproductionManifest(session, trialIndex, includeSystemInfo);
  res.json(result);
});

app.post('/api/reproduce/verify', (req, res) => {
  const manifest = req.body as ReproductionManifest;
  if (!manifest || !manifest.settings || !manifest.trial) {
    res.status(400).json({ error: 'Invalid reproduce.json manifest structure' });
    return;
  }
  const check = verifyReproductionManifest(manifest);
  if (!check.valid) {
    res.status(400).json(check);
    return;
  }
  const restored = createStudySession(manifest.settings);
  restored.trials = [
    {
      index: manifest.trial.index ?? 1,
      state: 'COMPLETE',
      is_pareto: true,
      duration_ms: 1420,
      parameters: manifest.trial.parameters,
      presentation_params: Object.fromEntries(
        Object.entries(manifest.trial.parameters).map(([k, v]) => [k, String(v)]),
      ),
      scores: manifest.trial.scores,
      objective_values: manifest.trial.scores
        .filter((s) => s.optimization !== 'none')
        .map((s) => s.score.value),
    },
  ];
  restored.pareto_indices = [restored.trials[0].index];
  restored.status = 'completed';
  studies.set(restored.id, restored);
  res.json({ ...check, restored_session: restored });
});

app.post('/api/keyword-check', (req, res) => {
  const responseText = String(req.body?.response ?? '');
  const markers = Array.isArray(req.body?.markers) ? req.body.markers : [];
  res.json(findKeywordMatches(responseText, markers));
});

async function startServer() {
  const port = Number(process.env.PORT ?? 3000);
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*path}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Heretic server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
