# TASKS — Multi-Account OAuth, Failover und Usage Center

Die Reihenfolge ist verbindlich. Jeder Slice endet mit einem nutzbaren oder eindeutig verifizierbaren Zustand; Shared-Contract-Slices sind mit **[Contract]** markiert und werden besonders streng geprüft.

## 1. Claude-Credential-Isolation als Go/No-Go-Spike

**Ziel:** Die riskanteste Annahme vor Produktcode beweisen.

- In einem isolierten Test-Home den Claude Agent SDK Auth-Control-Flow untersuchen.
- Beweisen, ob ein voller Login-Credential-Satz mit `user:inference` und `user:profile` ohne dauerhafte Änderung des globalen macOS-Keychains übernommen werden kann.
- Fallback-Prototyp: bestehendes Keychain-Credential sichern, Login serialisiert durchführen, neues Credential importieren, altes Credential über Finalizer restaurieren.
- Zwei Claude-Prozesse mit unterschiedlichen instance-scoped Access Tokens gleichzeitig starten.
- Für beide Accounts Profil und Usage lesen.
- Tokenrefresh/Rotation zentral und singleflight testen; die Child-Prozesse dürfen den Refresh Token nicht erhalten.
- Ergebnis und verifizierte Claude-Version in `docs/providers/claude-multi-account.md` dokumentieren, ohne Tokenwerte oder private Payloads.

**Verifikation:** reproduzierbarer manueller Test plus fokussierter Test des Brokers mit Fake Keychain/CLI. Punkte 3–5 aus SPEC §7.4 müssen erfüllt sein. Bei Fehlschlag Claude-Teil blockieren und nicht mit einer scheinbaren Multi-Account-Lösung fortfahren.

## 2. Verbundene Accounts und Credential-Grundlage **[Contract]**

**Ziel:** Accounts können sicher verbunden und als erste-class Provider-Instanzen geführt werden.

- `providerUsage.ts` zunächst mit `ProviderAccountSummary`, Account/Auth/Routing States und Connect-Flow-Contracts anlegen.
- `ProviderAccountCredentialStore` als typsicheren Wrapper über `ServerSecretStore` implementieren.
- `ProviderAccountAdapter` und `ProviderAccountService` einführen.
- Codex Connect über isolierten app-server + bestehendes `authOverlay` implementieren.
- Claude Connect auf Basis des freigegebenen Spike-Pfads implementieren.
- Nicht geheime Account-Metadaten persistieren; Secret-Payload ausschließlich im Secret Store.
- Connect/Reconnect/Disconnect RPCs und Client Commands ergänzen.
- Providers UI um `Connect account`, Auth-Status und `Convert to managed account` erweitern.
- Beim Connect einer zweiten kompatiblen Instanz die Failover-Option standardmäßig aktiviert anbieten.

**Verifikation:** zwei Fixture-Accounts pro Driver verbinden, App neu starten, unterschiedliche Metadaten sehen, Secret-Redaction-Tests bestehen, Disconnect entfernt nur das Zielcredential.

## 3. Live-Quota-Service inklusive Fable **[Contract]**

**Ziel:** Alle aktuellen Limits werden provider-native und normalisiert geliefert.

- Quota-Contracts aus SPEC §8.1 ergänzen.
- Codex `account/rateLimits/read` und sparse Updates kapseln.
- Claude SDK-Usage in einem toleranten Decoder kapseln.
- Bekannte Claude-Felder plus dynamisches `limits[]` implementieren; Fable nicht hardcoden.
- Extra Usage/Credits und fehlende Fenster korrekt modellieren.
- Stale Cache, Refresh-Cooldown, Runtime-Update und 429-Backoff implementieren.
- `getProviderAccountUsage` und `refreshProviderAccountUsage` RPCs plus Client Queries/Commands anbinden.
- Auf Provider Cards zunächst eine kleine Textzeile `Usage available / stale / reconnect` zeigen, damit die Contracts sofort produktiv verwendet werden.

**Verifikation:** Adapter-Fixtures für Codex Multi-Bucket, Claude 5h/7d/Fable/Credits, fehlende Felder, stale und 429; keine rohe Providerantwort verlässt den Server.

## 4. Usage-Persistence und Runtime-Ledger **[Contract]**

**Ziel:** Ab diesem Slice wird neue vIDE-Nutzung exakt pro Account aufgezeichnet.

- Migration 036 und `UsageHistoryRepository` implementieren.
- Normalisierte Usage-History-Contracts aus SPEC §9.4 hinzufügen.
- `ProviderRuntimeIngestion` bzw. einen dedizierten Subscriber so erweitern, dass abgeschlossene Turns idempotente Facts schreiben.
- `providerInstanceId`, `ProviderAccountKey`, Modell, Token-Deltas, Thread/Turn und Provider-Refs speichern.
- Duplicate Events und Server-Restarts über `sourceKey` abfangen.
- Aggregationsqueries für Zeitbereich, Bucket, Provider, Account, Modell und Grouping implementieren.
- RPC `getProviderUsageHistory` anbinden.

