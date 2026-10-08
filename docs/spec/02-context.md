> [bgdb](../../README.md) · [Documentation](../README.md) · BGDB specification, Part I · [Overview](README.md) · [Requirements](requirements.md) · [Terms index](terms-index.md) · [Glossary](glossary.md)

# Context and positioning (informative)

Existing backgammon game collections are typically (a) tied to a server-side script (for example CGI search over a fixed database), (b) closed or proprietary (analysis files in native formats), or (c) static transcripts without search or replay. BGDB aims at the unoccupied combination: *open data in a git repository*, *client-side search*, *in-browser replay*, *community growth by pull request*.

The project reuses existing community standards wherever possible: position identifiers (*XGID*, *GNUBGID*) and the widespread *Jellyfish MAT* text format for matches. Position strings can be parsed by existing code, so the viewer can reuse its board and position decoders.
