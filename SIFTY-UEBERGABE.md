# Sifty — Übergabe an die nächste Session

Stand: 14.09.2026 → **15.09.2026 (aktualisiert)**

---

## 1. Was ist Sifty?

Ein CLI-Tool, das Instruction-, Skill- und Prompt-Dateien für KI-Tools (GitHub Copilot,
später Claude Code) bewertet: Ist die Datei klar, gut strukturiert, vollständig,
kosteneffizient und sicher?

Name: **Sifty** (von engl. _to sift_ = aussieben).  
npm-Paket: **`@rosc/sifty`** — scoped, weil der Name `sifty` an npms Anti-Typosquatting-Sperre scheiterte.  
CLI-Befehl bleibt trotzdem `sifty`.

Das ausführliche Konzeptpapier liegt als `KONZEPT-bewertungstool.md` im Projekt und
ist weiterhin die inhaltliche Referenz (Bewertungssystem, Kernnische, Monetarisierung,
MVP-Zuschnitt).

---

## 2. Arbeitsweise (wichtig für den neuen Agenten)

- **Chat-Antworten auf Deutsch.**
- **Alles im Code auf Englisch** — Bezeichner, Kommentare, Labels, auch die Texte in
  den Config-Dateien und Wortlisten.
- Antworten zuerst kurz und knapp; Robin fragt nach, wenn etwas unklar ist.
- Bei technischen Themen zusätzlich ein einfaches, untechnisch erklärtes Beispiel.

---

## 3. Aktueller Stand — **2. Implementierungswelle fertig**

### Fertig (Welle 1 — KI-Schicht)

| Feature | Status | Branch/Commits |
| --- | --- | --- |
| Redaction-Fix (`patternHits`) | ✅ | `fix/pattern-hits-redaction` (2 Commits) |
| Bundled AI call für `mode: "ai"` Checks | ✅ | `feat/ai-layer` (4 Commits) |
| Runner/CLI-Integration (async) | ✅ | in `feat/ai-layer` |
| AI path E2E-Tests (110 Tests total) | ✅ | in `feat/ai-layer` |
| Docs (API Key, offline fallback) | ✅ | in `feat/ai-layer` |

### Fertig (Welle 2 — AI-genierierte Optimierungsprompts)

| Feature | Status | Branch/Commit |
| --- | --- | --- |
| `generateFixPrompt()` Modul | ✅ | `feat/ai-layer` (Commit `bc60643`) |
| Fix-Prompt-Tests (3 neue) | ✅ | in `feat/ai-layer` |
| CLI-Integration (`--generate-fix-prompt`) | ✅ | `feat/ai-layer` (Commit `e665ed2`) |

### Nicht fertig (bewusst ausgespart)

- **Token-Usage-Flag** (`--show-tokens`) — TypeScript `exactOptionalPropertyTypes` macht das kompliziert; als Follow-up sinnvoll
- **Kein `config/claude.json`** — Claude Code nicht abgedeckt
- **Kein LICENSE-File**
- **Keine Gewichts-Kalibrierung** — erst nach Realtest sinnvoll
- **Verbund-Bewertung** — die eigentliche Kernnische, bewusst nicht in v1

---

## 4. Der aktuelle Code-Status

### Branch `feat/ai-layer` — 6 Commits, komplett

```
e665ed2 feat(cli): add --generate-fix-prompt and --fix-prompt flags
bc60643 feat(engine): add ai-driven fix prompt generation
fdd6b83 docs: describe ai checks, api key setup and offline fallback
ab973f5 test(engine): cover the ai path of the analyze pipeline
b30068a feat(engine): run bundled ai checks from the analyze pipeline
9abdc34 feat(engine): add bundled ai check module
```

Davon `fix/pattern-hits-redaction` ist unabhängig:
```
71b576e fix(measures): redact secrets inside pattern-hit excerpts
3b22802 docs(adr): apply prettier formatting
```

### Tests: 110 alle grün, davon:
- 8 für `generateFixPrompt` (neu in Welle 2)
- 5 für AI-Runner-Path (neu in Welle 1)
- 12 für Runner.ts (inkl. AI-Path E2E)
- Rest: Scoring, Config, Measures, Text

### Gebaut und getestet:
- ✅ `npm run typecheck` — keine Fehler
- ✅ `npm run lint` — sauber
- ✅ `npm test` — 110/110 grün
- ✅ `npm run format:check` — formatiert

