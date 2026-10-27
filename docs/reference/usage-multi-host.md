# Usage across CLIs and hosts

Stats & Usage reads one list of "usage rows" regardless of which CLI wrote the log or which
machine it ran on. This page is the contract for adding a CLI, for changing what a host returns,
and for reading the numbers on the page.

## Dimensions

A row carries three separate dimensions and the page never merges them:

- **CLI** — the program that ran (`claude`, `codex`, `trae`, …).
- **Model provider** — who served the model (`anthropic`, `openai`, …). Classified from the model
  id (`src/shared/usage-model-provider.ts`); anything it cannot place is `unknown`, never a guess.
  A provider named in the log itself is not carried yet.
- **Model** — the model id as logged.

Plus host, project, session and day. Tokens are four non-overlapping buckets (fresh input, cache
read, cache write, output) and `totalTokens` is their sum. Reasoning tokens are reported beside
output, never added again. Each adapter maps its own accounting onto these buckets; the rule for
each is next to its row mapper (`src/main/*-usage/*-usage-rows.ts`).

## Cost has three sources

| Source        | Meaning                                                             |
| ------------- | ------------------------------------------------------------------- |
| **reported**  | The CLI wrote a price in its own log (OpenCode). Shown as recorded. |
| **estimated** | Tokens times the bundled price table: an API-equivalent figure.     |
| **unknown**   | No price for that model. Counted as tokens, excluded from dollars.  |

Unknown is not zero: the cost panel states how many tokens no dollar figure includes. A model is
never priced by resemblance to another. Estimated prices are applied per request, so a request
above a long-context threshold is charged its tier even when the day's totals are large.

Dollars are API-equivalent value, not a bill. Plan or subscription limits are shared per account
and are not summed here.

## Population

The page shows one population at a time and says which:

- **Sessions in Orca worktrees only** (default).
- **All readable CLI history, inside and outside Orca.**

The two are different questions and are never added together. The choice is part of the query,
so a changed population is a different result, not a different slice of one.

## Hiding, collecting, excluding

Three controls, three meanings:

- **Stop collecting** — the CLI's store stops scanning. History already read is kept and counted.
- **Exclude from totals** — still listed, not counted.
- **Hide** — excluded and not listed.

## Hosts

The desktop asks each connected SSH host to scan its own logs through the existing relay
connection and return aggregates. The request is `usage.scan`:

- Params: `cli`, the host's `worktrees`, the viewer's `timeZone`, an optional `knownRevision` and
  a `page` cursor.
- Result: `not-modified`, `unsupported-cli`, or a `page` of per-file aggregates.
- Content: counts and ids only. No transcripts, message text, credentials or file paths. A file
  is identified by a digest of the events it owns.

The scan runs in a short-lived child of the relay with an allow-listed environment and `TZ` set
to the viewer's zone (worker threads ignore `TZ`, which was measured), so every host buckets days
the same way. Results are cached per host under `~/.orca-remote/usage-cache/<relay version>/` and
pruned when the relay changes.

### Reading a host's state

| Status         | Meaning                                                                |
| -------------- | ---------------------------------------------------------------------- |
| This computer  | Local scan.                                                            |
| Up to date     | Last request succeeded.                                                |
| Stale          | Request failed or could not be verified; the last good result is shown |
|                | with the time it was taken.                                            |
| Unavailable    | Not connected and nothing cached.                                      |
| Not covered    | The host's relay predates the CLI or the method.                       |
| Not synced yet | Never asked.                                                           |

Losing contact with a host is never read as "no usage" or "the work ended"
(see [`ssh-execution-boundary.md`](./ssh-execution-boundary.md)): a failed sync keeps the last
good figures and marks them stale. A CLI not yet scanned remotely (OpenCode, Muse) is labelled
"Not scanned on remote hosts yet" instead of showing zero.

### The same history on two machines

A copied or synced log directory yields the same events on two hosts. Putting the host in the key
would count them twice, so each file carries a digest of the events it owns. If two hosts hold
files with the same digest, the local copy is counted, otherwise the host that sorts first by id.
Sessions that share an id but differ in content (a fork that diverged) are counted in full and
flagged "overlapping" on the host panel, because their intersection cannot be known from
aggregates.

### Mixed versions

Clients and relays update independently. A relay without `usage.scan` answers JSON-RPC
method-not-found and is shown as **Not covered**; a relay that knows the method but not a CLI
answers `unsupported-cli`. A new optional field is safe; a new CLI must be added to
`USAGE_SCAN_RELAY_CLIS` on both sides before the desktop asks for it. See
[`remote-wire-compatibility.md`](./remote-wire-compatibility.md).

## Adding a CLI

1. Write an electron-free scanner that extends the shared per-file cache pattern (look at
   `src/main/trae-usage/scanner.ts` for the smallest example) and owns event keys per file so a
   re-stamped copy counts once.
2. Map its state to `UsageRow`s in a `*-usage-rows.ts` next to it. State the token semantics
   there: whether cache sits inside input, whether reasoning sits inside output.
3. Add the store as a `UsageProviderStoreLifecycle` subclass, a worker-protocol case, and an entry
   in `REGISTERED_USAGE_ADAPTERS` and `USAGE_ADAPTER_CATALOG`. Set `logFormatVerified` honestly.
4. To scan it on remote hosts, add it to `USAGE_SCAN_RELAY_CLIS` and the relay job.
5. A CLI with no reliable on-disk log is **not** added. It appears under "not supported" in the
   adapter list. Token counts are never estimated from terminal text.

## What is not covered

- No real SSH host has been exercised end to end. The wire path is covered by unit tests, a
  loopback relay dispatcher and a forked-child integration test, not by a remote machine.
- Trae's log format is assumed; see [`trae-usage-log-format.md`](./trae-usage-log-format.md).
- OpenCode and Muse are local-only for now.
- Non-English locales fall back to English for the new strings until translated.
