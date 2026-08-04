# Handoff — Chat-Turn nach dem Mock umbauen

Stand: 2026-08-01. Repo `/Users/henri/Desktop/Desktop/Privat/Tools/vIDE`.

## Auftrag

`agent-flow-motion-mock.html` (Repo-Root, untracked) ist die **Spezifikation**. Der Agent-Turn im
Chat soll 1:1 so aussehen und sich so verhalten — Animationen, Flow, Übergänge, Tool-Calls mit
Details, Changed-Files mit Klick in die Datei, das Einklappen der ganzen Arbeit auf
„Worked for n" und wieder auf.

Nicht übernehmen: Sidebar, Toolbar-Regler des Mocks (Replay, Theme-Toggle). Der Colorpicker gehört
in die Theme-Settings, nicht in die Chat-Toolbar.

Zusätzlich: Positionierung, Layout und Symmetrie des Chats mitnehmen. Der Chat darf **nicht breiter
sein als die Eingabe** — Transcript und Composer auf dieselbe Breite und denselben Innenabstand.

## Wo der Code steht

`vide` ist der Trunk (nicht `main` — `main` ist eine andere, 105 Commits alte Linie).

- `vide` @ `6eb82836c`, 7 vor `origin/vide`. Enthält **alles**: theme-tokens-System, Color-Picker,
  und die drei Settings-Commits aus der Vorsession.
- `theme-tokens` Worktree unter `.claude/worktrees/theme-tokens` steht auf demselben Commit.
- `chat-turn-rework` @ `425df8821` ist **veraltet** (ein Commit hinter). Neu von `vide` abzweigen,
  diesen Branch löschen.
- `chat-motion-settings` @ `48fcf3521` ist in `vide` enthalten, kann weg.

**Erster Schritt der neuen Session:**

```bash
git checkout vide && git checkout -b chat-turn-ui
```

## Was in der Vorsession gebaut wurde (steht in `vide`, funktioniert)

Drei Commits, Settings-Ebene:

