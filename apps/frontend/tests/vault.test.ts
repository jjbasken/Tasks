import { beforeAll, describe, expect, it } from 'bun:test'
import { initCrypto, deriveStretchKey, generateKdfSalt, generateKeypair, generateListKey, encryptSymmetric, decryptSymmetric, sealToPublicKey, fromBase64, openSeal, toBase64 } from '@tasks/shared'
import { encryptListName, readListName, unwrapListKey } from '../src/lib/listCrypto.js'
import { spawnedOccurrences } from '../src/lib/recurrence.js'

beforeAll(initCrypto)
async function vault(passphrase: string) {
  return { ...generateKeypair(), stretchKey: await deriveStretchKey(passphrase, generateKdfSalt()) }
}

describe('list encryption and migration', () => {
  it('lets an invitee with a different passphrase decrypt the shared name and task', async () => {
    const owner = await vault('owner passphrase')
    const recipient = await vault('recipient passphrase')
    const listKey = generateListKey()
    const wrappedOwnerKey = JSON.stringify(encryptSymmetric(listKey, owner.stretchKey))
    const wrappedRecipientKey = sealToPublicKey(fromBase64(listKey), recipient.publicKey)
    expect(unwrapListKey(wrappedOwnerKey, owner)).toBe(listKey)
    const recipientKey = unwrapListKey(wrappedRecipientKey, recipient)
    expect(recipientKey).toBe(listKey)
    const task = encryptSymmetric('Buy milk', fromBase64(listKey))
    expect(decryptSymmetric(task, fromBase64(recipientKey))).toBe('Buy milk')
    expect(readListName(encryptListName('Family shopping', listKey), recipientKey, recipient, false))
      .toEqual({ name: 'Family shopping', needsMigration: false })
  })

  it('migrates legacy names without hiding existing lists from recipients', async () => {
    const owner = await vault('owner')
    const recipient = await vault('recipient')
    const listKey = generateListKey()
    const legacy = JSON.stringify(encryptSymmetric('Family', owner.stretchKey))
    expect(readListName(legacy, listKey, owner, true)).toEqual({ name: 'Family', needsMigration: true })
    expect(readListName(legacy, listKey, recipient, false).name).toBe('Shared list')
    expect(readListName(encryptListName('Family', listKey), listKey, recipient, false).name).toBe('Family')
    expect(readListName(JSON.stringify('Legacy plaintext'), listKey, owner, true).needsMigration).toBe(true)
  })

  it('transfers enough sealed material to unlock personal and shared lists on a paired device', async () => {
    const owner = await vault('owner')
    const device = generateKeypair()
    const bundle = { privateKey: owner.privateKey, publicKey: owner.publicKey, stretchKey: toBase64(owner.stretchKey) }
    const sealed = sealToPublicKey(new TextEncoder().encode(JSON.stringify(bundle)), device.publicKey)
    const decoded = JSON.parse(new TextDecoder().decode(openSeal(sealed, device.publicKey, device.privateKey)))
    const paired = { ...decoded, stretchKey: fromBase64(decoded.stretchKey) }
    const personalKey = generateListKey()
    expect(unwrapListKey(JSON.stringify(encryptSymmetric(personalKey, owner.stretchKey)), paired)).toBe(personalKey)
    const sharedKey = generateListKey()
    expect(unwrapListKey(sealToPublicKey(fromBase64(sharedKey), owner.publicKey), paired)).toBe(sharedKey)
  })
})

it('undoes only the occurrence spawned by the completed task, even with identical recurrence rules', () => {
  const base = { title: 'Daily', notes: null, bucket: 'now', status: 'active', rrule: 'FREQ=DAILY', due_date: '2026-10-12', completed_at: null } as const
  expect(spawnedOccurrences([
    { ...base, id: 'child', spawned_by: 'parent' },
    { ...base, id: 'unrelated', spawned_by: 'other-parent' },
    { ...base, id: 'legacy' },
    { ...base, id: 'completed-child', spawned_by: 'parent', status: 'done' },
  ], 'parent')).toEqual(['child'])
})
