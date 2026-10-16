// Selection only: do not load settings, credentials, or model catalogs here.
export function selectHubProfile(env = {}, args = []) {
  if (args.some(a => a.startsWith('--set-theory-') && a !== '--set-theory-offline')) throw new Error('UNAPPROVED_HUB_PROFILE');
  const cli = args.includes('--set-theory-offline');
  const selected = cli ? 'set-theory-offline' : (env.CODEX_QQ_PROFILE || 'legacy');
  if (!['legacy', 'set-theory-offline'].includes(selected)) throw new Error('UNAPPROVED_HUB_PROFILE');
  if (selected === 'set-theory-offline' && args.some(a => !['--set-theory-offline', '--once'].includes(a))) {
    throw new Error('UNAPPROVED_TEACHING_ARGUMENT');
  }
  return selected;
}
