# FDC Smile Bus

A VR bus simulator for Meta Quest 3. You drive the **FDC Dental Clinic Smile Bus** through a festive little town, pick up passengers at 3 bus stops and bring them to FDC Dental Clinic for a check-up.

The bus is modelled on the real one:
- white body with the green skirt and pink waves
- tinted windows with the big glowing **fdc** logo, "Dental Clinic **Smile Bus**", and the waving tooth mascot
- QR "Download aplikasi FDC", the website, and plate **B 7893 TDB**
- front: the pink smile on the nose and the windscreen slogans "Membawa Senyum Lebih Dekat · Be The Reason Someone Smiles"
- rear: "Smile Bus by FDC Dental Clinic"

Built with Three.js + WebXR. The bus, town, people, sounds and music are all made in code; there are no model or audio files.

## How a round goes (about 4 minutes)

1. **Start screen:** you stand on the clinic forecourt next to the Smile Bus. Choose **Mulai menyetir**, **Pengaturan** or **Cara main**.
2. **Drive** from the driver's seat (on the right: Indonesia drives on the left).
   - Follow the map on the dashboard to each **halte**.
   - Stop in the **green BUS STOP zone** and open the door. The passengers walk to the door, climb the step, walk down the aisle to a free seat, turn round and sit down.
   - Close the door and drive on.
3. **Traffic lights:** stop at the white line when the light is red. The lights have visors, a glowing lamp and the red / green countdown display, like real Indonesian lights. Oncoming cars, angkot and scooters stay in their lane, and they brake and honk if you drift into it.
4. **Back at FDC Dental Clinic:** stop in the zone and open the door. The passengers stand up one by one (front rows first), walk to the front, step down out of the door and walk to the clinic entrance, while the crowd cheers and confetti flies.

**Side mirrors:** both ear mirrors show what's behind you, live (flipped like a real mirror).
5. **Result:**
   - stars and a score
   - passengers delivered, stops, smile %, time, red lights, bumps
   - the FDC app QR
   - **Main lagi** / **Menu** / **Lobby FDC**

   In booth mode it goes back to the start screen by itself after 40 s.

**Smile meter:** smooth driving keeps the passengers smiling. Hard braking, sharp turns, speeding, kerbs and red lights lower it, and the final smile % is a big part of the score.

## Controls

| | VR (Quest controllers) | Desktop |
| --- | --- | --- |
| Gas | Right trigger (or right stick up) | `W` / `↑` |
| Brake | Left trigger (or right stick down) | `S` / `↓` / `Space` |
| Steer | Either stick left/right, **or grab the wheel** with the grip buttons and turn it | `A` `D` / `←` `→` |
| Door | A (or the **Pintu** button on the dash) | `E` |
| Horn | X (or **Klakson**); people nearby hop and wave | `H` |
| Reverse | **Mundur** on the dash (when stopped) | `R` |
| Pause | B / Y: Lanjut, Atur posisi duduk, Mulai ulang, Menu | `M` / `Esc` |

**Mode Santai** (Pengaturan): the bus drives and brakes by itself, including slowing down for stops and red lights. You only steer and open/close the door. It's good for kids and first-timers at the booth.

## Against motion sickness

- **A steady cockpit around you.** The dashboard, pillars, roof and seats never move relative to you, so your eyes always have a stable frame.
- **Tunnel vision while turning or braking.** The edges of your view darken softly and fade away when you drive straight. Pengaturan → **Anti pusing**: Mati / Sedang / Kuat.
- **Gentle movement:**
  - acceleration is jerk-limited, so there are no lurches
  - steering is eased
  - the bus never pitches or rolls
  - the top speed is low: 40 km/h by default (30 / 40 / 50 in Pengaturan)
- **Seat position:** when you start driving, your head is placed at the driver's eyes whether you sit or stand. **Atur posisi duduk** in the pause menu re-centres it.
- **Displays about 2 m away.** Instructions, the pause menu and the result float beyond the windscreen, not right in front of your face.

## Settings

The start screen's **Pengaturan** saves on the headset. To change the defaults for every headset, edit `DEFAULTS` in `src/game/config.js`.

| Setting | Choices |
| --- | --- |
| Mode | Normal (gas + rem), Santai (jalan sendiri) |
| Anti pusing | Sedang, Kuat, Mati |
| Kecepatan maks | 40, 50, 30 km/h |
| Mobil lain | on / off |
| Radio musik | on / off (chill lo-fi on the bus radio; also the **Radio** dash button) |

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install three.js, Vite and the QR library (once) |
| `npm run dev` | Play on the Mac at http://localhost:5177 |
| `npm run build` | Build into `dist/` |
| `npm run quest:connect` | Let a Quest plugged in by USB open `http://localhost:5177` |
| `npm run pages:setup` | Install the GitHub Pages workflow (once) |
| `npm run apk:setup` / `npm run apk:build` | Make the Quest app `fdc-smile-bus.apk` (see below) |

