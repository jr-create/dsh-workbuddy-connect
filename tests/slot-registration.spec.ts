import { describe, expect, it } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { CARD_VARIANTS } from '../src/client/WorkBuddyPluginCard.tsx'

/**
 * The two settings-surface seams ONE client bundle registers into.
 *
 * DSH 0.1.5 renders plugin cards in the settings Plugins tab, which dispatches
 * the keyed `settings.plugin.item` slot once per served settings namespace —
 * one key per WorkBuddy variant. DSH 0.1.6+ gives the settings shell pages of
 * its own: `settings.section` is a LIST slot whose entry is keyed by `id`
 * (not by `key` — the registry rejects a `key`-only registration on a list
 * slot), ordered by `order`, and labelled by registrant-localized `label`
 * text. The client entry registers both seams unconditionally and lets
 * slot-declaration lifetime pick: a callback for a slot the host never
 * declares simply never runs. This file pins the consequences of that shape
 * against the real registry rather than trusting the registration calls.
 *
 * Whether a key/id is accepted (and whether a duplicate or an undeclared slot
 * is rejected) is a property of the real slot registry rather than of this
 * plugin's code. These tests drive the actual `SlotCore` to answer that,
 * instead of trusting that the registration shape works.
 *
 * Only the variant ids are needed from the card module (the components
 * themselves cannot render in this Node environment), and the register calls
 * are typed loosely on purpose: the point under test is the registry's
 * behaviour, not the DSH client typings.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The id the bundle registers its settings page under. */
const BUNDLE_KEY = 'dsh-workbuddy-connect'

/** Minimal component stand-in; the registry only stores the reference. */
const Component = (): null => null

const register = (core: SlotCore, options: Record<string, unknown>): unknown =>
  (core.register as any)(options, Component)

/**
 * Declare a slot the way its host page does: an entry contributes a
 * `children` table. `SlotCore` has no standalone declare method — the child
 * spec is owned by the registering entry, which is also why a slot can only
 * be claimed once. Which slots a host declares is exactly the capability the
 * dual-seam design detects, so the tests declare them per host generation.
 */
function declareHostSlots(core: SlotCore, slots: readonly string[]): void {
  const children: Record<string, Record<string, unknown>> = {}
  if (slots.includes('settings.plugin.item')) {
    children['settings.plugin.item'] = { kind: 'keyed', keyProps: { workbuddy: {}, 'workbuddy-ai': {} } }
  }
  // `settings.section` is a list slot: no `keyProps` table, entries are
  // ordered and identified by their own `id`.
  if (slots.includes('settings.section')) {
    children['settings.section'] = { kind: 'list' }
  }
  register(core, { name: 'root', children })
}

/** The client entry's 0.1.5-seam registrations: one card per variant. */
function registerLegacyCards(core: SlotCore): void {
  for (const [index, variant] of CARD_VARIANTS.entries()) {
    register(core, { name: 'settings.plugin.item', key: variant.id, priority: 30 - index })
  }
}

/** The client entry's 0.1.6+-seam registration: one settings page. */
function registerSettingsPage(core: SlotCore): void {
  register(core, {
    name: 'settings.section',
    key: BUNDLE_KEY,
    id: BUNDLE_KEY,
    order: 16,
    label: 'WorkBuddy',
  })
}

describe('settings.plugin.item carries both cards (DSH 0.1.5 seam)', () => {
  it('accepts two registrations with distinct keys from one owner', () => {
    const core = new SlotCore()
    declareHostSlots(core, ['settings.plugin.item'])
    expect(() => registerLegacyCards(core)).not.toThrow()
    // Both entries are live, which is exactly what the two cards need.
    expect((core.entries as any)('settings.plugin.item')).toHaveLength(2)
  })

  it('projects one cell per key, so both cards render', () => {
    const core = new SlotCore()
    declareHostSlots(core, ['settings.plugin.item'])
    registerLegacyCards(core)
    // The projection returns the winning ENTRY per key, so the key is read off
    // `options` — one cell each, which is what the settings page renders.
    const cells = (core.entriesOfSlot as any)('settings.plugin.item') as { options: { key?: string } }[]
    expect(cells).toHaveLength(2)
    expect(cells.map(cell => cell.options.key).sort()).toEqual(['workbuddy', 'workbuddy-ai'])
  })

  it('rejects a duplicate key at the same priority, which is why priorities differ', () => {
    const core = new SlotCore()
    declareHostSlots(core, ['settings.plugin.item'])
    register(core, { name: 'settings.plugin.item', key: 'workbuddy', priority: 30 })
    expect(() => register(core, { name: 'settings.plugin.item', key: 'workbuddy', priority: 30 }))
      .toThrow(/already has an entry for key/)
  })

  it('requires an explicit key, which is why each card passes one', () => {
    const core = new SlotCore()
    declareHostSlots(core, ['settings.plugin.item'])
    // This is the rc.7 breakage the client entry's try/catch exists for.
    expect(() => register(core, { name: 'settings.plugin.item' }))
      .toThrow(/requires options.key/)
  })
})

