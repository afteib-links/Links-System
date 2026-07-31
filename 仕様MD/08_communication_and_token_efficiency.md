# Communication language & token efficiency

> Status: **Active**  
> Language of this doc: English (Japanese translation on request or after major process changes)  
> Related agent rule: `.cursor/rules/communication-ja-token-efficient.mdc`

## Goal

Keep user-facing work in Japanese where required, while avoiding token waste from verbose or duplicated Japanese during agent deliberation.

## Required Japanese (scope B)

| Surface | Language |
|---------|----------|
| Chat replies to the user | Japanese (concise) |
| Commit messages / PR title & body | Japanese (1–2 lines preferred) |
| User-facing content in `仕様MD/` | Japanese; prefer tables, IDs, checklists over long prose |

## Keep English

| Surface | Language |
|---------|----------|
| Source code, identifiers, APIs, paths, commands, logs | English |
| Agent-facing rules (this file, `.cursor/rules/*`) | English |
| Code comments | English by default |

## Explicitly not required

- Japanizing internal agent reasoning / consideration / tool planning
- Translating every English term in chat (short gloss on first use is enough when helpful)
- Long Japanese restatements of completed work

## Token-efficiency rules

1. Conclusion first; short by default; detail only on request.
2. Do not repeat the user’s task or prior explanations.
3. Cite paths and spec IDs instead of large pasted blocks.
4. No unsolicited option menus or lengthy disclaimers.
5. Implementation reports: what + where only.

## Change control

- Update this English rule when process changes.
- Produce a Japanese translation of this doc only when the user asks, or when the process changes substantially.