**Verifikation:** In-Memory-SQLite-Tests für Upsert, Filter, Gruppierung, UTC/DST, Unassigned und große All-Time-Bucketing-Resultate.

## 5. Native Codex-Historie und lokaler Backfill

**Ziel:** Bestehende Historie erscheint, ohne doppelt zu zählen.

- Codex `account/usage/read` pro isoliertem Account synchronisieren; Lifetime und Daily Buckets persistieren.
- Read-only, inkrementellen Claude-JSONL-Scanner implementieren.
- Codex-Lokallog-Scanner nur als Fallback implementieren.
- Import-Cursors, Truncation/Rotation und idempotente Source Keys umsetzen.
- Transcript-Facts mit vIDE-Runtime-Facts korrelieren und Source-Priorität anwenden.
- Shared-Home-Altlogs ohne Accountbezug als Unassigned markieren.
- `refreshProviderUsageHistory` als singleflight Background Command ergänzen.
- Importstatus und Coverage in der Query zurückgeben.

**Verifikation:** realistische, anonymisierte Fixtures aus Claude/Codex; zweimaliger Import verändert Summen nicht; Codex-native Tageswerte überschreiben überlappende lokale Totals; Fable-Modellfacts landen im Modellbreakdown.

## 6. Usage Master-Dashboard und Activity Field

**Ziel:** Die ruhige Gesamtansicht beantwortet Usage, Pace und verfügbare Accounts ohne Quota-Bar-Wand.

- Route `/settings/usage`, Sidebar-Eintrag direkt nach Providers und Route-Tree ergänzen.
- Usage-spezifisches opt-in `max-w-6xl` im Settings Layout ermöglichen.
- `UsageSettingsPage`, URL-gesteuerte Scope-/Range-Filter und Loading/Empty/Error States bauen.
- `UsageHeadline` mit Total Tokens, Pace, Turns und getrennt markiertem Live-Wert `Ready accounts` bauen.
- Accountzustände `Ready`, `Restricted`, `Limited`, `Unknown` und `Reconnect` aus Auth, Modell und frischen Quotas deterministisch ableiten.
- Input/Output/Cache als sekundäre Composition-Zeile, nicht als weitere KPI Cards, darstellen.
- Adaptives `UsageActivityField` für 24h/7d/30d/90d/1y/All mit diskreten Intensitätsstufen bauen.
- `AccountUsageIndex` als gruppierte, stabile Liste bauen; pro Account nur Status, Active/Next und das engste relevante Limit zeigen.
- Account-Fokus mit dem X-ray-State des Activity Field verbinden: Gesamtkontur bleibt sichtbar, Füllung zeigt den Accountanteil.
- Account-Drill-down innerhalb derselben Route implementieren; Back Navigation erhält Filter und Scrollposition.
- Mobile Filter Bottom Sheet, Headline-Reflow, Activity-Raster und Accountliste implementieren.
- Theme-Tokens, bestehende SF-Typografie und Account-Accent verwenden; keine neuen globalen Farben/Fonts.

**Verifikation:** Component-/Logic-Tests für Scope/URL-State, KPI-Semantik und Accountstatus; visueller Zwischencheck in Light/Dark und 320/1440 px. Die Masteransicht enthält keine horizontalen Quota-Progress-Bars und maximal vier Headline-KPIs.

## 7. Activity-Interaktion, Account-Details und Breakdown UI

**Ziel:** Gesamt- und Einzelaccount-Historie erfüllen den vollständigen Analyse-Use-Case.

- Hover-, Fokus- und Pin-State für das Activity Field implementieren; feste Readout-Zeile statt Tooltip-Mosaik.
- Eingeklapptes Master-Breakdown implementieren; bei gepinntem Zeitfeld mit dessen Scope öffnen.
- Adaptive Buckets und Jahres-/Monatslabels für alle Zeiträume anbinden.
- Vergleich zur Vorperiode nur bei vollständiger, gleich langer Coverage berechnen.
- Breakdown nach Account, Provider und Modell mit Sortierung und Toggle-Legende bauen.
- 24h/7d/30d/90d/1y/All und Custom Range anbinden.
- Provider-, Account- und Modellfilter anbinden; Filter in URL persistieren.
- Coverage-/Unassigned-Erklärung und Importstatus anzeigen.
- Single-Account-Ansicht um typografische Quota-Tabelle, Modellbreakdown, Routing-/Data-Footer und Fable-Historie ergänzen.
- Reduced Motion, Screenreader-Beschreibungen und matrixunabhängige Tabellenalternative sicherstellen.