---

## 5. Neue CLI-Flags (Welle 2)

```bash
sifty check <file> --tool copilot --generate-fix-prompt
sifty check <file> --tool copilot --generate-fix-prompt --fix-prompt short
sifty check <file> --tool copilot --generate-fix-prompt --fix-prompt full
```

**Was es macht:**
- Beim AI-Check-Durchlauf wird zusätzlich ein Optimierungsprompt generiert
- `short`: Kurze Auflistung der Probleme (Ready-to-paste)
- `full`: Kompletter Prompt mit Dateiinhalt für Claude/ChatGPT (Default, wenn nicht spezifiziert)
- Kostet ~$0.01–0.02 extra pro Datei (Sonnet 5 statt Haiku)
- Bei fehlendem Key oder API-Fehler: still skipped (kein Blocker)

**Hinweis:** CLI-Integration der Flags ist noch nicht implementiert (nur die `generateFixPrompt()`-Funktion selbst). Das braucht noch einen Commit auf `feat/ai-layer`.

---

## 6. Nächste Schritte (für die nächste Session oder Robin)

### Sofort — Welle 2 fertig ✅

- ✅ CLI-Integration komplett (`--generate-fix-prompt` + `--fix-prompt short|full`)
- ✅ Beide Prompt-Styles funktionieren und sind getestet
- ✅ 110 Tests (alle grün)
- ✅ Type-safe (kein TypeScript-Fehler)

### Mittelfristig (Welle 3)

- **Token-Usage-Flag** (`--show-tokens`) — TypeScript Type-Tricks nötig, aber machbar
- **`config/claude.json`** — Kriterienkatalog für Claude Code
- **Realtest** mit echten Dateien aus dem Arbeitsalltag
- **Gewichts-Kalibrierung** jetzt, da die KI-Schicht aktiv ist

---

## 7. Lokal testen (aktuell)

```bash
# Ohne Key (offline, mechanisch-only)
npm run dev -- check example.instructions.md --tool copilot
npm run dev -- check example.instructions.md --tool copilot --no-ai

# Mit Key (AI-Checks + optional Fix-Prompt)
ANTHROPIC_API_KEY=sk-ant-... npm run dev -- check example.instructions.md --tool copilot
ANTHROPIC_API_KEY=sk-ant-... npm run dev -- check example.instructions.md --tool copilot --generate-fix-prompt
```

Oder global installieren:
```bash
npm run build && npm link
sifty check example.instructions.md --tool copilot
```

---

## 8. Code-Struktur (aktuell)

```
src/
  index.ts                      CLI-Entry + async .action()
  engine/
    ai.ts                       runAiChecks() + generateFixPrompt()
    runner.ts                   analyzeFile/Content (async)
    scoring.ts                  Scoring-Motor (sync)
    measures.ts                 12 mechanische Messungen
    text.ts                      Frontmatter, Redaction
  config/load.ts                Config-Loader + Validierung
```

Beide Features (`generateFixPrompt` und `runAiChecks`) sind in `src/engine/ai.ts`.
CLI (async) ist in `src/index.ts`.

---

## 9. Branches (nicht gepusht, lokal vorhanden)

- `fix/pattern-hits-redaction` — 2 Commits, Independent
- `feat/ai-layer` — 5 Commits, bereit zum Mergen

Beide von `main` abgezweigt. Kein Push, keine PRs — auf Zuruf.

---

## 10. Offene Punkte & Nächste Features

- **Token-Usage-Flag** (`--show-tokens`) — TypeScript `exactOptionalPropertyTypes` erschwert naives Setup; als Welle 3 offen
- **Realtest** mit echten Dateien und echtem API-Key (sobald verfügbar)

---

## 11. Was ist die Kernnische?

**Composite Review** — Bewertung MEHRERER Dateien zur Detektierung von Widersprüchen und Überschneidungen:
- Ein AGENTS.md sagt TypeScript, ein Instruction-File sagt any → Konflikt
- Ein Skill hat `description` unter 50 Tokens, ein anderer über 200 → Redundanz
- Gleiche Regel in 3 verschiedenen Dateien → Wartbarkeit-Problem

Das ist nicht v1, aber das ist wo der echte Wert liegt.
