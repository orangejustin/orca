import { useMemo, useSyncExternalStore } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { TuiAgent } from '../../../../shared/tui-agent'
import {
  formatAgentSessionRestartRowLabel,
  formatRestartAllAgentsLabel,
  type AgentSessionRestartMenuRow
} from '@/lib/agent-session-restart-plan'
import {
  formatAgentSessionRestartOutcome,
  summarizeAgentSessionRestartOutcomes,
  type AgentSessionRestartOutcome
} from '@/lib/agent-session-restart-run'
import {
  collectAgentSessionRestartPlanFromState,
  getAgentSessionRestartController
} from '@/lib/agent-session-restart-service'

export function AgentSessionRestartMenu(): React.JSX.Element {
  const tabsByWorktree = useAppStore((state) => state.tabsByWorktree)
  const terminalLayoutsByTabId = useAppStore((state) => state.terminalLayoutsByTabId)
  const ptyIdsByTabId = useAppStore((state) => state.ptyIdsByTabId)
  const agentStatusByPaneKey = useAppStore((state) => state.agentStatusByPaneKey)
  const disabledTuiAgents = useAppStore((state) => state.settings?.disabledTuiAgents)
  const plan = useMemo(() => {
    // The subscribed snapshots are the rerender inputs. Collection reads the same store.
    void tabsByWorktree
    void terminalLayoutsByTabId
    void ptyIdsByTabId
    void agentStatusByPaneKey
    void disabledTuiAgents
    return collectAgentSessionRestartPlanFromState(useAppStore.getState())
  }, [
    tabsByWorktree,
    terminalLayoutsByTabId,
    ptyIdsByTabId,
    agentStatusByPaneKey,
    disabledTuiAgents
  ])
  const controller = getAgentSessionRestartController()
  const report = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const otherHostSkipped = plan.targets.some(
    (target) =>
      target.kind === 'skipped' &&
      (target.reason === 'remote-unsupported' || target.reason === 'unknown-host')
  )

  return (
    <AgentSessionRestartMenuView
      rows={plan.rows}
      restartAllCount={plan.restartAllCount}
      outcomes={report.outcomes}
      running={report.running}
      hostNote={
        plan.restartAllCount === 0 && otherHostSkipped
          ? translate(
              'settings.manageSessions.restartOtherHost',
              'This computer cannot replace agents on another host, so those sessions were left running.'
            )
          : null
      }
      onRestart={(agent) => {
        void controller.request(agent).catch((error: unknown) => {
          console.warn('[session-restart] request failed:', error)
        })
      }}
    />
  )
}

export function AgentSessionRestartMenuView({
  rows,
  restartAllCount,
  outcomes,
  running,
  hostNote = null,
  menuOpen,
  onRestart
}: {
  rows: readonly AgentSessionRestartMenuRow[]
  restartAllCount: number
  outcomes: readonly AgentSessionRestartOutcome[]
  running: boolean
  hostNote?: string | null
  menuOpen?: boolean
  onRestart: (agent: TuiAgent | 'all') => void
}): React.JSX.Element {
  const summary = summarizeAgentSessionRestartOutcomes(outcomes)
  return (
    <div className="space-y-2" data-testid="agent-session-restart">
      <DropdownMenu open={menuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="agent-session-restart-trigger"
          >
            <RotateCcw />
            {translate('settings.manageSessions.restartAgents', 'Restart agents')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuItem
            disabled={running || restartAllCount === 0}
            data-testid="agent-session-restart-all"
            onSelect={() => onRestart('all')}
          >
            {formatRestartAllAgentsLabel(restartAllCount)}
          </DropdownMenuItem>
          {rows.map((row) => (
            <DropdownMenuItem
              key={row.agent}
              disabled={running || row.disabled}
              data-testid={`agent-session-restart-${row.agent}`}
              onSelect={() => onRestart(row.agent)}
            >
              {formatAgentSessionRestartRowLabel(row)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {hostNote ? (
        <p className="text-xs text-muted-foreground" data-testid="agent-session-restart-host-note">
          {hostNote}
        </p>
      ) : null}
      {summary ? (
        <p className="text-xs text-muted-foreground" data-testid="agent-session-restart-summary">
          {summary}
        </p>
      ) : null}
      {outcomes.length > 0 ? (
        <ul
          className="space-y-1 text-xs text-muted-foreground"
          data-testid="agent-session-restart-results"
        >
          {outcomes.map((outcome) => (
            <li key={outcome.ptyId}>{formatAgentSessionRestartOutcome(outcome)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
