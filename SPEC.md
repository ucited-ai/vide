# SPEC — Multi-Account OAuth, automatisches Failover und Usage Center

Status: zur Freigabe vor Implementierung  
Stand: 2026-08-01

## 1. Ziel

vIDE soll mehrere bezahlte Claude- und Codex-/ChatGPT-Accounts gleichzeitig verwalten können. Ein Account wird einmal verbunden und bleibt danach als eigene Provider-Instanz verfügbar. Beim Erreichen eines echten Subscription-Limits wechselt vIDE automatisch auf einen kompatiblen Account mit verfügbarer Kapazität und setzt den Turn im Normalfall ohne erneutes OAuth und ohne Verlust des Thread-Kontexts fort.

Zusätzlich bekommt Settings einen eigenständigen großen Bereich **Usage**. Er ist der zentrale Einstieg für:

- aktuelle Limits aller Accounts,
- Gesamtverbrauch über Claude und Codex,
- historische Token-Nutzung,
- Filter nach Zeitraum, Provider, Account und Modell,
- Drill-down auf einen einzelnen Account,
- manuelles Umschalten und Konfiguration der Failover-Reihenfolge.

Der bisherige Chat-Seitenbereich **Environment** wird zu **Details**. Er bleibt eine schnelle, threadbezogene Oberfläche und zeigt nur den gerade aktiven Account, die knappsten Limits und einen Link in das vollständige Usage Center.

## 2. Festgelegte Produktentscheidungen

1. **Settings erhält `/settings/usage` als eigenen Hauptbereich.** Usage wird nicht in Providers oder General gequetscht.
2. **Die Defaultansicht ist ein echtes Master-Dashboard, keine Wand aus Quota-Bars.** Vier nackte Gesamtkennzahlen, eine GitHub-artige Activity Map und ein sortierter Account Index bilden die Übersicht. Pro Account erscheint dort nur der aktuell engste Flaschenhals; alle Quota-Fenster liegen im Drill-down.
3. **Live-Limits und Historie erscheinen gemeinsam, aber visuell und semantisch getrennt.** Prozentwerte der Provider-Quota werden niemals aus lokalen Token-Logs geschätzt.
4. **Automatisches Failover ist die Standardoption beim Verbinden eines zweiten Accounts desselben Providers.** Bestehende Installationen werden nicht ungefragt aktiviert; der Connect-Flow zeigt die aktivierte Option einmalig an.
5. **Normale Limitfehler werden automatisch fortgesetzt.** Nur ein seltener Fall mit bereits ausgeführten, nicht sicher wiederholbaren Side Effects darf eine Bestätigung verlangen.
6. **Claude-Accounts werden nicht durch das globale macOS-Claude-Keychain-Item geroutet.** vIDE hält pro Provider-Instanz einen eigenen vollständigen OAuth-Credential-Satz und bindet den passenden Access Token an den Claude-Prozess.
7. **Claude-Credentials liegen im bestehenden vIDE `ServerSecretStore`.** Das bedeutet atomare Dateien in einem `0700`-Verzeichnis mit `0600`-Dateien; das ist Zugriffsschutz durch das Dateisystem, keine Verschlüsselung at rest. Tokens landen nie in Settings, SQLite, RPC-Antworten oder Logs.
8. **Codex behält die bereits vorhandene native Isolation.** Pro Account gibt es ein privates `auth.json` im Codex-`authOverlay`/Shadow Home; Sessions und Verlauf bleiben über das gemeinsame `CODEX_HOME` geteilt.
9. **Fable wird unterstützt.** Modellbezogene Claude-Limits werden datengetrieben aus `limits[]` und nicht über fest verdrahtete Feldnamen gelesen. Historische Fable-Tokens werden über das tatsächlich geloggte Modell aggregiert.
10. **Historische Gesamtwerte sind ehrlich gekennzeichnet.** Nicht eindeutig einem Account zuordenbare Altlogs erscheinen als „Unassigned“, statt einem falschen Account zugeschlagen zu werden.

## 3. In Scope

### Accounts und OAuth

- Mehrere Provider-Instanzen für `claude` und `codex` mit je einem Account.
- Einmaliger Connect-/Reconnect-Flow aus vIDE.
- Account-Metadaten: Provider, E-Mail wenn verfügbar, Plan, Auth-Status, Ablaufstatus und konfigurierbarer Anzeigename/Farbe.
- Manueller Wechsel:
  - „Use now“ für den letzten aktiven, kompatiblen Thread,
  - „Make default“ für neue Threads,
  - bestehender Model-/Provider-Picker bleibt verwendbar.
- Pro Provider konfigurierbare Failover-Reihenfolge.
- Warnung, wenn zwei Instanzen versehentlich denselben Provider-Account repräsentieren.

### Automatisches Failover

- Preflight-Wechsel, wenn der aktive Account laut frischem Snapshot erschöpft ist.
- Reaktiver Wechsel bei einem typisierten Provider-Limitfehler.
- Erhalt des bestehenden Threads und Resume-Cursors bei kompatibler Continuation Group.
- Genau ein automatischer Wiederanlauf pro weiterem Account und Turn; keine Schleifen.
- Sichtbare, aber nicht blockierende Chat-Aktivität: „Limit reached on Personal · switched to Work · continuing“.
- Wenn alle kompatiblen Accounts erschöpft sind: klare Fehlermeldung mit den bekannten Reset-Zeiten.

### Usage Center

- Gesamtansicht über alle verbundenen Claude- und Codex-Accounts.
- Provider-Gruppenansicht für nur Claude oder nur Codex.
- Einzelaccount-Ansicht.
- Live-Quota einschließlich Reset-Zeit, Frische/Quelle und Zustand.
- Historischer Gesamt-Tokenverbrauch sowie Zeitreihe.
- Filter:
  - Zeitraum: `24h`, `7d`, `30d`, `90d`, `1y`, `All` sowie Custom Range,
  - Provider,
  - Account,
  - Modell,
  - Gruppierung: Account, Provider oder Modell.
- Kennzahlen: Total Tokens, Input, Output, Cache Read/Creation soweit verfügbar, Reasoning soweit verfügbar, Turns.
- Datenabdeckung pro Ansicht: Provider-Account-Historie, vIDE-Ledger, lokaler Import oder Unassigned.
- Incremental Backfill bestehender lokaler Claude-/Codex-Logs ohne doppelte Einträge.
- Responsive Desktop-/Mobile-UI, Tastaturbedienung, Screenreader-Texte und Reduced Motion.

### Details-Seitenbereich im Chat

- UI-Name, Tooltip und Accessibility-Label von „Environment“ auf „Details“ ändern.
- Neuer kompakter Abschnitt „Account“ oberhalb des bestehenden Environment-Inhalts:
  - aktiver Account,
  - maximal zwei aktuell limitierende Quota-Werte als kompakte Datenzeilen,
  - Auto-switch-Zustand,
  - kompatibler Quick Switch,
  - „Open Usage“.
- Bestehende Environment- und Sources-Inhalte bleiben funktional unverändert.

## 4. Explizit Out of Scope