describe('settings.section carries the settings page (DSH 0.1.6+ seam)', () => {
  it('accepts the registration the client entry makes', () => {
    const core = new SlotCore()
    declareHostSlots(core, ['settings.section'])
    expect(() => registerSettingsPage(core)).not.toThrow()
    expect((core.entries as any)('settings.section')).toHaveLength(1)
  })

  it('keys the entry by id, with the order and label the shell reads', () => {
    const core = new SlotCore()
    declareHostSlots(core, ['settings.section'])
    registerSettingsPage(core)
    const cells = (core.entriesOfSlot as any)('settings.section') as { options: Record<string, unknown> }[]
    expect(cells).toHaveLength(1)
    expect(cells[0]!.options.id).toBe(BUNDLE_KEY)
    expect(cells[0]!.options.order).toBe(16)
    expect(cells[0]!.options.label).toBe('WorkBuddy')
  })

  it('requires options.id — a key alone is rejected on a list slot', () => {
    // THE CONTRACT BOUNDARY. `settings.section` is `kind: 'list'`, so the
    // registry demands `id`; `settings.plugin.item` is `kind: 'keyed'` and
    // demands `key`. The client entry passes both on the settings page so the
    // shell's nav (`id`) and its `inject()` filter (`key`) agree, but `id` is
    // the one the registry would refuse to do without.
    const core = new SlotCore()
    declareHostSlots(core, ['settings.section'])
    expect(() => register(core, { name: 'settings.section', key: BUNDLE_KEY, order: 16, label: 'WorkBuddy' }))
      .toThrow(/requires options\.id/)
  })

  it('rejects a second entry under the same id', () => {
    // Two profiles referencing the bundle, or the browser half loaded twice,
    // collide here. The client entry's try/catch is what turns that collision
    // into a `console.error` instead of a failed-loader banner.
    const core = new SlotCore()
    declareHostSlots(core, ['settings.section'])
    registerSettingsPage(core)
    expect(() => registerSettingsPage(core)).toThrow(/already has an entry with id/)
  })
})

describe('the two seams coexist without interference', () => {
  it('lands every registration when one host declared both slots', () => {
    // A host generation that keeps the old settings tab while also shipping
    // the settings shell must hold all three registrations at once; the keys
    // live in different slots, so they cannot collide.
    const core = new SlotCore()
    declareHostSlots(core, ['settings.plugin.item', 'settings.section'])
    expect(() => {
      registerLegacyCards(core)
      registerSettingsPage(core)
    }).not.toThrow()
    expect((core.entriesOfSlot as any)('settings.plugin.item')).toHaveLength(2)
    expect((core.entriesOfSlot as any)('settings.section')).toHaveLength(1)
  })

  it('rejects registering into a slot the host never declared', () => {
    // THE CAPABILITY BOUNDARY. On a 0.1.5 host nothing declares
    // `settings.section`, and on a 0.1.6+ host nothing declares
    // `settings.plugin.item` — a direct `register` into the missing slot
    // throws. That is exactly why the client entry mounts each seam through
    // `ctx.slots.inject`, which runs its callback only once the slot's
    // declaration is committed (and never runs it for a slot the host does
    // not ship) instead of registering eagerly.
    const core = new SlotCore()
    declareHostSlots(core, ['settings.plugin.item'])
    expect(() => registerSettingsPage(core)).toThrow(/not declared/)

    const other = new SlotCore()
    declareHostSlots(other, ['settings.section'])
    expect(() => registerLegacyCards(other)).toThrow(/not declared/)
  })
})
