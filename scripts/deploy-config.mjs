// Pure helper: derives the Cloudflare upload (worker name + metadata) from wrangler.jsonc. No argv, no repo-folder name.
// Migrations are deliberately NOT sent: class Room already exists at migration tag v1 on the live worker.
// Strings are matched first so "//" inside a string (e.g. a URL) is kept.
export const stripComments = (s) => s.replace(/"(?:\\.|[^"\\])*"|\/\/.*$|\/\*[\s\S]*?\*\//gm, (m) => (m[0] === '"' ? m : ''));

export function deployConfig(wranglerText) {
  const w = JSON.parse(stripComments(wranglerText));
  if (!w.name) throw new Error('wrangler.jsonc has no "name"');
  const bindings = ((w.durable_objects && w.durable_objects.bindings) || [])
    .map((b) => ({ type: 'durable_object_namespace', name: b.name, class_name: b.class_name }));
  return { name: w.name, metadata: { main_module: 'worker.js', compatibility_date: w.compatibility_date, bindings } };
}
