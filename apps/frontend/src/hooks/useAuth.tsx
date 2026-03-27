import { createContext, useContext, useState, type ReactNode } from 'react'
import { session } from '../lib/session.js'
import { trpc } from '../lib/trpc.js'
import {
  initCrypto, generateKdfSalt, deriveStretchKey, generateKeypair,
  generateListKey, encryptSymmetric, decryptSymmetric,
  type EncryptedBlob,
} from '@tasks/shared'

type AuthContextType = {
  isLoggedIn: boolean
  login: (username: string, passphrase: string) => Promise<void>
  register: (username: string, email: string, passphrase: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!session.getToken())
  const utils = trpc.useUtils()

  async function login(username: string, passphrase: string) {
    await initCrypto()
    const challenge = await utils.auth.getLoginChallenge.fetch({ username })
    const stretchKey = await deriveStretchKey(passphrase, challenge.kdfSalt)
    const encPrivKey: EncryptedBlob = JSON.parse(challenge.encryptedPrivateKey)
    const privateKeyB64 = decryptSymmetric(encPrivKey, stretchKey)
    const result = await utils.client.auth.login.mutate({ username, passwordHash: passphrase })
    session.setToken(result.token)
    const userInfo = await utils.users.search.fetch({ username })
    session.setStretchKey(stretchKey)
    session.setPrivateKey(privateKeyB64)
    if (userInfo) session.setPublicKey(userInfo.publicKey)
    setIsLoggedIn(true)
  }

  async function register(username: string, email: string, passphrase: string) {
    await initCrypto()
    const kdfSalt = generateKdfSalt()
    const stretchKey = await deriveStretchKey(passphrase, kdfSalt)
    const { publicKey, privateKey } = generateKeypair()
    const listKey = generateListKey()
    const encPrivKey = encryptSymmetric(privateKey, stretchKey)
    const encListKey = encryptSymmetric(listKey, stretchKey)
    const encListName = encryptSymmetric('Personal', stretchKey)
    await utils.client.auth.register.mutate({
      username, email,
      passwordHash: passphrase,
      publicKey,
      kdfSalt,
      encryptedPrivateKey: JSON.stringify(encPrivKey),
      encryptedPersonalListKey: JSON.stringify(encListKey),
      encryptedPersonalListName: JSON.stringify(encListName),
    })
    await login(username, passphrase)
  }

  function logout() {
    session.clear()
    setIsLoggedIn(false)
  }

  return (
    <AuthContext.Provider value={{ isLoggedIn, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
