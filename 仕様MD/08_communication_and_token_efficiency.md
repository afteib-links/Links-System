# Communication language & token efficiency

> Status: **Active**  
> Language of this doc: **English**  
> Japanese translation: only when the user asks, or after a substantial process change  
> Related agent rule: `.cursor/rules/communication-ja-token-efficient.mdc`

## Goal

Japanese only on **final user-facing surfaces**. Keep Thought / mid-turn work narration in **English and short** to avoid token waste.

## Required Japanese (scope B)

| Surface | Language |
|---------|----------|
| Final chat reply | Japanese (concise) |
| Commit / PR title & body | Japanese (1–2 lines preferred) |
| User-facing `仕様MD/` content | Japanese; tables / IDs / checklists preferred |

## Keep English

| Surface | Language |
|---------|----------|
| Thought / reasoning / planning / tool-step narration | English, short |
| Mid-turn “about to…” status lines | English or omit |
| Code, APIs, paths, commands, logs | English |
| `.cursor/rules/*` and this file | English |

## Conflict note (important)

Cursor **User Rules** that say “all explanations / progress updates in Japanese” will override this and Japanize the Thought / Worked UI.

Narrow any such User Rule to: **final reply + commit/PR + user-facing specs only**. Do not require Japanese for Thought or mid-turn narration.

Suggested User Rule replacement (Japanese OK inside the rule text the human edits):

```text
# Language
- Final chat reply to the user: Japanese, concise
- Commit messages / PR title & body: Japanese
- User-facing content under 仕様MD/: Japanese
- Thought / mid-turn work narration / tool-step commentary: English, short (do not Japanize)
- Code, identifiers, paths, commands, logs: English
```

## Token-efficiency rules

1. Conclusion first; short by default.
2. Do not repeat the task or prior answers.
3. Cite paths and spec IDs instead of large pastes.
4. No unsolicited option menus.
5. Implementation reports: what + where only.

## Change control

- Update this English rule when the process changes.
- Japanese translation of this doc only on request or after a substantial process change.
