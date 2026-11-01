// Suggested word lists for the popup's Muted words tab. None are on until
// the user adds one; then they're ordinary named lists (wordGroups in
// storage.js). "*" matches any letters, as everywhere else.
const WordPacks = [
  { name: 'US politics', words: ['trump', 'biden', 'kamala', 'harris', 'maga', 'republican*', 'democrat*', 'gop', 'congress', 'senate', 'senator*', 'election*', 'vance', 'desantis', 'obama', 'pelosi', 'aoc', 'impeach*', 'supreme court', 'white house', 'liberal*', 'conservative*'] },
  { name: 'World news and war', words: ['ukraine', 'ukrainian*', 'russia', 'russian*', 'putin', 'zelensky*', 'gaza', 'israel', 'israeli*', 'hamas', 'hezbollah', 'iran', 'nato', 'invasion', 'missile*', 'airstrike*', 'ceasefire', 'war crime*'] },
  { name: 'Celebrities', words: ['celebrity', 'celebrities', 'celeb', 'celebs', 'kardashian*', 'taylor swift', 'kanye', 'drake', 'beyonce', 'bieber', 'hollywood', 'paparazzi', 'gossip', 'red carpet', 'met gala', 'oscars', 'grammys'] },
  { name: 'Sports', words: ['nfl', 'nba', 'mlb', 'nhl', 'premier league', 'champions league', 'fifa', 'world cup', 'super bowl', 'touchdown', 'playoff*', 'transfer window', 'formula 1', 'f1', 'ufc'] },
  { name: 'TV and movie spoilers', words: ['spoiler*', 'spoil*', 'finale', 'season finale', 'ending explained', 'post credit*', 'plot twist', 'leaked'] },
  { name: 'Crypto and stocks', words: ['crypto*', 'bitcoin', 'btc', 'ethereum', 'nft', 'nfts', 'dogecoin', 'memecoin*', 'solana', 'blockchain', 'hodl', 'stonks', 'to the moon', 'wallstreetbets', 'short squeeze'] },
  { name: 'AI', words: ['chatgpt', 'openai', 'gpt', 'llm', 'llms', 'ai art', 'ai generated', 'midjourney', 'generative ai', 'deepfake*', 'sora'] },
  { name: 'Animals', words: ['cat', 'cats', 'kitten*', 'kitty', 'dog', 'dogs', 'puppy', 'puppies', 'pupper*', 'doggo*', 'parrot*', 'hamster*', 'bunny', 'bunnies'] },
  { name: 'Anime', words: ['anime', 'manga', 'waifu*', 'isekai', 'one piece', 'naruto', 'jujutsu kaisen', 'demon slayer', 'my hero academia', 'cosplay*'] },
  { name: 'Video games', words: ['gta 6', 'gta vi', 'fortnite', 'minecraft', 'pokemon', 'nintendo', 'playstation', 'ps5', 'xbox', 'steam deck', 'speedrun*', 'patch notes'] },
  { name: 'Memes and slang', words: ['meme', 'memes', 'shitpost*', 'skibidi', 'rizz', 'gyatt', 'sigma', 'npc', 'based', 'ratio', 'copium'] },
  { name: 'Crime and violence', words: ['murder*', 'murdered', 'shooting', 'shootings', 'stabbed', 'stabbing', 'killed', 'homicide', 'gunman', 'massacre', 'abuse*', 'assault*', 'true crime'] },
  { name: 'Road rage and dashcams', words: ['road rage', 'dashcam', 'dash cam', 'crash', 'car crash', 'tesla', 'cybertruck', 'karen', 'instant karma'] }
];