## Publish

1. Run `npm run pages:setup` once, then commit and push to `main`.
2. In GitHub → **Settings → Pages**, set **Source: GitHub Actions**.

It goes live at https://markzugenjer.github.io/fdc-vr-bus-simulator/ and the **FDC Smile Bus** button in the FDC VR lobby opens it.

## Quest app (.apk)

Like the other FDC apps, the APK only opens the published site, so after the first install a `git push` is enough to update it. It shares the signing key in `../vr-games-1/android`.

```bash
npm run apk:setup     # adds id.co.fdc.vrbus to ../vr-games-1/public/.well-known/assetlinks.json
cd ../vr-games-1 && git add -A && git commit -m "Add FDC Smile Bus to assetlinks" && git push && cd -
npm run apk:build     # → fdc-smile-bus.apk
adb install -r fdc-smile-bus.apk
```

## The town

- **Houses:** plastered walls in pastel colours, clay-tile hip (limasan) or gable roofs with white fascia and soffits, a tiled terrace with columns, panelled doors, framed windows with curtains and roster vents, AC units, potted plants, some water-tank towers and parked scooters, a lawn and a brick-and-railing fence with a sliding gate.
- **Ruko (shophouses):** 2–3 storeys, open shops full of goods or rolling doors, named shop signs (Apotek Sehat, Bakso Pak Kumis, Fotokopi...), striped awnings, balconies with railings, AC units, parapets and water tanks.
- **Warung:** wooden stalls with zinc roofs, banners (Es Teh, Nasi Goreng, Sate Ayam...), jars of snacks, hanging sachets, a bench and plastic stools. Gerobak carts, benches and recycling bins along the sidewalks.
- **Street:** worn asphalt with tyre tracks and patches, black-and-white painted kerbs, paving-block sidewalks with the yellow tactile strip, drains, zebra crossings and arrows at the junctions, electricity poles with sagging wires and transformers, curved LED street lamps.
- **Nature:** mango and ketapang trees, coconut palms with fronds and coconuts, banana plants, flowering bushes, hills and a volcano on the horizon, fluffy clouds.
- **People:** each person has moving arms and legs (walk, wave, cheer, sit), many looks (hijab, peci, caps, school uniforms with backpacks, skirts, glasses, bags), and a soft shadow. Some stroll up and down the sidewalks.
- **Traffic:** sedans, hatchbacks, angkot minivans with their route band, and scooters with riders.

The buildings' details are painted once into one texture atlas (`src/game/atlas.js`), so all that variety costs no extra draw calls.

## Performance

- **Static scenery is merged** into one mesh per 90 m block (one shared atlas material), so blocks behind you are skipped.
- **Repeats are instanced:** trees (with lower-poly crowns far from the road), palms, bananas, bushes, umbul-umbul, bunting, balloons, lamps, traffic lamps, vehicles, seats and shadows.
- **People are one mesh each;** their limbs bend in the vertex shader (no skeletons).
- **Side mirrors** are 128 × 224 renders that take turns, one per frame, and don't draw the bus interior.
- **Panels update about 10 times a second,** not every frame.
- **Result:** about 85–110 draw calls and 280–320k triangles while driving, with no real-time shadows or post-processing.

## Files

```
src/game/game.js     the round: start screen, driving rules, stops, boarding, scoring, result
src/game/bus.js      the Smile Bus: outer shell, door, wheels, live side mirrors, cockpit, seats, garland, tooth charm
src/game/livery.js   the paint job (canvas textures from the photos), FDC logo, mascot, QR
src/game/world.js    the town: road loop, houses, ruko, warungs, halte, traffic lights, clinic, trees, poles, decor
src/game/atlas.js    the town's texture atlas (roof tiles, windows, shop signs...) and TexKit, the merged-scenery builder
src/game/drive.js    controls and the vehicle model (jerk-limited, soft kerbs)
src/game/traffic.js  oncoming sedans, hatchbacks, angkot and scooters
src/game/people.js   townsfolk and passengers with bending limbs, blob shadows
src/game/hud.js      dashboard: speedometer, smile meter, map, windscreen messages
src/game/comfort.js  the anti-motion-sickness vignette
src/game/festive.js  bunting with fairy lights, balloons, merged static kit
src/game/sfx.js      engine, horn, air doors, bell... (synthesized)
src/game/music.js    chill lo-fi radio (synthesized)
src/game/config.js   settings and defaults
src/core/            shared VR base (renderer, lasers, panels)
```
