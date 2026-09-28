/**
 * The bundle's own settings page, contributed to the settings shell's
 * `settings.section` slot.
 *
 * One page = the plugin's parameters plus its two account cards. The cards
 * are the same components the Plugins page mounts; the parameters are the
 * plugin's volatile config fields (`authFile`, `authFileAI`, `probeConsent`,
 * `useMaximumContextWindow`), read and written through the settings domain's
 * shared form transport (`ctx.configForms`) against the plugin's Host entry.
 *
 * The form is keyed by the plugin's entry id as the Host reports it in the
 * describe mirror (`llm-workbuddy` — the cordis patch entry this bundle
 * installs). The page renders the form section only while the Host serves
 * that namespace, so a deployment without the plugin entry shows no trace of
 * it. On DSH 0.1.5 nothing declares `settings.section`, and on 0.1.6/0.1.7
 * hosts without the settings shell the registration simply never mounts —
 * the Plugins-page seam keeps working everywhere either way.
 */

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the `settings.section` SlotMap entry, declared by the settings
// shell. Cross-plugin collaboration goes through cordis services, so a value
// import would fail the client bundle-purity gate.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { CARD_VARIANTS, WorkBuddyPluginCard } from './WorkBuddyPluginCard.tsx'
import type { WorkBuddySettingsKey } from './locales.ts'

/** Props the settings shell delivers to this page. */
export type WorkBuddySettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.workbuddy'>

/** The plugin's Host entry id — the cordis patch entry this bundle installs. */
export const PLUGIN_ENTRY_ID = 'llm-workbuddy'

/**
 * The plugin entry's volatile text fields, with the copy keys for each.
 * Booleans are handled separately (their saved state is the snapshot value
 * itself, not a draft).
 */
export const AUTH_FIELD_DEFS = [
  { field: 'authFile', labelKey: 'authFile', hintKey: 'authFileHint', placeholderKey: 'authFilePlaceholder' },
  { field: 'authFileAI', labelKey: 'authFileAI', hintKey: 'authFileAIHint', placeholderKey: 'authFileAIPlaceholder' },
] as const

/** One text field's live editing state: the draft plus whether it diverges. */
export interface FieldDraft {
  value: string
  dirty: boolean
}

/** Reset one draft from the served snapshot. */
export function draftOf(value: unknown): FieldDraft {
  return { value: typeof value === 'string' ? value : '', dirty: false }
}

/** The config-form snapshot slice this page reads, narrowed for testability. */
export interface SectionFormSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  value: Record<string, unknown> | undefined
  writable: boolean
}

/** Minimal read/write face this page needs from `ctx.configForms`. */
export interface SectionConfigForm {
  getSnapshot(): SectionFormSnapshot
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
  unset(field: string): Promise<boolean>
}

/** The configForms service face as the client context exposes it. */
interface ConfigFormsService {
  get(entryId: string): SectionConfigForm
}

/**
 * Subscribe to the form snapshot with a stable useSyncExternalStore-shaped
 * contract (`getSnapshot` returns a stable reference until the next change —
 * the settings domain's documented store guarantee).
 */
function useFormSnapshot(form: SectionConfigForm | undefined): SectionFormSnapshot | undefined {
  const [snapshot, setSnapshot] = useState<SectionFormSnapshot | undefined>(
    () => form?.getSnapshot(),
  )
  useEffect(() => {
    if (form === undefined) return undefined
    setSnapshot(form.getSnapshot())
    return form.subscribe(() => setSnapshot(form.getSnapshot()))
  }, [form])
  return snapshot
}

/**
 * Render the bundle's settings page: its own heading first (the shell's
 * `settings-scroll` column is a bare scroll box with no title and no padding),
 * then the parameter form (the values a user changes rarely), then the two
 * account cards (the live status they keep coming back to). The shell still
 * owns the nav row and the page frame.
 *
 * `form` arrives through the registrant's `inject` face in production (the
 * client entry passes `ctx.configForms.get(PLUGIN_ENTRY_ID)`); the prop keeps
 * the component directly testable and renders the cards only when absent.
 */
