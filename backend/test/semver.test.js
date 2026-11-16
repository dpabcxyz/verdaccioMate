/**
 * semver 完整比较回归测试（清理排序基准）
 * 覆盖：主/次/补丁、v 前缀、build 元数据忽略、prerelease 完整语义
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import compare from '../semver.js'

test('主/次/补丁数值比较', () => {
  assert.equal(compare('1.0.0', '1.0.0'), 0)
  assert.ok(compare('1.0.0', '1.0.1') < 0)
  assert.ok(compare('1.0.0', '0.9.9') > 0)
  assert.ok(compare('2.0.0', '10.0.0') < 0)
})

test('v 前缀与 build 元数据', () => {
  assert.equal(compare('v1.2.3', '1.2.3'), 0)
  assert.equal(compare('1.2.3+build.5', '1.2.3+build.9'), 0)
})

test('prerelease：正式版大于任何 prerelease（同主体）', () => {
  assert.ok(compare('1.0.0', '1.0.0-beta.1') > 0)
  assert.ok(compare('1.0.0-rc.2', '1.0.0') < 0)
})

test('prerelease：数字标识按数值、数字 < 非数字、公共前缀更长者更大', () => {
  assert.ok(compare('1.0.0-rc.2', '1.0.0-rc.10') < 0)
  assert.ok(compare('1.0.0-alpha', '1.0.0-beta') < 0)
  assert.ok(compare('1.0.0-1', '1.0.0-a') < 0)
  assert.ok(compare('1.0.0-rc.1', '1.0.0-rc.1.1') < 0)
})

test('清理保留逻辑：beta 不会挤掉同主体的正式版', () => {
  const versions = ['1.0.0-beta.1', '1.0.0', '1.0.0-rc.2']
  versions.sort(compare)
  const keep = versions.slice(-1)
  assert.equal(keep[0], '1.0.0')
})

test('主版本不同的 prerelease 仍按主版本排序', () => {
  const sorted = ['1.9.9', '2.0.0-beta.1', '1.0.0'].sort(compare)
  assert.deepEqual(sorted, ['1.0.0', '1.9.9', '2.0.0-beta.1'])
})