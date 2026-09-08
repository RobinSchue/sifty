# Architecture Decision Records (ADR)

Dieses Verzeichnis enthält die Architecture Decision Records (ADRs) für dieses
Projekt.

## Was ist ein ADR?

Ein ADR (Architecture Decision Record) dokumentiert eine einzelne wichtige
architektonische Entscheidung: den Kontext, die getroffene Entscheidung und
ihre Konsequenzen. ADRs machen Entscheidungen nachvollziehbar und
versioniert, statt sie nur in Commit-Historie oder Gedächtnis zu belassen.
Das Format folgt dem Vorschlag von Michael Nygard
([Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)).

## Naming-Konvention

Jedes ADR ist eine eigene Markdown-Datei mit dem Namensschema:

```
NNNN-kebab-case-title.md
```

- `NNNN` ist eine 4-stellige, fortlaufende Nummer (z. B. `0001`, `0002`, ...).
- `kebab-case-title` ist ein kurzer, sprechender Titel in Kleinbuchstaben mit
  Bindestrichen.

Beispiel: `0002-use-zod-for-validation.md`

## Neues ADR anlegen

Für ein neues ADR die Datei [`template.md`](./template.md) kopieren, mit der
nächsten freien Nummer benennen und ausfüllen.