export function WorkBuddySettingsSection(
  props: WorkBuddySettingsSectionProps & { form?: SectionConfigForm },
): ReactNode {
  const { form } = props
  const t = props.t as (key: WorkBuddySettingsKey, params?: Record<string, unknown>) => string
  return (
    <section style={pageStyle}>
      {/* The shell's `settings-scroll` column is a bare vertical scroll box:
          it supplies no heading and no padding, so the page draws its own. */}
      <h2 style={sectionTitleStyle}>{t('sectionTitle')}</h2>
      <p style={sectionIntroStyle}>{t('sectionIntro')}</p>
      {form === undefined
        ? null
        : <WorkBuddyParamsForm form={form} t={t} />}
      <ul style={cardListStyle}>
        {CARD_VARIANTS.map(variant => (
          <WorkBuddyPluginCard key={variant.id} t={t} variant={variant} />
        ))}
      </ul>
    </section>
  )
}

/**
 * The parameter form: two auth-path text fields and two checkboxes, driven by
 * the shared config form for the plugin's Host entry.
 *
 * Editing is draft-then-save (not type-into-the-wire): the snapshot updates
 * whenever the Host folds a new view, and only an explicit save sends
 * `set`/`unset` ops. That keeps the form honest about what is persisted, and
 * one Save applies both fields atomically enough for their two namespaces
 * (they live in one entry, so the writes share the form's revision fence).
 */
