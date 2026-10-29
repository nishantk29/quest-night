// Styled error pages for the Worker (404, 500, 426) and the static public/404.html (scripts/build-404.mjs).
// No error text ever reaches the page: only the fixed title and line passed in.
import { errorBody } from '../public/js/error-screen.js';

const CSS = `.err-page{min-height:100svh;display:grid;align-content:center}
.err-mark{display:block;text-align:center;font-family:var(--display-serif);font-size:var(--fs-lg);letter-spacing:.06em;color:var(--brass);padding-top:var(--s5)}
.err-page .empty{gap:var(--s4);justify-items:center;text-align:center}
@media (prefers-reduced-motion:no-preference){.err-page .empty>*{animation:err-rise calc(.5s * var(--dur-scale)) var(--ease-out) both}.err-page .empty>:nth-child(2){animation-delay:calc(.06s * var(--dur-scale))}.err-page .empty>:nth-child(3){animation-delay:calc(.12s * var(--dur-scale))}}
@keyframes err-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`;

export const ERRORS = {
  404: { title: 'Page not found', line: 'The page you wanted isn’t here. Head back to the games.' },
  426: { title: 'Wrong door', line: 'That address is for the game itself. Open the game from the home page.' },
  500: { title: 'Something broke', line: 'The quest took an unexpected turn. Try again in a moment.' },
};

export const errorPage = ({ status = 404, title, line } = {}) => {
  const d = ERRORS[status] || ERRORS[500];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title || d.title} | Quest Night</title>
<meta name="robots" content="noindex">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0B0B0D">
<style>html{background:#0B0B0D;color-scheme:dark}</style>
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/theme.css">
<link rel="stylesheet" href="/redesign.css">
<style>${CSS}</style>
</head>
<body>
<div class="err-mark" aria-hidden="true">Quest Night</div>
${errorBody({ title: title || d.title, line: line || d.line })}
</body>
</html>
`;
};

export const errorResponse = (status, headers = {}) => new Response(errorPage({ status }), {
  status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
