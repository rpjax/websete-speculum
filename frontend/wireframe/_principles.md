# Wireframe principles (constitution)

Any page, step, or component markdown that violates these is **invalid**.

## 1. Full explicitness (DNA)

- Nothing left “for when we code.”
- One file = one page, one flow step, or one reusable component.
- Vague stubs forbidden. Domain skeletons still list routes, jobs, APIs, and named flows.

## 2. Motor domain = structure

- Folders and nav mirror Speculum domains: Sessions, Profiles, Scripts, Configurations, Host resources, Diagnostics, Auth.
- Subpages = jobs of the **same** domain (list → detail → confirm; flow steps).
- Scripts = **one** place with internal split (library | injections).

## 3. One job per view

- If the screen needs “and also…”, split into a step, sub-route, or reveal panel.
- Cross-cutting apply (e.g. Scripting config) requires a **review** step before apply.

## 4. Revealing UI

- Primary viewport = minimum path to finish the job.
- Detail / advanced / metrics only after interaction or next step.
- Banned: field walls, JSON as primary UI, empty shells without CTA.

## 5. Semantics and fluency

- Copy answers *what / why / what now*.
- Helpers are part of the page contract, not decoration.
- Happy path: few clicks. Unhappy path: explicit recovery.

## 6. Separate surfaces

- Admin ≠ Motor canvas ≠ Lab.
- Setup (`/setup`) is its own surface (first-run / not-ready), linked by next-best-action — not stuffed into dense Admin chrome.

## 7. Anti-god (hard ban)

- No god page / god component.
- No single “Configuration” page editing every section at once.
- Diagnostics is not a monolith: observe / investigate / govern are distinct jobs/flows.

## DNA acceptance checklist (page / step)

Before marking a Sprint 1 page ready:

- [ ] Job + route + auth gate
- [ ] ASCII layout + control inventory (label / helper / default / validation)
- [ ] Copy for empty / error / success / confirm
- [ ] Happy-path sequence + reveals
- [ ] API mapping (endpoints + fields)
- [ ] Components used
- [ ] Inteligência UX section
- [ ] Build acceptance (“done when…”)
- [ ] Explicitly out of scope
- [ ] Does not violate principles 1–7
