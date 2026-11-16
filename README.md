# Snipe Hunt

A cooperative woodland hunting game for amateur radio nets, in the style of Hunt the Wumpus.

**Play it here: [kr1ttr.radio/snipehunt](https://kr1ttr.radio/snipehunt/)**

Net control runs the game in a web browser. Check-ins play along over the air with paper and
pencil. It's a fun way to practice directed-net procedure: check-ins, taking turns, and clear,
concise traffic.

## How the game works

- The woods are a small grid: columns A–E and rows 1–4 (or 1–5 on bigger nights). Row 1 is north.
- The whole net shares **one hunter**. Somewhere in the woods hides **the snipe**, along with two
  **bogs** and a **giant owl**.
- Each round, players are drawn **by lottery**. When your call is drawn:
  1. **Move** the hunter north, south, east or west, or hold position.
  2. Net control reads back what you hear from the new square.
  3. Decide whether to **swing the bag** at the square next to you, and which way.
- **Clues** come only from the squares directly north, south, east and west of the hunter:

  | You hear… | It means… |
  |---|---|
  | Frogs croaking | A bog is next door. Step in and the hunt is over. |
  | A hoot overhead | The giant owl is close. It may carry the hunter off and drop them anywhere. |
  | A soft winnowing call | The snipe is right next door. |

- **Bag the snipe and the whole net wins.** Each miss uses one of 5 tries and will likely flush the
  snipe to a new hiding spot. The snipe gets away if the hunter steps right on it, or when the
  tries run out.

## Running a net (for net control)

1. Open [kr1ttr.radio/snipehunt](https://kr1ttr.radio/snipehunt/) in a computer's web browser.
2. On the **Preamble** tab, fill in your net name, callsign, schedule and frequency. The preamble
   text fills them in for you, and you can edit the wording to suit your net.
3. Read the preamble, then take check-ins on the **Game** tab: callsign and name, ticked as
   **Player** or **No traffic / In-out**.
4. Pick a 5 × 4 or 5 × 5 grid, press **Start game**, and then **Draw next player** each turn.
   Read the text in the **Read on air** box. It tells you exactly what to say.
5. When the net is over, press **Export log** to save a `.txt` record of the session: check-ins,
   game results and the full transcript.

**Keyboard:** arrow keys pick a direction, **H** holds, and **Enter** submits or draws the next player.

**GM view** shows where everything is hidden. Keep it off if others can see your screen.

## Good to know

- **Nothing to install.** It runs entirely in the browser. Optionally, Chrome, Edge and Brave can
  install it as an app (look for the install icon in the address bar), and it then works without
  internet.
- **Your data stays on your computer.** Check-ins, the transcript, your preamble and settings are
  saved in your browser only. Nothing is sent anywhere.
- **Save a backup.** If your browser's data is cleared, your preamble and settings go with it. Use
  **Save backup** on the Preamble tab now and then, and **Restore…** to bring them back.
- If the browser closes in the middle of a net, open the page again and it picks up where you
  left off.

## Feedback

Ran Snipe Hunt on your net? I'd love to hear how it went. Open an
[issue](https://github.com/KR1TTR/snipehunt/issues) with ideas or problems.

73 de KR1TTR

© 2026 KR1TTR. All rights reserved.
