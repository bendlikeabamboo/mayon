// Minimal `$app/environment` double for route-level browser tests. The browser
// project runs real Chromium, so `browser` is true; `building` and `dev` stay in
// their test-safe states. See specs/032-test-suite-tiering/research.md R4.

export const browser = true;
export const building = false;
export const dev = true;
export const version = 'test';
