import { selectHubProfile } from '../config/teaching-profile.js';

export async function launchHub({ env = process.env, args = process.argv.slice(2),
  loadLegacy = () => import('../server.js'),
  startTeaching = async () => (await import('../../profiles/set-theory/hub-smoke.mjs')).runHubSmoke()
} = {}) {
  const profile = selectHubProfile(env, args);
  // Branch BEFORE importing the legacy composition root, which starts background
  // tasks and probes signed-in agent state. Offline mode must never import it.
  return profile === 'legacy' ? loadLegacy() : startTeaching();
}
