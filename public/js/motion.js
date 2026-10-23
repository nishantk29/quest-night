// Motion helpers: which screen we are on (for View Transitions) and the carousel's current step.
// Everything here is cosmetic and feature-detected; callers also check fx.enabled().

// Changes only when the player moves to a different screen or step, not on every live update.
export const screenKey = (S) => `${S.mode}|${S.code || ''}|${S.fatal ? 'x' : S.view ? `${S.view.phase}|${S.view.game?.quest ?? ''}` : 'wait'}`;

export const canTransition = (doc = globalThis.document) => typeof doc?.startViewTransition === 'function' && doc.visibilityState !== 'hidden';

// Which snap step is showing, given the scroller's scrollLeft and the distance between steps.
export const stepAt = (scrollLeft, step, count) => (step > 0 ? Math.max(0, Math.min(count - 1, Math.round(scrollLeft / step))) : 0);
