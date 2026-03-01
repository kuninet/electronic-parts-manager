# Gitリポジトリ修復（Skill/ノウハウ）

強制プッシュや歴史の書き換えにより、ローカルブランチが「No remote for the current branch」や「diverged」状態になった際の対処法：

1. **Upstreamの再設定**:
   `git branch --set-upstream-to=origin/[branch] [branch]`
   これにより、ローカルとリモートの紐付けを修復する。

2. **Rebaseによる同期**:
   `git pull --rebase origin [branch]`
   歴史を一直線に整えながら同期させる。

3. **混同ブランチの除去**:
   リモート名と同じ名前のローカルブランチ（例: `origin`）が誤って作られている場合は削除する。

※強制プッシュはリポジトリの不整合を引き起こしやすいため、実施後は必ず追跡設定とステータスを確認すること。