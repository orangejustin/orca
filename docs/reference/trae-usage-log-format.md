# Trae CLI usage log format

**Status: assumed, not verified against a real capture.** Trae CLI's on-disk usage log is not
publicly documented. The adapter was written from the record names `token_usage_record` and the
older `token_count`, and it is marked `logFormatVerified: false` in
`src/shared/usage-adapter-catalog.ts`, which the Stats page shows beside the CLI. Treat every
number from Trae as provisional until the checklist at the end is done.

Everything below the "Assumptions" heading lives in one file,
`src/main/trae-usage/trae-usage-record-parser.ts`, so a real sample changes that file only.

## What is known

- The binary is `traecli`, and its home is `~/.trae-cn` (the skills folder under it is already
  read by Orca's skill discovery).
- The 1.0 CLI ("coco") kept sessions under `~/.cache/coco/sessions`; the new CLI migrates them.
- `traecli exec --json` and `--output-format=stream-json` print JSONL to stdout. That is output,
  not the on-disk log, and the adapter does not read it.

## Assumptions

### Where the logs are

The layout under the Trae home is unknown, so logs are found by content, not by an assumed
subdirectory. Under each root the scanner walks to depth 6, skips `node_modules`, `.git`,
`skills`, `extensions` and `cache`, and treats every `*.jsonl` as a candidate. Lines that cannot
carry usage are skipped on a substring check before any JSON parsing.

Roots, in order: `~/.trae-cn`, `~/.trae`, `$XDG_CACHE_HOME/coco/sessions` (default
`~/.cache/coco/sessions`). `ORCA_TRAE_USAGE_ROOTS` (path-delimited) replaces the list.

### Record families

| Family                | Recognised by                                                                                    | Meaning                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `token_usage_record`  | `type` (or `payload.type`) equal to `token_usage_record`                                         | One request. Usage under `usage`, `token_usage`, `payload.usage`, `payload`, or self |
| `token_count` (older) | `type`/`payload.type` equal to `token_count`, with `info.total_token_usage` / `last_token_usage` | Cumulative snapshots, Codex-shaped; turned into per-request increments               |

Field spellings tolerated: `input_tokens` / `prompt_tokens` / `input`; `output_tokens` /
`completion_tokens` / `output`; `cached_input_tokens` / `cache_read_input_tokens` /
`cache_read_tokens` / `cached_tokens`; `reasoning_output_tokens` / `reasoning_tokens`. A request id
comes from `request_id`, `requestId`, `message_id` or `id`. Timestamps may be ISO strings or epoch
seconds, milliseconds or microseconds.

### Token semantics

- Cached input is a **subset of input**, and reasoning is a **subset of output** (OpenAI style).
  Both are clamped to their parent so a malformed record cannot go negative or be added twice.
  If Trae reports cache as a separate bucket instead, `freshInputTokens` is understated and the
  cache share overstated. This is the first thing to confirm.
- `totalTokens` is `input + output`.

### Counting rules

- A record with a request id is keyed `req:<id>`, so a copy re-stamped by a fork counts once.
  Without one it is keyed on its content, with a per-log ordinal so two genuinely identical
  records in one log both count.
- A `token_count` snapshot that matches a `token_usage_record` on timestamp, input and output is
  dropped as a mirror. If Trae stamps the two with different timestamps the mirror is **not**
  detected and the request is counted twice.
- A changed file (size or mtime) is reparsed from byte 0, so appended, truncated and replaced logs
  all come out right. A replacement with identical size and mtime is not detected.
- A half-written last line fails to parse and is retried on the next scan.

### Cost

Trae logs are assumed to carry no price, so every Trae token is reported as unpriced, never as
free. If the real log carries a cost, it should be read as `reported` (see
`src/main/opencode-usage/opencode-usage-rows.ts` for the pattern).

### Provider

The model provider is classified from the model id only (`src/shared/usage-model-provider.ts`).
A provider named in the log is not carried yet, because the shared aggregate has no field for it.

## To verify with a real capture

1. Collect a few scrubbed lines of each record family from a real `~/.trae-cn` (remove prompts,
   paths and identifiers; keep field names and shapes).
2. Confirm the directory, the type tag, the usage field names and the nesting.
3. Confirm whether cached input is inside input, and whether reasoning is inside output.
4. Confirm whether a request can appear as both record families, and how their timestamps relate.
5. Replace the synthetic fixtures in `trae-usage-record-parser.test.ts` and `scanner.test.ts`
   with the real lines, then set `logFormatVerified: true`.
