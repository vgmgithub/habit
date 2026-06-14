# Feature: Manual Service Worker Updates

## Objective

Give the user **explicit control** over when service-worker updates apply. New versions install silently in the background; the page only reloads when the user taps "Update available". Eliminates surprise reloads mid-flow (e.g., while editing a habit or filling out wrap-up).

## Default PWA patterns (what we changed)

- **Old way:** SW installs → auto-calls `skipWaiting()` → activates immediately → page reloads automatically.
- **New way:** SW installs → stays in waiting state → user taps "Check for updates" / "Update available" → only then applies and reloads.

## Implementation

### Service Worker (`sw.js`)

- **Removed** `self.skipWaiting()` from the `install` event. New SW installations now park in the "waiting" slot.
- **Added** message listener:
  ```js
  self.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
  });
  ```
  This is the ONLY way a new SW transitions from waiting → activated.
- **Kept** `self.clients.claim()` in `activate` — once the user triggers skip-wait, the new SW takes over all open clients immediately.
- `CACHE` versioned as always; bumped to `habits-v22` when adding this feature.

### Main app (`js/app.js`)

**Registration (line ~2745):**
```js
const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
window.__swReg = reg;
```
`updateViaCache: 'none'` ensures the browser **never** uses HTTP caching when checking for SW updates, so detection is reliable (no hidden 24-hour caches from Apache/nginx).

**Update detection (on register):**
- Check if `reg.waiting` exists AND `navigator.serviceWorker.controller` exists → set `window.__updateReady = true`.
- Listen for `updatefound` events; when new SW reaches `'installed'` state with a controller present, set the flag.
- Call `render()` to refresh the Settings menu if open.

**Reload handler (line ~2760):**
```js
let reloaded = false;
navigator.serviceWorker.addEventListener('controllerchange', () => {
  if (reloaded) return;
  reloaded = true;
  window.location.reload();
});
```
This fires **only** when a waiting SW's `SKIP_WAITING` message is processed, so the reload is expected, not surprising.

**`checkForUpdates()` function (line ~1992):**
1. If a SW is already waiting → send `SKIP_WAITING` immediately.
2. Otherwise, call `reg.update()` to check the network.
3. Wait for any installing SW to reach `installed` state (or timeout after 8s).
4. If a new SW is waiting, send `SKIP_WAITING`; otherwise toast "You're on the latest version".
5. The reload happens via the `controllerchange` handler, not this function.

### Settings menu item

**Added in `renderSettings()` (line ~1445):**
```js
const updateBtn = h('button', { class: 'btn' }, 
  window.__updateReady ? '⬇️ Update available' : '🔄 Check for updates');
updateBtn.addEventListener('click', checkForUpdates);
root.appendChild(settingRow('App updates', updateBtn,
  window.__updateReady
    ? 'A new version is ready to install — tap to apply and reload.'
    : 'Pull the latest version from the server.'));
```

The button label + hint flip based on `window.__updateReady`:
- `false` → "🔄 Check for updates" / "Pull the latest version from the server."
- `true` → "⬇️ Update available" / "A new version is ready to install — tap to apply and reload."

## Behavior

**First install / on the latest version:**
- Settings → "Check for updates" (button is enabled).
- Tap → app checks the network → "You're on the latest version" (no SW to activate).
- Label stays "Check for updates".

**After a new SW is released (no user action yet):**
- Browser's background update check fires (every 24h or so, or when user navigates).
- New SW downloads and reaches `waiting` state (because no `skipWaiting()`).
- `updatefound` listener fires → sets `window.__updateReady = true`.
- If Settings menu is open, it re-renders → button changes to "⬇️ Update available".
- **No page reload.** User is uninterrupted.

**User taps "Update available":**
- `checkForUpdates()` sees `reg.waiting` → sends `SKIP_WAITING` immediately.
- Toast "Applying update…".
- New SW activates → `controllerchange` fires → page reloads.
- After reload, Settings shows "🔄 Check for updates" again (on the new version).

**Offline or network error while checking:**
- Toast "Could not reach server — try again later" (after 8s timeout).
- Button state unchanged.

## Test scenarios (manual)

1. **First install:** Settings → "Check for updates" → tap → "You're on the latest version" (no auto-reload).
2. **Bump CACHE in SW, reload page:** Within a few seconds, menu label flips to "⬇️ Update available".
3. **Tap "Update available":** Page reloads on new code. Menu reverts to "Check for updates".
4. **Close all tabs, reopen:** Label already shows "Update available" (background check already ran).
5. **Tap "Check for updates" while offline:** Toast "Could not reach server — try again later".
6. **Confirm:** No automatic reload at any point except after tapping "Update available" / "Applying update…".

## CSS

No new CSS needed. The button uses existing `.btn` class; the menu item uses existing `settingRow` helper.

## Files

- `sw.js` — removed `skipWaiting()` from install, added message listener, bumped CACHE to v22.
- `js/app.js` — updated SW registration, added `checkForUpdates()` function, added the Settings menu item.

## Related docs

The service worker behavior is related to [backup-restore.md](backup-restore.md), which also uses `updateViaCache: 'none'` to ensure fresh assets.
