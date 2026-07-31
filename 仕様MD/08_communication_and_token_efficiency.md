# Communication language & token efficiency

> Status: **Active**  
> Language of this doc: **English**  
> Japanese translation: only when the user asks, or after a substantial process change  
> Related agent rule: `.cursor/rules/communication-ja-token-efficient.mdc`

## Goal

Keep **user-facing** surfaces in Japanese where required, without forcing Japanese during agent deliberation, and without wasting tokens on verbose replies.

## Required Japanese (scope B)

| Surface | Language |
|---------|----------|
| Final chat replies to the user | Japanese (concise) |
| Commit messages / PR title & body | Japanese (1–2 lines preferred) |
| User-facing content in `仕様MD/` | Japanese; prefer tables, IDs, checklists over long prose |

## Keep English

| Surface | Language |
|---------|----------|
| Source code, identifiers, APIs, paths, commands, logs | English |
| Agent-facing rules (this file, `.cursor/rules/*`) | English |
| Code comments | English by default |

## Explicitly not required

- Japanizing internal reasoning / Thought UI / planning / deliberation / tool-step narration while working — keep those **English and short** (Japanese here wastes tokens)
- Translating every English term in chat (a short gloss on first useful mention is enough)
- Long Japanese restatements of completed work
- Maintaining a Japanese copy of these rules until requested

## Token-efficiency rules

1. Conclusion first; short by default; detail only on request.
2. Do not repeat the user’s task or prior explanations.
3. Cite paths and spec IDs instead of large pasted blocks.
4. No unsolicited option menus or lengthy disclaimers.
5. Implementation reports: what + where only.

## Change control

- Update this English rule when the process changes.
- Produce a Japanese translation only when the user asks, or when the process changes substantially.
