/**
 * 失败形态归一
 * 失败有两种形态：authFetch 对超时/网络错误/401 是「抛异常」；后端业务错误与入参契约层
 * （validate.js 的 INVALID_PARAM）是 `{ ok:false, message }`。
 * 调用点若只判 res.ok，异常路径就只剩 finally 复位按钮态：用户看到的是「点了没反应」，
 * 控制台留一条未处理的 Promise rejection。
 * 分层约定：写动作在 store 折算成 ok:false 响应体（toFailure），由视图的失败分支提示一次；
 * 读刷新多为脱离调用链的异步（定时器、watch、onMounted 里的 fire-and-forget），
 * 没人能接住异常，就在本层提示一次（notifyError）后保持旧数据。
 * 两条路都只弹一次，不会出现「store 弹一条 + 视图再弹一条」。
 */
import { ElMessage } from 'element-plus'

/**
 * @param {{message?: string}|Error|null|undefined} errLike 抛出的异常
 * @param {string} [fallback] 拿不到 message 时的兜底文案
 * @returns {{ok: false, message: string}} 与后端失败响应体同形，供调用方继续走失败分支
 */
export function toFailure(errLike, fallback = '操作失败，请稍后重试') {
  return { ok: false, message: (errLike && errLike.message) || fallback }
}

/**
 * 读路径异常的统一出口：提示一次并返回，调用方保持原有数据不变
 * grouping=true 让同一条消息在一次级联失败里（整页刷新的包列表 + 阈值 + 日志）只占一条，
 * 角标累加，避免同一句「网络请求失败」连弹三条
 * @param {{message?: string}|Error|null|undefined} errLike
 * @param {string} [fallback]
 */
export function notifyError(errLike, fallback = '加载失败，请稍后重试') {
  ElMessage({ type: 'error', message: toFailure(errLike, fallback).message, grouping: true })
}

