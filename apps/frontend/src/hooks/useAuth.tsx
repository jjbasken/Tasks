import { createContext, useContext, useState, type ReactNode } from 'react'
import { session } from '../lib/session.js'
import { trpc } from '../lib/trpc.js'
import {
  initCrypto, generateKdfSalt, deriveStretchKey, deriveServerPassword, generateKeypair, fromBase64,
  generateListKey, encryptSymmetric, decryptSymmetric,
  type EncryptedBlob,
} from '@tasks/shared'

type AuthContextType = {
  isLoggedIn: boolean
  isAdmin: boolean
  login: (username: string, passphrase: string) => Promise<void>
  register: (username: string, email: string, passphrase: string, isAdmin?: boolean) => Promise<void>
  logout: () => Promise<void>
  activateSession: (isAdmin: boolean) => void
}

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
    session.setToken(result.token)
    const encPrivKey: EncryptedBlob = JSON.parse(result.encryptedPrivateKey)
    const privateKeyB64 = decryptSymmetric(encPrivKey, stretchKey)
    const userInfo = await utils.users.search.fetch({ username })
    session.setStretchKey(stretchKey)
    session.setPrivateKey(privateKeyB64)
    if (userInfo) session.setPublicKey(userInfo.publicKey)
    const me = await utils.users.me.fetch()
    session.setIsAdmin(me.isAdmin)
    setIsAdmin(me.isAdmin)
    setIsLoggedIn(true)
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
    // year-long token valid for anyone who captured it.
    try {
      await utils.client.auth.logout.mutate()
    } catch {
      // Offline or already-invalid token — clear locally regardless.
    }
    session.clear()
    setIsLoggedIn(false)
    setIsAdmin(false)
  }

  function activateSession(admin: boolean) {
    session.setIsAdmin(admin)
    setIsAdmin(admin)
    setIsLoggedIn(true)
  }

  return (
    <AuthContext.Provider value={{ isLoggedIn, isAdmin, login, register, logout, activateSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
