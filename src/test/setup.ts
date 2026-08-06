/**
 * 全局测试环境补丁（vitest setupFiles）。
 *
 * jsdom 没实现「带伪元素参数」的 getComputedStyle。antd 表头吸顶（rc-table sticky）挂载时会用
 * `getComputedStyle(el, '::-webkit-scrollbar')` 量滚动条宽度，于是每渲染一次吸顶表格就往 stderr
 * 打一屏 "Not implemented"——真正的报错会被淹掉。这里丢掉伪元素参数、回落到元素自身样式：
 * jsdom 下量出来本来就是 0，与打一堆噪声的结果完全一致，只是不再刷屏。
 */
const nativeGetComputedStyle = window.getComputedStyle.bind(window);

window.getComputedStyle = ((element: Element) =>
  nativeGetComputedStyle(element)) as typeof window.getComputedStyle;