- Automatisches Verteilen normaler Turns zur Lastverteilung; Accounts wechseln nur manuell oder bei Limit/Auth-Ausfall gemäß Routingregel.
- Automatischer Wechsel zwischen Claude und Codex. Failover bleibt innerhalb desselben Drivers und derselben Continuation Group.
- Stiller Modellwechsel, wenn ein Zielaccount das aktuelle Modell nicht unterstützt.
- Darstellung von Subscription-Quota als vermeintliche absolute Token-Grenze; Provider liefern überwiegend Prozente.
- API-equivalente Kostenberechnung. Subscription-Usage ist kein tatsächlich berechneter API-Preis.
- Team-Admin-Analytics oder Cloud-Synchronisierung der lokalen Usage-Daten.
- Export, CSV, Alerts/Push Notifications und Forecasting in V1.
- Übernahme eines kompletten externen Dashboards oder Start eines dauerhaften `ccusage`-/Orbit-Subprozesses.
- Kopieren von GPL-Code aus onWatch. Die Recherche dient nur als Architektur- und Verhaltensreferenz.
- Vollständige Verschlüsselung des bestehenden `ServerSecretStore` oder Migration in den OS-Keychain in diesem Feature.
- Exakte Account-Zuordnung historischer Altlogs, wenn die Quelldaten keine Account-Identität enthalten.

## 5. Technische Ausgangslage

### Was vIDE bereits kann

- `ProviderInstanceConfig` erlaubt bereits mehrere Instanzen desselben Drivers.
- Codex besitzt mit `CodexHomeLayout` ein `authOverlay`: private `auth.json`, gemeinsam verlinkte Sessions und derselbe Continuation Key.
- `ProviderCommandReactor` kann innerhalb desselben Drivers auf eine Instanz mit identischem Continuation Key wechseln und den Provider-Thread neu starten/resumen.
- Claude kann per `CLAUDE_CONFIG_DIR` ein anderes Home nutzen, aber auf macOS bleibt die Subscription-Authentifizierung im globalen Keychain-Item. Unterschiedliche Claude Homes isolieren dort deshalb die Accounts nicht.
- Runtime Events enthalten `providerInstanceId` und normalisierte Token-Snapshots, werden bisher aber nicht als abfragbares Usage-Ledger persistiert.
- SQLite, Migrationen, Effect Services und WebSocket-RPC sind bereits vorhanden.
- Settings hat file-based Routes und eine eigene Sidebar; `Usage` kann als gleichwertiger Bereich ergänzt werden.

### Verifizierte Provider-Oberflächen

- Codex app-server:
  - `account/login/start`, `account/login/completed`, `account/logout`,
  - `account/rateLimits/read` und `account/rateLimits/updated`,
  - `account/usage/read` mit `lifetimeTokens` und täglichen Token-Buckets,
  - typisierter `usageLimitExceeded`-Fehler.
- Claude Agent SDK/CLI:
  - `rate_limit_event` mit 5h-/7d-/modellbezogenen Grenzen,
  - experimentelle strukturierte Usage-Abfrage,
  - `SDKAssistantMessage.error === "rate_limit"`,
  - dokumentierte `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` und `CLAUDE_CODE_OAUTH_SCOPES`.
- Anthropic Usage:
  - bekannte Fenster wie `five_hour` und `seven_day`,
  - neuere modellbezogene Limits dynamisch in `limits[]`, darunter Fable,
  - der volle Login-Token braucht u. a. `user:profile`; ein `claude setup-token` besitzt nur Inference-Rechte und reicht deshalb nicht als alleinige Quelle für das Usage Center.

## 6. UX- und Visual-Design

### 6.1 Gegenstand, Nutzer und einziger Job

- **Gegenstand:** ein lokales Instrumentenpanel für die verfügbare Arbeitskapazität mehrerer Coding-Agent-Subscriptions.
- **Nutzer:** ein Power User, der parallel mit mehreren Claude- und Codex-Accounts arbeitet und Unterbrechungen vermeiden will.
- **Einziger Job der Seite:** innerhalb weniger Sekunden beantworten: „Wie viel Kapazität ist noch da, welcher Account läuft gerade und wie hat sich mein Verbrauch entwickelt?“

### 6.2 Visuelle Richtung

Die Seite erweitert die vorhandene vIDE-Material- und Typografie-Sprache; sie wirkt nicht wie ein fremdes Analytics-SaaS.

**Palette, repräsentativ für Light Mode; im Code ausschließlich über bestehende semantische Theme-Tokens:**

- Ledger `#F7F7F8`
- Paper `#FDFDFD`
- Ink `#18181B`
- Quiet ink `#71717A`
- Activity signal `#5B6CFF`
- Critical `#E5484D`

Die Activity Map leitet fünf diskrete Intensitätsstufen aus dem bestehenden Primary-Token ab. Provider-/Account-Farben kommen nur als kleiner Identitätsmarker aus der vorhandenen `accentColor`; die Gesamtansicht wird nicht in vier konkurrierende Farben zerlegt. Warnung und Critical erscheinen ausschließlich bei tatsächlichem Handlungsbedarf. Keine Gradients, Glow-Effekte, Donut Charts oder dekorativen Sparklines.

**Typografie:**

- Section-/Account-Titel: vorhandenes `SF Pro Display`/System-Display, semibold, enge vIDE-Tracking-Werte.
- UI und Erklärtext: `SF Pro Text`/System-Sans.
- Zahlen, Prozentwerte, Reset-Zeit und Achsen: `SF Mono`/bestehendes `--font-mono`, tabular nums.

**Signatur:** das **Activity Field** — eine GitHub-artige, aber für Tokenverbrauch adaptierte Matrix aus Zeitkästchen. Intensität kodiert Usage; Fokus oder Klick auf ein Feld zeigt Datum, Tokens, Turns und den stärksten Account-/Modellanteil. Fokussiert man im Account Index einen Account, wechselt die Matrix in einen ruhigen X-ray-Modus: die Kontur behält die Gesamtaktivität, die Füllung isoliert den Anteil dieses Accounts auf derselben Skala; die Readout-Zeile nennt zusätzlich den exakten Anteil. So wird Multi-Account-Verteilung sichtbar, ohne vier Charts oder Farbstapel einzubauen. Die Matrix bleibt das einzige dominante Visual der Seite.

### 6.3 Designkritik und Revision

Der erste Entwurf mit einer „Capacity Runway“ war trotz fehlendem Card Grid zu repetitiv: vier Accounts multipliziert mit 5h, Weekly, Fable und Credits erzeugt viele fast gleichartige Balken. Er priorisierte Provider-Payloads statt der eigentlichen Nutzerfragen.

Die Revision entfernt deshalb sämtliche Progress Bars aus der Masteransicht:

- oben nur vier belastbare Überblickswerte,
- genau ein visuelles Zentrum: das Activity Field,
- darunter ein Account Index als ruhige, sortierte Liste,
- pro Account nur Status plus engstes relevantes Limit,
- vollständige Quota-Fenster erst nach Klick auf den Account,
- Breakdown nur bei Bedarf unterhalb der Übersicht.

