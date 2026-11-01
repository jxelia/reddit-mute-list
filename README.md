## Mute List for Reddit

A mute list for subreddits and users that works better than Reddit's built-in one. Reddit's mute only filters some feeds; this hides muted subreddits and users everywhere a post shows up (the main page, popular, all, subreddit feeds, profiles) and, optionally, hides comments from muted users. The list syncs across your browsers through Chrome sync.

### Install (Chromium browsers)
- Open `chrome://extensions`
- Enable "Developer mode"
- Click "Load unpacked" and select this folder

### Use
- Each post has a round **Mute r/…** button right under its ⋯ button
- On posts Reddit recommends (main page posts from subreddits you haven't joined), that button is an eye with a slash instead: it picks Reddit's own **Show fewer posts like this**, then Reddit's **Hide** (no toast; Reddit does the hiding). Their ⋯ menu gets **Mute r/… everywhere** and **Mute r/… in recommendations**
- Open a post's ⋯ menu on Reddit. The menu gets:
  - **Join** as the first item (the Join button is moved out of the post header into the menu; turn off **Hide Join button** in Display settings to leave it in the header)
  - **Mute u/…** just above **Hide**
  - Reddit's own **Block** item, if the menu has one, moved next to them above Hide
- Muting hides matching posts immediately; a toast offers **Undo**
- On `old.reddit.com`, "mute r/…" and "mute u/…" links are added to each post's buttons row
- Click the extension icon to view and edit the mute list:
  - Subreddits and Users tabs, filter, add (paste names or links), remove
  - Subreddit patterns: `*cat*` mutes every subreddit with "cat" in its name; `cat*` (starts with) and `*cat` (ends with) work too
  - **Title words** tab: words or phrases that hide posts by title on r/popular, r/all, custom feeds, the pages of subreddits you haven't joined and that aren't in a custom feed, and posts the main page recommends. Opening a post with a muted word shows a one-line bar, which opens the post and its comments
    - Matching is whole-word and ignores case; `*` matches any letters (`spoil*` → spoiler, spoilers)
  - **Recommended** tab: subreddits and users hidden only when Reddit recommends them (one add box: `u/` names and user links go to Users, everything else to Subreddits). Their own pages and subs you've joined are untouched
    - **Built-in filters** (each on by default, matched by subreddit name):
      - **Countries, cities, states and provinces**: about 2,100 names (r/toronto, r/de, r/canadahousing, forms like `askNYC` or `torontojobs`), plus any name starting or ending with a country or nationality word (r/ukpolitics, r/personalfinancecanada). Language and food subs (r/learnjapanese, r/koreanfood) count as topics and stay
      - **Gender, nationality, ethnicity and religion**: r/askmen, r/AskAChinese, r/askjews, r/exmuslim, r/TwoXChromosomes, r/Christianity…
      - **Any r/Ask… subreddit**
      - **News and politics**: r/worldnews, r/politics, and any name containing news, politic, election, conservative, liberal…
      - **Airlines**
      - **Keep list** (on by default): any other recommended post shrinks to one line: the sub's name (click the line to show or hide the post) and a ⋮ menu with **Keep** and **Mute**, unless its sub is kept, an exception, or matches a ticked topic (16 topics; Tech, Science, History & learning, Money & careers and Health are ticked at first). Kept subs are listed and editable in the popup
      - **Exceptions**: **Add exception** under each filter lets through whole groups or single subs, and they're shown in full: countries and cities, groups like Men or Christianity, r/Ask… topics, news groups, airlines or their countries, or any subreddit name. A country is let through by every filter (r/AskIndia, r/ukpolitics)
      - Place names that also mean something else (r/phoenix, r/reading, r/buffalo…) are never filtered. **See the lists** shows every name and word. The lists are in `presets/src/`; after editing them, run `python3 presets/build.py`
  - **Edit as text** to edit a whole list at once, one name per line
  - Toggle hiding comments from muted users
  - **Download backup** (JSON) and **Restore…** (merge or replace; opens in a tab)

### Notes
- Storage: `chrome.storage.sync`, chunked to fit its per-item limit; about 100 KB in total, room for thousands of names
- Muted items are hidden by a generated stylesheet keyed on Reddit's post attributes (`subreddit-prefixed-name`, `author`), so they never flash on screen
- If Reddit's own menu can't be found, a small menu of the same actions opens next to the ⋯ button instead
- Only the `storage` permission. Network requests go only to Reddit itself: `/api/me.json` (your username, cached for an hour, so your own comments and hover card are left alone) and `/api/multi/mine.json` (same site, your signed-in session) to learn which subreddits are in your custom feeds; it's cached for 6 hours and only made on subreddit pages when the subreddit-pages word list isn't empty. The popup shows what was found and has a **Recheck** link

### Roadmap
- Back up to / restore from the user's own cloud storage, kept in sync
- Restore from a web address, such as a shared public cloud drive link
