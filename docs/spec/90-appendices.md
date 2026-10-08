> [bgdb](../../README.md) · [Documentation](../README.md) · BGDB specification, Part I · [Overview](README.md) · [Requirements](requirements.md) · [Terms index](terms-index.md) · [Glossary](glossary.md)

# Appendix A: Example: registry

    {
      "schema": "1.0",
      "name": "BGDB",
      "license": "CC0-1.0",
      "capabilities": ["catalog", "textIndex", "openingIndex", "positionIndex"],
      "sealPolicy": { "maxMatches": 5000, "maxMB": 300, "maxAttachmentKB": 2048 },
      "shards": [
        { "id": "0001", "base": "https://example.github.io/bgdb-data/data/0001/",
          "status": "sealed", "matches": 5000, "manifestHash": "a1b2c3...",
          "mirrors": [] },
        { "id": "0002", "base": "https://example.github.io/bgdb-data/data/0002/",
          "status": "open", "matches": 4312, "manifestHash": "d4e5f6..." }
      ],
      "overlays": { "tombstones": "overlays/tombstones.json",
                    "patches": "overlays/patches.json",
                    "aliases": "overlays/aliases.json",
                    "collections": "overlays/collections.json" }
    }


# Appendix B: Example: shard metadata

    {
      "schema": "1.0",
      "id": "0002",
      "status": "open",
      "formats": ["mat+meta", "bgdb-json"],
      "counts": { "matches": 4312, "games": 28104 },
      "summary": {
        "dateRange": ["2008", "2026-09-30"],
        "matchLengths": { "0": 120, "5": 800, "7": 1500, "9": 900, "11": 700, "other": 292 },
        "events": ["evt-0031", "evt-0045"],
        "playerFilter": { "type": "bloom", "bits": 65536, "hashes": 5, "data": "..." },
        "positionIndexPolicy": "firstPlies:12"
      }
    }


# Appendix C: Example: match (logical JSON profile)

    {
      "schema": "1.0",
      "id": "0002/3f9a1c5e0b72d814",
      "sides": [ { "player": "p-0042", "name": "J. Smith" },
                 { "player": "p-0107", "name": "A. Jones" } ],
      "matchLength": 7,
      "rules": { "crawford": true, "jacoby": false },
      "date": "2019-05-04",
      "event": "evt-0031",
      "games": [ {
        "index": 1, "startScore": [0, 0],
        "actions": [
          { "kind": "roll", "side": 0, "dice": [3, 1] },
          { "kind": "move", "side": 0, "moves": [ { "from": 8, "to": 5, "hit": false },
                                                  { "from": 6, "to": 5, "hit": false } ] }
        ],
        "result": { "winner": 1, "points": 2, "kind": "gammon", "how": "bearOff" }
      } ],
      "provenance": { "originalFormat": "mat", "contributor": "alice",
                      "submittedAt": "2026-10-02", "license": "CC0-1.0" }
    }


# Appendix D: Example: manifest

    {
      "schema": "1.0",
      "generated": "2026-10-02T10:00:00Z",
      "files": [
        { "path": "index/catalog.3f9a1c.json.gz", "type": "catalog", "version": 1,
          "hash": "3f9a1c...", "size": 812345, "encoding": "gzip" },
        { "path": "index/text/ab.77c2e0.bin", "type": "textIndexShard", "version": 1,
          "hash": "77c2e0...", "size": 40211, "encoding": "none" }
      ]
    }


# Appendix E: Example: the “Submit a match” issue form

    name: Submit a match
    description: Drop the ZIP made by the Contribute page of the site. A bot checks it, adds your matches, and answers here.
    title: "Matches"
    labels: ["submission"]
    body:
      - type: textarea
        id: transcript
        attributes:
          label: Your matches
          description: Drag the ZIP from the Contribute page into this box (a line with its name appears; that is normal).
        validations: { required: true }
      - type: checkboxes
        id: rights
        attributes:
          label: Rights
          options:
            - label: I have the right to share this under the CC0 public-domain dedication.
              required: true

The form of the data repositories is `templates/data-repo/.github/ISSUE_TEMPLATE/submit-match.yml`. Until tools v13 it also took a pasted match ([decision 0025](../decisions/0025-online-players-otb-names-and-erasure.md)).


# Appendix F: Example: workflow skeletons

    # .github/workflows/validate.yml  (runs on pull requests, read-only)
    name: validate
    on: { pull_request: { paths: ["inbox/**"] } }
    permissions: { contents: read, pull-requests: write }
    jobs:
      validate:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@<pinned-sha>
          - uses: example/bgdb-validator@<pinned-sha>   # data-only, no PR code executed
            with: { path: inbox, report: report.json }
          - uses: example/bgdb-comment@<pinned-sha>      # posts/updates the bot comment

    # .github/workflows/ingest.yml  (runs on the default branch)
    name: ingest
    on: { push: { branches: [master], paths: ["inbox/**"] } }
    concurrency: { group: ingest, cancel-in-progress: false }
    permissions: { contents: write }
    jobs:
      ingest:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@<pinned-sha>
          - run: npx bgdb-ingest --inbox inbox --data data
          - run: git add -A && git commit -m "ingest" && git push


# Appendix G: Requirement index by area

| **Prefix**                               | **Area**                                           |
|:-----------------------------------------|:---------------------------------------------------|
| LM, EXT                                  | Logical model, extensions                          |
| ST, SH, OV                               | Storage binding, shards, overlays                  |
| ID, DU, PK, NO                           | Identity, duplicates, position keys, normalization |
| IX                                       | Indexes                                            |
| CL                                       | Client caching and loading                         |
| SE                                       | Search                                             |
| EAS, CTB, VA, FB, MP, IN, CR, RC, SC, ME | Contribution workflow                              |
| RP, EV                                   | Rights, governance, evolution                      |
