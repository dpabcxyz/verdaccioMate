/**
 * tgz 物理文件匹配回归测试
 * 覆盖：{version}.tgz 与 {pkgname}-{version}.tgz 两种命名、缺失文件返回 null
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listTgzFiles, findTgzForVersion } from '../tgz.js'

function makePkgDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-tgz-'))
  for (const n of files) fs.writeFileSync(path.join(dir, n), 'x'.repeat(8))
  return dir
}

test('listTgzFiles 只收集 .tgz', () => {
  const dir = makePkgDir(['1.0.0.tgz', 'lodash-1.1.0.tgz', 'package.json', 'readme.md'])
  const files = listTgzFiles(dir)
  assert.equal(files.length, 2)
  assert.deepEqual(files.map(f => f.key).sort(), ['1.0.0', 'lodash-1.1.0'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('findTgzForVersion：新版 {version}.tgz 精确匹配', () => {
  const dir = makePkgDir(['1.0.0.tgz', '2.0.0.tgz'])
  const files = listTgzFiles(dir)
  assert.equal(findTgzForVersion(files, '1.0.0').name, '1.0.0.tgz')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('findTgzForVersion：旧版 {pkgname}-{version}.tgz 后缀匹配', () => {
  const dir = makePkgDir(['lodash-1.1.0.tgz'])
  const files = listTgzFiles(dir)
  assert.equal(findTgzForVersion(files, '1.1.0').name, 'lodash-1.1.0.tgz')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('findTgzForVersion：无实体文件返回 null', () => {
  const dir = makePkgDir(['cheerio-2.0.0.tgz'])
  const files = listTgzFiles(dir)
  assert.equal(findTgzForVersion(files, '9.9.9'), null)
  assert.equal(findTgzForVersion(files, '2.0.0').name, 'cheerio-2.0.0.tgz')
  fs.rmSync(dir, { recursive: true, force: true })
})