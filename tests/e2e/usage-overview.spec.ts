import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { getStoreState, waitForSessionReady } from './helpers/store'

const jsonl = (entries: unknown[]): string =>
  `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`

function writeLog(file: string, entries: unknown[]): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, jsonl(entries))
}

test.describe('usage overview', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
  })

  async function openStats(orcaPage: Page): Promise<void> {
    await orcaPage.evaluate(() => {
      window.__store!.getState().openSettingsPage()
    })
    await expect
      .poll(async () => getStoreState<string>(orcaPage, 'activeView'), {
        timeout: 5_000
      })
      .toBe('settings')
    await orcaPage.getByRole('button', { name: 'Stats & Usage' }).click()
    await expect(orcaPage.getByRole('heading', { name: 'Usage Analytics' })).toBeVisible()
  }

  test('Stats & Usage opens on the combined overview with provider controls', async ({
    orcaPage
  }) => {
    await openStats(orcaPage)

    const providerDropdown = orcaPage.getByTestId('usage-provider-select')
    await expect(providerDropdown).toHaveAttribute(
      'aria-label',
      'Usage analytics provider: Overview'
    )
    await expect(orcaPage.getByTestId('usage-explorer-pane')).toBeVisible()
    await expect(
      orcaPage.getByRole('heading', { name: 'Usage across CLIs and hosts' })
    ).toBeVisible()
    await expect(orcaPage.getByTestId('usage-population')).toContainText(
      'Sessions in Orca worktrees only'
    )
    // Nothing is collected on a fresh profile, so the page offers to start rather than showing zeros as data.
    await expect(orcaPage.getByText('No usage matches this selection yet.')).toBeVisible()
    await expect(orcaPage.getByRole('button', { name: 'Collect Claude Code' })).toBeVisible()
    await expect(orcaPage.getByRole('button', { name: 'Collect Codex' })).toBeVisible()
    await expect(orcaPage.getByRole('button', { name: 'Collect Trae CLI' })).toBeVisible()
    await expect(orcaPage.getByTestId('usage-host-coverage-row')).toHaveCount(0)

    await providerDropdown.click()
    await orcaPage.getByRole('menuitem', { name: 'Codex', exact: true }).click()
    await expect(orcaPage.getByRole('heading', { name: 'Codex Usage Tracking' })).toBeVisible()
    await expect(providerDropdown).toHaveAttribute('aria-label', 'Usage analytics provider: Codex')

    await providerDropdown.click()
    await orcaPage.getByRole('menuitem', { name: 'OpenCode', exact: true }).click()
    await expect(orcaPage.getByRole('heading', { name: 'OpenCode Usage Tracking' })).toBeVisible()
    await expect(providerDropdown).toHaveAttribute(
      'aria-label',
      'Usage analytics provider: OpenCode'
    )
  })

  test('reads Claude, Codex and Trae logs into one overview and keeps populations apart', async ({
    electronApp,
    orcaPage,
    seededRepoPath
  }) => {
    const home = await electronApp.evaluate(({ app }) => app.getPath('home'))
    const now = new Date().toISOString()
    const outsideOrca = path.join(home, 'not-an-orca-worktree')
    mkdirSync(outsideOrca, { recursive: true })

    // Claude: 1000 fresh + 500 out + 2000 cache read + 500 cache write = 4000 inside Orca, 200 outside.
    const claudeUsage = (id: string, cwd: string, input: number, output: number, cache = 0) => ({
      type: 'assistant',
      sessionId: id,
      requestId: `req-${id}`,
      timestamp: now,
      cwd,
      message: {
        id: `msg-${id}`,
        model: 'claude-sonnet-4-6',
        usage: {
          input_tokens: input,
          output_tokens: output,
          cache_read_input_tokens: cache * 4,
          cache_creation_input_tokens: cache
        }
      }
    })
    writeLog(path.join(home, '.claude', 'projects', '-orca', 'claude-in.jsonl'), [
      claudeUsage('claude-in', seededRepoPath, 1000, 500, 500)
    ])
    writeLog(path.join(home, '.claude', 'projects', '-other', 'claude-out.jsonl'), [
      claudeUsage('claude-out', outsideOrca, 150, 50)
    ])

    // Codex: input 3000 of which 1000 cached, output 400 of which 100 reasoning => 2000 + 1000 + 400.
    const day = now.slice(0, 10).split('-')
    writeLog(path.join(home, '.codex', 'sessions', ...day, 'rollout-e2e-codex.jsonl'), [
      {
        type: 'session_meta',
        payload: { id: 'codex-in', cwd: seededRepoPath }
      },
      {
        timestamp: now,
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            model: 'gpt-5-codex',
            last_token_usage: {
              input_tokens: 3000,
              cached_input_tokens: 1000,
              output_tokens: 400,
              reasoning_output_tokens: 100,
              total_tokens: 3400
            },
            total_token_usage: {
              input_tokens: 3000,
              cached_input_tokens: 1000,
              output_tokens: 400,
              reasoning_output_tokens: 100,
              total_tokens: 3400
            }
          }
        }
      }
    ])

    // Trae: an assumed log shape, and a model with no price. Input 2000 (500 cached) + output 300.
    writeLog(path.join(home, '.trae-cn', 'sessions', 'trae-in.jsonl'), [
      {
        type: 'token_usage_record',
        timestamp: now,
        request_id: 'trae-req-1',
        session_id: 'trae-in',
        cwd: seededRepoPath,
        model: 'doubao-seed-1.6',
        usage: {
          input_tokens: 2000,
          cached_input_tokens: 500,
          output_tokens: 300
        }
      }
    ])

    await openStats(orcaPage)
    const pane = orcaPage.getByTestId('usage-explorer-pane')
    await pane.getByRole('button', { name: /^CLIs/ }).click()
    for (const cli of ['claude', 'codex', 'trae']) {
      await pane
        .getByTestId(`usage-adapter-${cli}`)
        .getByRole('switch', { name: 'Collect' })
        .click()
    }

    const cliTable = pane.getByTestId('usage-breakdown-table')
    const rowFor = (label: string) => cliTable.getByRole('row', { name: new RegExp(label) })

    // Inside Orca: only the sessions run in an Orca worktree.
    await expect(rowFor('Claude Code')).toContainText('4.0k', {
      timeout: 30_000
    })
    await expect(rowFor('Codex')).toContainText('3.4k')
    await expect(rowFor('Trae CLI')).toContainText('2.3k')
    await expect(pane.getByText('9.7k', { exact: true }).first()).toBeVisible()

    // Cost keeps its three sources apart: Trae's model has no price, so its tokens are named, not zeroed.
    await expect(pane.getByTestId('usage-cost-unpriced')).toHaveText('2.3k')
    await expect(pane.getByTestId('usage-cost-reported')).toHaveText('n/a')
    await expect(pane.getByTestId('usage-cost-estimated')).not.toHaveText('n/a')
    await expect(rowFor('Trae CLI')).toContainText('No price')
    await expect(pane.getByTestId('usage-adapter-trae')).toContainText(
      'Log format not checked against a real capture'
    )

    // The other population is a different question, not a bigger slice of this one.
    await pane.getByRole('radio', { name: 'All readable history' }).click()
    await expect(pane.getByTestId('usage-population')).toContainText('All readable CLI history')
    await expect(rowFor('Claude Code')).toContainText('4.2k')
    await expect(rowFor('Codex')).toContainText('3.4k')
    await pane.getByRole('radio', { name: 'Orca worktrees' }).click()
    await expect(rowFor('Claude Code')).toContainText('4.0k')

    // Left out of totals: still listed, no longer counted.
    await pane
      .getByTestId('usage-adapter-trae')
      .getByRole('switch', { name: 'Count in totals' })
      .click()
    await expect(rowFor('Trae CLI')).toHaveCount(0)
    await expect(pane.getByTestId('usage-cost-unpriced')).toHaveText('0')
    await expect(pane.getByTestId('usage-adapter-trae')).toContainText('Left out of totals')
  })
})
