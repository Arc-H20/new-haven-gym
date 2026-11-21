# New Haven Gym

A phone web app for logging workouts. It runs offline and saves each session as a Markdown file in a separate private GitHub repo.

This repo holds only the app code. No training data or tokens live here.

## How it fits together

- **This repo (public)** is served by GitHub Pages. The phone installs it from Chrome with "Add to Home screen".
- **The log repo (private)** holds `Routines.md`, `Exercises.md` and `Sessions/YYYY-MM-DD <Day>.md`, in the same line format as the old Obsidian vault: `- Squat [kg]: 60x8 100x5@2 90x6 // note` (`@2` = 2 reps in reserve).
- The phone reads the log repo through the GitHub API with a fine-grained token that can only touch that repo. The token is stored on the phone only.
- Finished sessions are queued on the phone and uploaded when there is a connection. Reordering, adding or removing exercises on the Log tab rewrites that day in `Routines.md`.

## Files

| File | What it is |
| --- | --- |
| `index.html` | App shell and the logo symbol |
| `styles.css` | All styles (black, white, #5C0D00) |
| `lib.js` | Training logic ported from the Obsidian plugin: targets, progression, deloads, hard sets, est. 1RM |
| `store.js` | Local cache, upload queue and GitHub API calls |
| `app.js` | Screens: Home, Log, exercise logging, rest timer, Finish, Week, History, More, Connect |
| `sw.js` | Offline cache. Bump `VERSION` when shipping changes so phones pick them up |
| `manifest.webmanifest`, `icons/` | Install name and icons |
| `fonts/` | Inter and Barlow Condensed (SIL Open Font License) |

## Making the phone token

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
2. Repository access: **Only select repositories** → the private log repo.
3. Permissions → Repository permissions → **Contents: Read and write**. Nothing else.
4. Pick an expiry (up to a year), generate, and paste it into the app's Connect screen.

## Changing the app

Edit the files, bump `VERSION` in `sw.js` and `APP_VERSION` in `app.js`, and push. The phone gets the new version the next time it opens the app online (or More → Check for updates).
