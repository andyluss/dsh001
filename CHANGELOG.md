# 变更日志 · 仓库根

> 本文件**只记录仓库级改动**：目录布局、提交规范与 Git 钩子、忽略配置、根 README 与实验登记。
> 每个实验有自己的变更日志，见 `lab/<三位编号>-<短横线英文名>/CHANGELOG.md`。
>
> 结构参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，日期用提交日期。
> 只记**对使用者或后续开发有意义**的事，不逐条复述 diff。

---

## [未发布]

（尚无）

## [2026-09-12]

### repo

#### 变更

- **目录布局**：实验 002 的皮肤相关文件整合进 `lab/002-liveskin/` —— `plugin/`（插件包根）、
  `docs/`（设计文档）、`test/`（冒烟测试台）、`archive/`（前身脚手架），
  实验目录结构与 001 一致；`doc/` 下只剩 `punks/`（两个实验共享的内容底座）。
  插件在 DSH Web profile 里的两处接线（`link:` 绝对路径与 `node_modules` 符号链接）已同步更新。
- **忽略配置**：`.liveskin-test/.home/`（测试用的临时 DSH home）不再入库，改为测试台运行时生成。

#### 新增

- 变更日志按实验拆分：本文件只记仓库级改动，实验改动写在各实验自己的 `CHANGELOG.md` 里。

## [初始提交] · 2026-09-11

- 建立实验室仓库骨架：`README.md`（实验登记与目录结构）、`CONTRIBUTING.md`（提交规范）、
  `.gitignore` / `.gitmessage`、`.githooks/`（`commit-msg` 校验格式与中文，`pre-commit`
  拦截可再生目录、系统垃圾与超过 2MB 的文件）。
