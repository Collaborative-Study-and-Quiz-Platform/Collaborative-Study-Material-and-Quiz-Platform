# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

### CSQP-F-013: My Bookmarks

Students can toggle the outline/filled bookmark beside View and Download in
Browse materials. My Bookmarks uses the same material explorer and file actions.
Bookmarks are stored by the backend, scoped to the authenticated student; no
localStorage is used. Pending/unknown bookmark state disables the control, with
accessible status/error feedback and retry. Both pages share a session-scoped
store; navigation/window focus revalidates against the server. Account/token
changes discard the old store, and stale responses cannot overwrite new state.

Run `node --test test/*.test.mjs`, `npm run lint`, and `npm run build`.
Static rendering tests cover accessible states; direct store tests cover request
methods, duplicate clicks, reconciliation and stale/account response handling.

TC-Mat-04 manual browser checklist (use disposable test accounts/materials):

- Save in Browse materials; verify a filled icon and the same material in My Bookmarks.
- Remove there; verify Browse materials shows an outline and the last removal shows the empty state.
- Log out/in; verify saved materials persist. Another student must have an independent list.
- Verify View, PDF preview, DOCX/PPT fallback, Download and download counts from both pages.
- Verify instructors retain their existing uploads/View restrictions and have no bookmark navigation/action.
- Use keyboard Tab/Enter/Space; check button names, pressed/pending states, feedback and focus after removal.
- Simulate failed/slow requests, rapid clicks, navigation during requests and account changes.
- Change bookmarks in another tab; focus/re-enter the material page and verify reconciliation.

Cross-tab synchronization occurs on focus/navigation, rather than through a live
subscription. Lists follow the current unpaginated material API convention.