**Verifikation:** Query-/Formatter-Tests, Arrow-Key-Navigation zwischen Zeitfeldern und Screenreader Labels; Headline entspricht für jede Filterkombination der Summe der gelieferten Buckets. Der Account Index zeigt nie mehr als ein Limit pro Account.

## 8. Manuelles Routing und Failover-Reihenfolge **[Contract]**

**Ziel:** Accounts lassen sich aus Usage und Chat eindeutig umschalten.

- `providerAccountRouting` in Settings mit Migration Defaults ergänzen.
- Routing-Reihenfolge pro Driver in `AccountRoutingPopover` editierbar machen.
- `switchProviderAccount` RPC implementieren:
  - current compatible thread + default,
  - nur default,
  - queued switch bei laufendem Turn.
- Usage-Aktionen dynamisch als `Use now` oder `Make default` beschriften.
- Modell beibehalten; nicht unterstützte Zielmodelle blockieren und erklären.
- Duplicate Accounts und inkompatible Continuation Groups aus der Zielauswahl entfernen.
- Exakte Success-/Error-Toasts implementieren.

**Verifikation:** Manual Switch Codex und Claude innerhalb kompatibler Threads, Queue während laufendem Turn, Inkompatibilitätsfälle und Settings-Persistenz.

## 9. Typisierte Limitfehler und automatisches Failover **[Contract]**

**Ziel:** Der normale Usage-Limit-Fall läuft ohne User-Unterbrechung weiter.

- `failureCause` in `TurnCompletedPayload` ergänzen.
- Codex- und Claude-Adapter auf exakte Providerfehler mappen.
- `ProviderFailoverCoordinator` mit Eligibility, Reihenfolge, Headroom und Attempt State implementieren.
- Preflight bei bekannt erschöpftem Account implementieren.
- Reaktiven A→B-Wechsel in `ProviderCommandReactor` integrieren.
- No-output-Fall automatisch exakt einmal mit Originalturn fortsetzen.
- Partial-text-Fall über Resume + internen Continue-Turn fortsetzen.
- Side-Effect-Guard aus Runtime Events speisen; niemals Originalturn nach Tool-/Hook-Side-Effect replayen.
- Chat Activity für Switch/Continue sowie All-Accounts-Exhausted-Zustand implementieren.
- Frische Usage-Snapshots nach Limitfehler aktualisieren.

**Verifikation:** fokussierte Reactor-/Coordinator-Integrationstests für Preflight, A→B success, A→B→all exhausted, keine Schleife, Modell fehlt, Continuation mismatch, partial text und Tool-Side-Effect ohne Replay.

## 10. Details-Panel und schneller Thread-Kontext

**Ziel:** Der aktuelle Thread zeigt Accountzustand ohne das Usage Center zu duplizieren.

- `ChatEnvironmentColumn` zu `ChatDetailsColumn` umbenennen.
- Header-Tooltip, aria-labels, Imports und Tests auf `Details` umstellen.
- Kompakten Accountabschnitt mit aktivem Account, maximal zwei engsten Limits, Auto-switch-Status und Quick Switch ergänzen.
- `Open Usage` mit erhaltenem Thread-Kontext/Return Target implementieren.
- Bestehende Environment-/Sources-Sektionen ohne funktionale Regression übernehmen.

**Verifikation:** Quick Switch im idle Thread, queued State im laufenden Turn, Link in korrekten Account-Drill-down, bestehende Git-/Environment-Aktionen unverändert.

## 11. Hardening, Dokumentation und vollständige Verifikation

**Ziel:** Feature ist releasefähig und der Plan vollständig erfüllt.

- Auth-/Usage-Fehlertexte, Stale/Offline/429, Token-Ablauf und Remote OAuth Code Flow durchtesten.
- Log- und RPC-Redaction mit Secret-Sentinels prüfen.
- Migration 036 auf leerer und bestehender DB prüfen.
- Performance mit großer All-Time-Fixture messen; Browser erhält begrenzte Buckets.
- Provider-Dokumentation für Codex Multi-Account, Claude Managed Accounts, Credential-Schutz und Unassigned-Historie aktualisieren.
- OSS-/Provider-Abhängigkeiten und experimentelle Claude-Usage-Oberfläche dokumentieren.
- Focused Tests, Types, Lint und Format in den betroffenen Packages ausführen.
- Integrierte visuelle Prüfung mit `test-vide-app` für Desktop/Mobile sowie Light/Dark durchführen.
- SPEC-Akzeptanzkriterien und E2E-Schritte einzeln abhaken.

**Verifikation:** keine offenen Pflichtkriterien aus SPEC §16/17; visuelle Prüfung ist tatsächlich durchgeführt und dokumentiert, nicht nur aus Code abgeleitet.
