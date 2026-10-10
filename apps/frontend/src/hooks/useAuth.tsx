import { createContext, useContext, useState, type ReactNode } from 'react'
import { queryClient } from '../lib/queryClient.js'
import { session } from '../lib/session.js'
import { trpc } from '../lib/trpc.js'
import {
  initCrypto, generateKdfSalt, deriveStretchKey, deriveServerPassword, generateKeypair,
  generateListKey, encryptSymmetric, decryptSymmetric,
  fromBase64, type EncryptedBlob,
} from '@tasks/shared'

type AuthContextType = {
  isLoggedIn: boolean
  isAdmin: boolean
  login: (username: string, passphrase: string) => Promise<void>
  register: (username: string, email: string, passphrase: string, isAdmin?: boolean) => Promise<void>
  unlockDevice: (token: string, bundle: DeviceKeyBundle) => Promise<void>
  logout: () => Promise<void>
}

export type DeviceKeyBundle = { privateKey: string; publicKey: string; stretchKey: string }

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!session.getToken())
  const [isAdmin, setIsAdmin] = useState(() => session.getIsAdmin())
  const utils = trpc.useUtils()

  async function login(username: string, passphrase: string) {
    await initCrypto()
    const challenge = await utils.auth.getLoginChallenge.fetch({ username })
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
    setIsAdmin(me.isAdmin)
    setIsLoggedIn(true)
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
    session.clear()
    queryClient.clear()
    setIsLoggedIn(false)
    setIsAdmin(false)
  }

  return (
    <AuthContext.Provider value={{ isLoggedIn, isAdmin, login, register, unlockDevice, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