Auch große KPI Cards wurden verworfen. Die Zahlen stehen „nackt“ in einem typografischen Ledger mit Hairline-Trennungen. Dadurch bleibt die Hierarchie klar, ohne dass jede Information einen eigenen Container beansprucht.

### 6.4 Informationsarchitektur

`Settings > Usage` wird in der Sidebar direkt nach `Providers` einsortiert.

Die Seite hat vier klar getrennte Ebenen:

1. **Scope und Zeitraum** — eine reduzierte Control Row.
2. **Usage headline** — drei periodenbezogene Kennzahlen plus ein klar abgesetzter Live-Wert.
3. **Activity** — zeitliche Usage als interaktive Kästchenmatrix.
4. **Accounts** — sortierter Master Index mit Drill-down und Routingaktionen.

Die Accountauswahl ist zugleich Navigation:

- `All accounts`
- `Claude`
- `Codex`
- einzelner Account

Damit gibt es nicht zusätzlich noch Tabs für „Overview“ und „Account“.

### 6.5 Desktop-Wireframe: Master-Dashboard

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Usage                    [All accounts ▾]       [30d ▾]  [Filters · 0]  ↻   │
│                                                                              │
│ PERIOD · 30 DAYS                                             NOW             │
│ 184.2M                 6.1M / day        1,284                3 / 4          │
│ total tokens           average           turns                ready accounts │
│ 62.4M input · 14.8M output · 107.0M cache                  updated 18s ago   │
├──────────────────────────────────────────────────────────────────────────────┤
│ ACTIVITY                                                    [Tokens ▾]       │
│ Jul                                                               Aug       │
│ Mon  ▫ ▫ ▪ ▪ ▫ ▫ ▫  ▪ ▪ ▪ ▫ ▫ ▫  ▪ ▪ ▪ ▪ ▫ ▫ ▪  ▪ ▫ ▫ ▪ ▪ ▪ ▪ ▪          │
│ Wed  ▫ ▪ ▪ ▫ ▫ ▫ ▪  ▪ ▫ ▪ ▪ ▪ ▫  ▫ ▪ ▪ ▫ ▫ ▪ ▪  ▪ ▪ ▫ ▫ ▪ ▪ ▫ ▪          │
│ Fri  ▪ ▪ ▫ ▪ ▫ ▪ ▪  ▫ ▫ ▪ ▪ ▪ ▪  ▪ ▫ ▪ ▪ ▪ ▪ ▫  ▪ ▫ ▪ ▪ ▪ ▫ ▪ ▪          │
│      Less  ▫ ▫ ▪ ▪ ▪  More       Thu, Jul 31 · 8.4M tokens · 17 turns      │
├──────────────────────────────────────────────────────────────────────────────┤
│ ACCOUNTS                              Auto-switch on              [Manage]   │
│                                                                              │
│ CLAUDE · 2                                                                  │
│ ● Personal   sonnenjh@…       Active · Ready      36% left · 5h       ›     │
│ ● Work       h.sonnen@…       Next · Ready        73% left · weekly   ›     │
│                                                                              │
│ CODEX · 2                                                                   │
│ ● Personal   sonnenjh@…       Active · Limited    resets in 46m       ›     │
│ ● Work       h.sonnen@…       Next · Ready        88% left · weekly   ›     │
│                                                                              │
│ Unassigned local activity · 2.8M tokens                         [Review]     │
└──────────────────────────────────────────────────────────────────────────────┘
```

Die Übersicht verwendet eine zusammenhängende Fläche mit Section Rules statt einzelner Cards. Die vier Headline-Werte sind:

1. `Total tokens` im gewählten Zeitraum,
2. `Average per day` als Pace,
3. `Turns`,
4. `Ready accounts` als explizit mit „Now“ gekennzeichneter Live-Wert.

Input, Output und Cache sind eine sekundäre Composition-Zeile unter Total Tokens. Ein Vergleich mit der Vorperiode erscheint nur, wenn eine gleich lange, vollständig abgedeckte Vergleichsperiode vorhanden ist; sonst wird kein künstliches Delta gezeigt.

`Ready accounts` zählt nur authentifizierte Accounts, die ihr konfiguriertes Default-/aktuelles Modell nach einem frischen Snapshot ausführen können. Ein ausschließlich erschöpftes Fable-Fenster setzt einen sonst nutzbaren Claude-Account auf `Restricted`, nicht auf `Limited`. Bei fehlenden oder stale Daten zeigt die Headline beispielsweise `3 ready · 1 unknown` statt einer irreführenden Quote.

### 6.6 Desktop-Wireframe: Einzelaccount

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ‹ All accounts   ● Claude · Work                               [Use now]  ···│
│                  h.sonnen@… · Max · Connected                               │
│                  [30d ▾] [Model: All ▾]                                     │
├──────────────────────────────────────────────────────────────────────────────┤
│ PERIOD · 30 DAYS                                             NOW             │
│ 44.2M tokens       1.5M / day       318 turns              Ready            │
│ 14.2M input · 4.1M output · 25.9M cache                  updated 18s ago     │
├──────────────────────────────────────────────────────────────────────────────┤
│ ACTIVITY · WORK                                                              │
│      ▫ ▫ ▪ ▪ ▫ ▫ ▫  ▪ ▪ ▪ ▫ ▫ ▫  ▪ ▪ ▪ ▪ ▫ ▫ ▪  ▪ ▫ ▫ ▪ ▪ ▪ ▪ ▪          │
├──────────────────────────────────────────────────────────────────────────────┤
│ LIMITS                                                                       │
│ 5 hour             8% used · 92% left                  resets in 4h 12m      │
│ Weekly            27% used · 73% left                  Tuesday 09:00         │
│ Fable              Not used this window                Monday 09:00          │
├──────────────────────────────────────────────────────────────────────────────┤
│ MODELS                                  Tokens       Share       Turns       │
│ Fable 5                                 18.2M        41%         84          │
│ Claude Sonnet …                         …            …           …           │
│                                                                              │
│ Failover position 2 · Local history since Aug 1          [Manage provider]  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Auch im Account-Drill-down sind Quotas primär typografische Datenzeilen, keine Card-Sammlung. Ein optionaler sehr dünner Fill darf nur im fokussierten Limit erscheinen; die Zahlen und Reset-Zeit bleiben die eigentliche Information.

### 6.7 Filter- und Navigationsverhalten

- Filter werden in der URL gespiegelt: `scope`, `from`, `to`, `provider`, `account`, `model`, `groupBy`.
- Zeitraum und Gruppierung bleiben beim Drill-down erhalten.
- Default ist `All accounts`, `30d`, Gruppierung nach Account.
- Das Activity Field passt seine Kästchen an den Zeitraum an:
  - 24h: 24 Stundenfelder,
  - 7d: vier 6h-Felder pro Tag,
  - 30d/90d: Tagesfelder im Wochenraster,
  - 1y: klassisches 52×7-Kalenderraster,
  - All: Wochenfelder mit Jahresmarken und serverseitig begrenzter Bucketzahl.
- Custom Range liegt hinter dem Range-Control-Overflow und öffnet einen kleinen Date-Range-Popover.
- `All accounts` und Zeitraum bleiben immer sichtbar. Provider, Account, Modell und Gruppierung liegen im kompakten `Filters · N`-Popover; Mobile verwendet dafür ein Bottom Sheet.
- Jedes Activity-Feld ist per Tastatur fokussierbar. Hover/Fokus aktualisiert eine feste Readout-Zeile; Klick pinnt den Zeitraum und aktualisiert das Breakdown, ohne ein Tooltip-Mosaik zu erzeugen.
- Die Intensität verwendet Quantile innerhalb des gewählten Scopes. Exakte Tokens und Turns stehen immer im Readout; Farbe ist nicht die einzige Informationsquelle.

### 6.8 Account-Aktionen

- Klick auf eine Accountzeile öffnet den Drill-down auf derselben Route; Filter und Scrollposition des Master-Dashboards werden für Back Navigation erhalten.
- Die gesamte Accountzeile ist ein klarer Link. `Use now` liegt im getrennten Overflow-Menü, damit Row-Navigation und Account-Aktion nicht konkurrieren.
- Wenn ein kompatibler letzter Thread existiert, bedeutet `Use now`: aktuellen Thread und Default umstellen.
- Ohne kompatiblen Thread lautet die Aktion `Make default`.
- Ein Toast nennt den Scope exakt: „Work is now used for this thread and new threads.“
- Ein Drei-Punkte-Menü enthält `Reconnect`, `Manage provider`, `Remove account`; Secret-Werte werden nie angezeigt oder kopiert.
- Der Master Index ist nicht frei nach Prozent sortiert: zuerst Provider, darin Active, Failover-Reihenfolge und anschließend nicht routbare Accounts. So bleibt die Liste räumlich stabil.
- Pro Account zeigt die Masteransicht genau ein Limit: das aktuell engste relevante Fenster. Fable erscheint dort nur, wenn es tatsächlich der Flaschenhals ist; alle Fenster stehen im Drill-down.
- Hover oder Keyboard-Fokus einer Accountzeile isoliert deren Anteil im Activity Field; das ist eine Vorschau, keine Voraussetzung zum Erreichen von Informationen.
- Das ausführliche Breakdown ist im Master standardmäßig eingeklappt. Es öffnet sich über `Show breakdown` oder automatisch für ein gepinntes Activity-Feld.

### 6.9 Mobile

- Die Headline zeigt `Total tokens` über die volle Breite; Pace, Turns und Ready Accounts stehen darunter als dreispaltige Zahlenzeile.
- Das Activity Field nutzt ein verdichtetes Raster ohne Page-Overflow. Die sichtbaren Zellen dürfen kleiner als 44 px sein; zugängliche Row-/Column-Navigation und die feste Readout-Zeile übernehmen die Bedienung, statt jede Zelle als großes Touch Target aufzublähen.
- Fokuswerte erscheinen oberhalb der Matrix statt als pointer-only Tooltip.
- Accountzeilen stapeln Identität, Status und das engste Limit; Aktionen liegen im Overflow-Menü.
- Die Tabelle wird zu einer sortierten Breakdown-Liste.
- Alle eigentlichen Controls und Accountzeilen haben mindestens 44 px Touchhöhe; keine Information erfordert Hover.

### 6.10 Loading, Empty, Stale und Error

- Skeletons übernehmen exakt die spätere Headline-/Matrix-/Listengeometrie.
- Keine Accounts: „Connect a Claude or Codex account to see limits and history.“ plus zwei konkrete Connect-Aktionen.
- Keine Historie: Live-Limits bleiben sichtbar; darunter „History starts after the first synced turn“ und optionaler lokaler Importstatus.
- Stale: letzte bekannte Werte bleiben sichtbar, gedimmt mit `Updated … ago`; niemals auf 0 zurücksetzen.
- Unavailable: klare Ursache und `Reconnect` oder `Retry`.
- Unassigned Altlogs: eigener neutraler Breakdown-Eintrag mit Erklärung.
- Fable nicht im Provider-Payload: im Detail ausblenden, nicht als 0 Prozent vortäuschen.
- Fable im Plan, aber noch ohne aktives Fenster: „Not used this window“.
- Kein vollständiger Vergleichszeitraum: Pace ohne Trendpfeil zeigen.

## 7. Account- und Credential-Architektur

### 7.1 Identitäten

- `ProviderInstanceId` bleibt der Routing Key.
- `ProviderAccountKey` ist ein serverseitiger, nicht reversibler Fingerprint aus Driver und providerseitigem Subject/Account-ID. Er dient Deduplizierung und historischer Zuordnung.
- E-Mail ist reine Präsentation und darf nicht als Primary Key verwendet werden.
- Ein Provider-Account kann höchstens einer aktiven Instanz desselben Drivers zugeordnet sein; Duplikate werden markiert und nicht als Failover-Ziel verwendet.

### 7.2 Codex

Beim Verbinden eines neuen Codex-Accounts:

1. vIDE erzeugt eine Codex-Provider-Instanz mit gemeinsamem `homePath` und eindeutigem `shadowHomePath`.
2. `CodexHomeLayout` materialisiert das `authOverlay`; Sessions/History bleiben gemeinsam, `auth.json` bleibt privat.
3. vIDE startet `account/login/start` im app-server dieser Instanz.
4. Der Browser-/Device-Flow läuft einmal; Codex persistiert und refresht seine Tokens nativ.
5. Profil, Plan, Limits und Usage werden über dieselbe isolierte app-server-Instanz gelesen.

Codex-Tokens werden nicht zusätzlich in `ServerSecretStore` dupliziert.

### 7.3 Claude

Claude benötigt eine vIDE-eigene Credential-Schicht, weil der klassische macOS-CLI-Login nur ein globales verschlüsseltes Keychain-Item verwendet.

`ProviderAccountCredentialStore` speichert pro Claude-`ProviderInstanceId`:

- Access Token,
- Refresh Token,
- Expiry,
- Scopes,
- Subscription Type,
- minimale, nicht geheime Account-Metadaten getrennt vom Secret-Payload.

Der Runtime-Prozess erhält nur den aktuellen `CLAUDE_CODE_OAUTH_TOKEN`. Der Refresh Token bleibt im Serverprozess. So konkurrieren mehrere laufende Sessions desselben Accounts nicht um rotierende Refresh Tokens.

`ClaudeCredentialManager`:

- serialisiert Refreshes pro Account,
- refresht vor Ablauf oder nach 401 genau einmal,
- schreibt den kompletten rotierten Credential-Satz atomar zurück,
- startet betroffene Claude-Sessions kontrolliert neu und resumt sie,
- redacted alle Fehler und Logs.

### 7.4 Verbindlicher Claude-Isolation-Spike

Vor dem produktiven Connect-Flow muss ein fokussierter Spike diese Punkte auf dem unterstützten Claude-CLI/SDK-Build beweisen:

1. voller Browser-Login mit mindestens `user:inference` und `user:profile`,
2. Extraktion/Übernahme des resultierenden Credential-Payloads ohne Secret-Ausgabe,
3. zwei Accounts parallel in zwei Claude-Prozessen über instance-scoped Access Tokens,
4. Usage-Abfrage für beide Accounts,
5. zentraler Refresh mit Rotation und atomarem Store-Update,
6. bestehender globaler Claude-CLI-Login bleibt nach dem Connect unverändert.

Bevorzugter Pfad: Claude Agent SDK Auth-Control-Flow liefert die Credentials an den Broker, ohne den globalen Store dauerhaft zu verändern.

Fallback auf macOS: globales Keychain-Credential unter exklusivem Broker-Lock sichern, vollständigen Claude-Login ausführen, neuen Credential-Satz importieren und das vorherige globale Credential sofort wiederherstellen. Der Flow darf nicht parallel laufen und warnt vor dem kurzen exklusiven Loginfenster.

Auf Linux/Windows wird ein temporäres `CLAUDE_CONFIG_DIR` als Staging-Verzeichnis verwendet, anschließend importiert und entfernt.

Wenn Punkt 3, 4 oder 5 nicht zuverlässig beweisbar ist, wird Claude Multi-Account nicht halb aktiviert. Der Slice stoppt mit dokumentiertem Blocker; Codex und Usage-Historie können unabhängig weiter implementiert werden.

### 7.5 Claude-Sessionzustand

- Account-Instanzen teilen denselben Claude-`homePath`, damit ihre `continuation.groupKey` identisch ist.
- Authentifizierung kommt ausschließlich aus dem instance-scoped vIDE-Credential und ist nicht mehr an `homePath` gekoppelt.
- Legacy-Instanzen ohne vIDE-Credential dürfen weiterhin den klassischen CLI-Login benutzen, sind aber nicht als automatisches Multi-Account-Failover-Ziel markiert.
- Der Providers-Flow bietet „Convert to managed account“, um einen Legacy-Login einmalig in vIDE zu verbinden.

## 8. Live-Usage und Fable

### 8.1 Normalisierter Vertrag

Neue Contracts in `packages/contracts/src/providerUsage.ts`:

```ts
ProviderAccountSummary {
  instanceId
  driver
  accountKey
  displayName
  email?
  plan?
  accentColor?
  authState
  routingState
}