export function WorkBuddyParamsForm(
  { form, t }: { form: SectionConfigForm; t: (key: WorkBuddySettingsKey, params?: Record<string, unknown>) => string },
): ReactNode {
  const snapshot = useFormSnapshot(form)
  const section = snapshot?.value
  const writable = snapshot?.writable === true

  const [authDrafts, setAuthDrafts] = useState<Record<string, FieldDraft>>({})
  const [busy, setBusy] = useState(false)
  const [savedAt, setSavedAt] = useState<number | undefined>(undefined)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)

  // Re-seed the drafts whenever the Host folds a new snapshot — but never
  // over a dirty draft the user has not saved yet (the fields they are
  // editing keep their state; untouched fields follow the snapshot).
  useEffect(() => {
    if (section === undefined) return
    setAuthDrafts(previous => {
      const next: Record<string, FieldDraft> = {}
      for (const { field } of AUTH_FIELD_DEFS) {
        const previousDraft = previous[field]
        const served = draftOf(section[field])
        next[field] = previousDraft?.dirty === true ? previousDraft : served
      }
      return next
    })
  }, [section])

  const edit = useCallback((field: string, value: string) => {
    setAuthDrafts(previous => ({
      ...previous,
      [field]: { value, dirty: true },
    }))
    setSavedAt(undefined)
    setSaveError(undefined)
  }, [])

  const save = useCallback(async () => {
    setBusy(true)
    setSaveError(undefined)
    try {
      let accepted = true
      for (const { field } of AUTH_FIELD_DEFS) {
        const draft = authDrafts[field]
        const served = typeof section?.[field] === 'string' ? section[field] as string : ''
        const draftValue = draft?.value ?? ''
        if (draftValue === '') {
          if (served !== '') accepted = await form.unset(field) && accepted
        } else if (draftValue !== served) {
          accepted = await form.set(field, draftValue) && accepted
        }
      }
      if (accepted) {
        setSavedAt(Date.now())
        // Re-seed from the accepted view on the next snapshot fold; clear the
        // dirty flags now so the "saved" line stays until the fold lands.
        setAuthDrafts(previous => Object.fromEntries(
          Object.entries(previous).map(([field, draft]) => [field, { ...draft, dirty: false }]),
        ))
      } else {
        setSaveError(t('saveFailed', { message: t('requestFailed') }))
      }
    } catch (error: unknown) {
      setSaveError(t('saveFailed', { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(false)
    }
  }, [authDrafts, form, section, t])

  const setBoolean = useCallback(async (field: string, value: boolean) => {
    setBusy(true)
    setSaveError(undefined)
    try {
      const accepted = value ? await form.set(field, value) : await form.unset(field)
      if (accepted) setSavedAt(Date.now())
      else setSaveError(t('saveFailed', { message: t('requestFailed') }))
    } catch (error: unknown) {
      setSaveError(t('saveFailed', { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(false)
    }
  }, [form, t])

  if (snapshot === undefined || section === undefined) {
    return (
      <section style={formSectionStyle}>
        <h3 style={headingStyle}>{t('paramsHeading')}</h3>
        <p style={hintStyle}>{t('loading')}</p>
      </section>
    )
  }

  const dirty = AUTH_FIELD_DEFS.some(({ field }) => authDrafts[field]?.dirty === true)
  const probeConsent = section['probeConsent'] === true
  const maximumContext = section['useMaximumContextWindow'] !== false

  return (
    <section style={formSectionStyle}>
      <h3 style={headingStyle}>{t('paramsHeading')}</h3>
      {AUTH_FIELD_DEFS.map(({ field, labelKey, hintKey, placeholderKey }) => {
        const draft = authDrafts[field] ?? draftOf(section[field])
        return (
          <label key={field} style={fieldStyle}>
            <span style={labelStyle}>{t(labelKey)}</span>
            <input
              type="text"
              style={inputStyle}
              value={draft.value}
              placeholder={t(placeholderKey)}
              disabled={!writable || busy}
              onChange={event => edit(field, event.target.value)}
            />
            <span style={hintStyle}>{t(hintKey)}</span>
          </label>
        )
      })}
      <label style={checkStyle}>
        <input
          type="checkbox"
          checked={probeConsent}
          disabled={!writable || busy}
          onChange={event => { void setBoolean('probeConsent', event.target.checked) }}
        />
        <span style={checkCopyStyle}>
          {t('probeConsent')}
          <span style={hintStyle}>{t('probeConsentHint')}</span>
        </span>
      </label>
      <label style={checkStyle}>
        <input
          type="checkbox"
          checked={maximumContext}
          disabled={!writable || busy}
          onChange={event => { void setBoolean('useMaximumContextWindow', event.target.checked) }}
        />
        <span style={checkCopyStyle}>
          {t('useMaximumContextWindow')}
          <span style={hintStyle}>{t('useMaximumContextWindowHint')}</span>
        </span>
      </label>
      <div style={formFooterStyle}>
        <button
          type="button"
          style={buttonStyle}
          disabled={!writable || busy || (!dirty && savedAt === undefined)}
          onClick={() => { void save() }}
        >
          {busy ? t('saving') : t('save')}
        </button>
        {saveError !== undefined && <span style={errorStyle}>{saveError}</span>}
        {saveError === undefined && savedAt !== undefined && !dirty && (
          <span style={hintStyle}>{t('saved')}</span>
        )}
      </div>
      {!writable && <p style={hintStyle}>{t('paramsUnavailable')}</p>}
    </section>
  )
}

/** Page heading: the settings shell's scroll column supplies no title. */
const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 18,
  lineHeight: '26px',
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
}

/** One-line explanation under {@link sectionTitleStyle}. */
const sectionIntroStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: '22px',
  color: 'var(--dsw-alias-label-secondary)',
}

const pageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  width: '100%',
}

const formSectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '14px 16px 16px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-module-platform)',
}

const headingStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: '20px',
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
}

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const labelStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: '20px',
  fontWeight: 500,
  color: 'var(--dsw-alias-label-primary)',
}

const inputStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  padding: '7px 10px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  fontSize: 13,
}

const hintStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary)',
}

const checkStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 9,
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
  lineHeight: '20px',
  cursor: 'pointer',
}

const checkCopyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}

const formFooterStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
}

const buttonStyle: CSSProperties = {
  boxSizing: 'border-box',
  minHeight: 32,
  padding: '5px 14px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 16,
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
}

const errorStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-state-error-primary)',
}

/**
 * The cards' list. Same semantics as the Plugins page's list: each card is
 * an `<li>`, markers cleared so only the column rhythm remains.
 */
const cardListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  listStyle: 'none',
  margin: 0,
  padding: 0,
}
