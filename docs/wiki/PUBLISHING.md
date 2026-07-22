# (repo-only) How to publish these pages to the GitHub Wiki

The GitHub wiki is a **separate git repository** that only exists after the
first page is created, and this automation session doesn't have push rights
to it — so publishing is a 2-minute manual step:

## One-time

1. Open https://github.com/Kairose-master/ai-agent-credit-dashboard/wiki
   → **Create the first page** → title `Home`, paste anything → Save.
   (This initializes the wiki repo.)

2. From any machine with your GitHub auth:

```bash
git clone https://github.com/Kairose-master/ai-agent-credit-dashboard.wiki.git
cd ai-agent-credit-dashboard.wiki
# copy every page except this file
cp ../ai-agent-credit-dashboard/docs/wiki/*.md .
rm PUBLISHING.md
git add -A && git commit -m "Publish wiki" && git push
```

Done — the sidebar (`_Sidebar.md`) and all pages go live at `/wiki`.

## Updating later

Edit the files in `docs/wiki/` (the source of truth, reviewed like any code),
then repeat the copy + push. Keeping the source in the main repo means wiki
changes ride the normal PR flow.