ProviderQuotaWindow {
  id
  label
  scope: account | model | credits
  modelId?
  modelLabel?
  usedPercent?
  windowDurationMinutes?
  resetsAt?
  status: available | near_limit | exhausted | unknown
}

ProviderAccountUsageSnapshot {
  account
  quotas[]
  fetchedAt
  staleAt
  state: fresh | stale | unavailable | unauthenticated | error
  source: codex_app_server | claude_sdk | runtime_event
}
```

Web-Clients erhalten niemals Tokens oder rohe Providerantworten.

### 8.2 Codex

- Initial: `account/rateLimits/read`.
- Laufend: sparse `account/rateLimits/updated` in den letzten Snapshot mergen; bei Inkonsistenz refetchen.
- Alle Einträge in `rateLimitsByLimitId` dynamisch abbilden.
- Primary/Secondary nicht semantisch fest als 5h/Weekly benennen; `windowDurationMins` und `limitName` bestimmen das Label.
- Fehlende Fenster sind „not reported“, nicht 0 Prozent.

### 8.3 Claude und Fable

- Primär die strukturierte SDK-Usage-Methode kapseln; ihre experimentelle Form verlässt den Driver-Adapter nicht.
- Toleranter Decoder akzeptiert bekannte Top-Level-Felder sowie neue `limits[]`-Einträge.
- `limits[].scope.model.display_name` erzeugt dynamische Modellzeilen, etwa Fable.
- Reihenfolge: 5 hour, Weekly/all models, dann aktive modellbezogene Wochenlimits, danach Extra Usage/Credits.
- Fable-Historie kommt aus dem geloggten Modellnamen, unabhängig davon, ob ein separates Fable-Quota-Fenster existiert.
- Bei Pro/Standard-Plänen kann Fable nur über Usage Credits laufen. Dann zeigt die UI Credits/Planstatus statt einer erfundenen Fable-Prozentgrenze.

### 8.4 Refresh-Policy

- Beim Öffnen von Usage oder Details werden nur Snapshots älter als fünf Minuten aktualisiert.
- Nach einem abgeschlossenen Turn wird der aktive Account frühestens nach 60 Sekunden debounced aktualisiert.
- Manuelles Refresh hat 60 Sekunden Cooldown pro Account.
- Runtime Rate-Limit-Events aktualisieren den Cache sofort.
- 429 respektiert `Retry-After` und exponentiellen Backoff mit Jitter.
- Wenn der Tab geschlossen ist, läuft kein aggressives Polling aller Accounts.

## 9. Historische Usage

### 9.1 Datenquellen und Priorität

1. **Codex Account Usage:** `account/usage/read` liefert Lifetime Tokens und tägliche Buckets pro isoliertem Account. Das ist die kanonische Codex-Gesamtsicht.
2. **Claude lokale Transcripts:** inkrementeller Read-only-Scan der JSONL-Dateien im konfigurierten Claude Home; erfasst Modell und Input/Output/Cache-Tokens.
3. **vIDE Runtime Ledger:** ab Einführung des Features wird jeder abgeschlossene Turn mit `providerInstanceId`, Account-Fingerprint und normalisierten Token-Deltas persistiert. Es liefert die exakteste Account-Zuordnung und überbrückt, bis lokale Provider-Logs geschrieben wurden.
4. **Codex lokale Logs:** nur als Fallback, wenn `account/usage/read` nicht verfügbar ist.

Orbit/`ccusage` dient als Referenz für Logformat, inkrementelles Scannen, Modellnormalisierung und Zeitraumaggregation. vIDE startet keinen externen Dashboard- oder CLI-Prozess.

### 9.2 Deduplizierung und Zuordnung

- Jeder Fact besitzt einen stabilen `sourceKey`, gebildet aus Provider-Session/Turn/Message oder Account/Datum.
- Import ist Upsert und idempotent.
- Für Codex-Tagesgesamtwerte gewinnt die native Account-Usage gegenüber überlappenden lokalen Facts.
- Claude-Transcript-Facts gewinnen gegenüber demselben vIDE-Runtime-Fact, sobald beide über Provider-IDs korreliert sind.
- Eindeutig an eine Provider-Instanz gebundene Home-Verzeichnisse können rückwirkend dem Account zugeordnet werden.
- Wird ein Home von mehreren Accounts geteilt und fehlt im Altlog die Account-ID, bleibt der Fact `unassigned`.
- Unassigned fließt in „All local activity“ und Provider-Gesamtwerte ein, aber nie in eine einzelne Accountsumme.

### 9.3 Persistence

Migration `036_ProviderUsage.ts` ergänzt:

```text
provider_usage_facts
  source_key                 PRIMARY KEY
  provider_driver            NOT NULL
  provider_instance_id       NULL
  provider_account_key       NULL
  source                     NOT NULL
  resolution                 turn | message | day
  occurred_at                NOT NULL
  bucket_end_at              NULL
  thread_id                  NULL
  turn_id                    NULL
  provider_session_id        NULL
  provider_turn_id           NULL
  model                      NULL
  input_tokens               NULL
  cached_input_tokens        NULL
  cache_creation_tokens      NULL
  output_tokens              NULL
  reasoning_output_tokens    NULL
  total_tokens               NOT NULL
  metadata_json              NOT NULL

