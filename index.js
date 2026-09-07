const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const { DateTime } = require("luxon");

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const POLL_INTERVAL = 60 * 1000; // 60 seconds
const EVENT_WINDOW = 48 * 60 * 60 * 1000; // 2 days

const CATEGORIES = [
  "football",
  "tennis",
  "basketball",
  "fights",
  "motorsports",
  "nfl",
  "nhl",
  "mlb",
  "rugby",
  "golf",
  "others",
  "wrestling",
  "darts"
];

const EVENTS_LINK =
  "https://discord.com/channels/1372972743464714370/1455146521975586878/1541192756104273923";

const REQUEST_LINK =
  "https://discord.com/channels/1372972743464714370/1455147734544941162";

const API_BASE = "https://futbol-x.xyz/api";

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// --------------------------------------------------
// TIME
// --------------------------------------------------

function parseEAT(dateString) {
  return DateTime.fromISO(dateString, {
    zone: "Africa/Nairobi"
  });
}

// --------------------------------------------------
// FETCH EVENTS
// --------------------------------------------------

async function fetchCategory(category) {
  try {
    const response = await fetch(`${API_BASE}/${category}.json`);

    if (!response.ok) {
      console.error(`Failed to fetch ${category}: ${response.status}`);
      return [];
    }

    const data = await response.json();

    if (!data.success || !Array.isArray(data.streams)) {
      return [];
    }

    const events = [];

    for (const group of data.streams) {
      if (!Array.isArray(group.streams)) continue;

      for (const event of group.streams) {
        if (!event.name || !event.starts_at || !event.ends_at) continue;

        events.push({
          category: category,
          name: event.name,
          starts_at: event.starts_at,
          ends_at: event.ends_at
        });
      }
    }

    return events;
  } catch (error) {
    console.error(`Error fetching ${category}:`, error.message);
    return [];
  }
}

async function fetchAllEvents() {
  const results = await Promise.all(
    CATEGORIES.map(category => fetchCategory(category))
  );

  return results.flat();
}

// --------------------------------------------------
// EVENT FILTERING
// --------------------------------------------------

function processEvents(events) {
  const now = DateTime.now().setZone("Africa/Nairobi");

  const filtered = [];

  for (const event of events) {
    const start = parseEAT(event.starts_at);
    const end = parseEAT(event.ends_at);

    if (!start.isValid || !end.isValid) continue;

    const isLive = now >= start && now < end;

    const startsWithin48Hours =
      start > now && start <= now.plus({ hours: 48 });

    // Show LIVE events
    // OR upcoming events within the next 48 hours.
    if (isLive || startsWithin48Hours) {
      filtered.push({
        ...event,
        start,
        end,
        isLive
      });
    }
  }

  // Earliest events first
  filtered.sort((a, b) => a.start.toMillis() - b.start.toMillis());

  return filtered;
}

// --------------------------------------------------
// DISCORD TIMESTAMP
// --------------------------------------------------

function discordTimestamp(dateTime) {
  return `<t:${Math.floor(dateTime.toSeconds())}:F>`;
}

// --------------------------------------------------
// BUILD MESSAGE
// --------------------------------------------------

function buildMessage(events) {
  let message = "";

  message += "━━━━━━━━━━━━━━━━━━━━\n";
  message += "        **FUTBOL-X**\n";
  message += "     **LIVE & UPCOMING**\n";
  message += "━━━━━━━━━━━━━━━━━━━━\n\n";

  const liveEvents = events.filter(event => event.isLive);

  if (liveEvents.length > 0) {
    message += "🔴 **LIVE NOW**\n\n";

    for (const event of liveEvents) {
      message += `⚽ **${event.name}**\n`;
      message += "🔴 LIVE\n\n";
    }

    message += "━━━━━━━━━━━━━━━━━━━━\n\n";
  }

  // Group by category
  const grouped = {};

  for (const event of events) {
    if (event.isLive) continue;

    if (!grouped[event.category]) {
      grouped[event.category] = [];
    }

    grouped[event.category].push(event);
  }

  for (const category of CATEGORIES) {
    const categoryEvents = grouped[category];

    // Don't show empty categories
    if (!categoryEvents || categoryEvents.length === 0) continue;

    message += `${categoryEmoji(category)} **${category.toUpperCase()}**\n\n`;

    for (const event of categoryEvents) {
      message += `**${event.name}**\n`;
      message += `🕐 ${discordTimestamp(event.start)}\n\n`;
    }

    message += "\n";
  }

  // Permanent links at bottom
  message += "━━━━━━━━━━━━━━━━━━━━\n\n";
  message += `🔗 **Events Links Here;**\n${EVENTS_LINK}\n\n`;
  message += `📝 **Event Request Here;**\n${REQUEST_LINK}`;

  return message;
}

// --------------------------------------------------
// CATEGORY EMOJIS
// --------------------------------------------------

function categoryEmoji(category) {
  const emojis = {
    football: "⚽",
    tennis: "🎾",
    basketball: "🏀",
    fights: "🥊",
    motorsports: "🏎️",
    nfl: "🏈",
    nhl: "🏒",
    mlb: "⚾",
    rugby: "🏉",
    golf: "⛳",
    others: "📺",
    wrestling: "🤼",
    darts: "🎯"
  };

  return emojis[category] || "📺";
}

// --------------------------------------------------
// FIND OR CREATE MESSAGE
// --------------------------------------------------

async function getScheduleMessage(channel) {
  const messages = await channel.messages.fetch({
    limit: 50
  });

  const existing = messages.find(message =>
    message.author.id === client.user.id &&
    message.content.includes("FUTBOL-X") &&
    message.content.includes("Events Links Here")
  );

  if (existing) {
    return existing;
  }

  return await channel.send("Loading Futbol-X schedule...");
}

// --------------------------------------------------
// UPDATE
// --------------------------------------------------

async function updateSchedule() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);

    if (!channel || !channel.isTextBased()) {
      console.error("Configured channel is not a text channel.");
      return;
    }

    const allEvents = await fetchAllEvents();
    const events = processEvents(allEvents);

    const content = buildMessage(events);

    const message = await getScheduleMessage(channel);

    await message.edit(content);

    console.log(
      `Schedule updated: ${events.length} events (${new Date().toISOString()})`
    );
  } catch (error) {
    console.error("Schedule update error:", error);
  }
}

// --------------------------------------------------
// START
// --------------------------------------------------

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await updateSchedule();

  setInterval(updateSchedule, POLL_INTERVAL);
});

if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN environment variable.");
  process.exit(1);
}

if (!CHANNEL_ID) {
  console.error("Missing DISCORD_CHANNEL_ID environment variable.");
  process.exit(1);
}

client.login(TOKEN);
