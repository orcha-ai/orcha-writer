# Orcha Writer Agent Notes

## 工作方式

- 默认使用中文和项目维护者沟通。
- 修改前先阅读相关代码和已有交互模式，保持改动范围收敛。
- 手动代码编辑使用 `apply_patch`，不要顺手重排无关文件。
- 不回退用户或其他协作者已经做出的无关改动。

## Issue 关联

- 开发提交和 PR 使用 `Refs #<issue>` 或 `Related to #<issue>` 关联对应 issue。
- 发版前不要在提交或 PR 描述里使用 `Fixes #<issue>`、`Closes #<issue>`、`Resolves #<issue>`，避免合并时提前自动关闭 issue。
- issue 只在对应版本正式发布后关闭；关闭时补充发布版本、Release 链接和已发布行为摘要。

## Changelog

- `CHANGELOG.md` 在发版整理时更新，不在普通开发提交里提前追加 Unreleased 条目。
- 发版时再把已验证、确定进入该版本的变更写入对应版本小节。
- 新功能开发过程中发现并修复的中间问题，归入该功能本身，不在 changelog 里单独记录为“修复”。
- 只有已发布版本存在的问题、用户可感知的回归、线上安装包中的缺陷，才在 changelog 的“修复”中单独记录。

## 验证与打包

- 涉及前端或 Tauri 界面改动，提交前运行 `pnpm run build`。
- macOS 打包后，用 `hdiutil verify` 校验生成的 DMG。
- 本地 updater 包签名依赖 `TAURI_SIGNING_PRIVATE_KEY`；缺少该私钥不影响 `.app` 和 `.dmg` 本体的可用性验证。
