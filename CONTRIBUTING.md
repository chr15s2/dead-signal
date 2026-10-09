# Contributing

Dead Signal is a small, mobile-first game with three missions. Contributions that improve touch controls, accessibility, performance, balance, and browser compatibility are welcome.

1. Run the game locally using the command in [README.md](README.md).
2. Keep simulation changes in `dist/engine.js`, drawing in `dist/renderer.js`, and interface/input changes in `dist/app.js`.
3. Run `node --test tests/*.test.mjs` for simulation changes. For interface changes, check a small portrait viewport, landscape, and desktop; test touch controls on a real device when available.
4. Describe the problem, your change, and what you checked in your pull request. Include browser/device information and reproduction steps for bugs.

Keep the game buildless and usable without an account or network connection after its files load. Do not add tracking, secrets, generated archives, or checkout-specific `.openai/` metadata.

Use original or permissively licensed assets, include their license notices, and record their source. Do not contribute Cannon Fodder assets or code. Contributions to original code and artwork are licensed under the project's MIT license; existing third-party assets retain their own licenses.
