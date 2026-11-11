# Sound effects

Drop sound files in this folder using the exact names below. The game picks them up automatically;
if a file is missing, the built-in synthesized sound is used instead.

| File name (any one of these)                     | Plays when                       |
|--------------------------------------------------|----------------------------------|
| `sword-draw-effect.mp3` (current), or `turn-start.mp3` / `.ogg` / `.wav` | It becomes your turn |

Tips
- Keep files short (under ~2 seconds) and small (under ~200 KB) so they load instantly.
- MP3 works in every browser; use it if unsure.
- If more than one format exists, the first in the order mp3 → ogg → wav is used.
- After adding or replacing a file, commit and push so Vercel serves it. Locally, just refresh the page.
