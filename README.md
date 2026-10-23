# Build: VR Proof of Concept source

This folder holds the full source code and every asset needed to build the PoC. It is submitted inside the zip, so keep it self-contained.

| Item | Value |
|---|---|
| Engine | WebXR with A-Frame 1.6.0 (vendored in `vendor/`, so it runs from the zip) |
| Facilitator approval | Verbal from Heli (AI writes the code; concept and decisions are the student's). Written confirmation pending: [date and wording] |
| Repo | <https://github.com/TheartistisME/memory-palace-vr> |
| Live build | <https://theartistisme.github.io/memory-palace-vr/> |
| Test setup | Chrome + Immersive Web Emulator; headset sessions noted separately |

## Rules
- AI writes the code to the student's design decisions (see `../../AGENTS.md`, facilitator ruling). The student decides what it does and tests it.
- Every feature maps to a decision ID (D1–D20) in `../01_Design_Doc/Decision_Log.md`. Mention the ID in commit messages, e.g. `feat(recall): hide items at recall (D4)`.
- Tag each forum build: `iteration-1`, `iteration-2`, `iteration-3`.
- Learning content loads from `items.json`. Keep personal data out of session logs.

## Files
| File | Purpose |
|---|---|
| `01_Iteration1_Build_Spec.html` / `.docx` | Iteration 1 features and acceptance checks (generated) |
| `index.html` | The scene: lights, room root, panel, rig with camera and both hand lasers |
| `app.js` | Everything else: room layout, stand looks, panel, guided start, gentle mode, sound switch, teleport, Place → Walk → Test → Score, session log |
| `i18n.js` | Interface text in 13 languages (D17). AI-drafted; have a native speaker check a language before relying on it |
| `items.json` | Room content: domain, centre image, 6 facts with their 3D objects and stand looks (D18), ceiling outliers and sources, and the room text in each language |
| `scenes.js` | Animated fact scenes: the centre heart and the six stands; the motion carries the fact (D15, iteration 1.1) |
| `sounds/voice/` | Fourteen voice lines, two per scene (D15). Grok TTS placeholders; scripts in `lines.tsv` |
| `sounds/wrong.wav` | The "wrong" cue at test (D14). Placeholder tones; replace it with your own sound, same file name |
| `sounds/gentle.wav` | The soft chime that replaces the wrong cue in gentle mode (D19). Placeholder tones, same rule |
| `vendor/aframe.min.js` | A-Frame 1.6.0 |

## Run it

```
cd 03_A1_VR_PoC/02_Build
python3 -m http.server 8000
```

Open <http://localhost:8000> in Chrome. Drag to look; click the panel buttons and the stands. On a phone, drag with a finger to look and tap to choose. In portrait the panel docks to the bottom of the screen and the view widens to fit the room. For VR without a headset, add the Immersive Web Emulator extension and press the VR button. Opening `index.html` as a file will not work: browsers block `items.json` from `file://`.

## How a session runs (iteration 1.3)

1. Start at the front door, facing the centre image (D2, D11). The first panel lists the three steps and has Start, Language (D17), Gentle (D19) and Sound (D20).
2. Guided start (D16): Start turns you to stand 1, which pulses under an arrow and a "Tap here" label. Tapping it places the first fact there; the panel then says to place the rest yourself.
3. Place: each fact arrives as a 3D object on the panel; click any empty stand to put it there. Undo takes back the last one (D1). A stand changes its look to match the fact it holds (D18).
4. Walk once: Next hops to the centre, then stands 1–6 clockwise and left to right, then a look up at the ceiling (D8, D12, D13).
5. Test: objects hidden. At each lit stand, recall, Reveal, then Got it or Missed it (D4). A miss plays the wrong sound and fade-snaps you to that stand with the object shown (D14).
6. Score: correct out of 6, test time, the missed items. Save log downloads the session JSON for `03_Testing/results/`.

## Languages, gentle mode and sound

- **Language:** the device language is used when it is one of the 13; otherwise English. Add `?lang=xx` to the link to force one, e.g. `https://theartistisme.github.io/memory-palace-vr/?lang=ja`. Codes: en es fr de it pt zh ja ko hi ar vi id. Voice lines stay English (translated audio is future work).
- **Gentle mode:** reads every panel aloud in the chosen language (when the device has a voice for it), offers a Hint before each test answer, uses a soft chime instead of the buzzer and kinder wording.
- **Sound (D20):** off silences everything: voice lines, the miss sounds and gentle read-aloud. A miss still shows by the snap and the panel. All three choices are remembered on the device.

## Verified

2026-10-14: full loop driven in headless Chrome, including real mouse clicks on a button and a stand: place with undo, walk 8 stops, test with two misses (sound played, snap shown), score 4/6, session log complete, no console errors. Not yet checked: the Immersive Web Emulator and a real headset.

That run was iteration 1.0, before the D15 scenes. 2026-10-14: the student ran iteration 1.1 (D15) by hand and reported it works. An automated re-run of 1.1 is still to do.

2026-10-20: full loop driven in headless Chrome at phone size (390×844, touch taps) and at desktop size (1280×800): place, walk 8 stops, test with one miss, score 5/6, no console errors. Not yet checked on a real phone.

2026-10-23 (iteration 1.2): full loop driven in headless Chrome at phone size (390×844, touch) in English with gentle mode on (guided start, place, walk 8 stops, hint, one miss with the chime, score 5/6) and at desktop size (1280×800) after switching to Japanese through the language grid (score 5/6). The guided start and the panels also checked in Arabic (phone) and German (desktop). No console errors. Screenshots in `../03_Testing/results/iteration_1/build_1.2/`. Not checked: read-aloud with a real voice (headless Chrome has none), real phones, a headset, and the translations by native speakers.
