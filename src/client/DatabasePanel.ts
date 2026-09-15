import * as React from 'react'
/**
 * The panel root: reads the controller, loads the data-source list, and routes
 * to the list view or the engine-specific database view.
 *
 * Every async failure lands in this component's error banner rather than an
 * unhandled rejection, so a broken data source degrades one panel instead of
 * the whole GUI.
 */

import type { DataSourceSummary, EngineAvailability, GateSettingsView } from '../protocol.ts'
import type { DbApi } from './api.ts'
import type { PanelController } from './controller.ts'
import { RedisDatabaseView } from './RedisDatabaseView.ts'
import { SourceListView } from './SourceListView.ts'
import { SqlDatabaseView } from './SqlDatabaseView.ts'
import { ErrorBanner, Empty, t } from './ui.ts'

/** Props for {@link DatabasePanel}. */
export interface DatabasePanelProps {
  controller: PanelController
  api: DbApi
  /** Bumps on every locale change so the view re-renders its copy. */
  localeTick: number
  /**
   * Leave the panel: hand the centre column back to the conversation. Owned by
   * the mount, which is the only place that can reach the layout router.
   */
  onClose(): void
}

/** The panel root. */
export function DatabasePanel(props: DatabasePanelProps): React.ReactElement {
  const { controller, api, localeTick, onClose } = props
  const [snapshot, setSnapshot] = React.useState(() => controller.getSnapshot())
  const [sources, setSources] = React.useState<DataSourceSummary[] | undefined>(undefined)
  const [settings, setSettings] = React.useState<GateSettingsView>({ allowAgentWrite: false, requireApproval: true })
  const [engines, setEngines] = React.useState<EngineAvailability[]>([])
  const [error, setError] = React.useState<string | undefined>(undefined)
  // localeTick carries no meaning of its own; reading it is what makes a
  // Language switch re-render the subtree.
  void localeTick

  React.useEffect(() => controller.subscribe(() => setSnapshot(controller.getSnapshot())), [controller])

  /** Re-read the source list and the write posture. */
  const reload = React.useCallback(async (): Promise<void> => {
    try {
      const payload = await api.listSources()
      setSources(payload.sources)
      setSettings(payload.settings)
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setSources(current => current ?? [])
    }
  }, [api])

  React.useEffect(() => { void reload() }, [reload])
  React.useEffect(() => { void api.engines().then(setEngines).catch(() => setEngines([])) }, [api])

  const saveGate = React.useCallback(async (patch: Partial<GateSettingsView>): Promise<void> => {
    try {
      setSettings(await api.setSettings(patch))
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [api])

  /** Open one source: connect, then route by engine. */
  const connect = React.useCallback(async (source: DataSourceSummary): Promise<void> => {
    try {
      const payload = await api.connect(source.id)
      if (!payload.ok) {
        setError(t('db.connectFailed', { error: payload.result.error ?? '' }))
        return
      }
      setError(undefined)
      const summary = payload.source ?? source
      if (summary.kind === 'redis') {
        controller.showRedis(summary, payload.redis ?? { databases: [] })
      } else {
        controller.showSql(summary, (payload.schemas ?? []).map(item => item.name))
      }
      // The summary can change host-side (derived auth flags), so keep the
      // list behind the panel in sync.
      void reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [api, controller, reload])

  const screen = snapshot.screen
  let body: unknown
  if (screen.name === 'sql') {
    body = React.createElement(SqlDatabaseView, {
      api,
      source: screen.source,
      initialSchemas: screen.schemas,
      // Inside a data source the back control steps out to the list; the list's
      // own control is the one that leaves the panel, mirroring how a file
      // manager separates "up a level" from "close".
      onBack: () => controller.showList(),
      onClose,
    })
  } else if (screen.name === 'redis') {
    body = React.createElement(RedisDatabaseView, {
      api,
      source: screen.source,
      initialInfo: screen.info,
      onBack: () => controller.showList(),
      onClose,
    })
  } else if (sources === undefined) {
    body = React.createElement(Empty, { message: t('common.loading') })
  } else {
    body = React.createElement(SourceListView, {
      api,
      sources,
      settings,
      engines,
      reload,
      saveGate,
      onConnect: (source: DataSourceSummary) => { void connect(source) },
      onBack: onClose,
    })
  }

  // The error banner rides above the active screen, which supplies its own
  // `.dbm-root` column. This wrapper must therefore NOT be another `.dbm-root`:
  // nesting two 100%-height flex columns doubled the layout (measured as two
  // `.dbm-root` elements in the centre column) and broke the inner scroll areas.
  return React.createElement(
    'div',
    { className: 'dbm-shell' },
    error === undefined ? null : React.createElement(ErrorBanner, { message: error }),
    body as never,
  )
}
