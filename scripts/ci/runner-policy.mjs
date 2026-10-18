export const projects = ['Sandline', 'Hundred-Acre-Learning', 'Gunball'];
export const labels = ['self-hosted', 'linux', 'x64', 'project-ci'];
export function readyRunners(project, metadata, pages) {
  if (!projects.includes(project)) throw Error('Unsupported project');
  if (metadata.full_name !== `JoshuaLRay/${project}` || metadata.private !== true)
    throw Error('Only the named private owner repository may use this runner');
  if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page.runners)))
    throw Error('Invalid runner inventory');
  const online = pages.flatMap(page => page.runners).filter(runner =>
    runner.status === 'online' && labels.every(label => runner.labels?.some(
      actual => actual.name?.toLowerCase() === label)));
  if (!online.length) throw Error('No matching online runner; routing was not changed');
  return online;
}
