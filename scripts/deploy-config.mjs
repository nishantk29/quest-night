// Pure helper: derives the Cloudflare upload (worker name + metadata) from wrangler.jsonc. No argv, no repo-folder name.
// Migrations are deliberately NOT sent: class Room already exists at migration tag v1 on the live worker.
// Every binding wrangler.jsonc declares is uploaded (Durable Objects, Workers AI, vars), except the assets binding:
// the embedded build (scripts/build-embedded.mjs) serves public/ itself and passes ASSETS to the worker. A binding kind
// this file doesn't know makes deployConfig throw, so a new binding can never be dropped from a deploy without notice.
// workers.dev: the deploy sets the worker's workers.dev route and preview URLs to exactly what wrangler.jsonc says
// ("workers_dev" and "preview_urls", both required booleans). Nothing defaults to on.
// Strings are matched first so "//" inside a string (e.g. a URL) is kept.
export const stripComments = (s) => s.replace(/"(?:\\.|[^"\\])*"|\/\/.*$|\/\*[\s\S]*?\*\//gm, (m) => (m[0] === '"' ? m : ''));

export const AI_MODES = ['off', 'dark', 'on'];
// wrangler.jsonc keys that declare bindings this uploader does not support yet.
export const UNSUPPORTED_BINDING_KEYS = ['kv_namespaces', 'd1_databases', 'r2_buckets', 'services', 'queues', 'vectorize', 'hyperdrive',
  'browser', 'analytics_engine_datasets', 'send_email', 'mtls_certificates', 'dispatch_namespaces', 'workflows', 'images',
  'version_metadata', 'tail_consumers', 'pipelines', 'secrets_store_secrets', 'unsafe'];

export function deployConfig(wranglerText) {
  const w = JSON.parse(stripComments(wranglerText));
  if (!w.name) throw new Error('wrangler.jsonc has no "name"');
  for (const k of UNSUPPORTED_BINDING_KEYS) if (w[k] !== undefined) throw new Error(`wrangler.jsonc declares "${k}", which scripts/deploy-config.mjs does not upload yet; add it there`);
  const bindings = ((w.durable_objects && w.durable_objects.bindings) || [])
    .map((b) => ({ type: 'durable_object_namespace', name: b.name, class_name: b.class_name }));
  if (w.ai) {
    if (!w.ai.binding) throw new Error('wrangler.jsonc "ai" has no "binding"');
    bindings.push({ type: 'ai', name: w.ai.binding });
  }
  for (const [name, value] of Object.entries(w.vars || {})) {
    if (typeof value !== 'string') throw new Error(`var ${name} must be a string`);
    if (name === 'AI_MODE' && !AI_MODES.includes(value)) throw new Error(`AI_MODE must be ${AI_MODES.join('|')}, got ${value}`);
    bindings.push({ type: 'plain_text', name, text: value });
  }
  for (const k of ['workers_dev', 'preview_urls']) if (typeof w[k] !== 'boolean') throw new Error(`wrangler.jsonc must set "${k}" to true or false (match the live worker); the deploy never guesses it`);
  const workersDev = { enabled: w.workers_dev, previews_enabled: w.preview_urls };
  return { name: w.name, metadata: { main_module: 'worker.js', compatibility_date: w.compatibility_date, bindings }, workersDev };
}

// The text of the Cloudflare-API deploy function file (what build-deploy.mjs writes).
export function deployFunction({ name, metadata, worker, workersDev }) {
  if (!workersDev || typeof workersDev.enabled !== 'boolean' || typeof workersDev.previews_enabled !== 'boolean') throw new Error('deployFunction needs workersDev { enabled, previews_enabled } from deployConfig');
  const subBody = JSON.stringify({ enabled: workersDev.enabled, previews_enabled: workersDev.previews_enabled });
  return `async () => { const ACC="a3303cef4b0984b2859ef104bd74df1e"; const NAME=${JSON.stringify(name)}; const WORKER=${JSON.stringify(worker)};
 const metadata = ${JSON.stringify(metadata)};
 const B = '----cn' + Date.now();
 const body = ['--' + B, 'Content-Disposition: form-data; name="metadata"', 'Content-Type: application/json', '', JSON.stringify(metadata),
   '--' + B, 'Content-Disposition: form-data; name="worker.js"; filename="worker.js"', 'Content-Type: application/javascript+module', '', WORKER, '--' + B + '--', ''].join('\\r\\n');
 const put = await cloudflare.request({ method: 'PUT', path: '/accounts/' + ACC + '/workers/scripts/' + NAME, body, contentType: 'multipart/form-data; boundary=' + B, rawBody: true });
 const sub = await cloudflare.request({ method: 'POST', path: '/accounts/' + ACC + '/workers/scripts/' + NAME + '/subdomain', body: ${subBody} });
 return { script: put.success, errors: put.errors, etag: put.result && put.result.etag, subdomain: sub.success };
}`;
}

// Reads the workers.dev settings the deploy function would POST (also from older files that wrote a JS object literal).
export const workersDevOf = (fnText) => JSON.parse(/\n const sub = await cloudflare\.request\(\{ method: 'POST', path: [^\n]*\/subdomain', body: (\{[^\n]*?\}) \}\);\n/.exec(fnText)[1].replace(/([{,]\s*)([A-Za-z_]+)\s*:/g, '$1"$2":'));

// Reads the metadata back out of a deploy function file. WORKER is a JSON string (no raw newlines), so the only
// line that starts with " const metadata = " is the real one.
export const metadataOf = (fnText) => JSON.parse(/\n const metadata = (.*);\n/.exec(fnText)[1]);