provider_usage_import_cursors
  source_path_hash           PRIMARY KEY
  source_path                NOT NULL
  file_mtime_ms              NOT NULL
  byte_offset                NOT NULL
  last_scanned_at            NOT NULL

provider_account_metadata
  provider_instance_id       PRIMARY KEY
  provider_driver            NOT NULL
  provider_account_key       NOT NULL
  email                      NULL
  plan                       NULL
  connected_at               NOT NULL
  last_seen_at               NOT NULL
```

Indexes liegen mindestens auf `(occurred_at)`, `(provider_instance_id, occurred_at)`, `(provider_driver, occurred_at)` und `(model, occurred_at)`.

Quota-Snapshots bleiben in einem begrenzten Cache und werden nicht als unbegrenzte zweite Time Series gespeichert; V1-Historie meint Token-Nutzung.

### 9.4 Query-Vertrag

```ts
ProviderUsageHistoryQuery {
  from?
  to?
  rangePreset?
  providerDrivers[]?
  providerInstanceIds[]?
  models[]?
  groupBy: account | provider | model
}

ProviderUsageHistoryResult {
  coverage[]
  totals
  series[]
  breakdown[]
  unassignedTotals?
  effectiveBucket: hour | six_hours | day | week
}
```

Aggregation geschieht im Server/SQLite. Der Browser erhält bereits begrenzte, für Activity Field und Breakdown fertige Buckets; keine vollständige Eventliste.

## 10. Routing und automatisches Fortsetzen

### 10.1 Neue typisierte Fehlerursache

`TurnCompletedPayload` erhält:

```ts
failureCause?:
  | "usage_limit"
  | "authentication"
  | "overloaded"
  | "transport"
  | "other"
