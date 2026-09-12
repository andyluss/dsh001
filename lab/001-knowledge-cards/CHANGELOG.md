# 变更日志 · 实验 001 · 知识卡片

> 实验说明见 [README.md](README.md)；仓库级改动见[根变更日志](../../CHANGELOG.md)。
> 结构参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，日期用提交日期。
> 只记**对使用者或后续开发有意义**的事，不逐条复述 diff。

---

## [初始提交] · 2026-09-11

- 零依赖的知识卡片管理程序，两个实现版本共享同一份本地数据
  （localStorage 的 `kcards.v1` / `kcats.v1` / `ktags.v1`）：
  - **原生版** `index.html`：单文件 HTML + CSS + 原生 JS，双击即用；
  - **React 版** `react-app/`：Vite + React 18，组件化，功能更全（复习、排序、拖拽、
    深色模式等），带 vitest 测试。
- 数据模型：分类树、标签树，以及基于 SM-2 的间隔重复复习。
- `viz/`：排序算法可视化（卡片排序特性的配套页面）。
