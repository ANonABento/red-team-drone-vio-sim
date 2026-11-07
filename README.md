# Red team sim

A browser simulation for the red team operations challenge, built in Ambition: the drone (airframe, flight physics, navigation that can be switched on or off), the environment (the ground and light it flies over) and the camera with its rolling shutter.

## What's here

- `src/` the sim's source as ES modules; `src/main.js` is the entry point
- `index.html` the page's markup (body only)
- `style.css` the sim's styles, on top of Ambition's kit stylesheet
- `ambition.json` the app's manifest: its saved collections and libraries

## Running it outside Ambition

1. Bundle `src/main.js` into `app.js`, for example `npx esbuild src/main.js --bundle --format=esm --outfile=app.js`.
2. Wrap `index.html` in a full page that loads three.js as the global `THREE`, a stylesheet defining the kit's CSS variables, `style.css`, and then `app.js` as a module.
3. Provide a small `window.ambition` stand-in (collection, viewer, members, route, data, asset, color) that saves to the browser.
4. Serve the folder with a static server such as `npx serve` or `python -m http.server`.

The Ottawa ground images and elevation files are not included.