- `ffe3e2f35` — drei Achsen als Client-Settings: `chatStreamAnimation`, `chatThinkingIndicator`,
  `chatChangedFilesLayout`. IDs in `packages/contracts/src/settings.ts:88-120`, Registry in
  `apps/web/src/components/chat/chatAppearance.ts`, UI in `settings/ThemeSettingsPanel.tsx`
  (Sektion „Chat"). Canvas-Indikator: `chat/ThinkingIndicator.tsx` + `chat/thinkingIndicatorPainters.ts`
  (sechs reine Painter, portiert aus dem Mock). Wort-Wrapping: `apps/web/src/markdown-stream-words.ts`.
  CSS: Block „chat appearance" am Ende von `apps/web/src/vide-theme.css`.
- `2d9efa166` — Bugfix, wichtig: `markdownComponents` in `ChatMarkdown.tsx` war auf `text` memoisiert.
  react-markdown übergibt jeden Eintrag der `components`-Map als **Element-Typ** an die JSX-Runtime,
  also erzeugte jeder Delta neue Renderer-Identitäten und React warf den ganzen Absatz-DOM weg.
  Behoben über `latestFromText`-Ref. **Nicht zurückdrehen** — sonst remountet jeder Absatz pro Token.
- `48fcf3521` — `CLAUDE.md` ist jetzt die echte Datei (war ein kaputter Symlink auf `AGENTS.md` mit
  Newline im Link-Target), `AGENTS.md` ist der Zeiger.

**Was davon nicht funktioniert und deshalb umgebaut werden muss:** die Streaming-Animation hängt an
`isStreaming`, und `enableAssistantStreaming` ist standardmäßig **aus**
(`packages/contracts/src/settings.ts:440`, Server läuft dann in `"buffered"`,
`ProviderRuntimeIngestion.ts:1476`). Ergebnis: der Text erscheint schlagartig, die Animation läuft nie.
Der Mock deckt Wörter auf **eigener Uhr** auf (`delayOf(i) = i * step + noise`) — das muss unabhängig
von echtem Streaming laufen. Nur der laufende Turn animiert; eine alte Nachricht, die beim Scrollen
neu mountet, darf nicht erneut loslaufen.

## Die zwei Fehler der Vorsession — nicht wiederholen

1. **Nie in die laufende App geschaut.** Die Streaming-Animation war fertig, getestet, committet — und
   funktionierte nie, weil sie an einem Setting hing, das aus ist. Ein Blick hätte es gezeigt.
   **Vor jedem „fertig": App starten und ansehen.**
2. **Falsche Frage gestellt.** Ich habe nach Model-_Reasoning_ (Chain-of-Thought) gesucht, es nicht
   gefunden, und daraus geschlossen, die Gedanken-Absätze des Mocks seien nicht baubar. Falsch: die
   Prosa zwischen den Tool-Calls sind gewöhnliche **Assistant-Kommentar-Nachrichten**, und die hat die
   App längst. Siehe unten.

## Was die App bereits kann (verifiziert, mit Fundstellen)

**Alles im Mock hat eine Datenquelle. Nichts ist blockiert, keine Server-Änderung nötig.**

- **Prosa zwischen Tool-Calls** = nicht-terminale Assistant-Nachrichten.
  `MessagesTimeline.logic.ts:541` (`showAssistantMeta`), `:420` (`terminalAssistantMessageIds`).
  Das ist der Inhalt, den der Mock als `.think`-Absätze rendert.
- **„Worked for 8m 38s"-Einklappen** existiert bereits: `MessagesTimeline.logic.ts:391`, Row-Typ
  `turn-fold` bei `:449`.
- **Tool-Calls mit Aufklappen** existieren: `SimpleWorkEntryRow` in `MessagesTimeline.tsx:1964`.
- **Turn-Timing**: `latestTurn.startedAt` / `completedAt` / `state === "running"`
  (`packages/contracts/src/orchestration.ts:334`), `activeTurnStartedAt` in `session-logic.ts:305`.
- **Status-Phrasen** für die Live-Zeile: `WorkLogEntry.toolTitle`, sonst `label`. Bei `task.progress`
  echte Phrasen wie „Searching for API endpoints" (`session-logic.ts:685`).

### Tool-Call-Felder (`WorkLogEntry`, `session-logic.ts:62-80`)

`id`, `createdAt`, `turnId`, `label`, `detail`, `command`, `rawCommand`, `changedFiles`, `tone`,
`toolTitle`, `toolData`, `itemType`, `requestKind`, `toolLifecycleStatus`, `sourceActivityKind`.

**Output-Verfügbarkeit — Einschränkung:** MCP-Calls behalten das volle Result in `toolData`
(`session-logic.ts:737`). Für Commands wird `stdout` **ausdrücklich nicht** übernommen
(`session-logic.ts:1126`); es gibt nur eine einzeilige, auf 180 Zeichen gekürzte `detail`-Preview
(`ProviderRuntimeIngestion.ts:203`). Die aufgeklappte Zeile des Mocks (`out: "42 matches · 6 files"`)
lässt sich für MCP echt füllen, für Commands nur mit dem, was da ist.

**Gruppierung:** rein positionell — aufeinanderfolgende `kind: "work"`-Einträge
(`MessagesTimeline.logic.ts:462`). Kein Feld verbindet Tool-Calls mit einer vorausgehenden
Kommentar-Nachricht; gemeinsam ist nur `turnId`. Der Mock gruppiert pro Gedanke — das muss über die
Reihenfolge nachgebaut werden (Kommentar-Nachricht, dann die Work-Einträge bis zur nächsten
Nachricht).

### In-Chat-Datei-Diff — geht, fast ohne neuen Code

- `getTurnDiff` liefert **einen** kompletten `git diff --patch` über alle Dateien des Turns
  (`apps/server/src/vcs/GitVcsDriver.ts:806`). Client-Atom:
  `packages/client-runtime/src/state/orchestration.ts:11`. Range: `checkpointTurnCount - 1 → checkpointTurnCount`
  (`DiffPanel.tsx:485`). Für `fromTurnCount === 0` nimmt die App `getFullThreadDiff`.
- `getRenderablePatch(patch, cacheScope)` zerlegt ihn in `FileDiffMetadata[]`
  (`apps/web/src/lib/diffRendering.ts:44`), Rückgabe `{kind:"files"|"raw"}`.
- `FileDiff` aus `@pierre/diffs/react` wird **bereits inline in einer Chat-Row** gerendert —
  Review-Kommentare, `MessagesTimeline.tsx:1718`. Keine Right-Panel-Annahme: keine feste Breite, kein
  Panel-Scroller, Theme aus `TimelineRowCtx`. Genau das recyceln.
- Das Right-Panel bleibt unangetastet: `onOpenTurnDiff` (`ChatView.tsx:5718` → `diffPanelStore` +
  `rightPanelStore`) bleibt als „Open diff"-Knopf bestehen, wird aber **nicht** mehr beim Klick auf
  eine Datei ausgelöst.

## Die Lücke — das ist die eigentliche Arbeit

| Mock                                                                                    | App heute                                      |
| --------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Statuszeile: Orb, tauschender Statustext, `·`, laufender Timer, Chevron                 | „Worked for 8m 38s" als statische Pille        |
| Tool-Gruppe = **eine** Zeile, Live-Text wechselt pro Call, klappt zu „Read 3 files" ein | jede Zeile einzeln + „+2 previous tool calls"  |
| Sheen läuft durch lebenden Text (`.shimmer`)                                            | nichts                                         |
| Wörter erscheinen gestaffelt                                                            | alles auf einmal                               |
| `grid-template-rows: 0fr→1fr` für **jedes** Auf/Zu                                      | teils hart, teils gar nicht                    |
| Datei klappt inline zu ihrem Diff auf                                                   | Sprung ins Git-Panel                           |
| Ein `--gutter`, jeder Text auf derselben Kante                                          | uneinheitlich                                  |
| Transcript und Composer gleich breit (`min(760px,100%)`, 24px)                          | Transcript `max-w-3xl`, Composer eigene Breite |

## Handover-Contract aus dem Mock (dessen eigener Kommentar, Zeile 20-31)

```
--gutter      Icon-Spalte / Text-Einzug für den ganzen Turn
--orb-color   Farbe des Indikators (unset = folgt dem Text)
--orb-size    Höhe des Indikators — an die Schriftgröße gebunden, nie größer
--orb-speed   Taktmultiplikator
--word-anim / --word-dur / --word-ease   die Streaming-Variante
.head[data-state="live"|"done"]          Statuszeile / eingeklappte Verlaufszeile
.work[data-state="idle"|"live"|"done"]   Tool-Gruppe vor/während/nach ihren Calls
.grow[data-on]                           die eine Auf/Zu-Mechanik (0fr -> 1fr)
[data-stream="on"] .word                 Wort-für-Wort-Reveal
.shimmer                                 Sheen durch lebenden Text
```

Wichtige Details im Mock, die leicht durchrutschen: `swap()` misst die Zielbreite mit einem
unsichtbaren Klon und morpht die Box (`fit()`, Zeile 1671) — der Text springt nie. Der Orb friert am
Ende auf einem Standbild ein (`orbFrame(0.6)`, Zeile 1983). Ein fertiger Gedanke behält seinen Sheen,
solange **seine** Tools laufen (Zeile 1927).

## Fallstricke im Repo

- **Theme-Token-Gate.** `scripts/theme-tokens/check.ts` blockiert beim Commit Werte, die benutzt aber
  nicht im Theme deklariert sind — das Spiegelbild des Dead-Code-Gates. Pixel aus dem Mock also
  **nicht** direkt einsetzen: erst als Token in `vide-theme.css`, dann verwenden.
- **Dead-Code-Gate.** Blockiert bei neu exportierten Symbolen ohne Referenz. Symbol löschen statt
  Baseline aktualisieren. Nur-von-Tests-referenziert ist eine Notiz, kein Block.
- **Tests aus dem Package-Verzeichnis starten** (`cd apps/web && vp test run src/...`). Vom Repo-Root
  greift der Glob in `.claude/worktrees/theme-tokens` und meldet eine Phantom-Failure.
- **`vp lint`**: die `no-unstable-nested-components`-Warnungen in `ChatMarkdown.tsx` sind Bestand,
  nicht neu.
- **Node-Builtins in `apps/web`** brauchen `// @effect-diagnostics nodeBuiltinImport:off` und
  Namespace-Import (`import * as NodeFS from "node:fs"`) — siehe `chatAppearance.test.ts`.
- **CSS-Import im Test** liefert `""`. Stylesheet mit `NodeFS.readFileSync` lesen, sonst geht die
  Assertion gegen einen leeren String durch.

## Verifikation

```bash
cd apps/web && npx tsgo --noEmit
cd apps/web && vp test run src/components/chat/...
vp lint <dateien> && vp fmt <dateien>
node scripts/dead-code/check.ts
node scripts/theme-tokens/check.ts
```

App ansehen — **Pflicht, bevor irgendetwas „fertig" heißt:**

```bash
node scripts/dev-runner.ts dev:desktop     # Electron-Fenster
node scripts/dev-runner.ts dev             # Browser
```

Ports und `baseDir` aus der `[dev-runner]`-Zeile lesen. Im Browser braucht es einen Pairing-Token:

```bash
VIDE_PORT=<port> node apps/server/src/bin.ts auth pairing create \
  --base-dir ~/.vide --dev-url http://localhost:<web> --base-url http://localhost:<web> --ttl 30m
```

## Aufräumen (offen)

- `chat-section.png` (255 KB Screenshot) liegt versehentlich im Repo-Root und ist in `425df8821`
  committet. Entfernen.
- `.serena/memories/` und `agent-flow-motion-mock.html` sind untracked. Der Mock ist die Spec — evtl.
  bewusst einchecken oder nach `docs/` verschieben.
- Branches `chat-motion-settings` und `chat-turn-rework` sind erledigt bzw. veraltet, können weg.

## Reihenfolge für die Umsetzung

1. Spalte + Gutter: Transcript und Composer auf ein Token-Paar, Hanging-Indent für den ganzen Turn.
2. Wort-Reveal auf eigener Uhr, unabhängig von `enableAssistantStreaming`, nur beim laufenden Turn.
3. Die eine `grow`-Mechanik (`0fr→1fr`) für jedes Auf/Zu.
4. Statuszeile: Orb, `swap()`-Textwechsel mit Breiten-Morph, Timer, Chevron, Sheen.
5. Tool-Gruppe als eine Zeile mit wechselnder Live-Beschriftung → Zusammenfassung → aufklappbar zu
   den Calls.
6. Einklappen am Ende auf „Worked for n", Orb friert ein, Klick klappt wieder auf.
7. Changed-Files-Karte mit Inline-Diff pro Datei (`getTurnDiff` + `getRenderablePatch` + `FileDiff`).
8. Orb-Farbe als Theme-Setting über den vorhandenen Color-Picker
   (`apps/web/src/components/ui/color-picker.tsx`).

Nach jedem Schritt in der App ansehen.
