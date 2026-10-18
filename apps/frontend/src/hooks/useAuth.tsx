import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { queryClient } from '../lib/queryClient.js'
import { session } from '../lib/session.js'
import { rememberOfflineAccount, unlockOfflineAccount, restoreOfflineData, watchOfflineData, flushOfflineData, forgetOfflineDevice, offlineStorageStatus } from '../lib/offlineVault.js'
import { trpc } from '../lib/trpc.js'
import {
  initCrypto, generateKdfSalt, deriveStretchKey, deriveServerPassword, generateKeypair,
  generateListKey, encryptSymmetric, decryptSymmetric,
  fromBase64, type EncryptedBlob,
} from '@tasks/shared'

type AuthContextType = {
  isLoggedIn: boolean
  isAdmin: boolean
  /** Changes on every unlock, including an online sign-in after an offline unlock. */
  unlockCount: number
  login: (username: string, passphrase: string) => Promise<void>
  register: (username: string, email: string, passphrase: string, isAdmin?: boolean) => Promise<void>
  unlockDevice: (token: string, bundle: DeviceKeyBundle) => Promise<void>
  logout: () => Promise<void>
  forgetDevice: () => Promise<void>
}

export type DeviceKeyBundle = { privateKey: string; publicKey: string; stretchKey: string }

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!session.getToken())
  const [isAdmin, setIsAdmin] = useState(() => session.getIsAdmin())
  const [unlockCount, setUnlockCount] = useState(0)
  const utils = trpc.useUtils()

  useEffect(() => watchOfflineData(queryClient), [])

  async function unlockOffline(username: string, passphrase: string) {
    const saved = await unlockOfflineAccount(username, passphrase)
    queryClient.clear()
    session.clear()
    session.setStretchKey(saved.key)
    saved.key.fill(0)
    session.setPrivateKey(saved.privateKey)
    session.setPublicKey(saved.publicKey)
    session.setUserId(saved.userId)
    try { await restoreOfflineData(queryClient) } catch (error) { offlineStorageStatus.report(error) }
    setIsAdmin(false)
    setIsLoggedIn(true)
    setUnlockCount(n => n + 1)
  }

  async function login(username: string, passphrase: string) {
    await initCrypto()
    if (!navigator.onLine) return unlockOffline(username, passphrase)
    let challenge
    try {
      challenge = await utils.client.auth.getLoginChallenge.query({ username })
    } catch (error: any) {
      // Do not bypass an explicit authentication/rate-limit response.
      if (!error?.data && error?.cause) return unlockOffline(username, passphrase)
      throw error
    }
    const stretchKey = await deriveStretchKey(passphrase, challenge.kdfSalt)
    const serverPassword = deriveServerPassword(stretchKey)
    const result = await utils.client.auth.login.mutate({ username, passwordHash: serverPassword })
    const encPrivKey: EncryptedBlob = JSON.parse(result.encryptedPrivateKey)
    const privateKeyB64 = decryptSymmetric(encPrivKey, stretchKey)
    session.setToken(result.token)
    try {
      queryClient.clear()
      const userInfo = await utils.client.users.search.query({ username })
      if (!userInfo) throw new Error('Account not found')
      await finishUnlock(stretchKey, privateKeyB64, userInfo.publicKey)
      try {
        rememberOfflineAccount(username, challenge.kdfSalt, stretchKey, {
          userId: session.getUserId()!, privateKey: privateKeyB64, publicKey: userInfo.publicKey,
        })
        offlineStorageStatus.report(null, 'account')
      } catch (error) { offlineStorageStatus.report(error, 'account') }
    } catch (error) {
      session.clear()
      throw error
    }
  }

  async function finishUnlock(stretchKey: Uint8Array, privateKey: string, publicKey: string) {
    const me = await utils.client.users.me.query()
    if (!me.id) throw new Error('Account not found')
    session.setStretchKey(stretchKey)
    session.setPrivateKey(privateKey)
    session.setPublicKey(publicKey)
    session.setUserId(me.id)
    session.setIsAdmin(me.isAdmin)
    try { await restoreOfflineData(queryClient) } catch (error) { offlineStorageStatus.report(error) }
    if (navigator.storage?.persist) void navigator.storage.persist().catch(() => {})
    setIsAdmin(me.isAdmin)
    setIsLoggedIn(true)
    setUnlockCount(n => n + 1)
  }

  async function unlockDevice(token: string, bundle: DeviceKeyBundle) {
    await initCrypto()
    session.setToken(token)
    try {
      queryClient.clear()
      await finishUnlock(fromBase64(bundle.stretchKey), bundle.privateKey, bundle.publicKey)
    } catch (error) {
      session.clear()
      throw error
    }
  }

  async function register(username: string, email: string, passphrase: string, isAdmin = false) {
    await initCrypto()
    const kdfSalt = generateKdfSalt()
    const stretchKey = await deriveStretchKey(passphrase, kdfSalt)
    const { publicKey, privateKey } = generateKeypair()
    const listKey = generateListKey()
    const encPrivKey = encryptSymmetric(privateKey, stretchKey)
    const encListKey = encryptSymmetric(listKey, stretchKey)
    const encListName = encryptSymmetric('Personal', fromBase64(listKey))
    const serverPassword = deriveServerPassword(stretchKey)
    await utils.client.auth.register.mutate({
      username, email,
      passwordHash: serverPassword,
      publicKey,
      kdfSalt,
      encryptedPrivateKey: JSON.stringify(encPrivKey),
      encryptedPersonalListKey: JSON.stringify(encListKey),
      encryptedPersonalListName: JSON.stringify(encListName),
      isAdmin,
    })
  }

  async function logout() {
    // Revoke the token server-side first. Clearing localStorage alone leaves a
    // captured token valid for anyone who captured it.
    try {
      await utils.client.auth.logout.mutate()
    } catch {
      // Offline or already-invalid token — clear locally regardless.
    }
    await flushOfflineData(queryClient)
    session.clear()
    queryClient.clear()
    setIsLoggedIn(false)
    setIsAdmin(false)
  }

  async function forgetDevice() {
    await forgetOfflineDevice()
    await logout()
  }

  return (
    <AuthContext.Provider value={{ isLoggedIn, isAdmin, unlockCount, login, register, unlockDevice, logout, forgetDevice }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