```

- Codex mappt `codexErrorInfo === "usageLimitExceeded"` auf `usage_limit`.
- Claude mappt `SDKAssistantMessage.error === "rate_limit"`, Result-Fehler und `rate_limit_event` auf `usage_limit`.
- Keine String-Suche als primäre Entscheidung.

### 10.2 Routing Settings

`ServerSettings` erhält:

```ts
providerAccountRouting: {
  [driver: string]: {
    autoFailover: boolean
    orderedInstanceIds: ProviderInstanceId[]
  }
}
```

Unbekannte oder gelöschte IDs werden beim Lesen ignoriert, beim Schreiben bereinigt. Die Reihenfolge ist nur innerhalb des Drivers relevant.

### 10.3 Zielauswahl

Ein Kandidat ist nur eligible, wenn:

- gleicher Driver,
- gleiche `continuation.groupKey`,
- enabled, installed, ready und authenticated,
- nicht derselbe Account-Fingerprint,
- aktuelles Modell verfügbar,
- nicht bereits für diesen Turn versucht,
- kein frisch bekanntes erschöpftes relevantes Limit.

Aus mehreren Kandidaten gewinnt zuerst die explizite Reihenfolge. Bei gleicher/fehlender Position gewinnt der Account mit der größten minimalen Headroom über die relevanten Quotas.

### 10.4 State Machine

```text
user turn
   │
   ├─ cached current quota exhausted ──> choose eligible account ──> rebind/resume
   │
   └─ start on current account
          │
          ├─ success ──> persist usage fact
          │
          └─ typed usage_limit
                 │
                 ├─ candidate exists ──> mark attempted ──> rebind/resume ──> continue
                 │
                 └─ none ──> fail with account/reset summary
```

`FailoverAttemptState` wird pro Turn gehalten:

- ursprüngliche User-Message/Command-ID,
- bereits versuchte Instanzen,
- ob Assistant-Content erschien,
- ob Tool-/Hook-Side-Effects gestartet oder abgeschlossen wurden,
- Resume-Cursor/Continuation Key,
- maximale Versuche = Anzahl kompatibler Instanzen.

### 10.5 Automatische Fortsetzungsregeln

- **Kein Assistant-Output, kein Tool:** ursprünglichen Turn auf der neuen Instanz automatisch erneut starten. Das ist der normale Provider-Limitpfad.
- **Nur partieller Assistant-Text, keine Side Effects:** Session auf neuer Instanz resumen und automatisch einen internen Continue-Turn starten; den User-Prompt nicht duplizieren.
- **Tool/Hook hat bereits Side Effects:** Account automatisch wechseln. Nur wenn ein dauerhafter Provider-Resume-Cursor nachweislich den fehlgeschlagenen Turn ohne Replay fortsetzen kann, automatisch resumen. Andernfalls eine kompakte Aktion „Continue on Work“ anzeigen. Dies ist die einzige Sicherheitsausnahme zur vollständigen Automatik.
- **Auth abgelaufen:** einmal zentral refreshen und dieselbe Instanz neu starten; erst bei echtem Auth-Fehler optional zum nächsten Account wechseln.
- **Overloaded/Transport:** kein Account-Failover; bestehende Retry-Policy verwenden.
- Jeder automatische Switch erzeugt eine persistierte Chat Activity und eine strukturierte Logzeile ohne Secrets.

## 11. Services und Cross-Component Contract

### 11.1 Server Services

- `ProviderAccountCredentialStore`
  - `getClaudeCredential(instanceId)`
  - `putClaudeCredential(instanceId, credential)`
  - `removeClaudeCredential(instanceId)`
- `ProviderAccountService`
  - `listAccounts()`
  - `connect(instanceId)` / `completeConnect(flowId, callback?)`
  - `disconnect(instanceId)`
  - `getUsage(instanceIds?)`
  - `refreshUsage(instanceIds?)`
  - `switchAccount(input)`
- Driver-Capability `ProviderAccountAdapter`
  - `readProfile`
  - `readLimits`
  - `readHistory`
  - `startLogin` / `cancelLogin` soweit unterstützt
- `UsageHistoryRepository`
  - idempotente Fact-Upserts,
  - Cursorverwaltung,
  - aggregierte Queries.
- `UsageHistoryIngestor`
  - Runtime-Event-Ledger,
  - inkrementeller lokaler Backfill,
  - Codex-Account-Usage-Sync.
- `ProviderFailoverCoordinator`
  - Zielauswahl,
  - Attempt State,
  - Activity/Telemetry.

### 11.2 WebSocket-RPC

Neue Methoden in `packages/contracts/src/rpc.ts`:

- `server.getProviderAccounts`
- `server.connectProviderAccount`
- `server.completeProviderAccountConnect`
- `server.disconnectProviderAccount`
- `server.getProviderAccountUsage`
- `server.refreshProviderAccountUsage`
- `server.getProviderUsageHistory`
- `server.refreshProviderUsageHistory`
- `server.switchProviderAccount`

Connect ist ein serverseitiger Flow mit `flowId`, `authorizationUrl`, Status und optionalem Code-Callback. Das Web öffnet nur die URL bzw. übergibt den Code; es sieht niemals Token.

### 11.3 Datenfluss

```text
Codex app-server ─┐
                  ├─ ProviderAccountAdapter ─┐
