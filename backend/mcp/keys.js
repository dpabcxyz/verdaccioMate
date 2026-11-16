/**
 * MCP API Key 生成/哈希/掩码/可逆加密 —— Verdaccio Mate 生成，客户端以 Bearer 头携带
 * - 认证走 key_hash（sha256），明文不落库
 * - Verdaccio Mate「复制配置」需要回看明文，故另存 AES-256-GCM 密文；主密钥在 DATA_DIR 下的独立文件，
 *   只有同时拿到 DB 与主密钥（同一挂载卷）才能还原，单纯备份/泄露 manager.db 不暴露 Key
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../db.js'

export const MCP_SCOPES = ['read', 'full']

const VAULT_FILE = path.join(DATA_DIR, 'mcp_key_vault.key')
const CIPHER_PREFIX = 'v1'
let vaultKey = null

export function generateMcpKey() {
  const key = `vcm_${randomBytes(32).toString('hex')}`
  return { key, hash: hashMcpKey(key), mask: maskMcpKey(key) }
}

export function hashMcpKey(key) {
  return createHash('sha256').update(String(key)).digest('hex')
}

export function maskMcpKey(key) {
  const s = String(key)
  if (s.length <= 10) return s
  return `${s.slice(0, 4)}…${s.slice(-4)}`
}

function readVault() {
  const buf = fs.readFileSync(VAULT_FILE)
  if (buf.length !== 32) throw new Error('MCP Key 主密钥文件长度不合法')
  return buf
}

/** 主密钥懒加载；wx 标志保证并发进程各自生成的密钥只有一个胜出，胜出者再被读回 */
function getVaultKey() {
  if (vaultKey) return vaultKey
  try {
    vaultKey = readVault()
    return vaultKey
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  try {
    fs.writeFileSync(VAULT_FILE, randomBytes(32), { flag: 'wx', mode: 0o600 })
  } catch (e) {
    if (e.code !== 'EEXIST') throw e // 并发进程已抢先落盘，读它的那份
  }
  vaultKey = readVault()
  return vaultKey
}

export function encryptMcpKey(key) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getVaultKey(), iv)
  const ct = Buffer.concat([cipher.update(String(key), 'utf8'), cipher.final()])
  return [CIPHER_PREFIX, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.')
}

/** 密文损坏、主密钥已轮换或旧库无密文时返回 null，由调用方提示重新生成 */
export function decryptMcpKey(enc) {
  if (typeof enc !== 'string') return null
  const [prefix, iv, tag, ct] = enc.split('.')
  if (prefix !== CIPHER_PREFIX || !iv || !tag || !ct) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', getVaultKey(), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    const plain = Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8')
    return /^vcm_[0-9a-f]{64}$/.test(plain) ? plain : null
  } catch {
    return null
  }
}
