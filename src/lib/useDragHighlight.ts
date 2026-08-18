'use client';

import * as React from 'react';

/* 看板拖放高亮（BUG-3：Safari 拖拽卡顿的根因修复）。
   旧实现在列容器上 onDragOver 无条件 setState、onDragLeave 直接置空——
   dragleave 会冒泡，拖拽在列内子元素间移动时子元素的 dragleave 冒泡到列，
   与紧随的 dragover 形成 null↔key 高频震荡；每次震荡整板重渲染并对列大子树
   反复切换 outline/背景。Safari 下 drag 事件 relatedTarget 为 null（无法用
   contains 过滤冒泡）且事件更密集，表现为明显卡顿/高亮闪烁。
   这里用经典 dragenter/dragleave 计数器：enter（含子元素冒泡）+1、leave −1、
   归零才真正清除——高亮 state 只在真正跨列时变化，不依赖 relatedTarget。 */
export function useDragHighlight<K extends string>() {
  const [overKey, setOverKey] = React.useState<K | null>(null);
  const keyRef = React.useRef<K | null>(null);
  const depthRef = React.useRef(0);

  const reset = React.useCallback(() => {
    depthRef.current = 0;
    keyRef.current = null;
    setOverKey(null);
  }, []);

  /* 展开到投放目标容器上；onDrop 由调用方自带（结尾调 reset()），
     拖拽源的 onDragEnd 也应挂 reset（拖放取消/落在无效区域时清残留高亮）。 */
  const targetProps = React.useCallback(
    (key: K) => ({
      onDragEnter: (e: React.DragEvent) => {
        e.preventDefault();
        depthRef.current += 1;
        if (keyRef.current !== key) {
          keyRef.current = key;
          setOverKey(key);
        }
      },
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault(); // 必须，否则 drop 不触发
        e.dataTransfer.dropEffect = 'move';
      },
      onDragLeave: () => {
        depthRef.current -= 1;
        if (depthRef.current <= 0) {
          depthRef.current = 0;
          keyRef.current = null;
          setOverKey(null);
        }
      },
    }),
    [],
  );

  return { overKey, targetProps, reset };
}