Claude SDK/OAuth ─┘                          ├─ ProviderAccountService ── WS RPC ── Usage UI
                                              │
Runtime token events ─ UsageHistoryIngestor ──┼─ SQLite Usage Facts ─── History Query
Local JSONL logs ───── incremental scanner ───┘
                                              │
typed limit errors ─ ProviderFailoverCoordinator ─ ProviderCommandReactor ─ resumed thread
```

## 12. Betroffene Dateien und Interfaces

### Shared Contracts

- Neu: `packages/contracts/src/providerUsage.ts`
- Ändern: `packages/contracts/src/providerRuntime.ts`
- Ändern: `packages/contracts/src/settings.ts`
- Ändern: `packages/contracts/src/rpc.ts`
- Ändern: `packages/contracts/src/index.ts`
- Tests: `packages/contracts/src/providerUsage.test.ts`, bestehende Settings-/Runtime-/RPC-Tests

### Server

- Neu: `apps/server/src/auth/ProviderAccountCredentialStore.ts`
- Neu: `apps/server/src/provider/ProviderAccountAdapter.ts`
- Neu: `apps/server/src/provider/Services/ProviderAccountService.ts`
- Neu: `apps/server/src/provider/Layers/ProviderAccountService.ts`
- Neu: `apps/server/src/provider/Accounts/CodexAccountAdapter.ts`
- Neu: `apps/server/src/provider/Accounts/ClaudeAccountAdapter.ts`
- Neu: `apps/server/src/provider/Accounts/ClaudeOAuthBroker.ts`
- Neu: `apps/server/src/provider/Accounts/ClaudeCredentialManager.ts`
- Neu: `apps/server/src/provider/Services/ProviderFailoverCoordinator.ts`
- Neu: `apps/server/src/provider/Layers/ProviderFailoverCoordinator.ts`
- Neu: `apps/server/src/usage/UsageHistoryIngestor.ts`
- Neu: `apps/server/src/persistence/Services/UsageHistoryRepository.ts`
- Neu: `apps/server/src/persistence/Layers/UsageHistoryRepository.ts`
- Neu: `apps/server/src/persistence/Migrations/036_ProviderUsage.ts`
- Ändern: `apps/server/src/persistence/Migrations.ts`
- Ändern: `apps/server/src/provider/ProviderDriver.ts`
- Ändern: `apps/server/src/provider/Drivers/ClaudeHome.ts`
- Ändern: `apps/server/src/provider/Layers/CodexProvider.ts`
- Ändern: `apps/server/src/provider/Layers/ClaudeProvider.ts`
- Ändern: `apps/server/src/provider/Layers/CodexAdapter.ts`
- Ändern: `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- Ändern: `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- Ändern: `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- Ändern: `apps/server/src/serverSettings.ts`
- Ändern: `apps/server/src/server.ts`
- Ändern: `apps/server/src/ws.ts`
- Fokussierte Unit-/Integrationstests neben jedem neuen Service und Adapter.

### Client Runtime und Web

- Ändern: `packages/client-runtime/src/state/server.ts`
- Neu: `packages/client-runtime/src/state/providerUsage.ts` falls die Query-/Filterlogik nicht klein im Server-State bleibt.
- Neu: `apps/web/src/routes/settings.usage.tsx`
- Neu: `apps/web/src/components/settings/usage/UsageSettingsPage.tsx`
- Neu: `apps/web/src/components/settings/usage/UsageScopeBar.tsx`
- Neu: `apps/web/src/components/settings/usage/UsageHeadline.tsx`
- Neu: `apps/web/src/components/settings/usage/UsageActivityField.tsx`
- Neu: `apps/web/src/components/settings/usage/AccountUsageIndex.tsx`
- Neu: `apps/web/src/components/settings/usage/AccountQuotaTable.tsx`
- Neu: `apps/web/src/components/settings/usage/UsageBreakdown.tsx`
- Neu: `apps/web/src/components/settings/usage/AccountRoutingPopover.tsx`
- Neu: `apps/web/src/components/settings/usage/ProviderAccountConnectDialog.tsx`
- Neu: `apps/web/src/components/settings/usage/usageFormatters.ts`
- Neu: fokussierte Logic-/Component-Tests im selben Verzeichnis.
- Ändern: `apps/web/src/components/settings/SettingsSidebarNav.tsx`
- Ändern: `apps/web/src/components/settings/ProviderInstanceCard.tsx`
- Ändern: `apps/web/src/components/settings/settingsLayout.tsx` nur für opt-in `max-w-6xl` im Usage-Bereich.
- Umbenennen/ändern: `apps/web/src/components/chat/ChatEnvironmentColumn.tsx` → `ChatDetailsColumn.tsx`
- Ändern: `apps/web/src/components/ChatView.tsx`
- Ändern: `apps/web/src/components/chat/ChatHeader.tsx`
- Mechanisch regenerieren: `apps/web/src/routeTree.gen.ts`.

## 13. Backward Compatibility und Migration

- Bestehende Provider-Instanzen bleiben unverändert nutzbar.
- Bestehende Codex `shadowHomePath`-Konfigurationen werden erkannt und als Account-Slots angezeigt.
- Bestehende Claude-Instanzen starten im Status `Legacy CLI auth`; sie werden nicht automatisch in den Managed Credential Store kopiert.
- Der Connect-Flow kann eine bestehende Instanz übernehmen oder eine neue anlegen.
- Fehlende `providerAccountRouting`-Settings decodieren zu deaktiviertem Failover, bis ein zweiter Account über den neuen Flow verbunden wird.
- Migration 036 ist additiv und löscht keine Daten.
- Import alter Logs läuft read-only und kann abgebrochen/erneut gestartet werden.

## 14. Edge Cases

- Zwei Instanzen melden dieselbe Account-ID: zweite Instanz als Duplicate markieren, nicht automatisch routen.
- E-Mail fehlt oder ändert sich: Fingerprint bleibt stabil, UI fällt auf Display Name zurück.
- Ein Limit fehlt im Payload: „Not reported“, kein 0-Prozent-Wert.
- Provider liefert neue Limit-/Modellfelder: generisch anzeigen, ohne Release von vIDE.
- Fable ist nicht im Plan: keine Fable-Limitzeile.
- Fable ist nur Usage Credits: Credits-Zustand anzeigen, keine Weekly-Quota erfinden.
- Rate-Limit-Snapshot ist stale: bekannte Werte mit Stale Label; vor Failover-Kandidatennutzung einmal refetchen.
- Alle Snapshots unbekannt: aktuelle Instanz versuchen; nur auf typisierten Limitfehler reagieren.
- Zielaccount unterstützt aktuelles Modell nicht: überspringen und erklären.
- Unterschiedlicher Continuation Key: kein bestehender Thread-Wechsel; „Start new thread with account“ anbieten.
- Turn läuft während manuellem Wechsel: Wechsel für den nächsten sicheren Turn vormerken, nicht mitten in Tool-Ausführung reißen.
- Account wird während eines Turns entfernt: laufenden Prozess stoppen, Thread in recoverable error setzen.
- OAuth Callback erreicht Remote-Server nicht: URL plus manueller Code-Callback im vIDE-Dialog.
- Access Token läuft während langer Session ab: zentral refreshen, Session neu starten und resumen.
- Mehrere Sessions desselben Claude-Accounts: ein Singleflight-Refresh, alle anderen warten auf den neuen Access Token.
- Import derselben Logdatei mehrfach: `sourceKey`/Cursor verhindert Duplikate.
- Logdatei wird rotiert oder gekürzt: Cursor erkennt kleinere Größe und scannt mit dedupe erneut.
- Shared Home mit mehreren Accounts: alte Facts bleiben Unassigned.
- Zeitzone/DST: Persistenz UTC, Bucketing in serverseitig expliziter User-Zeitzone, Labels lokal im Client.
- Sehr große All-Time-Historie: serverseitige Weekly Buckets und begrenzte Resultgröße.
- Offline/429: letzte Daten erhalten, Backoff, keine Nullung.

