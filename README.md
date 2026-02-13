# Drawsteel Montage

A Foundry VTT module for the Draw Steel game system that facilitates and automates Montage Tests.

## Requirements

- Foundry VTT v13+
- Draw Steel game system

## Installation

### Via Foundry Interface (recommended)

1. Install the Draw Steel game system.
2. Open Foundry → **Add-on Modules** → **Install Module**.
3. Paste this manifest URL and click Install:
   ```
   https://raw.githubusercontent.com/Luthair/drawsteel-montage/main/module.json
   ```
4. Enable the module in your world.

### Manual Installation

1. Download the latest `drawsteel-montage.zip` from [Releases](https://github.com/Luthair/drawsteel-montage/releases).
2. Extract into `Data/modules/drawsteel-montage`.
3. Enable the module in your world.

## Usage

### Director (GM)

- **Ctrl+M** – Open the Montage Test director app
- **Right-click an actor** in the Actors Directory → "Montage Test" to open the app
- Click **New Montage Test** to configure and start a test (title, description, difficulty, visibility, custom limits)
- When players submit intents, approve or reject each from the pending list
- For **Test** actions, approving triggers the Draw Steel roll; the result updates successes/failures automatically
- Click **End Montage Test** when done (or after outcome is reached) to post the result to chat

### Players

- **Alt+M** – Open the Montage action panel to submit your action for the current round
- Choose **Make Test**, **Assist**, or **Abstain**
- For Test/Assist, pick a characteristic (ones already used this montage are disabled)
- Submit; the Director will approve before the roll is made

## Outcomes

Victory rewards (announced in chat; no automatic actor updates):

- **Total success** (easy/moderate): 1 Victory; **hard**: 2 Victories
- **Partial success** (moderate/hard): 1 Victory
- **Total failure**: 0 Victories

## Development

```bash
npm install
npm run build
```

Source is TypeScript; the build outputs `drawsteel-montage.js`.

### Creating a Release

1. Update `version` in `package.json` and `module.json`.
2. Update the `download` URL in `module.json` to match the new tag (e.g. `.../releases/download/v0.1.0/drawsteel-montage.zip`).
3. Build and pack:
   ```bash
   npm run build
   npm run pack
   ```
4. Create a GitHub release with tag `v0.1.0` (or your version).
5. Upload `drawsteel-montage.zip` as a release asset.

**With GitHub Actions**: If the `.github/workflows/release.yml` workflow is present, pushing a tag (e.g. `git tag v0.1.0 && git push origin v0.1.0`) will build and attach the zip to the release. Remember to update `module.json` version and download URL before tagging.

## License

See LICENSE.
