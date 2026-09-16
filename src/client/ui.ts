import * as React from 'react'
/**
 * Shared presentational pieces of the panel: the translate seat, formatters,
 * the modal shell, and the tab strip. Kept free of business state so the
 * list view and the two database views share them without coupling.
 */

import { en, zh, type DbKey } from './locales.ts'
import { formatDuration } from './ttl.ts'

/** Template values accepted by the interpolator. */
export type TranslateValues = Record<string, string | number>

/** Active dictionary, picked by the document language at call time. */
function dictionary(): Record<string, string> {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  return lang.toLowerCase().startsWith('en') ? en : zh
}

/** Translate a key with optional {name} template params. */
export function t(key: DbKey, values?: TranslateValues): string {
  const template = dictionary()[key] ?? key
  if (values === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match,
  )
}

/** Human-readable error text from an unknown thrown value. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Format a byte count compactly. */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return t('common.none')
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

/** Format a TTL in seconds the way RedisDesktopManager does. */
export function formatTtl(seconds: number): string {
  if (seconds === -1) return t('redis.ttl.none')
  if (seconds === -2) return t('common.none')
  return formatDuration(seconds)
}

/**
 * The TTL countdown helpers, re-exported so call sites keep one import.
 *
 * They live in `ttl.ts` (no React, no i18n) because the arithmetic needs tests
 * that run without a DOM — see that module for why the reading is anchored
 * rather than decremented.
 */
export { countsDown, formatDuration, readTtl, remainingSeconds, type TtlReading } from './ttl.ts'


/** Format an uptime in seconds. */
export function formatUptime(seconds: number | undefined): string {
  if (seconds === undefined) return t('common.none')
  return formatTtl(seconds)
}

/** Render a wire cell for display. */
export function renderCell(value: string | number | boolean | null): string {
  if (value === null) return t('common.null')
  return String(value)
}

/** Whether a displayed cell is a NULL (for styling). */
export function isNull(value: string | number | boolean | null): boolean {
  return value === null
}

/** The modal shell every dialog renders into. */
export interface ModalProps {
  title: string
  /** Called on the overlay click, the ✕ button, and Esc. */
  onClose(): void
  /** Footer buttons, rendered right-aligned. */
  footer?: unknown
  children?: unknown
}

/**
 * A centred modal. Rendered into the panel's own tree rather than a portal so
 * the plugin never has to touch the shell's DOM.
 */
export function Modal(props: ModalProps): React.ReactElement {
  const { title, onClose, footer, children } = props

  // Esc closes; the listener is scoped to this modal's lifetime.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return React.createElement(
    'div',
    {
      className: 'dbm-overlay',
      onMouseDown: (event: { target: unknown; currentTarget: unknown }) => {
        // Only a click that both starts and ends on the backdrop closes, so a
        // drag that ends outside the dialog cannot discard the form.
        if (event.target === event.currentTarget) onClose()
      },
    },
    React.createElement(
      'div',
      { className: 'dbm-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      React.createElement('div', { className: 'dbm-modal-head' }, title),
      React.createElement('div', { className: 'dbm-modal-body' }, children as never),
      // The footer wrapper owns the top border and nothing else: button layout
      // belongs to the caller, so a dialog that needs its own arrangement
      // (e.g. a secondary action on the left) is not fighting this row. It was
      // previously right-aligned here, which nested a second flex row inside it
      // and quietly broke the split layout.
      footer === undefined ? null : React.createElement('div', { className: 'dbm-modal-foot' }, footer as never),
    ),
  )
}

/** One tab-stop descriptor. */export interface TabItem<T extends string> {
  id: T
  label: string
}

/** A tab strip; the caller owns the active id. */
export function TabStrip<T extends string>(props: {
  tabs: Array<TabItem<T>>
  active: T
  onChange(id: T): void
}): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'dbm-tabs', role: 'tablist' },
    props.tabs.map(tab =>
      React.createElement(
        'button',
        {
          key: tab.id,
          type: 'button',
          role: 'tab',
          className: 'dbm-tab',
          'data-active': String(props.active === tab.id),
          'aria-selected': props.active === tab.id,
          onClick: () => props.onChange(tab.id),
        },
        tab.label,
      ),
    ),
  )
}

/** An inline error banner. */
export function ErrorBanner(props: { message: string }): React.ReactElement {
  return React.createElement('div', { className: 'dbm-error' }, props.message)
}

/**
 * The panel's back-to-conversation control.
 *
 * Shaped after the SSH panel's control, which is what users already read as
 * "leave this panel": a chevron plus a label in a ghost button. It is rendered
 * on every screen of this panel, because the panel is a full takeover of the
 * centre column — the conversation is not visible behind it, so without a
 * control here the only way back would be a sidebar row.
 *
 * The label is the accessible name; `data-dsh-center-view-back` is the marker
 * sibling plugins and skin CSS use to find the control (dsh-ssh sets it too).
 */
export function BackButton(props: { onBack(): void; label?: string }): React.ReactElement {
  const label = props.label ?? t('panel.backToConversation')
  return React.createElement(
    'button',
    {
      type: 'button',
      className: 'dbm-btn dbm-btn-ghost dbm-back',
      'aria-label': label,
      'data-dsh-center-view-back': '',
      onClick: props.onBack,
    },
    React.createElement('span', { 'aria-hidden': 'true' }, '‹'),
    React.createElement('span', null, label),
  )
}

/** A lightweight "no data" placeholder. */
export function Empty(props: { message: string }): React.ReactElement {
  return React.createElement('div', { className: 'dbm-empty' }, props.message)
}