## 15. Security und Privacy

- Keine OAuth-Tokens in `ServerSettings`, SQLite, WebSocket, Browser-State, Analytics, Exceptions oder Testfixtures.
- Secret-Namen enthalten nur Driver und `ProviderInstanceId`, nie E-Mail.
- Alle Credential-Writes atomar; Verzeichnis `0700`, Dateien `0600`.
- `ServerSecretStore` wird in UI/Docs nicht fälschlich als verschlüsselter Keychain bezeichnet.
- OAuth Authorization URL und Callback-Code werden nur so lange wie der Flow benötigt im Speicher gehalten.
- Refresh-, Connect- und Disconnect-Operationen sind pro Instance singleflight/serialisiert.
- Der macOS-Keychain-Fallback restauriert das vorherige globale Credential auch bei Fehler/Abbruch über einen Finalizer.
- Providerfehler werden vor Logging durch bestehende Secret-Redaction plus credential-spezifische Tests geleitet.
- Usage-Historie bleibt lokal im jeweiligen vIDE-Environment.

## 16. Messbare Akzeptanzkriterien

### Multi-Account

- Zwei Claude- und zwei Codex-Accounts können einmal verbunden werden und über App-Neustarts hinweg gleichzeitig als authenticated erscheinen.
- Beide Accounts desselben Providers zeigen unterschiedliche, korrekt zugeordnete E-Mails/Account-Fingerprints und Limits.
- Ein manueller Switch in einem kompatiblen idle Thread behält Thread und sichtbaren Kontext.
- Ein neuer Thread verwendet den als Default markierten Account.

### Auto-Failover

- Ein synthetischer typisierter Limitfehler auf Account A wechselt automatisch zu Account B, startet den Turn genau einmal neu und liefert die Antwort im selben vIDE-Thread.
- Die User-Message erscheint nicht doppelt.
- Ein Tool-Side-Effect wird nicht automatisch wiederholt.
- Nach A→B wird nicht erneut A versucht; bei erschöpftem B endet der Turn mit der bekannten Reset-Zusammenfassung.
- Failover zwischen inkompatiblen Continuation Groups und zwischen Drivers findet nicht statt.

### Usage

- Gesamtansicht zeigt alle vier Accounts und deren frische/stale Live-Limits.
- Codex Weekly/weitere dynamische Buckets und Claude 5h/Weekly/scoped Limits erscheinen aus Providerdaten.
- Fable erscheint, wenn Claude es in `limits[]` meldet, und verschwindet sauber, wenn nicht gemeldet.
- `account/usage/read` füllt Codex Lifetime/Daily History pro Account.
- Claude JSONL-Import ist inkrementell, idempotent und aggregiert Modelle inklusive Fable.
- 24h/7d/30d/90d/1y/All, Provider-, Account- und Modellfilter liefern konsistente Summen und Activity-Buckets.
- Unassigned wird im Gesamtwert sichtbar, aber nie einem Einzelaccount zugeschlagen.

### UX

- Die Desktop-Masteransicht zeigt maximal vier Headline-KPIs, keine Quota-Progress-Bars und pro Account höchstens ein engstes Limit.
- Accountzeilen öffnen einen klaren Drill-down; Back Navigation erhält Master-Filter und Scrollposition.
- Mobile bei 320 px Breite hat keinen horizontalen Page-Overflow.
- Alle Filter und Account-Aktionen sind per Tastatur bedienbar und haben sichtbaren Fokus.
- Prozentwerte besitzen Textlabels; Farbe ist nie der einzige Statusindikator.
- Activity-Felder sind über Arrow Keys navigierbar und besitzen eine feste textuelle Readout-Zeile.
- `prefers-reduced-motion` deaktiviert Matrix- und Zahlenübergänge.

## 17. End-to-End-Verifikation

1. In einem isolierten vIDE-Test-Home zwei Codex- und zwei Claude-Test-/Fixture-Accounts verbinden; echte Tokens werden in automatisierten Tests durch Adapter-Fixtures ersetzt.
2. Usage öffnen und Gesamt-, Provider- und Einzelaccount-Ansicht auf Desktop sowie Mobile prüfen.
3. Fixture-Payloads für Claude mit `five_hour`, `seven_day`, dynamischem Fable-`limits[]` und Credits sowie Codex mit mehreren `rateLimitsByLimitId` einspeisen.
4. Historische Fixtures importieren, denselben Import wiederholen und beweisen, dass Summen unverändert bleiben.
5. Einen echten oder simulierten laufenden Thread auf Account A starten, `usage_limit` vor Output injizieren, automatische Fortsetzung auf B und exakt eine Assistant-Antwort prüfen.
6. Den Fall mit begonnenem Tool simulieren und beweisen, dass kein Tool-Replay erfolgt.
7. Server und Client neu starten; Accounts, Routing-Reihenfolge, History und Default-Auswahl müssen erhalten bleiben.
8. Focused Tests/Types/Lint nur für betroffene Packages ausführen.
9. Nach der UI-Implementierung eine integrierte visuelle Prüfung mit dem `test-vide-app`-Skill durchführen; Screenshots/Beobachtungen für Light, Dark, 1440 px und 320 px festhalten.

## 18. Recherche- und Implementierungsreferenzen

- [Codex app-server: Auth, Rate Limits und Account Usage](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [Claude Code Authentication und Credential Storage](https://code.claude.com/docs/en/authentication)
- [Claude Code OAuth Environment Variables](https://code.claude.com/docs/en/env-vars)
- [Anthropic: Fable 5 on your plan](https://support.claude.com/en/articles/15424964-claude-fable-5-on-your-plan)
- [ccusage: lokale Claude-/Codex-Tokenhistorie](https://github.com/ccusage/ccusage)
- [claude-usage: inkrementeller JSONL-/SQLite-Ansatz](https://github.com/phuryn/claude-usage)
- [usage-monitor-for-claude: dynamische modellbezogene `limits[]`](https://github.com/jens-duttke/usage-monitor-for-claude/blob/main/usage_monitor_for_claude/api.py)
- [quota-guard: Claude-eigene `rate_limits` aus Statusline-Daten](https://github.com/pareshrnayak/quota-guard)
- [onWatch: Snapshot-Historie und Multi-Provider-Architektur, nur Referenz](https://github.com/onllm-dev/onwatch)
