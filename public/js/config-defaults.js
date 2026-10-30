// Open-question defaults for the setup carousel, presets and roles panel. One place, so each is easy to change.
export const DEFAULT_PRESET_ID = 'round-table';       // preselected on step 2 (item 3: The Round Table is the recommended preset)
export const SETUP_KEY = 'quest.setup.v1';            // localStorage: { code, step, presetId, seating, seatingChosen, advancedOpen }
export const SAVED_PRESETS_KEY = 'quest.presets.v1';  // localStorage: the host's own presets, on this phone only
export const SAVED_PRESETS_MAX = 12;                  // more than this and the oldest is dropped, so the list stays short
export const SETUP_STEPS = ['Players', 'Preset', 'Seating', 'Deal']; // the four carousel steps (item 8)
export const SLIDE_MS = 240;                          // carousel slide, transform only, ease-out. Goes through dur(): the 240ms on screen that item 8 asks for
export const FADE_MS = 120;                           // reduced-motion cross-fade instead of the slide: 120ms on screen
export const SWIPE_PX = 56;                           // horizontal drag needed to count as a swipe (never the only way to move)
export const NAME_MAX = 20;                           // same cap the room applies to a name
// Undo and Redo (event-log.js). Both answered on by Nishant and Fennel (Oct 30): the Host may go back over a quest
// result everyone has seen, and from the end screen (a confirm sheet says every phone hides the roles again).
export const UNDO_PAST_RESULT = true;
export const UNDO_PAST_GAME_OVER = true;
export const NOTIFY_ON_UNDO = true;                   // players get "The host went back a step" when the game itself changed
