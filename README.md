# 🧟 Zombie Smash: Nightfall

A mobile-first browser survival game. Tap/click zombies before they reach your base. Survive as long as you can.

---

## 🎮 How to Play

- **Tap or click** zombies to destroy them before they reach the center base
- **Collect powerups** that drop every 30 seconds for special abilities
- **Build combos** by killing zombies rapidly for score multipliers
- **Survive waves** — every 30 seconds the game gets harder
- Your score is saved to the **Leaderboard** via LocalStorage

---

## 👾 Zombie Types

| Type   | HP | Speed  | Points | Unlocks At |
|--------|----|--------|--------|------------|
| Walker | 1  | Slow   | 10     | Start      |
| Runner | 1  | Fast   | 20     | Score 20   |
| Tank   | 3  | Slow   | 50     | Score 50   |
| Ghost  | 1  | Medium | 40     | Score 75   |
| Toxic  | 2  | Medium | 60     | Score 100  |

---

## ⚡ Powerups

| Powerup        | Effect                              |
|----------------|-------------------------------------|
| ✝ Holy Bomb    | Destroys all zombies on screen      |
| 🕐 Freeze Time | Freezes all zombies for 5 seconds   |
| ⚡ Lightning   | Destroys the 10 nearest zombies     |
| 💚 Health      | Restores +25 HP (max 100)           |

---

## 🏗️ Project Structure

```
zombie-smash/
├── index.html          # Main HTML entry point
├── style.css           # All styles
├── game.js             # Complete game engine
├── netlify.toml        # Netlify deployment config
├── README.md           # This file
└── public/
    └── assets/
        ├── backgrounds/
        │   └── graveyard-bg.png     # Optional background image
        ├── player/
        │   └── player.png           # Optional player/base sprite
        ├── zombies/
        │   ├── walker.png
        │   ├── runner.png
        │   ├── tank.png
        │   ├── ghost.png
        │   └── toxic.png
        ├── powerups/
        │   ├── holy-bomb.png
        │   ├── freeze-time.png
        │   ├── lightning.png
        │   └── health.png
        ├── ui/
        │   ├── play-button.png
        │   ├── coin.png
        │   └── health-bar.png
        └── audio/
            ├── bg-music.mp3
            ├── zombie-hit.mp3
            ├── zombie-death.mp3
            ├── button-click.mp3
            └── game-over.mp3
```

> **Note:** All assets are optional. The game uses procedurally generated graphics and Web Audio API synthesized sounds when asset files are missing. It will never crash on missing assets.

---

## 🚀 Deploy to Netlify

### Option 1 — Drag & Drop (Easiest)

1. Go to [app.netlify.com](https://app.netlify.com)
2. Log in or create a free account
3. Drag the entire `zombie-smash/` folder onto the Netlify dashboard
4. Your game is live instantly at a `.netlify.app` URL

### Option 2 — Netlify CLI

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Navigate to project folder
cd zombie-smash

# Login to Netlify
netlify login

# Deploy
netlify deploy --prod --dir .
```

### Option 3 — GitHub + Netlify CI

1. Push this folder to a GitHub repository
2. In Netlify, click **"Add new site" → "Import an existing project"**
3. Connect your GitHub repo
4. Set **Publish directory** to `.` (root)
5. Leave **Build command** empty
6. Click **Deploy site**

Every future `git push` will auto-deploy.

---

## 🖥️ Run Locally

No build step needed. Just open `index.html` in a browser:

```bash
# Option 1: open directly
open index.html

# Option 2: use a local server (recommended for audio)
npx serve .
# or
python3 -m http.server 8080
# then open http://localhost:8080
```

> **Audio note:** Web Audio API requires a user gesture (click/tap) before playing. This is handled automatically on the first interaction.

---

## 📱 Mobile Support

- Fully touch-enabled with `touchstart` events
- Portrait-first responsive layout using viewport units
- `user-scalable=no` prevents accidental zoom during gameplay
- 60 FPS target on modern mobile browsers
- Tested on iOS Safari and Android Chrome

---

## 🔧 Customisation

Edit constants at the top of `game.js`:

```js
const ZOMBIE_TYPES = { ... }   // Change zombie stats
const HP_DAMAGE = { ... }      // Change damage values
const BASE_HP = 100;           // Change starting health
// getSpawnRate()               // Tune spawn frequency
// difficulty system            // Wave timing in gameLoop
```

---

## 📄 License

MIT — free to use, modify, and deploy.
