# Audio Assets

Place optional audio files here to replace the built-in procedural synthesis.

The engine checks for files in `ogg → mp3 → wav` order.  
Files that are missing simply fall back to the synthesized version — nothing breaks.

## Expected file names

| File name          | Triggered when…                                   |
|--------------------|---------------------------------------------------|
| `card-deal.ogg`    | Each hole card is dealt to a player               |
| `card-flip.ogg`    | Community cards revealed / opponent showdown flip |
| `chip-click.ogg`   | Any bet, call, or raise action                    |
| `chip-shuffle.ogg` | Before dealing a new hand                         |
| `win-small.ogg`    | Player (user or AI) wins the hand                 |
| `win-big.ogg`      | User wins a pot larger than 50 000 chips          |
| `bust.ogg`         | A player is eliminated                            |

## Free sound resources

### Kenney.nl — Casino Audio Pack (CC0, recommended)
https://kenney.nl/assets/casino-audio  
Free, no attribution required. Contains card deal, chip rattle, win jingle.

### Freesound.org (CC0 / CC-BY)
https://freesound.org  
Search: "card deal", "poker chip", "casino chips rattle", "card shuffle"  
Filter by CC0 licence for zero-attribution use.

### OpenGameArt.org (CC0 / CC-BY)
https://opengameart.org  
Search: "card game sounds", "casino"

### Mixkit (free, no attribution)
https://mixkit.co/free-sound-effects/casino/

### ZapSplat (free account required)
https://www.zapsplat.com  
Search "poker", "card game", "casino chips"

## Tips

- Prefer **OGG Vorbis** (smaller, best browser support in Electron).
- Keep files short: card sounds 0.1–0.3 s, chip sounds 0.05–0.15 s, fanfares 1–3 s.
- Normalise to around **-12 dBFS** peak — the engine applies its own dynamics compressor.
- Run through a batch converter (e.g. `ffmpeg -i input.wav -c:a libvorbis -q:a 4 output.ogg`)
  if the downloaded format isn't OGG.
