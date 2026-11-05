import { prepareScenario, evaluateCandidates, topPaths, sensitivityNotes } from './engine.js';

self.onmessage = (event) => {
  const { type, rawState, rule, options } = event.data || {};
  if (type !== 'evaluate') return;
  try {
    const scenario = prepareScenario(rawState, rule);
    const result = evaluateCandidates(scenario, options, (done, total, candidate) => {
      self.postMessage({ type: 'progress', done, total, tile: candidate?.tile ?? null });
    });
    const serializable = {
      ...result,
      candidates: result.candidates.map((c) => {
        const { hand, simulation, ...rest } = c;
        return { ...rest, paths: hand ? topPaths(scenario, c, 5) : [] };
      }),
      sensitivity: sensitivityNotes(result),
      scenarioMeta: {
        shanten: scenario.analysis.shanten,
        isWin: scenario.analysis.isWin,
        waits: scenario.analysis.waits,
        voidInfo: scenario.analysis.voidInfo,
        currentScore: scenario.currentScore,
        paths: scenario.paths,
      },
    };
    self.postMessage({ type: 'result', result: serializable });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || String(error), stack: error?.stack || '' });
  }
};
